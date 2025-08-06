document.addEventListener("DOMContentLoaded", function () {
    const token = localStorage.getItem("token");

    if (!token) {
        alert("Lütfen önce giriş yapın.");
        window.location.href = "login.html";
        return;
    }

    fetch("http://localhost:8000/get_preferences", {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`
        }
    })
        .then(res => {
            if (!res.ok) {
                if (res.status === 404) {
                    console.warn("Henüz tercih oluşturulmamış kullanıcı");
                    return {};  // boş obje gönder → alttaki .then(data => ...) kısmı patlamasın
                }
                throw new Error("Kullanıcı bilgileri alınamadı");
            }

        })
        .then(data => {
            if (data.mode === "duzenli") {
                document.querySelector("input[value='duzenli']").checked = true;
                document.getElementById("frequency-options").style.display = "block";
            } else if (data.mode === "tekil") {
                document.querySelector("input[value='tekil']").checked = true;
            }

            if (data.frequency) {
                document.querySelector(`input[name="frequency"][value="${data.frequency}"]`).checked = true;
            }

            if (data.platform) {
                document.getElementById("platform").value = data.platform;
            }

        })
        .catch(error => {
            console.warn("Tercih yok veya başka bir hata:", error);
            // Tercih bulunamadıysa, sadece formu boş göster
            // alert yerine console log bırak
            // login'e yönlendirme yapma
        });



    // Sıklık seçeneklerini göster/gizle
    const modeInputs = document.querySelectorAll('input[name="mode"]');
    modeInputs.forEach(input => {
        input.addEventListener("change", function () {
            const frequencyOptions = document.getElementById("frequencyOptions");
            if (this.value === "duzenli") {
                frequencyOptions.style.display = "block";
            } else {
                frequencyOptions.style.display = "none";
            }
        });
    });

    // Kaydet butonuna basıldığında tercihleri gönder
    document.getElementById("save-button").addEventListener("click", function () {
        const modeInput = document.querySelector('input[name="mode"]:checked');
        const frequencyInput = document.querySelector('input[name="frequency"]:checked');
        const platformInput = document.getElementById("platform");

        const mode = modeInput ? modeInput.value : "";
        const frequency = frequencyInput ? frequencyInput.value : null;
        const platform = platformInput ? platformInput.value : "";



        if (!mode || !platform) {
            alert("Lütfen tüm gerekli alanları doldurun.");
            return;
        }

        const payload = {
            mode: mode,
            frequency: mode === "duzenli" ? frequency : null,
            platform: platform
        };


        fetch("http://localhost:8000/update_preferences", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`

            },
            body: JSON.stringify(payload)
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error("Tercihler kaydedilemedi.");
                }
                return response.json();
            })
            .then(data => {
                alert("Tercihler başarıyla kaydedildi!");
                window.location.href = "/index.html";
            })
            .catch(error => {
                console.error("Hata:", error);
                alert("Tercihler kaydedilirken bir hata oluştu.");
            });
    });
});
