const resultsEl = document.getElementById("results");
const metaEl = document.getElementById("meta");

const stored = sessionStorage.getItem("analysisResults");
const fname = sessionStorage.getItem("uploadedFileName") || "Bilinmiyor";
metaEl.textContent = "Dosya: " + fname;

if (!stored) {
  resultsEl.innerHTML = `
    <div class="result-card" style="grid-column:1/-1;text-align:center">
      <h3>Veri bulunamadı</h3>
      <p>Önce <strong>guest-options</strong> sayfasından bir dosya yükleyip analiz etmelisin.</p>
    </div>`;
} else {
  const data = JSON.parse(stored);
  console.log("ANALYSIS RESULTS:", data);

  const pretty = {
    sentiment: "Duygu Etiketleri",
    intent: "Niyet Etiketleri",
    legal: "Hukuki Sınıflandırma",
    intent_purity: "Niyet Temizliği"
  };

  const desiredOrder = ["sentiment", "legal", "intent", "intent_purity"];
  const keys = desiredOrder.filter(k => k in data);

  if (keys.length === 0) {
    resultsEl.innerHTML = `
      <div class="result-card" style="grid-column:1/-1;text-align:center">
        <h3>Uyarı</h3>
        <p>Beklenen kolonlar bulunamadı ya da tümü boş geldi.</p>
      </div>`;
  } else {
    keys.forEach(col => {
      const title = pretty[col] || col;
      const bar64 = data[col]?.bar_chart;
      const pie64 = data[col]?.pie_chart;
      const counts = data[col]?.counts || {};
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

      // intent ve intent_purity kartlarını pie ile başlat
      const startWithPie = (col === "intent" || col === "intent_purity") && !!pie64;
      const initial64 = startWithPie ? (pie64 || bar64) : (bar64 || pie64);

      resultsEl.insertAdjacentHTML("beforeend", `
        <div class="result-card">
          <h3>
            ${title}
            ${(bar64 || pie64) && pie64 ? `<button class="toggle-btn" data-target="${imgId}" data-bar="${bar64}" data-pie="${pie64}">➡</button>` : ""}
          </h3>
          ${initial64 ? `<img id="${imgId}" class="chart-img chart-slide" alt="${title} grafiği" src="data:image/png;base64,${initial64}" data-showing="${startWithPie ? 'pie' : 'bar'}"/>`
                       : `<p>Grafik bulunamadı.</p>`}
          ${tableHtml}
        </div>
      `);
    });

    // Toggle olayları
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
