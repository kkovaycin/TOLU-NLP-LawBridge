// === Config ===
const API = "http://127.0.0.1:8000"; // CORS sorunlarını önlemek için localhost yerine 127.0.0.1
const ENDPOINTS = {
    ME: "/me",
    ANALYSES_PRIMARY: "/analyses",
    ANALYSES_FALLBACK: "/analysis_results",
    FILTER: "/filter_analysis_results",
    SEARCH: "/search_analysis",
};

// === Utils ===
function getToken() {
    return localStorage.getItem("token");
}

function ensureBearer(token) {
    return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

async function authFetch(path, options = {}) {
    const token = getToken();
    console.log("🔍 [authFetch] Endpoint:", path);
    console.log("🔍 [authFetch] LocalStorage token:", token);
    if (!token) {
        console.warn("⚠️ Token bulunamadı, login sayfasına yönlendiriliyor.");
        window.location.href = "login.html";
        return null;
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: ensureBearer(token),
        ...(options.headers || {}),
    };

    console.log("🔍 [authFetch] Authorization header:", headers.Authorization);

    const res = await fetch(`${API}${path}`, { ...options, headers });

    console.log("🔍 [authFetch] Response status:", res.status);

    // 401 -> login'e at
    if (res.status === 401) {
        console.warn("⚠️ 401 - Oturum süresi dolmuş veya token geçersiz");
        localStorage.removeItem("token");
        alert("Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.");
        window.location.href = "login.html";
        return null;
    }

    return res;
}

// === Boot ===
document.addEventListener("DOMContentLoaded", async () => {
    const token = getToken();
    if (!token) {
        alert("Giriş yapmadan bu sayfaya erişemezsiniz.");
        window.location.href = "login.html";
        return;
    }

    // Token doğrula
    const meRes = await authFetch(ENDPOINTS.ME, { method: "GET" });
    if (!meRes || !meRes.ok) {
        localStorage.removeItem("token");
        window.location.href = "login.html";
        return;
    }

    // Analizleri yükle
    await loadAnalyses();
});

// === Load Analyses with fallback (/analyses -> /analysis_results) ===
async function loadAnalyses() {
    try {
        let res = await authFetch("/analyses", { method: "GET" });

        // 👇 başarısızsa her durumda fallback dene
        if (!res || !res.ok) {
            console.warn("Primary /analyses başarısız, /analysis_results deneniyor…");
            res = await authFetch("/analysis_results", { method: "GET" });
        }

        if (!res || !res.ok) {
            throw new Error(`HTTP ${res ? res.status : "?"}: Analiz verileri alınamadı`);
        }

        const data = await res.json();
        renderSummary(data);
        renderCharts(data);
        renderTable(data);
    } catch (err) {
        console.error("Analiz yükleme hatası:", err);
        alert("Analizler yüklenemedi: " + err.message);
    }
}


// === Renderers ===
function renderSummary(data) {
    const totalCount = data.total_comments || 0;
    const analyzedCount = data.analyzed_comments || 0;

    const totalEl = document.getElementById("total-comments");
    if (totalEl) totalEl.textContent = totalCount;

    const analyzedEl = document.getElementById("analyzed-comments");
    if (analyzedEl) analyzedEl.textContent = analyzedCount;
}

function renderCharts(data) {
    const duygu = data.duygu_distribution || {};
    const niyet = data.niyet_distribution || {};
    const hukuki = data.hukuki_distribution || {};

    drawPieChart("sentimentChart", "Duygu Dağılımı", duygu);
    drawPieChart("intentChart", "Niyet Dağılımı", niyet);
    drawPieChart("lawChart", "Hukuki Etiket Dağılımı", hukuki);
}

function drawPieChart(canvasId, label, dataObject) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.warn(`Canvas bulunamadı: ${canvasId}`);
        return;
    }

    const ctx = canvas.getContext("2d");

    // Önceki chart varsa temizle
    window.charts = window.charts || {};
    if (window.charts[canvasId]) {
        window.charts[canvasId].destroy();
    }

    const entries = Object.entries(dataObject || {});
    if (!entries.length) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#666";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Veri bulunamadı", canvas.width / 2, canvas.height / 2);
        return;
    }

    window.charts[canvasId] = new Chart(ctx, {
        type: "pie",
        data: {
            labels: Object.keys(dataObject),
            datasets: [
                {
                    label,
                    data: Object.values(dataObject),
                    backgroundColor: [
                        "#36A2EB",
                        "#FF6384",
                        "#FFCE56",
                        "#4BC0C0",
                        "#9966FF",
                        "#FF9F40",
                        "#8BC34A",
                        "#FF5722",
                        "#607D8B",
                        "#E91E63",
                    ],
                    borderWidth: 1,
                },
            ],
        },
        options: {
            responsive: true,
            plugins: { legend: { position: "bottom" } },
        },
    });
}

function renderTable(data) {
    const tbody = document.querySelector("#analysisTable tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!data.analyses || !data.analyses.length) {
        const row = document.createElement("tr");
        row.innerHTML =
            `<td colspan="7" style="text-align:center;">Henüz analiz bulunamadı</td>`;
        tbody.appendChild(row);
        return;
    }

    data.analyses.forEach((analysis) => {
        const row = document.createElement("tr");
        row.innerHTML = `
      <td>${analysis.name}</td>
      <td>${analysis.date}</td>
      <td>${analysis.platform}</td>
      <td>${analysis.mode || "Belirtilmemiş"}</td>
      <td>${analysis.frequency || "Belirtilmemiş"}</td>
      <td>${analysis.total_comments}</td>
      <td><button onclick="goToAnalysis('${analysis.id}')">Detay</button></td>
    `;
        tbody.appendChild(row);
    });
}

function goToAnalysis(id) {
    window.location.href = `analysis-detail.html?id=${id}`;
}

// === Filters ===
async function filterAnalyses() {
    try {
        const mode = document.getElementById("filter-mode").value;
        const frequency = document.getElementById("filter-frequency").value;

        const params = new URLSearchParams();
        if (mode) params.append("mode", mode);
        if (frequency) params.append("frequency", frequency);

        const res = await authFetch(`${ENDPOINTS.FILTER}?${params.toString()}`, {
            method: "GET",
        });
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const analyses = await res.json();
        // Sadece tabloyu güncelle
        renderTable({
            analyses,
            total_comments: 0,
            analyzed_comments: 0,
            duygu_distribution: {},
            niyet_distribution: {},
            hukuki_distribution: {},
        });
    } catch (err) {
        console.error("Filtreleme hatası:", err);
        alert("Filtreleme sırasında hata oluştu");
    }
}
window.filterAnalyses = filterAnalyses; // HTML onclick için

// === Search ===
document.getElementById("searchInput")?.addEventListener("input", async (e) => {
    const query = e.target.value.trim();
    if (query.length < 2) {
        await loadAnalyses();
        return;
    }

    try {
        const res = await authFetch(
            `${ENDPOINTS.SEARCH}?query=${encodeURIComponent(query)}`,
            { method: "GET" }
        );
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const analyses = await res.json();
        renderTable({
            analyses,
            total_comments: 0,
            analyzed_comments: 0,
            duygu_distribution: {},
            niyet_distribution: {},
            hukuki_distribution: {},
        });
    } catch (err) {
        console.error("Arama hatası:", err);
    }
});
