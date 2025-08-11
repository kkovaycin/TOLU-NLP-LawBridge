from jinja2 import Environment, FileSystemLoader

# 1. Jinja2 ortamını ayarla
env = Environment(loader=FileSystemLoader("."))  # . => mevcut klasör
template = env.get_template("dilekce_multi.j2")

# 2. Test verileri (multi-label)
labels = [
    "Hakaret – TCK m.125",
    "Kamu Görevlisine Hakaret – TCK m.125/3",
    "Tehdit – TCK m.106"
]

data = {
    "labels": labels,
    "platform": "Instagram",
    "tarih": "11.08.2025",
    "yorum": "Seni rezil ederim, memur bozuntusu!",
    "yorum_linki": "https://ornek.link/yorum",
    "ad_soyad": "Kübra Kovayçin",
    "bugun_tarih": "11.08.2025"
}

# 3. Şablonu verilerle doldur
output_text = template.render(**data)

# 4. Sonucu yazdır
print(output_text)

# 5. İstersen dosyaya da kaydedebilirsin
with open("dilekce_cikti.txt", "w", encoding="utf-8") as f:
    f.write(output_text)
