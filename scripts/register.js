document.addEventListener("DOMContentLoaded", () => {
    const registerButton = document.getElementById("register-button");

    registerButton.addEventListener("click", () => {
        console.log("***********")
        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        if (!name || !email || !password) {
            alert("Lütfen tüm alanları doldurun.");
            return;
        }

        const payload = {
            username: name,
            email: email,
            password: password
        };

        console.log(JSON.stringify(payload))

        fetch("http://localhost:8000/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        }).then(res => {
            console.log("*/*/*/*/*//*/*", res)
            if (!res.ok) {
                throw new Error("Kayıt başarısız.");
            }
            return res.json();
        }).then(data => {
            console.log("///////////", data)
            localStorage.setItem("token", data.access_token);
            window.location.href = "connect-account.html";
        }).catch(error => {
            console.error("Hata:", error);
            alert("Kayıt sırasında bir hata oluştu.");
        });
    });
});
