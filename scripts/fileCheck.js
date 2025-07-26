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
