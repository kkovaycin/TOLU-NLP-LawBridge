document.addEventListener("DOMContentLoaded", function () {
  const fileInput  = document.getElementById("fileInput");
  const fileLabel  = document.getElementById("fileLabel");
  const linkInput  = document.getElementById("linkInput");
  const analyzeBtn = document.querySelector(".card .btn");

  // Backend adresi
  const API_BASE = "http://127.0.0.1:5000";
  const ANALYZE_ENDPOINT = API_BASE + "/analyze";

  function updateBtn() {
    const hasFile = fileInput?.files && fileInput.files[0];
    const hasLink = (linkInput?.value || "").trim().length > 0;
    analyzeBtn.disabled = !(hasFile || hasLink);
  }

  if (fileInput && fileLabel) {
    fileInput.addEventListener("change", function () {
      const file = fileInput.files[0];
      if (!file) {
        fileLabel.textContent = "Dosya seç";
      } else {
        const ext = file.name.split(".").pop().toLowerCase();
        if (!["txt","csv"].includes(ext)) {
          alert("Sadece .txt ve .csv formatlarında dosya yükleyebilirsin.");
          fileInput.value = "";
          fileLabel.textContent = "Dosya seç";
        } else {
          fileLabel.textContent = file.name;
        }
      }
      updateBtn();
    });
  }

  if (linkInput) {
    linkInput.addEventListener("input", updateBtn);
  }

  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.addEventListener("click", async () => {
      const hasFile = fileInput?.files && fileInput.files[0];
      const url = (linkInput?.value || "").trim();

      const old = analyzeBtn.textContent;
      analyzeBtn.textContent = "İşleniyor...";
      analyzeBtn.disabled = true;

      try {
        let res;
        if (url && !hasFile) {
          // LINK MODU: JSON gönder
          res = await fetch(ANALYZE_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
          });
        } else if (hasFile) {
          // DOSYA MODU: multipart gönder
          const fd = new FormData();
          fd.append("file", fileInput.files[0], fileInput.files[0].name);
          res = await fetch(ANALYZE_ENDPOINT, { method: "POST", body: fd });
        } else {
          alert("YouTube linki girin veya dosya seçin.");
          return;
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || ("HTTP " + res.status));
        }

        const data = await res.json();

        // Görsel başlık: link kullanıldıysa video başlığını göster
        const displayName =
          (data && data.video_meta && data.video_meta.videoTitle) ||
          (hasFile ? fileInput.files[0].name : "YouTube");

        sessionStorage.setItem("analysisResults", JSON.stringify(data));
        sessionStorage.setItem("uploadedFileName", displayName);

        window.location.href = "./guest-analysis.html";
      } catch (e) {
        alert("Hata: " + (e?.message || "Beklenmeyen hata"));
      } finally {
        analyzeBtn.textContent = old;
        updateBtn();
      }
    });
  }
});
