// ------------------------------
// guest-analysis.js (tam sürüm)
// ------------------------------
const resultsEl = document.getElementById("results");
const metaEl    = document.getElementById("meta");

// ---- SessionStorage'tan veriyi al
const stored = sessionStorage.getItem("analysisResults");
const fname  = sessionStorage.getItem("uploadedFileName") || "Bilinmiyor";
metaEl.textContent = "Dosya: " + fname;

if (!stored) {
  resultsEl.innerHTML = `
    <div class="result-card" style="grid-column:1/-1;text-align:center">
      <h3>Veri bulunamadı</h3>
      <p>Önce <strong>guest-options</strong> sayfasından bir dosya yükleyip analiz etmelisin.</p>
    </div>`;
} else {
  const data = JSON.parse(stored);
  // Bazı sürümlerde sonuç "stats" altına konuyor olabilir
  const root = data?.stats || data;

  // ---- Grafik kartları
  const PRETTY = {
    sentiment: "Duygu Etiketleri",
    intent: "Niyet Etiketleri",
    legal: "Hukuki Sınıflandırma",
    intent_purity: "Niyet Temizliği"
  };
  const ORDER = ["sentiment", "legal", "intent", "intent_purity"];
  const keys  = ORDER.filter(k => root[k]);

  if (keys.length === 0) {
    resultsEl.innerHTML = `
      <div class="result-card" style="grid-column:1/-1;text-align:center">
        <h3>Uyarı</h3>
        <p>Beklenen kolonlar bulunamadı ya da tümü boş geldi.</p>
      </div>`;
  } else {
    keys.forEach(col => {
      const title  = PRETTY[col] || col;
      const bar64  = root[col]?.bar_chart;
      const pie64  = root[col]?.pie_chart;
      const counts = root[col]?.counts || {};
      const entries = Object.entries(counts);

      let tableHtml = "";
      if (entries.length) {
        tableHtml = `
          <details style="margin-top:.75rem;">
            <summary>Detaylı sayımlar</summary>
            <div style="overflow:auto; margin-top:.5rem;">
              <table style="width:100%; border-collapse:collapse;">
                <thead>
                  <tr>
                    <th style="text-align:left; border-bottom:1px solid #eee; padding:.4rem;">Etiket</th>
                    <th style="text-align:right; border-bottom:1px solid #eee; padding:.4rem;">Adet</th>
                  </tr>
                </thead>
                <tbody>
                  ${entries.map(([k, v]) => `
                    <tr>
                      <td style="padding:.4rem; border-bottom:1px solid #f3f3f3;">${k}</td>
                      <td style="padding:.4rem; border-bottom:1px solid #f3f3f3; text-align:right;">${v}</td>
                    </tr>`).join("")}
                </tbody>
              </table>
            </div>
          </details>`;
      }

      const imgId = `chart-${col}`;
      const startWithPie = (col === "intent" || col === "intent_purity") && !!pie64;
      const initial64    = startWithPie ? (pie64 || bar64) : (bar64 || pie64);

      resultsEl.insertAdjacentHTML("beforeend", `
        <div class="result-card">
          <h3>
            ${title}
            ${(bar64 || pie64) && pie64
              ? `<button class="toggle-btn" data-target="${imgId}" data-bar="${bar64 || ""}" data-pie="${pie64 || ""}">➡</button>`
              : ""}
          </h3>
          ${initial64
            ? `<img id="${imgId}" class="chart-img chart-slide" alt="${title} grafiği"
                   src="data:image/png;base64,${initial64}" data-showing="${startWithPie ? 'pie' : 'bar'}"/>`
            : `<p>Grafik bulunamadı.</p>`}
          ${tableHtml}
        </div>
      `);
    });

    // Grafik türü toggle
    document.querySelectorAll(".toggle-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const img = document.getElementById(btn.dataset.target);
        if (!img) return;
        const current = img.dataset.showing || "bar";
        const next    = current === "pie" ? "bar" : "pie";
        const next64  = (next === "pie") ? btn.dataset.pie : btn.dataset.bar;
        if (!next64) return;
        img.classList.remove("slide-in");
        void img.offsetWidth; // reflow
        img.src = `data:image/png;base64,${next64}`;
        img.dataset.showing = next;
        img.classList.add("slide-in");
      });
    });
  }

  // -------------------------------------------------
  // AŞAĞISI: FİLTRE PANELİ + TABLO + DİLEKÇE BUTONU
  // -------------------------------------------------

  // DOM referansları
  const rowsBody = document.getElementById("rowsBody");
  const searchBox = document.getElementById("searchBox");
  const clearBtn  = document.getElementById("clearFilters");
  const pagerPrev = document.getElementById("prevPage");
  const pagerNext = document.getElementById("nextPage");
  const pageInfo  = document.getElementById("pageInfo");

  // Filtre kutuları (checkbox listeleri) için alanlar
  const labelAreas = {
    sentiment: document.getElementById("f-sentiment"),
    legal: document.getElementById("f-legal"),
    intent: document.getElementById("f-intent"),
    intent_purity: document.getElementById("f-intent_purity")
  };

  // --- Kayıtlar & meta ---
  // Backend başka anahtar altında göndermiş olabilir: data.records ya da data.stats.records
  const records = data?.records || data?.stats?.records || [];
  const meta = data?.meta || data?.stats?.meta || {};

  // Checkbox listelerini grafik counts’larından hazırla
  function renderCheckboxes(col) {
    const container = labelAreas[col];
    if (!container) return;
    const items = Object.entries(root[col]?.counts || {});
    if (!items.length) { container.innerHTML = `<em>Veri yok</em>`; return; }
    container.innerHTML = items.map(([lbl, n]) => `
      <label style="display:block;margin:.15rem 0;">
        <input type="checkbox" name="${col}" value="${lbl}"> ${lbl} <span class="kv">(${n})</span>
      </label>
    `).join("");
  }
  ["sentiment","legal","intent","intent_purity"].forEach(renderCheckboxes);

  // ---- Hücre genişletme ve normalize (filter fix) ----
  function stripAccents(s) {
    try { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
    catch { return s; }
  }
  function keyify(s) {
    return stripAccents((s || "").toString().toLowerCase())
      .replace(/\s+/g, " ").trim()
      .replace(/[^\w]+/g, "");
  }
  function expandCell(raw) {
    if (raw == null) return [];
    let t = String(raw).trim();
    if (!t) return [];

    // 1) JSON
    try {
      const obj = JSON.parse(t);
      if (Array.isArray(obj)) return obj.map(String);
      if (obj && Array.isArray(obj.choices)) return obj.choices.map(String);
      if (typeof obj === "string") t = obj;
    } catch (_) {}

    // 2) "choices:[...]" veya tek "[...]"
    let m = t.match(/choices\s*:\s*\[([^\]]+)\]/i) || t.match(/\[([^\]]+)\]/);
    if (m) {
      return m[1].split(",")
        .map(x => x.replace(/^['"]|['"]$/g, "").trim())
        .filter(Boolean);
    }
    // 3) fallback: virgülle böl
    return t.split(",").map(x => x.trim()).filter(Boolean);
  }

  // Metin kolonu tespit
  const TEXT_CANDIDATES = (meta?.text_col && [meta.text_col]) ||
                          ["text","yorum","comment","content","tweet","message","body"];
  function findTextCol(recs) {
    if (!Array.isArray(recs) || !recs.length) return "text";
    const cols = Object.keys(recs[0] || {});
    for (const c of TEXT_CANDIDATES) {
      if (cols.includes(c)) return c;
    }
    // ilk string benzeri alanı bul
    for (const c of cols) {
      if (typeof (recs[0]?.[c]) === "string") return c;
    }
    return "text";
  }
  const TEXT_COL = findTextCol(records);

  // ---- Filtreleme (AND mantığı) + arama ----
  const PAGE_SIZE = 20;
  let page = 1;
  let currentFiltered = [];
  let currentView     = [];

  function getActiveFilters() {
    const f = {};
    Object.keys(labelAreas).forEach(col => {
      const cbs = labelAreas[col]?.querySelectorAll('input[type="checkbox"]:checked') || [];
      f[col] = Array.from(cbs).map(x => x.value);
    });
    f.q = (searchBox?.value || "").trim().toLowerCase();
    return f;
  }

  function passFilters(row, f) {
    // Metin araması
    const text = (row[TEXT_COL] || "").toString().toLowerCase();
    if (f.q && !text.includes(f.q)) return false;

    // Etiket kolonları için: seçili yoksa serbest; varsa HÜCRE→liste→normalize→TAM eşleşme (AND)
    for (const col of ["sentiment","legal","intent","intent_purity"]) {
      const sel = f[col];
      if (!sel || sel.length === 0) continue;

      const tokens = expandCell(row[col] || "").map(keyify);
      if (tokens.length === 0) return false;

      const wants = sel.map(keyify);
      const ok = wants.every(w => tokens.includes(w));
      if (!ok) return false;
    }
    return true;
  }

  // Tablo render
  function escapeHtml(s) {
    return (s || "").toString()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function renderTable() {
    if (!rowsBody) return; // HTML'de tablo bölümü yoksa sessizce geç
    if (!records || !records.length) {
      rowsBody.innerHTML = `
        <tr><td colspan="6" style="padding:.6rem;color:#666;">
          Bu sürümde kayıt listesi gönderilmediği için tablo gösterilemiyor.
        </td></tr>`;
      if (pageInfo) pageInfo.textContent = `0 kayıt`;
      if (pagerPrev) pagerPrev.disabled = true;
      if (pagerNext) pagerNext.disabled = true;
      return;
    }

    const f = getActiveFilters();
    const filtered = records.filter(r => passFilters(r, f));
    currentFiltered = filtered;

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages) page = pages;

    const start = (page - 1) * PAGE_SIZE;
    const view  = filtered.slice(start, start + PAGE_SIZE);
    currentView = view;

    rowsBody.innerHTML = view.map((r, i) => {
      const text = escapeHtml(r[TEXT_COL] || "");

      // Gösterimde insan-okur etiket dizeleri (ham JSON görmeyelim)
      const showCell = col => {
        const arr = expandCell(r[col] || "");
        return escapeHtml(arr.join(", "));
      };

      // Dilekçe butonu aktif/pasif
      const isUygunsuz = expandCell(r.legal || "").some(x => /uygunsuzluk\s*yok/i.test(x));
      const isSpam     = expandCell(r.intent || "").some(x => /(spam\s*\/\s*tanıtım|\bspam\b)/i.test(x));
      const disabled   = (isUygunsuz || isSpam) ? "disabled" : "";

      return `
        <tr>
          <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${text}</td>
          <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${showCell("sentiment")}</td>
          <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${showCell("legal")}</td>
          <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${showCell("intent")}</td>
          <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${showCell("intent_purity")}</td>
          <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">
            <button class="btn-outline btn-petition dilekce-btn" data-idx="${start + i}" ${disabled}>
              Dilekçe Oluştur
            </button>
          </td>
        </tr>
      `;
    }).join("");

    if (pageInfo) pageInfo.textContent = `${total} kayıt · Sayfa ${page}/${pages}`;
    if (pagerPrev) pagerPrev.disabled  = (page <= 1);
    if (pagerNext) pagerNext.disabled  = (page >= pages);
  }

  // Dilekçe butonu tıklaması (event delegation)
  if (rowsBody) {
    rowsBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-petition");
      if (!btn) return;
      if (btn.disabled) return;

      const idx = parseInt(btn.dataset.idx, 10);
      const row = currentFiltered[idx];
      if (!row) return;

      // Bu noktadan sonra yönlendirme / modal açma / template doldurma yapılabilir
      // Ör: window.location.href = `petition.html?i=${idx}`;
      // Dilekçe butonu tıklaması (event delegation)
if (rowsBody) {
  rowsBody.addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-petition");
    if (!btn) return;
    if (btn.disabled) return;

    const idx = parseInt(btn.dataset.idx, 10);

    // Şu anki filtre sonucundaki gerçek satırı al
    const row = currentFiltered[idx];
    if (!row) return;

    // 1) Kullanıcıdan ad soyad al
    const adSoyad = prompt("Dilekçe sahibi Ad Soyad:");
    if (!adSoyad) return;

    // 2) Backend'e göndereceğimiz gövdeyi hazırla
    // - Text kolonu tespiti zaten üstteki TEXT_COL ile yapılmıştı
    const textCol = TEXT_COL;
    const yorum = (row[textCol] || "").toString();

    // Hücreleri JSON/virgül/basit dizi gibi farklı formatlardan normalize eden yardımcı
    const expandCell = (raw) => {
      if (raw == null) return [];
      let t = String(raw).trim();
      if (!t) return [];
      try {
        const obj = JSON.parse(t);
        if (Array.isArray(obj)) return obj.map(String);
        if (obj && Array.isArray(obj.choices)) return obj.choices.map(String);
        if (typeof obj === "string") t = obj;
      } catch (_) {}
      let m = t.match(/choices\s*:\s*\[([^\]]+)\]/i) || t.match(/\[([^\]]+)\]/);
      if (m) {
        return m[1].split(",").map(x => x.replace(/^['"]|['"]$/g, "").trim()).filter(Boolean);
      }
      return t.split(",").map(x => x.trim()).filter(Boolean);
    };

    // Hukuki etiketleri labels olarak gönderelim (şablon bunları yazıyor)
    const labels = expandCell(row.legal || "");

    // İsteğe bağlı: video analizinden geldiysen meta içinde platform, tarih, link olabilir
    const stored = sessionStorage.getItem("analysisResults");
    const payloadAll = stored ? JSON.parse(stored) : {};
    const videoMeta  = payloadAll?.video_meta || null;

    const platform    = videoMeta ? "YouTube" : "Sosyal Medya";
    const tarih       = videoMeta?.publishedAt?.slice(0, 10) || new Date().toLocaleDateString("tr-TR");
    const yorum_linki = videoMeta ? `https://www.youtube.com/watch?v=${videoMeta.videoId}` : "";

    const body = {
      ad_soyad: adSoyad,
      labels,
      platform,
      tarih,
      yorum,
      yorum_linki
    };

    // 3) PDF’i backend’den iste
    try {
      const resp = await fetch("http://127.0.0.1:5000/petition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert("PDF oluşturulamadı: " + (err?.error || resp.status));
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      // 4) İndir
      const a = document.createElement("a");
      a.href = url;
      a.download = `dilekce_${idx + 1}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("İstek hatası: " + err);
    }
  });
}
;
    });
  }

  // Eventler
  Object.values(labelAreas).forEach(box => {
    if (!box) return;
    box.addEventListener("change", () => { page = 1; renderTable(); });
  });
  if (searchBox) {
    searchBox.addEventListener("input", () => { page = 1; renderTable(); });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      Object.values(labelAreas).forEach(box => {
        box?.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb.checked = false));
      });
      if (searchBox) searchBox.value = "";
      page = 1;
      renderTable();
    });
  }
  if (pagerPrev) pagerPrev.addEventListener("click", () => { if (page > 1) { page--; renderTable(); }});
  if (pagerNext) pagerNext.addEventListener("click", () => { page++; renderTable(); });

  // İlk çizim
  renderTable();
}