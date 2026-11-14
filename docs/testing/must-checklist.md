# MUST Test Checklist (Hours 0–16)

**Owner:** Bug tester 1 (Asil), with Bug tester 2  
**Target:** Hour 16 Milestone Sign-off  
**Reference:** [ROADMAP.md](../../ROADMAP.md) §7, [docs/roles/tester-1.md](../roles/tester-1.md)

**Belge incelemesi 2026-11-14 12:59 (Europe/Istanbul), `main` `d2c4695`:** Saat 16 onayı verilmedi. İngilizce yürüyüş: [test-plan.md](./test-plan.md). Alan kontrolü: [contract-checklist.md](./contract-checklist.md). Bölüm 2.1 ilk PASS olarak duruyor. Bölüm 2.2–2.5 işaretlenmedi: duraklar hâlâ örnek (PRE-07), rota HiRISE maliyet kırpmasının üzerinde değil, `web/` içinde uygulama yok.

---

## 1. Quick Verification Gate (Her PR Öncesi Kontrol)

Her pull request (PR) merge edilmeden önce aşağıdaki kontroller Tester 1 tarafından yapılmalıdır:
- [ ] Değişiklik yalnızca sahibinin klasöründe mi? ([ROADMAP.md](../../ROADMAP.md) §2)
- [ ] `.env` veya gizli anahtar (API key) kesinlikle committe yok mu?
- [ ] `data/raw/` klasörü veya büyük ham dosyalar (.tif, .IMG, .jp2) git'e eklenmemiş mi?
- [ ] Veri sözleşmeleri (`docs/contracts/`) ile üretilen JSON şemaları eşleşiyor mu?
- [ ] Değişiklik `docs/coordination/AGENT_LOG.md` içine `Commit: this commit` şeklinde işlenmiş mi?
- [ ] En az 1 tester onayı alındı mı?

---

## 2. MUST Teslimatları ve Fonksiyonel Testler (Hour 16)

Aşağıdaki 8 temel kriter sağlanmadan MUST aşaması tamamlanmış sayılamaz:

### 2.1. Arazi ve Eğim Maliyet Haritası (Backend 1)
- [x] Kırpılmış Mount Sharp DTM ve ortofoto hazırlandı mı? (`pipeline/terrain/`, `data/processed/terrain/`) — *Doğrulandı: 2x2 km DTEEC_019698 kırpması ve ortofoto mevcut.*
- [x] Eğim (slope) ve engebe (roughness) hesaplandı mı? — *Doğrulandı: TRI tabanlı roughness ve slope hesaplandı.*
- [x] `cost-map.json` sözleşmeye (`docs/contracts/cost-map.json`) uygun mu? — *Doğrulandı: Şema uyumlu, 395x395 hücreli gerçek maliyet haritası üretildi.*
- [x] Bilinen DTM eğim az okuma (under-read) uyarısı `cost-map.json` içinde belgelendi mi? — *Doğrulandı: `tilt_validation_note` mevcut.*
- [x] Önizleme yüksekliği (height preview) 3D bileşeni için üretildi mi? — *Doğrulandı: `height-preview.png` (16-bit) ve `height_preview_elevation_range_m` eklendi.*
- [x] *Fallback:* Raster üretilemezse statik görsel/harita önizlemesi devrede mi? — *Doğrulandı: PNG önizlemeleri hazır.*

### 2.2. Güvenli Rota ve Duraklar (Backend 2)
- [ ] Kilitli duraklar (`stops.json`) Mount Sharp göl çökelleri ve Altadena boxwork bonus durağını kapsıyor mu?
- [ ] Duraklar DTEEC_019698 DTM sınırları içinde mi? ([docs/testing/STOP_COORDINATE_CHECK.md](./STOP_COORDINATE_CHECK.md))
- [ ] Rota engelli/aşırı dik (>20°) hücrelerden kaçınıyor mu?
- [ ] Toplam mesafe (distance) ve tırmanış (climb) hesaplandı mı?
- [ ] `hud-telemetry.json` örnekleri üretildi mi?
- [ ] *Fallback:* Çözücü (A\*/Dijkstra) çalışmazsa statik etiketli GeoJSON rotası hazır mı?

### 2.3. 2D Planlayıcı ve Rota İletimi (Frontend 1)
- [ ] MapLibre GL JS tabanlı 2D harita açılıyor mu?
- [ ] Duraklar ve rota çizgisi harita üzerinde düzgün çiziliyor mu?
- [ ] Planlayıcıdan 3D HUD görünümüne rota iletimi (`mm:set-route` event'i) çalışıyor mu?

### 2.4. 3D Birinci Şahıs Görünümü ve Kask HUD (Frontend 1)
- [ ] three.js birinci şahıs arazi görünümü yükleniyor mu?
- [ ] Kask HUD üzerinde 4 zorunlu alan görüntüleniyor mu?
  - [ ] **Mesafe (Distance)**: Katedilen / kalan mesafe
  - [ ] **Eğim (Slope)**: Değer ve renk sınıfı (yeşil/sarı/kırmızı)
  - [ ] **Sonraki Durak (Next Stop)**: Hedef durağın adı
  - [ ] **Suit O₂**: Yüzde değeri ve net olarak **örnek/temsili yer tutucu (placeholder)** etiketi
- [ ] *Fallback:* İşlenmiş dosyalar eksikse `docs/contracts/` örneklerine düşüyor mu?

### 2.5. Çevrimdışı ve Güvenilirlik Testi
- [ ] İnternet kesilse bile yerel JSON ve yükseklik önizlemesi ile sunum çalıştırılabiliyor mu?
- [ ] Arayüzde veri kaynakları ve dürüstlük notları (lunar slope stand-in, O₂ placeholder vb.) görünür mü?

---

## 3. MUST Onay Tablosu (Sign-off)

| Madde | Durum (`PASS` / `FAIL` / `FALLBACK`) | Test Eden | Notlar |
|---|---|---|---|
| B1 Arazi / Maliyet Haritası | PASS (İlk Sürüm) | Asil (T1) | MUST-01 & MUST-02 test edildi. Duraklar kilitlendikten sonra (PRE-07) yeniden kırpılacak. |
| B2 Duraklar & Rota | Henüz Test Edilmedi | Asil (T1) | |
| F1 2D Planlayıcı | Henüz Test Edilmedi | Asil (T1) | |
| F1 3D HUD (4 alan) | Henüz Test Edilmedi | Asil (T1) | |
| mm:set-route Entegrasyonu | Henüz Test Edilmedi | Asil (T1) | |
| Fallback mekanizması | Henüz Test Edilmedi | Asil (T1) | |
