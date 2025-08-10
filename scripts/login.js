document.addEventListener("DOMContentLoaded", () => {
  const loginButton = document.getElementById("login-button");

  loginButton.addEventListener("click", () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
      alert("Lütfen tüm alanları doldurun.");
      return;
    }

    const payload = {
      email: email,
      password: password
    };

    fetch("http://localhost:8000/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
    .then(res => {
      if (!res.ok) {
        throw new Error("Giriş başarısız.");
      }
      return res.json();
    })
    .then(data => {
      localStorage.setItem("token", data.access_token);
      window.location.href = "analysis-dashboard.html";
    })
    .catch(error => {
      console.error("Hata:", error);
      alert("Giriş sırasında bir hata oluştu.");
    });
  });
});
