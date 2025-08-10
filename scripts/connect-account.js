document.addEventListener("DOMContentLoaded", function () {
    // Auth manager kontrolü
    if (!window.authManager) {
        console.error("AuthManager yüklenemedi!");
        alert("Sistem hatası: AuthManager bulunamadı");
        window.location.href = "login.html";
        return;
    }

    // Authentication kontrolü
    if (!window.authManager.requireAuth()) {
        return;
    }

    // Kullanıcı tercihlerini yükle
    loadUserPreferences();
    
    // Event listener'ları kur
    setupEventListeners();
});

async function loadUserPreferences() {
    try {
        const response = await window.authManager.authenticatedFetch("/get_preferences");
        
        if (!response) {
            console.log("Tercih bulunamadı, varsayılan değerler kullanılacak");
            return;
        }
        
        if (response.status === 404) {
            console.log("Henüz tercih oluşturulmamış kullanıcı");
            return;
        }
        
        const data = await response.json();
        console.log("🎯 Kullanıcı tercihleri:", data);
        
        // Form alanlarını doldur
        populateForm(data);
        
    } catch (error) {
        console.warn("Tercih yükleme hatası:", error);
        // Hata durumunda da devam et, boş form göster
    }
}

function populateForm(data) {
    try {
        // Mod seçimi
        if (data.mode) {
            const modeInput = document.querySelector(`input[value='${data.mode}']`);
            if (modeInput) {
                modeInput.checked = true;
                
                // Frekans seçeneklerini göster/gizle
                const frequencyOptions = document.getElementById("frequencyOptions");
                if (frequencyOptions) {
                    frequencyOptions.style.display = data.mode === "duzenli" ? "block" : "none";
                }
            }
        }
        
        // Frekans seçimi
        if (data.frequency) {
            const frequencyInput = document.querySelector(`input[name="frequency"][value="${data.frequency}"]`);
            if (frequencyInput) {
                frequencyInput.checked = true;
            }
        }
        
        // Platform seçimi
        if (data.platform) {
            const platformSelect = document.getElementById("platform");
            if (platformSelect) {
                platformSelect.value = data.platform;
            }
        }
        
        // Form durumunu güncelle
        updateFormState();
        
    } catch (error) {
        console.error("Form doldurma hatası:", error);
    }
}

function setupEventListeners() {
    // Mod değişikliği listener'ları
    const modeInputs = document.querySelectorAll('input[name="mode"]');
    modeInputs.forEach(input => {
        input.addEventListener("change", function () {
            const frequencyOptions = document.getElementById("frequencyOptions");
            if (frequencyOptions) {
                frequencyOptions.style.display = this.value === "duzenli" ? "block" : "none";
            }
            updateFormState();
        });
    });

    // Platform değişikliği
    const platformSelect = document.getElementById("platform");
    if (platformSelect) {
        platformSelect.addEventListener("change", updateFormState);
    }

    // Frekans değişikliği
    const frequencyInputs = document.querySelectorAll('input[name="frequency"]');
    frequencyInputs.forEach(input => {
        input.addEventListener("change", updateFormState);
    });

    // Kaydet butonu
    const saveButton = document.getElementById("save-button");
    if (saveButton) {
        saveButton.addEventListener("click", handleSavePreferences);
    }
}

function updateFormState() {
    const modeInput = document.querySelector('input[name="mode"]:checked');
    const platformInput = document.getElementById("platform");
    const saveButton = document.getElementById("save-button");
    
    // Form validasyonu
    const isValid = modeInput && platformInput && platformInput.value;
    
    if (saveButton) {
        saveButton.disabled = !isValid;
        saveButton.classList.toggle('disabled', !isValid);
    }
    
    // Mode bilgisi güncelle
    updateModeInfo(modeInput ? modeInput.value : null);
}

function updateModeInfo(mode) {
    const modeInfoDiv = document.getElementById("modeInfo");
    if (!modeInfoDiv) return;
    
    let infoText = "";
    
    switch (mode) {
        case "duzenli":
            infoText = "📅 <strong>Düzenli Mod:</strong> Seçtiğiniz sıklıkta otomatik analizler yapılacak. Sürekli takip için ideal.";
            break;
        case "duzensiz":
            infoText = "🎯 <strong>Düzensiz Mod:</strong> İstediğiniz zaman manuel analiz yapabilirsiniz. Esnek kullanım için ideal.";
            break;
        default:
            infoText = "";
    }
    
    modeInfoDiv.innerHTML = infoText;
}

async function handleSavePreferences() {
    const modeInput = document.querySelector('input[name="mode"]:checked');
    const frequencyInput = document.querySelector('input[name="frequency"]:checked');
    const platformInput = document.getElementById("platform");

    // Validation
    if (!modeInput || !platformInput || !platformInput.value) {
        showError("Lütfen tüm gerekli alanları doldurun.");
        return;
    }

    // Düzenli mod için frekans kontrolü
    if (modeInput.value === "duzenli" && !frequencyInput) {
        showError("Düzenli mod için sıklık seçimi zorunludur.");
        return;
    }

    const payload = {
        mode: modeInput.value,
        frequency: modeInput.value === "duzenli" ? frequencyInput.value : null,
        platform: platformInput.value
    };

    console.log("Kaydedilecek tercihler:", payload);

    // Loading durumu
    setLoading(true);

    try {
        const response = await window.authManager.authenticatedFetch("/update_preferences", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        
        if (!response) {
            throw new Error("Sunucu yanıtı alınamadı");
        }
        
        const data = await response.json();
        console.log("Tercih kayıt sonucu:", data);
        
        showSuccess("Tercihler başarıyla kaydedildi! Anasayfaya yönlendiriliyorsunuz...");
        
        setTimeout(() => {
            window.location.href = "/index.html";
        }, 2000);
        
    } catch (error) {
        console.error("Tercih kaydetme hatası:", error);
        showError("Tercihler kaydedilirken bir hata oluştu: " + error.message);
    } finally {
        setLoading(false);
    }
}

// Utility functions
function setLoading(loading) {
    const saveButton = document.getElementById("save-button");
    
    if (loading) {
        saveButton.disabled = true;
        saveButton.innerHTML = `
            <span class="loading-spinner"></span>
            Kaydediliyor...
        `;
        saveButton.classList.add("loading");
    } else {
        saveButton.disabled = false;
        saveButton.innerHTML = "Hesabımı Bağla ve Yetkilendir";
        saveButton.classList.remove("loading");
        updateFormState(); // Form durumunu yeniden kontrol et
    }
}

function showError(message) {
    removeAlerts();
    
    const alertDiv = document.createElement("div");
    alertDiv.className = "alert alert-error";
    alertDiv.innerHTML = `
        <span class="alert-icon">⚠️</span>
        <span class="alert-message">${message}</span>
        <button class="alert-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    const container = document.querySelector(".box");
    container.insertBefore(alertDiv, container.firstChild);
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

function showSuccess(message) {
    removeAlerts();
    
    const alertDiv = document.createElement("div");
    alertDiv.className = "alert alert-success";
    alertDiv.innerHTML = `
        <span class="alert-icon">✅</span>
        <span class="alert-message">${message}</span>
    `;
    
    const container = document.querySelector(".box");
    container.insertBefore(alertDiv, container.firstChild);
}

function removeAlerts() {
    const existingAlerts = document.querySelectorAll(".alert");
    existingAlerts.forEach(alert => alert.remove());
}

// Platform değişikliğinde ek bilgiler göster
document.addEventListener("change", function(e) {
    if (e.target.id === "platform") {
        showPlatformInfo(e.target.value);
    }
});

function showPlatformInfo(platform) {
    const platformInfo = {
        'twitter': {
            icon: '🐦',
            name: 'X (Twitter)',
            description: 'Tweet\'lere gelen yanıtlar analiz edilecek'
        },
        'instagram': {
            icon: '📷',
            name: 'Instagram',
            description: 'Gönderi yorumları analiz edilecek'
        },
        'youtube': {
            icon: '📺',
            name: 'YouTube',
            description: 'Video yorumları analiz edilecek'
        },
        'tiktok': {
            icon: '🎵',
            name: 'TikTok',
            description: 'Video yorumları analiz edilecek'
        }
    };
    
    const info = platformInfo[platform];
    if (info) {
        console.log(`Platform seçildi: ${info.icon} ${info.name} - ${info.description}`);
    }
}