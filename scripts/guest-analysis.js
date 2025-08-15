// ------------------------------
// guest-analysis.js (birleşik ve düzeltilmiş sürüm)
// - Grafikler
// - Dropdown filtreler (placeholder + 0'lı liste + seçili sayacı)
// - Search box
// - Tablo + sayfalama
// - Dilekçe modalı: PDF ÖNİZLEME (iframe) + PDF oluşturma (arkadaşının akışı)
// ------------------------------
const resultsEl = document.getElementById("results");
const metaEl = document.getElementById("meta");

// ---- SessionStorage
const stored = sessionStorage.getItem("analysisResults");
const fname = sessionStorage.getItem("uploadedFileName") || "Bilinmiyor";
if (metaEl) metaEl.textContent = "Dosya: " + fname;

if (!stored) {
  if (resultsEl) {
    resultsEl.innerHTML = `
      <div class="result-card" style="grid-column:1/-1;text-align:center">
        <h3>Veri bulunamadı</h3>
        <p>Önce <strong>guest-options</strong> sayfasından bir dosya yükleyip analiz etmelisin.</p>
      </div>`;
  }
} else {
  const data = JSON.parse(stored);
  const root = data?.stats || data;

  // ---- Grafik kartları
  const PRETTY = {
    sentiment: "Duygu Etiketleri",
    intent: "Niyet Etiketleri",
    legal: "Hukuki Sınıflandırma",
    intent_purity: "Niyet Temizliği"
  };
  const ORDER = ["sentiment", "legal", "intent", "intent_purity"];
  const keys = ORDER.filter(k => root[k]);

  if (resultsEl) {
    if (keys.length === 0) {
      resultsEl.innerHTML = `
        <div class="result-card" style="grid-column:1/-1;text-align:center">
          <h3>Uyarı</h3>
          <p>Beklenen kolonlar bulunamadı ya da tümü boş geldi.</p>
        </div>`;
    } else {
      keys.forEach(col => {
        const title = PRETTY[col] || col;
        const bar64 = root[col]?.bar_chart;
        const pie64 = root[col]?.pie_chart;
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
        const initial64 = startWithPie ? (pie64 || bar64) : (bar64 || pie64);

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
          const next = current === "pie" ? "bar" : "pie";
          const next64 = (next === "pie") ? btn.dataset.pie : btn.dataset.bar;
          if (!next64) return;
          img.classList.remove("slide-in");
          void img.offsetWidth;
          img.src = `data:image/png;base64,${next64}`;
          img.dataset.showing = next;
          img.classList.add("slide-in");
        });
      });
    }
  }

  // -------------------------------------------------
  // FİLTRE PANELİ + TABLO
  // -------------------------------------------------
  const rowsBody  = document.getElementById("rowsBody");
  const searchBox = document.getElementById("searchBox");
  const clearBtn  = document.getElementById("clearFilters");
  const pagerPrev = document.getElementById("prevPage");
  const pagerNext = document.getElementById("nextPage");
  const pageInfo  = document.getElementById("pageInfo");

  const labelAreas = {
    sentiment: document.getElementById("f-sentiment"),
    legal: document.getElementById("f-legal"),
    intent: document.getElementById("f-intent"),
    intent_purity: document.getElementById("f-intent_purity")
  };

  const records = data?.records || data?.stats?.records || [];
  const meta = data?.meta || data?.stats?.meta || {};

  function stripAccents(s){ try{ return s.normalize("NFD").replace(/[\u0300-\u036f]/g,""); }catch{return s;} }
  function keyify(s){ return stripAccents((s||"").toString().toLowerCase()).replace(/\s+/g," ").trim().replace(/[^\w]+/g,""); }
  function expandCell(raw){
    if (raw == null) return [];
    let t = String(raw).trim();
    if (!t) return [];
    try {
      const obj = JSON.parse(t);
      if (Array.isArray(obj)) return obj.map(String);
      if (obj && Array.isArray(obj.choices)) return obj.choices.map(String);
      if (typeof obj === "string") t = obj;
    } catch(_) {}
    const m = t.match(/choices\s*:\s*\[([^\]]+)\]/i) || t.match(/\[([^\]]+)\]/);
    if (m) return m[1].split(",").map(x=>x.replace(/^['"]|['"]$/g,"").trim()).filter(Boolean);
    return t.split(",").map(x=>x.trim()).filter(Boolean);
  }

  const TEXT_CANDIDATES = (meta?.text_col && [meta.text_col]) ||
    ["text","yorum","comment","content","tweet","message","body"];
  function findTextCol(recs){
    if (!Array.isArray(recs) || !recs.length) return "text";
    const cols = Object.keys(recs[0] || {});
    for (const c of TEXT_CANDIDATES) if (cols.includes(c)) return c;
    for (const c of cols) if (typeof (recs[0]?.[c]) === "string") return c;
    return "text";
  }
  const TEXT_COL = findTextCol(records);

  const PAGE_SIZE = 20;
  let page = 1;
  let currentFiltered = [];
  let currentView = [];

  // ===== Dropdown filtreler =====
  const SENTIMENT_ALL = [
    "Olumlu","Olumsuz","Nötr","Öfke/Kızgınlık","Üzüntü/Keder",
    "Hayal Kırıklığı","Endişe","Şaşkınlık","Alay/İroni"
  ];
  const INTENT_ALL = [
    "Şikayet/Memnuniyetsizlik","Kamuoyu Bilgilendirmesi/Uyarı","Kişisel Yorum/Gözlem",
    "Öneri/Beklenti/İstek","Bilgi/Açıklama Talebi","Destek/Yardım Talebi",
    "Hakaret/Aşağılama","Tehdit","Taciz","Dolandırıcılık/Sahte Kampanya","Spam/Tanıtım","Mizah/Alay"
  ];
  const LEGAL_ALL = [
    "Hakaret – TCK m.125","Kamu Görevlisine Hakaret – TCK m.125/3","Tehdit – TCK m.106",
    "Taciz – TCK m.105, 123","Nefret/Ayrımcılık – TCK m.122",
    "Toplumu Kin ve Düşmanlığa Tahrik – TCK m.216",
    "Veri İhlali – KVKK m.12, TCK m.136","Ayıplı Mal/Hizmet – TKHK m.8, 11",
    "Dolandırıcılık/Sahte Kampanya – TCK m.157","Spam/Tanıtım","Uygunsuzluk Yok"
  ];
  const PURITY_ALL = ["good_faith","bad_faith","uncertain"];

  const PLACEHOLDER = {
    sentiment:"Duygu etiketi seçiniz",
    legal:"Hukuki etiketi seçiniz",
    intent:"Niyet etiketi seçiniz",
    intent_purity:"Niyet temizliği seçiniz"
  };

  window.__activeFilters = window.__activeFilters || {
    sentiment:new Set(), legal:new Set(), intent:new Set(), intent_purity:new Set()
  };

  function selectionLabel(set, ph){
    const n=set.size; if(!n) return ph;
    const first=[...set][0]; return n===1 ? first : `${first} +${n-1}`;
  }

  function buildFilterDropdown(containerId, _title, countsObj, universe, stateKey){
    const el=document.getElementById(containerId); if(!el) return;
    const counts = countsObj || {};
    const pos = universe.map(l=>({label:l, count:counts[l]||0}))
      .sort((a,b)=>{
        if(a.count===0 && b.count===0) return a.label.localeCompare(b.label,"tr");
        if(a.count===0) return 1; if(b.count===0) return -1; return b.count-a.count;
      });
    const selected = window.__activeFilters[stateKey];

    el.innerHTML = `
      <div class="filter-dd" data-key="${stateKey}">
        <button type="button" class="dd-btn">
          <span class="dd-title" style="color:${selected.size? '#333':'#999'};">
            ${selectionLabel(selected, PLACEHOLDER[stateKey]||"Seçiniz")}
          </span>
          <span class="dd-chip"></span>
        </button>
        <div class="dd-menu">
          ${pos.some(x=>x.count>0) ? `
            <div class="dd-section">
              <h5>Analizde Olanlar</h5>
              ${pos.filter(x=>x.count>0).map(x=>`
                <label class="dd-item">
                  <input type="checkbox" value="${x.label}" ${selected.has(x.label)?"checked":""}/>
                  <span>${x.label}</span><span class="dd-count">${x.count}</span>
                </label>`).join("")}
            </div>` : `<div class="dd-empty">Analizde etiket yok</div>`}
          <div class="dd-section">
            <h5>Diğerleri</h5>
            ${pos.filter(x=>x.count===0).map(x=>`
              <label class="dd-item">
                <input type="checkbox" value="${x.label}" ${selected.has(x.label)?"checked":""}/>
                <span>${x.label}</span><span class="dd-count">0</span>
              </label>`).join("")}
          </div>
        </div>
      </div>`;

    const wrap = el.querySelector(".filter-dd");
    const btn  = wrap.querySelector(".dd-btn");
    const menu = wrap.querySelector(".dd-menu");
    const titleSpan = wrap.querySelector(".dd-title");

    btn.onclick = ()=> wrap.classList.toggle("open");
    document.addEventListener("click",(e)=>{ if(!wrap.contains(e.target)) wrap.classList.remove("open"); });

    menu.querySelectorAll('input[type="checkbox"]').forEach(chk=>{
      chk.addEventListener("change",()=>{
        if(chk.checked) selected.add(chk.value); else selected.delete(chk.value);
        titleSpan.textContent = selectionLabel(selected, PLACEHOLDER[stateKey]||"Seçiniz");
        titleSpan.style.color = selected.size ? "#333" : "#999";
        applyFiltersAndRender();
      });
    });
  }

  function renderAllFilterDropdowns(payload){
    buildFilterDropdown("f-sentiment","Duygu", payload?.sentiment?.counts||{}, SENTIMENT_ALL, "sentiment");
    buildFilterDropdown("f-legal","Hukuki", payload?.legal?.counts||{}, LEGAL_ALL, "legal");
    buildFilterDropdown("f-intent","Niyet", payload?.intent?.counts||{}, INTENT_ALL, "intent");
    buildFilterDropdown("f-intent_purity","Niyet Temizliği", payload?.intent_purity?.counts||{}, PURITY_ALL, "intent_purity");
  }

  function getActiveFilters(){
    const f={}; Object.keys(window.__activeFilters).forEach(k=>f[k]=[...window.__activeFilters[k]||[]]);
    f.q=(searchBox?.value||"").trim().toLowerCase(); return f;
  }

  function passFilters(row,f){
    const text=(row[TEXT_COL]||"").toString().toLowerCase();
    if(f.q && !text.includes(f.q)) return false;
    for(const col of ["sentiment","legal","intent","intent_purity"]){
      const sel=f[col]; if(!sel||!sel.length) continue;
      const tokens = expandCell(row[col]||"").map(keyify);
      if(tokens.length===0) return false;
      const ok = sel.map(keyify).every(w=>tokens.includes(w));
      if(!ok) return false;
    }
    return true;
  }

  function escapeHtml(s){
    return (s||"").toString().replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function renderTable(){
    if(!rowsBody) return;
    if(!records || !records.length){
      rowsBody.innerHTML = `
        <tr><td colspan="6" style="padding:.6rem;color:#666;">
          Bu sürümde kayıt listesi gönderilmediği için tablo gösterilemiyor.
        </td></tr>`;
      if(pageInfo) pageInfo.textContent = `0 kayıt`;
      if(pagerPrev) pagerPrev.disabled = true;
      if(pagerNext) pagerNext.disabled = true;
      return;
    }

    const f=getActiveFilters();
    const filtered = records.filter(r=>passFilters(r,f));
    currentFiltered = filtered;

    const total=filtered.length;
    const pages=Math.max(1, Math.ceil(total/PAGE_SIZE));
    if(page>pages) page=pages;

    const start=(page-1)*PAGE_SIZE;
    const view=filtered.slice(start, start+PAGE_SIZE);
    currentView=view;

    if(view.length===0){
      rowsBody.innerHTML = `<tr><td colspan="6" style="padding:.9rem;color:#777;text-align:center;">
        Sonuç bulunamadı. Filtreleri daralttıysan
        <button id="clearFiltersInline" class="btn-outline" style="margin-left:.4rem;">sıfırla</button>
      </td></tr>`;
      const btn=document.getElementById("clearFiltersInline");
      if(btn) btn.onclick=()=>{
        Object.values(window.__activeFilters).forEach(set=>set.clear());
        if(window.__lastPayload) renderAllFilterDropdowns(window.__lastPayload);
        if(searchBox) searchBox.value="";
        page=1; renderTable();
      };
    } else {
      rowsBody.innerHTML = view.map((r,i)=>{
        const text=escapeHtml(r[TEXT_COL]||"");
        const showCell = col => escapeHtml(expandCell(r[col]||"").join(", "));
        const isUygunsuz = expandCell(r.legal||"").some(x=>/uygunsuzluk\s*yok/i.test(x));
        const isSpam     = expandCell(r.intent||"").some(x=>/(spam\s*\/\s*tanıtım|\bspam\b)/i.test(x));
        const disabled   = (isUygunsuz||isSpam) ? "disabled" : "";

        return `
          <tr>
            <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${text}</td>
            <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${showCell("sentiment")}</td>
            <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${showCell("legal")}</td>
            <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${showCell("intent")}</td>
            <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">${showCell("intent_purity")}</td>
            <td style="padding:.45rem;border-bottom:1px solid #f3f3f3;">
              <button class="btn-outline btn-petition dilekce-btn" data-idx="${start+i}" ${disabled}>
                Dilekçe Oluştur
              </button>
            </td>
          </tr>`;
      }).join("");
    }

    if(pageInfo) pageInfo.textContent = `${total} kayıt · Sayfa ${page}/${pages}`;
    if(pagerPrev) pagerPrev.disabled = (page<=1);
    if(pagerNext) pagerNext.disabled = (page>=pages);
  }

  // ====== DİLEKÇE MODALI + PDF ÖNİZLEME ======
  const petitionModal   = document.getElementById("petitionModal");
  const petitionClose   = document.getElementById("petitionClose");
  const petitionCancel  = document.getElementById("petitionCancel");
  const petitionSubmit  = document.getElementById("petitionSubmit");
  const petitionName    = document.getElementById("petitionName");
  const petitionPreview = document.getElementById("petitionPreview"); // <iframe>

  let __petitionRow=null, __petitionIdx=-1, __videoMeta=null, __previewUrl=null;

  const debounce = (fn,ms=400)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

  function openPetitionModal(row, idx, videoMeta){
    __petitionRow=row; __petitionIdx=idx; __videoMeta=videoMeta||null;

    // ilk açılışta boş iframe; sonra preview üret
    if (petitionPreview) petitionPreview.src = "about:blank";
    petitionName.value = "";
    petitionModal.classList.add("open");
    petitionName.focus();

    refreshPetitionPreview();
    petitionName && petitionName.addEventListener("input", debounce(refreshPetitionPreview, 500));
  }

  function closePetitionModal(){
    petitionModal.classList.remove("open");
    if(__previewUrl){ URL.revokeObjectURL(__previewUrl); __previewUrl=null; }
    petitionPreview?.removeAttribute("src");
  }

  petitionClose?.addEventListener("click", closePetitionModal);
  petitionCancel?.addEventListener("click", closePetitionModal);
  document.addEventListener("keydown",(e)=>{ if(e.key==="Escape" && petitionModal.classList.contains("open")) closePetitionModal(); });
  petitionModal?.addEventListener("click",(e)=>{ if(e.target===petitionModal) closePetitionModal(); });

  // Dilekçe butonu (tabloda)
  rowsBody?.addEventListener("click",(e)=>{
    const btn=e.target.closest(".btn-petition");
    if(!btn || btn.disabled) return;
    const idx=parseInt(btn.dataset.idx,10);
    const row=currentFiltered[idx]; if(!row) return;

    const storedAll = sessionStorage.getItem("analysisResults");
    const payloadAll = storedAll ? JSON.parse(storedAll) : {};
    const videoMeta = payloadAll?.video_meta || null;

    openPetitionModal(row, idx, videoMeta);
  });

  // PDF oluştur (indir)
  petitionSubmit?.addEventListener("click", async ()=>{
    const adSoyad=(petitionName.value||"").trim();
    if(!adSoyad){ petitionName.focus(); return; }
    if(!__petitionRow) return;

    const yorum = (__petitionRow[TEXT_COL]||"").toString();
    const labels = expandCell(__petitionRow.legal||"");
    const platform = __videoMeta ? "YouTube" : "Sosyal Medya";
    const tarih = __videoMeta?.publishedAt?.slice(0,10) || new Date().toLocaleDateString("tr-TR");
    const yorum_linki = __videoMeta ? `https://www.youtube.com/watch?v=${__videoMeta.videoId}` : "";

    const body = { ad_soyad: adSoyad, labels, platform, tarih, yorum, yorum_linki };
    petitionSubmit.disabled = true;

    try{
      const resp = await fetch("http://127.0.0.1:5000/petition", {
        method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body)
      });
      if(!resp.ok){
        const err = await resp.json().catch(()=>({}));
        alert("PDF oluşturulamadı: " + (err?.error || resp.status));
        petitionSubmit.disabled=false; return;
      }
      const blob = await resp.blob();
      closePetitionModal();

      const url = URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`dilekce_${(__petitionIdx+1)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }catch(err){
      alert("İstek hatası: " + err);
      petitionSubmit.disabled=false;
    }
  });

  // PDF önizleme (iframe'e blob URL)
  async function refreshPetitionPreview(){
    if(!__petitionRow || !petitionPreview) return;

    const yorum = (__petitionRow[TEXT_COL]||"").toString();
    const labels = expandCell(__petitionRow.legal||"");
    const platform = __videoMeta ? "YouTube" : "Sosyal Medya";
    const tarih = __videoMeta?.publishedAt?.slice(0,10) || new Date().toLocaleDateString("tr-TR");
    const yorum_linki = __videoMeta ? `https://www.youtube.com/watch?v=${__videoMeta.videoId}` : "";

    const body = {
      ad_soyad: (petitionName.value||"").trim() || "Ad Soyad",
      labels, platform, tarih, yorum, yorum_linki
    };

    try{
      petitionPreview.classList.add("pdf-loading");
      const resp = await fetch("http://127.0.0.1:5000/petition", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        // preview için aynı endpoint kullanılıyor
        body: JSON.stringify(body)
      });
      if(!resp.ok) throw new Error("Önizleme alınamadı");

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if(__previewUrl) URL.revokeObjectURL(__previewUrl);
      __previewUrl = url;

      petitionPreview.src = url; // iframe gösterir
    }catch(e){
      petitionPreview.removeAttribute("src");
    }finally{
      petitionPreview.classList.remove("pdf-loading");
    }
  }

  // Arama + Sıfırlama + Sayfalama
  function applyFiltersAndRender(){ page=1; renderTable(); }
  searchBox?.addEventListener("input", ()=>applyFiltersAndRender());
  clearBtn?.addEventListener("click", ()=>{
    Object.values(window.__activeFilters).forEach(set=>set.clear());
    if(window.__lastPayload) renderAllFilterDropdowns(window.__lastPayload);
    if(searchBox) searchBox.value="";
    applyFiltersAndRender();
  });
  pagerPrev?.addEventListener("click", ()=>{ if(page>1){ page--; renderTable(); }});
  pagerNext?.addEventListener("click", ()=>{ page++; renderTable(); });

  // İlk kurulum
  window.__lastPayload = root;
  renderAllFilterDropdowns(root);
  renderTable();
}