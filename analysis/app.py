# app.py
# -*- coding: utf-8 -*-
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import base64
from io import BytesIO
from textwrap import wrap
import unicodedata, re, json

app = Flask(__name__)
CORS(app)

TOP_N = 5
TEXT_CANDIDATES = ["text", "yorum", "comment", "content", "tweet", "message", "body"]
LABEL_COLS = ["sentiment", "intent", "legal", "intent_purity"]
MAX_RECORDS = 2000

def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")

def keyify(s: str) -> str:
    s = strip_accents(s.lower())
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"[^\w]+", "", s)

CHOICES_PREFIX_RE = re.compile(r"(?i)\bchoices\s*[:：﹕꞉︰⦂⸬\-—–]*\s*")
ZERO_WIDTHS_RE     = re.compile(r"[\u200B-\u200D\uFEFF]")

def preclean_cell(text: str) -> str:
    t = ZERO_WIDTHS_RE.sub("", str(text))
    t = CHOICES_PREFIX_RE.sub("", t)
    # Genel: m.X, Y → m.X Y (Ayıplı Mal/Hizmet – TKHK m.8, 11 vb.)
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

# Canonical sözlükler
SENTIMENT_CANON = {
    "Öfke/Kızgınlık": ["Öfke / Kızgınlık","Öfke","Kızgınlık"],
    "Üzüntü/Keder": ["Üzüntü / Keder","Üzüntü","Keder"],
    "Hayal Kırıklığı": ["Hayal Kırıklığı"],
    "Endişe": ["Endişe","Kaygı"],
    "Şaşkınlık": ["Şaşkınlık"],
    "Nötr": ["Nötr","Neutral"],
    "Olumlu": ["Olumlu","Pozitif","Positive"],
    "Olumsuz": ["Olumsuz","Negatif","Negative"],
    "Alay/İroni": ["Alay / İroni","Alay","İroni"]
}

INTENT_CANON = {
    "Şikayet/Memnuniyetsizlik": ["Şikayet / Memnuniyetsizlik","Şikayet","Memnuniyetsizlik"],
    "Kamuoyu Bilgilendirmesi/Uyarı": ["Kamuoyu Bilgilendirmesi / Uyarı","Kamuoyu Bilgilendirmesi","Uyarı"],
    "Kişisel Yorum/Gözlem": ["Kişisel Yorum / Gözlem","Kişisel Yorum","Gözlem"],
    "Öneri/Beklenti/İstek": ["Öneri / Beklenti / İstek","Öneri","Beklenti","İstek"],
    "Bilgi/Açıklama Talebi": ["Bilgi / Açıklama Talebi","Bilgi Talebi","Açıklama Talebi","Bilgi","Açıklama"],
    "Destek/Yardım Talebi": ["Destek / Yardım Talebi","Destek Talebi","Yardım Talebi","Destek","Yardım"],
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
        "Nefret – TCK m.122","Ayrımcılık – TCK m.122","TCK m.122","Nefret / Ayrımcılık","Nefret/Ayrımcılık","Nefret Ayrımcılık","Nefret","Ayrımcılık"
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

def _topn_pie_base64(counts: pd.Series, title: str, n: int = TOP_N, exclude=None) -> str | None:
    if counts is None or counts.empty:
        return None
    if exclude:
        counts = counts.drop([x for x in exclude if x in counts.index], errors="ignore")
    if counts.empty:
        return None
    topn = counts.head(n)
    plt.figure(figsize=(7,7))
    plt.pie(topn.values, labels=topn.index, autopct='%1.1f%%', startangle=140)
    plt.title(f"{title} - En Çok {len(topn)} Etiket")
    plt.axis('equal')
    buf = BytesIO()
    plt.savefig(buf, format="png", dpi=150)
    plt.close()
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()

def _donut_topn_base64(counts: pd.Series, title: str, n: int = TOP_N, exclude=None) -> str | None:
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
    legend_labels = [f"{name} ({int(val)})" for name, val in zip(top.index, top.values)]
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

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})

@app.route("/analyze", methods=["POST"])
def analyze():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "Dosya yüklenmedi (form-data 'file' bekleniyor)."}), 400
    try:
        df = pd.read_csv(f, encoding="utf-8-sig")
    except UnicodeDecodeError:
        f.seek(0)
        df = pd.read_csv(f, encoding="utf-8", engine="python")
    except Exception as e:
        return jsonify({"error": f"CSV okunamadı: {e}"}), 400

    results = {}
    for col, pretty in [
        ("sentiment", "Duygu Etiketleri"),
        ("intent", "Niyet Etiketleri"),
        ("legal", "Hukuki Sınıflandırma"),
        ("intent_purity", "Niyet Temizliği"),
    ]:
        r = summarize_dimension(df, col, pretty)
        if r is not None:
            results[col] = r

    if not results:
        return jsonify({"error": "Beklenen kolonlar bulunamadı: sentiment, intent, legal, intent_purity"}), 422

    # --- canonical records ---
    text_col = next((c for c in TEXT_CANDIDATES if c in df.columns), None)
    present_label_cols = [c for c in LABEL_COLS if c in df.columns]
    records = []
    if text_col:
        cols = [text_col] + present_label_cols
        slim = df[cols].head(MAX_RECORDS).copy()
        for c in cols:
            if c == text_col:
                slim[c] = slim[c].astype(str)
            else:
                slim[c] = slim[c].apply(
                    lambda val: json.dumps({
                        "choices": [
                            canonicalize(x, c)
                            for x in _expand_cell(val)
                            if canonicalize(x, c)
                        ]
                    }, ensure_ascii=False)
                )
        records = slim.to_dict(orient="records")

    meta = {
        "text_col": text_col,
        "label_cols": present_label_cols,
        "total_rows": int(len(df))
    }

    payload = dict(results)
    payload["records"] = records
    payload["meta"] = meta
    return jsonify(payload)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
