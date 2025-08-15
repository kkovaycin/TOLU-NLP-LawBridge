# app.py
# -*- coding: utf-8 -*-
import os, re, io, json, time, unicodedata, base64
from urllib.parse import urlparse, parse_qs
from typing import List, Dict, Any, Optional

import pandas as pd
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS, cross_origin

# Matplotlib grafikleri için headless
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from io import BytesIO
from textwrap import wrap

from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape

# ReportLab (PDF)
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from datetime import datetime

# ==========================
# MODELLER (Hugging Face)
# ==========================
from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline

HF_TOKEN = os.getenv("HF_TOKEN", "").strip() or "your_token"

# Modeller (env ile override edilebilir)
MODEL_LEGAL     = os.getenv("MODEL_LEGAL",     "lawbridge/lawbridge-legal-model")
MODEL_INTENT    = os.getenv("MODEL_INTENT",    "lawbridge/intent-berturk")
MODEL_SENTIMENT = os.getenv("MODEL_SENTIMENT", "lawbridge/sentiment-berturk")

# Maks. uzunluklar ve eşikler
LEGAL_MAXLEN  = int(os.getenv("LEGAL_MAXLEN",  "128"))
INTENT_MAXLEN = int(os.getenv("INTENT_MAXLEN", "128"))
SENT_MAXLEN   = int(os.getenv("SENT_MAXLEN",   "128"))

LEGAL_THRESH  = float(os.getenv("LEGAL_THRESH",  "0.45"))
INTENT_THRESH = float(os.getenv("INTENT_THRESH", "0.45"))
SENT_THRESH   = float(os.getenv("SENT_THRESH",   "0.45"))

MAX_LABELS_PER_DIM = int(os.getenv("MAX_LABELS_PER_DIM", "5"))

def _hf_kwargs():
    return {"token": HF_TOKEN} if HF_TOKEN else {}

# Pipelinelar
tokenizer_legal   = AutoTokenizer.from_pretrained(MODEL_LEGAL, **_hf_kwargs())
model_legal       = AutoModelForSequenceClassification.from_pretrained(MODEL_LEGAL, **_hf_kwargs())
clf_legal         = pipeline("text-classification", model=model_legal,   tokenizer=tokenizer_legal)

tokenizer_intent  = AutoTokenizer.from_pretrained(MODEL_INTENT, **_hf_kwargs())
model_intent      = AutoModelForSequenceClassification.from_pretrained(MODEL_INTENT, **_hf_kwargs())
clf_intent        = pipeline("text-classification", model=model_intent,  tokenizer=tokenizer_intent)

tokenizer_sent    = AutoTokenizer.from_pretrained(MODEL_SENTIMENT, **_hf_kwargs())
model_sent        = AutoModelForSequenceClassification.from_pretrained(MODEL_SENTIMENT, **_hf_kwargs())
clf_sentiment     = pipeline("text-classification", model=model_sent,    tokenizer=tokenizer_sent)

def classify_multi(clf, text: str, max_length: int, threshold: float, max_labels: int) -> list[str]:
    """
    Çoklu etiket: tüm skorları al, eşik üzerindekileri sırayla seç.
    Hiçbiri geçmezse en yüksek skoru döndür. Tekilleştirerek döndürür.
    """
    if clf is None or not text or not str(text).strip():
        return []
    try:
        out = clf(
            str(text),
            return_all_scores=True,
            function_to_apply="sigmoid",
            top_k=None,
            truncation=True,
            max_length=max_length
        )
        if isinstance(out, list) and out and isinstance(out[0], list):
            out = out[0]
        if not isinstance(out, list):
            return []

        out = sorted(out, key=lambda d: d.get("score", 0.0), reverse=True)
        picked = [d["label"] for d in out if d.get("score", 0.0) >= threshold]
        if not picked and out:
            picked = [out[0]["label"]]
        if max_labels:
            picked = picked[:max_labels]
        return list(dict.fromkeys(picked))
    except Exception as e:
        print("[MULTI ERROR]", e)
        return []

# ---------------------------------------
# Görsel özet/kanonikleştirme için sözlükler
# ---------------------------------------
def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")

def keyify(s: str) -> str:
    s = strip_accents((s or "").lower())
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"[^\w]+", "", s)

SENTIMENT_CANON = {
    "Öfke/Kızgınlık": ["Öfke / Kızgınlık","Öfke","Kızgınlık"],
    "Üzüntü/Endişe": ["Üzüntü / Endişe","Üzüntü","Endişe"],
    "Hayal Kırıklığı": ["Hayal Kırıklığı"],
    "Nötr": ["Nötr","Neutral"],
    "Olumlu": ["Olumlu","Pozitif","Positive"],
    "Olumsuz": ["Olumsuz","Negatif","Negative"],
    "Alay/İroni": ["Alay / İroni","Alay","İroni"]
}
INTENT_CANON = {
    "Şikayet/Memnuniyetsizlik": ["Şikayet / Memnuniyetsizlik","Şikayet","Memnuniyetsizlik"],
    "Kamuoyu Bilgilendirmesi/Uyarı": ["Kamuoyu Bilgilendirmesi / Uyarı","Kamuoyu Bilgilendirmesi","Uyarı"],
    "Kişisel Yorum/Gözlem": ["Kişisel Yorum / Gözlem","Kişisel Yorum","Gözlem"],
    "Talep": ["Talep"],
    "Hakaret/Aşağılama": ["Hakaret / Aşağılama","Hakaret","Aşağılama"],
    "Tehdit": ["Tehdit"],
    "Taciz": ["Taciz"],
    "Dolandırıcılık/Sahte Kampanya": ["Dolandırıcılık / Sahte Kampanya","Dolandırıcılık","Sahte Kampanya"],
    "Spam/Tanıtım": ["Spam / Tanıtım","Spam","Tanıtım"],
    "Mizah/Alay": ["Mizah / Alay","Mizah","Alay"]
}
LEGAL_CANON = {
    "Hakaret – TCK m.125": ["Hakaret – TCK m.125","Hakaret TCK m.125","Hakaret-TCK m.125","Hakaret"],
    "Tehdit – TCK m.106": ["Tehdit – TCK m.106","Tehdit TCK m.106","Tehdit-TCK m.106","Tehdit"],
    "Taciz – TCK m.105, 123": ["Taciz – TCK m.105, 123","Taciz – TCK m.105 123","Taciz – TCK m.105","Taciz – TCK m.123","Taciz","m.105 123"],
    "Nefret/Ayrımcılık – TCK m.122": [
        "Nefret / Ayrımcılık – TCK m.122","Nefret/Ayrımcılık – TCK m.122","Nefret Ayrımcılık – TCK m.122",
        "Nefret – TCK m.122","Ayrımcılık – TCK m.122","TCK m.122","Nefret / Ayrımcılık","Nefret/Ayrımcılık",
        "Nefret Ayrımcılık","Nefret","Ayrımcılık"
    ],
    "Toplumu Kin ve Düşmanlığa Tahrik – TCK m.216": ["Toplumu Kin ve Düşmanlığa Tahrik – TCK m.216","TCK m.216"],
    "Veri İhlali – KVKK m.12, TCK m.136": ["Veri İhlali – KVKK m.12, TCK m.136","KVKK m.12","TCK m.136","Veri İhlali"],
    "Ayıplı Mal/Hizmet – TKHK m.8, 11": [
        "Ayıplı Mal / Hizmet – TKHK m.8, 11","Ayıplı Mal/Hizmet – TKHK m.8, 11",
        "Ayıplı Mal / Hizmet – TKHK m.8 11","Ayıplı Mal/Hizmet – TKHK m.8 11",
        "Ayıplı Mal / Hizmet – TKHK m.8 ve 11","Ayıplı Mal/Hizmet – TKHK m.8 ve 11",
        "Ayıplı Mal","Ayıplı Hizmet"
    ],
    "Dolandırıcılık/Sahte Kampanya – TCK m.157": ["Dolandırıcılık / Sahte Kampanya – TCK m.157","TCK m.157","Dolandırıcılık","Sahte Kampanya"],
    "Kamu Görevlisine Hakaret – TCK m.125/3": ["Kamu Görevlisine Hakaret – TCK m.125/3","TCK m.125/3"],
    "Uygunsuzluk Yok": ["Uygunsuzluk Yok","Uygunsuzluk yok","None","Yok"]
}
PURITY_CANON = {
    "good_faith": ["good_faith","good faith","iyi niyet"],
    "bad_faith": ["bad_faith","bad faith","kötü niyet"],
    "uncertain": ["uncertain","belirsiz"]
}

def build_alias_map(canon):
    alias = {}
    for canonical, variants in canon.items():
        for v in variants + [canonical]:
            alias[keyify(v)] = canonical
    return alias

ALIAS = {
    "sentiment": build_alias_map(SENTIMENT_CANON),
    "intent": build_alias_map(INTENT_CANON),
    "legal": build_alias_map(LEGAL_CANON),
    "intent_purity": build_alias_map(PURITY_CANON),
}

def canonicalize(token: str, dimension: str) -> str:
    t = token.strip()
    if not re.search(r"[A-Za-z0-9ÇŞĞÜÖİçşğüöı]", t):
        return ""
    k = keyify(t)
    k = re.sub(r"^(choices|intent|sentiment|legal|faith|purity)\s*", "", k)
    return ALIAS.get(dimension, {}).get(k, t)

# Purity tek değer (yalnızca legal'den)
DEFAULT_SENTIMENT = "Olumsuz"
DEFAULT_PURITY    = "uncertain"
PURITY_PRIORITY   = ["bad_faith", "good_faith", "uncertain"]
LEGAL_TO_PURITY = {
    "Hakaret – TCK m.125": "bad_faith",
    "Kamu Görevlisine Hakaret – TCK m.125/3": "bad_faith",
    "Tehdit – TCK m.106": "bad_faith",
    "Taciz – TCK m.105, 123": "bad_faith",
}
def purity_from_legal(legal_labels: list[str]) -> str:
    vals = [LEGAL_TO_PURITY.get(lg, DEFAULT_PURITY) for lg in (legal_labels or [])]
    for p in PURITY_PRIORITY:
        if p in vals:
            return p
    return DEFAULT_PURITY

# ==========================
# Uygulama
# ==========================
app = Flask(__name__)
CORS(app)

# --- DejaVu fontlarını yükle (Türkçe için şart) ---
BASE_DIR  = Path(__file__).resolve().parent
FONTS_DIR = BASE_DIR.parent / "assets" / "fonts" / "dejavu-sans"
try:
    pdfmetrics.registerFont(TTFont("DejaVu",      str(FONTS_DIR / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(FONTS_DIR / "DejaVuSans-Bold.ttf")))
    print("Fontlar yüklendi:", pdfmetrics.getRegisteredFontNames())
except Exception as e:
    print("FONT register hatası:", e)

# --- Jinja template config ---
TEMPLATE_DIR = BASE_DIR.parent / "legal complaint template"
env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(enabled_extensions=("j2",))
)

TOP_N = 8
TEXT_CANDIDATES = ["text", "yorum", "comment", "content", "tweet", "message", "body"]
LABEL_COLS = ["sentiment", "intent", "legal", "intent_purity"]
MAX_RECORDS = 2000

# ==========================
# Çoklu etiket hücre yardımcıları (görselleştirme)
# ==========================
CHOICES_PREFIX_RE = re.compile(r"(?i)\bchoices\s*[:：﹕꞉︰⦂⸬\-—–]*\s*")
ZERO_WIDTHS_RE    = re.compile(r"[\u200B-\u200D\uFEFF]")

def preclean_cell(text: str) -> str:
    t = ZERO_WIDTHS_RE.sub("", str(text))
    t = CHOICES_PREFIX_RE.sub("", t)
    t = re.sub(r"(?i)\bm\.?\s*(\d+)\s*,\s*(\d+)\b", r"m.\1 \2", t)
    t = re.sub(r"[;|]+", ",", t)
    t = re.sub(r",\s*,", ",", t)
    return t

def _expand_cell(text: str) -> list[str]:
    if text is None:
        return []
    raw = str(text).strip()
    if raw == "" or raw.lower() in {"nan", "none"}:
        return []
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict) and "choices" in obj and isinstance(obj["choices"], list):
            return [str(x) for x in obj["choices"]]
        if isinstance(obj, list):
            return [str(x) for x in obj]
        if isinstance(obj, str):
            raw = obj
    except Exception:
        pass
    m = re.search(r'choices\s*:\s*\[([^\]]+)\]', raw, flags=re.I)
    if m:
        inner = m.group(1)
        return [s.strip().strip('\'"') for s in inner.split(",") if s.strip()]
    m2 = re.search(r'\[([^\]]+)\]', raw)
    if m2:
        inner = m2.group(1)
        return [s.strip().strip('\'"') for s in inner.split(",") if s.strip()]
    t = preclean_cell(raw)
    return [p.strip() for p in t.split(",") if p.strip()]

def explode_multilabel(series: pd.Series) -> pd.Series:
    s = series.dropna().map(_expand_cell)
    s = pd.Series([item for sub in s for item in (sub if isinstance(sub, list) else [sub])])
    if s.empty:
        return s
    s = s.astype(str).str.strip()
    s = s[(s != "") & s.str.contains(r"[A-Za-z0-9ÇŞĞÜÖİçşğüöı]", regex=True)]
    return s

def _bar_chart_base64(counts: pd.Series, title: str) -> str | None:
    if counts is None or counts.empty:
        return None
    plt.figure(figsize=(10,6))
    ax = counts.plot(kind="bar")
    ax.set_title(title); ax.set_ylabel("Adet")
    ax.set_xticklabels(["\n".join(wrap(str(i), 20)) for i in counts.index], rotation=0)
    for p in ax.patches:
        h = p.get_height()
        if h:
            ax.annotate(f"{int(h)}",(p.get_x()+p.get_width()/2.,h),
                        ha='center',va='bottom',xytext=(0,3),textcoords='offset points')
    plt.tight_layout()
    buf = BytesIO()
    plt.savefig(buf, format="png", dpi=150)
    plt.close()
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()

def _topn_pie_base64(counts: pd.Series, title: str, n: int = 8, exclude=None) -> str | None:
    if counts is None or counts.empty:
        return None
    if exclude:
        counts = counts.drop([x for x in exclude if x in counts.index], errors="ignore")
    if counts.empty:
        return None
    topn = counts.head(n)
    plt.figure(figsize=(7,7))
    labels = [str(x).replace("%", "%%") for x in topn.index]
    plt.pie(topn.values, labels=labels, autopct='%1.1f%%', startangle=140)
    plt.title(f"{title} - En Çok {len(topn)} Etiket")
    plt.axis('equal')
    buf = BytesIO()
    plt.savefig(buf, format="png", dpi=150)
    plt.close()
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()

def _donut_topn_base64(counts: pd.Series, title: str, n: int = 8, exclude=None) -> str | None:
    if counts is None or counts.empty:
        return None
    if exclude:
        counts = counts.drop([x for x in exclude if x in counts.index], errors="ignore")
    if counts.empty:
        return None
    counts = counts.sort_values(ascending=False)
    top = counts.head(n).copy()
    if len(counts) > n:
        top.loc["Diğer"] = counts.iloc[n:].sum()
    fig, ax = plt.subplots(figsize=(8,6))
    wedges, _texts, autotexts = ax.pie(
        top.values, labels=None, autopct='%1.1f%%', startangle=140,
        wedgeprops=dict(width=0.35)
    )
    ax.set_title(f"{title} – En Çok {min(n, len(counts))} Etiket (+Diğer)")
    ax.axis('equal')
    legend_labels = [f"{str(name).replace('%','%%')} ({int(val)})"
                     for name, val in zip(top.index, top.values)]
    ax.legend(wedges, legend_labels, loc="center left", bbox_to_anchor=(1, 0.5),
              frameon=False, title="Etiketler")
    buf = BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()

def summarize_dimension(df: pd.DataFrame, col: str, pretty: str):
    if col not in df.columns:
        return None
    exploded = explode_multilabel(df[col])
    if exploded.empty:
        return {"counts": {}, "bar_chart": None, "pie_chart": None}
    canon = exploded.map(lambda x: canonicalize(x, col))
    canon = canon[(canon.notna()) & (canon != "")]
    if canon.empty:
        return {"counts": {}, "bar_chart": None, "pie_chart": None}
    counts = canon.value_counts().sort_values(ascending=False)
    bar64 = _bar_chart_base64(counts, f"{pretty} Dağılımı")
    if col in ("intent", "intent_purity"):
        pie64 = _donut_topn_base64(counts, pretty, n=TOP_N)
    elif col == "legal":
        pie64 = _topn_pie_base64(counts, pretty, n=TOP_N, exclude={"Uygunsuzluk Yok"})
    else:
        pie64 = _topn_pie_base64(counts, pretty, n=TOP_N)
    return {"counts": counts.to_dict(), "bar_chart": bar64, "pie_chart": pie64}

# ==========================
# YouTube Yardımcıları
# ==========================
from googleapiclient.discovery import build as gbuild
from googleapiclient.errors import HttpError

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "your_api_key").strip()
SLEEP_BETWEEN_CALLS = 0.05

def _extract_video_id(url_or_id: str) -> Optional[str]:
    s = (url_or_id or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_\-]{8,}", s):
        return s
    try:
        u = urlparse(s)
    except Exception:
        return None
    if u.netloc in {"youtu.be"}:
        vid = u.path.lstrip("/")
        return vid or None
    if u.netloc.endswith("youtube.com"):
        qs = parse_qs(u.query)
        if "v" in qs and qs["v"]:
            return qs["v"][0]
        m = re.match(r"^/shorts/([A-Za-z0-9_\-]+)", u.path or "")
        if m: return m.group(1)
        m = re.match(r"^/live/([A-Za-z0-9_\-]+)", u.path or "")
        if m: return m.group(1)
    return None

def _yt_client(api_key: str):
    if not api_key:
        raise RuntimeError("YOUTUBE_API_KEY eksik.")
    return gbuild("youtube", "v3", developerKey=api_key)

def _get_video_meta(youtube, video_id: str) -> Dict[str, Any]:
    r = youtube.videos().list(part="snippet", id=video_id, maxResults=1).execute()
    items = r.get("items", [])
    if not items:
        raise ValueError(f"Video bulunamadı: {video_id}")
    sn = items[0]["snippet"]
    return {
        "videoId": video_id,
        "videoTitle": sn.get("title", ""),
        "channelId": sn.get("channelId", ""),
        "channelTitle": sn.get("channelTitle", ""),
    }

def _fetch_all_replies(youtube, parent_id: str) -> List[Dict[str, Any]]:
    replies, page_token = [], None
    while True:
        time.sleep(SLEEP_BETWEEN_CALLS)
        r = youtube.comments().list(
            part="snippet", parentId=parent_id, maxResults=100,
            pageToken=page_token, textFormat="plainText"
        ).execute()
        for c in r.get("items", []):
            s = c["snippet"]
            replies.append({
                "commentId": c.get("id"),
                "parentId": parent_id,
                "isReply": 1,
                "authorDisplayName": s.get("authorDisplayName"),
                "authorChannelId": (s.get("authorChannelId") or {}).get("value"),
                "publishedAt": s.get("publishedAt"),
                "likeCount": s.get("likeCount"),
                "text": s.get("textDisplay"),
            })
        page_token = r.get("nextPageToken")
        if not page_token:
            break
    return replies

def _fetch_all_comments(youtube, video_id: str) -> List[Dict[str, Any]]:
    rows, page_token = [], None
    while True:
        time.sleep(SLEEP_BETWEEN_CALLS)
        r = youtube.commentThreads().list(
            part="snippet,replies", videoId=video_id, maxResults=100,
            pageToken=page_token, textFormat="plainText", order="time"
        ).execute()
        for item in r.get("items", []):
            top = item["snippet"]["topLevelComment"]["snippet"]
            top_id = item["snippet"]["topLevelComment"]["id"]
            rows.append({
                "commentId": top_id,
                "parentId": "",
                "isReply": 0,
                "authorDisplayName": top.get("authorDisplayName"),
                "authorChannelId": (top.get("authorChannelId") or {}).get("value"),
                "publishedAt": top.get("publishedAt"),
                "likeCount": top.get("likeCount"),
                "text": top.get("textDisplay"),
            })
            rows.extend(_fetch_all_replies(youtube, top_id))
        page_token = r.get("nextPageToken")
        if not page_token:
            break
    return rows

# ==========================
# IO: Dosya okuma
# ==========================
def read_uploaded_file_to_df(file_storage) -> pd.DataFrame:
    filename = (file_storage.filename or "").lower()
    data = file_storage.read()
    if not data:
        raise ValueError("Boş dosya.")
    bio = io.BytesIO(data)

    if filename.endswith(".csv"):
        try:
            return pd.read_csv(bio, encoding="utf-8-sig")
        except UnicodeDecodeError:
            bio.seek(0)
            return pd.read_csv(bio, encoding="utf-8", engine="python")
    elif filename.endswith(".xlsx") or filename.endswith(".xls"):
        return pd.read_excel(bio)
    elif filename.endswith(".json"):
        return pd.read_json(bio, lines=False)
    else:
        bio.seek(0)
        try:
            return pd.read_csv(bio)
        except Exception:
            bio.seek(0)
            return pd.read_excel(bio)

# ==========================
# Analiz Pipeline
# ==========================
def choose_text_column(df: pd.DataFrame) -> Optional[str]:
    for c in TEXT_CANDIDATES:
        if c in df.columns:
            return c
    obj_cols = [c for c in df.columns if df[c].dtype == "object"]
    if not obj_cols:
        return None
    scores = {c: df[c].dropna().astype(str).map(len).mean() for c in obj_cols}
    return max(scores, key=scores.get) if scores else None

def _maybe_label_with_model(df: pd.DataFrame, text_col: Optional[str]) -> pd.DataFrame:
    if not text_col:
        return df

    sentiments, intents, legals, purities = [], [], [], []
    for t in df[text_col].fillna("").tolist():
        # 1) Legal
        legal_list = classify_multi(clf_legal, t, LEGAL_MAXLEN, LEGAL_THRESH, MAX_LABELS_PER_DIM)
        if not legal_list:
            legal_list = ["Uygunsuzluk Yok"]

        # 2) Intent (kendi modeli)
        intent_list = classify_multi(clf_intent, t, INTENT_MAXLEN, INTENT_THRESH, MAX_LABELS_PER_DIM)
        if not intent_list:
            intent_list = ["Kişisel Yorum/Gözlem"]

        # 3) Sentiment (kendi modeli)
        sent_list = classify_multi(clf_sentiment, t, SENT_MAXLEN, SENT_THRESH, MAX_LABELS_PER_DIM)
        if not sent_list:
            sent_list = [DEFAULT_SENTIMENT]

        # 4) Purity: tek değer (yalnızca legal'den)
        purity = purity_from_legal(legal_list)

        # JSON alanları
        legals.append(json.dumps({"choices": list(dict.fromkeys(legal_list))}, ensure_ascii=False))
        intents.append(json.dumps({"choices": list(dict.fromkeys(intent_list))}, ensure_ascii=False))
        sentiments.append(json.dumps({"choices": list(dict.fromkeys(sent_list))}, ensure_ascii=False))
        purities.append(json.dumps({"choices": [purity]}, ensure_ascii=False))

    df = df.copy()
    # Güvenlik kontrolü (geliştirme için):
    # assert len(sentiments) == len(intents) == len(legals) == len(purities) == len(df), "label list lengths mismatch"

    df["sentiment"]     = sentiments
    df["intent"]        = intents
    df["legal"]         = legals
    df["intent_purity"] = purities
    return df

def _summarize_like_analyze(df: pd.DataFrame) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    text_col = choose_text_column(df)

    results = {}
    for col, pretty in [
        ("sentiment", "Duygu Etiketleri"),
        ("intent", "Niyet Etiketleri"),
        ("legal", "Hukuki Sınıflandırma"),
        ("intent_purity", "Niyet Temizliği"),
    ]:
        if col in df.columns:
            r = summarize_dimension(df, col, pretty)
            if r is not None:
                results[col] = r

    records = []
    if text_col:
        cols = [text_col] + [c for c in LABEL_COLS if c in df.columns]
        slim = df[cols].head(MAX_RECORDS).copy()
        for c in cols:
            if c != text_col and c in slim.columns:
                slim[c] = slim[c].apply(lambda v: json.dumps({"choices": _expand_cell(v)}, ensure_ascii=False))
        records = slim.to_dict(orient="records")

    payload.update(results)
    payload["records"] = records
    payload["meta"] = {
        "text_col": text_col,
        "label_cols": [c for c in LABEL_COLS if c in df.columns],
        "total_rows": int(len(df))
    }
    return payload

# ==========================
# API
# ==========================
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})

@app.route("/analyze", methods=["POST"])
def analyze():
    ct = (request.content_type or "").lower()

    # 1) JSON ile YouTube link akışı (CSV yazmadan)
    if "application/json" in ct:
        try:
            j = request.get_json(force=True, silent=False) or {}
            url = (j.get("url") or "").strip()
        except Exception:
            url = ""
        if url:
            if not YOUTUBE_API_KEY:
                return jsonify({"error": "YOUTUBE_API_KEY ayarlı değil; link akışı kullanılamaz."}), 400
            try:
                vid = _extract_video_id(url)
                if not vid:
                    return jsonify({"error": "Video linki/ID geçersiz."}), 400

                yt = _yt_client(YOUTUBE_API_KEY)
                meta = _get_video_meta(yt, vid)
                rows = _fetch_all_comments(yt, vid)

                df = pd.DataFrame(rows)
                if "text" not in df.columns:
                    df.rename(columns={"Yorum Metni": "text"}, inplace=True)
                    if "text" not in df.columns:
                        df["text"] = ""

                df.insert(0, "videoChannelTitle", meta["channelTitle"])
                df.insert(1, "videoTitle", meta["videoTitle"])
                df.insert(2, "videoId", meta["videoId"])

                text_col   = choose_text_column(df)
                df_labeled = _maybe_label_with_model(df, text_col)
                payload    = _summarize_like_analyze(df_labeled)
                payload["video_meta"] = meta
                return jsonify(payload)

            except HttpError as e:
                return jsonify({"error": f"YouTube API hatası: {e}"}), 502
            except Exception as e:
                return jsonify({"error": f"YouTube akış hatası: {e}"}), 500

    # 2) Dosya akışı (multipart/form-data)
    if "multipart/form-data" in ct and "file" in request.files:
        try:
            f = request.files["file"]
            df = read_uploaded_file_to_df(f)
            text_col = choose_text_column(df)
            if not text_col:
                obj_cols = [c for c in df.columns if df[c].dtype == "object"]
                if obj_cols:
                    df = df.rename(columns={obj_cols[0]: "text"})
                    text_col = "text"

            df_labeled = _maybe_label_with_model(df, text_col)
            payload = _summarize_like_analyze(df_labeled)
            return jsonify(payload)

        except Exception as e:
            return jsonify({"error": f"Dosya analizi hatası: {e}"}), 400

    return jsonify({"error": "Geçersiz istek. JSON {url: ...} veya multipart/form-data ile dosya yükleyin."}), 400

# ==========================
# Dilekçe: şablon + PDF
# ==========================
def render_petition_text(payload: dict) -> str:
    t = env.get_template("dilekce_multi.j2")
    data = dict(payload)
    data["bugun_tarih"] = datetime.now().strftime("%d.%m.%Y")
    return t.render(**data)

def text_to_pdf_bytes(text: str) -> bytes:
    """
    Düz metni DejaVu font ile A4'e basar.
    Otomatik olarak font boyutu / satır aralığını küçültüp tek sayfaya sığdırır.
    Başlık satırları (KONU:, AÇIKLAMALAR:, İLGİLİ MEVZUAT:, DELİL:, SONUÇ ve TALEP:) bold basılır.
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4

    # Kenar boşlukları (biraz dar)
    margin = 1.5 * cm
    left   = margin
    right  = page_w - margin
    top    = page_h - margin
    bottom = margin
    usable_w = right - left
    usable_h = top - bottom

    base_size    = 11.0
    heading_size = 12.0
    min_size     = 8.0
    para_space   = 3

    HEAD_PREFIXES = ("KONU:", "AÇIKLAMALAR:", "İLGİLİ MEVZUAT:", "DELİL:", "SONUÇ ve TALEP:")

    def wrap_by_width(text_line: str, font_name: str, font_size: float) -> list[str]:
        words = (text_line or "").split(" ")
        lines, cur = [], ""
        for w in words:
            test = (cur + (" " if cur else "") + w).strip()
            fname = font_name if font_name in pdfmetrics.getRegisteredFontNames() else "Helvetica"
            if pdfmetrics.stringWidth(test, fname, font_size) <= usable_w:
                cur = test
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
        return lines if lines != [""] else [""]

    paragraphs = [block.rstrip() for block in text.split("\n")]

    size = base_size
    while size >= min_size:
        total_height = 0
        for p in paragraphs:
            is_heading = p.startswith(HEAD_PREFIXES)
            f_name = "DejaVu-Bold" if (is_heading and "DejaVu-Bold" in pdfmetrics.getRegisteredFontNames()) else "DejaVu"
            f_size = heading_size if is_heading else size
            leading = f_size + 3
            wrapped = wrap_by_width(p, f_name, f_size)
            total_height += len(wrapped) * leading + para_space
        if total_height <= usable_h:
            break
        size -= 0.5
        heading_size = max(size + 1, size)

    y = top
    for p in paragraphs:
        is_heading = p.startswith(HEAD_PREFIXES)
        f_name = "DejaVu-Bold" if (is_heading and "DejaVu-Bold" in pdfmetrics.getRegisteredFontNames()) else "DejaVu"
        f_size = heading_size if is_heading else size
        leading = f_size + 3
        try:
            c.setFont(f_name, f_size)
        except:
            c.setFont("Helvetica-Bold" if is_heading else "Helvetica", f_size)

        for line in wrap_by_width(p, f_name, f_size):
            if y - leading < bottom:
                c.showPage()
                y = top
                try:
                    c.setFont(f_name, f_size)
                except:
                    c.setFont("Helvetica-Bold" if is_heading else "Helvetica", f_size)
            c.drawString(left, y, line)
            y -= leading
        y -= para_space

    c.save()
    return buf.getvalue()

@app.route("/petition", methods=["POST", "OPTIONS"])
@cross_origin()
def petition():
    if request.method == "OPTIONS":
        return "", 200

    try:
        j = request.get_json(force=True) or {}
        ad_soyad = (j.get("ad_soyad") or "").strip()
        if not ad_soyad:
            return jsonify({"error": "ad_soyad boş olamaz"}), 400

        labels = j.get("labels") or []
        if not isinstance(labels, list) or not labels:
            return jsonify({"error": "labels boş olamaz"}), 400

        payload = {
            "ad_soyad": ad_soyad,
            "labels": labels,
            "platform": j.get("platform") or "Sosyal Medya",
            "tarih": j.get("tarih") or datetime.now().strftime("%d.%m.%Y"),
            "yorum": j.get("yorum") or "",
            "yorum_linki": j.get("yorum_linki") or "",
        }

        text_out  = render_petition_text(payload)
        pdf_bytes = text_to_pdf_bytes(text_out)

        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"dilekce_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf",
        )
    except Exception as e:
        return jsonify({"error": f"petition hatası: {e}"}), 500

# ==========================
# Main
# ==========================
if __name__ == "__main__":
    if not HF_TOKEN:
        print("UYARI: HF_TOKEN set edilmemiş. Model private ise indirme/yükleme hatası alabilirsin.")
    app.run(host="127.0.0.1", port=5000, debug=True)
