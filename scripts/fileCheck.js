document.addEventListener("DOMContentLoaded", function () {
  const fileInput = document.getElementById("fileInput");
  const fileLabel = document.getElementById("fileLabel");

  fileInput.addEventListener("change", function () {
    const file = fileInput.files[0];
    if (!file) {
      fileLabel.textContent = "Dosya seçilmedi";
      return;
    }

    const allowedExtensions = ["txt", "csv"];
    const extension = file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      alert("Sadece .txt ve .csv formatlarındaki dosyalar yüklenebilir.");
      fileInput.value = "";
      fileLabel.textContent = "Dosya seçilmedi";
      return;
    }

    // Geçerli dosya adı
    fileLabel.textContent = file.name;
  });
});



(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const API_BASE = "http://127.0.0.1:5000";
    const ANALYZE_ENDPOINT = API_BASE + "/analyze";

 
    const fileInput  = document.getElementById("fileInput");
    const fileLabel  = document.getElementById("fileLabel");
 
    const analyzeBtn = document.querySelector(".card .btn");

    if (!fileInput || !fileLabel || !analyzeBtn) {
      console.warn("Gerekli eleman(lar) bulunamadı.");
      return;
    }

    // Başlangıçta butonu kilitle
    analyzeBtn.disabled = true;

    // Dosya seçilince UI güncelle
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        fileLabel.textContent = file.name;
        analyzeBtn.disabled = false;
      } else {
        fileLabel.textContent = "Dosya seç";
        analyzeBtn.disabled = true;
      }
    });

    // Analiz Et → API'ye yükle ve sonuç sayfasına yönlendir
    analyzeBtn.addEventListener("click", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      const oldText = analyzeBtn.textContent;
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = "Yükleniyor...";

      try {
        const fd = new FormData();
        fd.append("file", file, file.name);

        const res = await fetch(ANALYZE_ENDPOINT, { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || ("HTTP " + res.status));
        }
        const data = await res.json();

        sessionStorage.setItem("analysisResults", JSON.stringify(data));
        sessionStorage.setItem("uploadedFileName", file.name);

        window.location.href = "./guest-analysis.html";
      } catch (e) {
        alert("Hata: " + (e?.message || "Beklenmeyen bir hata."));
      } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = oldText;
      }
    });
  });
})();