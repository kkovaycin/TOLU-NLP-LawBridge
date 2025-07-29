const freq = document.getElementById("frequencyOptions");
const modeInfo = document.getElementById("modeInfo");

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener("change", function () {
    const selectedMode = this.value;
    localStorage.setItem("usageMode", selectedMode);

    if (selectedMode === "duzenli") {
      freq.style.display = "block";
      modeInfo.innerHTML = "<strong>Düzenli Mod:</strong> Hesap periyodik olarak analiz edilecek.";
    } else {
      freq.style.display = "none";
      modeInfo.innerHTML = "<strong>Düzensiz Mod:</strong> Tek seferlik analiz yapılacak.";
    }

  });
});

function connectAccount() {
  const platform = document.getElementById("platform").value;
  const mode = localStorage.getItem("usageMode") || document.querySelector('input[name="mode"]:checked')?.value;
  const frequency = document.querySelector('input[name="frequency"]:checked')?.value || null;

  const userId = 1; // Test ID, sonra dinamikleşir

  if (mode === "duzenli" && !frequency) {
    alert("Lütfen bir analiz sıklığı (günlük, haftalık veya aylık) seçin.");
    return;
  }

  const payload = {
    user_id: userId,
    platform: platform,
    mode: mode,
    frequency: frequency
  };

  fetch("http://localhost:8000/update_preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Sunucu hatası!");
      }
      return response.json();
    })
    .then((data) => {
      console.log("Güncelleme başarılı:", data);
      alert("Hesabınız başarıyla bağlandı!");
    })
    .catch((error) => {
      console.error("Hata:", error);
      alert("Bir hata oluştu.");
    });
}
