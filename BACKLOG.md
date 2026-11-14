# BACKLOG

Repo: https://github.com/onerrbaris/burncal (private). Yeni oturum: önce `docs/HANDOFF.md`. Bulgular: `docs/REPORT.md`. `ARCHITECTURE.md` taslaktır.

## Next step
Yeni `ARCHITECTURE.md`'yi ekipçe onayla (4 vitrin bölgesi, statik site, sunucu yok), sonra T1–T5'i başlat. Yeni yöntem araştırması yok. **Ekip içi bitiş: 15 Kasım saat 15:00** (resmî kapanış 23:59).

## In progress
- (yok)

## Open
- İl gruplarını gerçek il poligonlarıyla tanımla (3–4 komşu il, benzer yanma rejimi) ve hatayı yeniden ölç. Kutularla ilk ölçüm yapıldı: `analysis/med/subregions.py`.
- Gerçek il sınırlarıyla doğrulama (şimdiye kadar kutularla yapıldı)
- Eleştiri yanıtı: `docs/CLAUDE_RESPONSE_TO_REVIEW.md` (deneyler `analysis/experiments/review_2026_11_14/`). Açık kalanlar o dosyanın "Yapılmayanlar" bölümünde; ilki gerçek il poligonları (geoBoundaries `data/raw/boundaries/` altında, `shapely` kurulu). Öne çıkan bulgu: zamana ileri testte hata LOYO'nun ~1,5 katı; `invarea_w` ürün adayı.
- 2026 verisi: FIRMS MAP_KEY gerekli
- **Olay kümeleme denemesi (gece, en fazla 2 saat).** Amaç: büyük yangınlarda MODIS tespiti başına VIIRS tespitinin azalmasını yakalamak (2021-08 Marmaris/Milas +%38 aşırı tahmin). Yapılacak: MED/COAST'ta MODIS noktalarını yer + gün yakınlığına göre olaylara grupla (tarih için `data/raw` yeniden okunmalı; `med/cache/det_region` yalnızca yıl/ay içeriyor), olay başına VIIRS/MODIS oranını olay büyüklüğü ve FRP'ye göre modelle, `analysis/med/evaluate.py` ölçüleriyle bir yıl dışarıda bırakarak aylık çarpanla kıyasla (WAPE, yanlılık, yıl sıra korelasyonu; bölge, 1°, 0,25°). Sonuç ne olursa olsun `docs/REPORT.md`'ye yazılacak. Ortamda pandas/scikit-learn kurulu değil.
- Terra/Aqua ayrı ağırlığı ürüne al (`analysis/med/evaluate.py:135`; bölge aylık %15,3 → %14,7).

## Team to-do (humans)
- FIRMS MAP_KEY iste: https://firms.modaps.eosdis.nasa.gov/api/map_key/ → `.env` içine `FIRMS_MAP_KEY=...` (commit'leme)
- Teslim kılavuzuna (video süresi) tarayıcıdan bak. ("Resources" sekmesine bakıldı: yalnızca FIRMS listeleniyor. "Teams" sekmesi bu challenge için 841 takım gösteriyor.)
- Deploy için Render + Vercel hesapları

## Done
- Keşif: FIRMS arşivi + API, challenge kuralları, rakipler
- Türkiye verisi indirildi (`python scripts/fetch_firms.py`)
- Uyumlaştırma yöntemi çalışması: iki yön, seyreltme, gürültü tabanı, filtre duyarlılığı (`analysis/`)
- Akdeniz bölgesi çalışması (`analysis/med/`)
- Alt bölge ölçeği ölçümü (`analysis/med/subregions.py`, `subregion_*.csv`; bir yıl dışarıda, WAPE yıllık/aylık). Tek bölgesel çarpanla: 1 birim %6/%15, 3 birim %13/%26, 5 birim %15/%27, ~100 km (26 birim) %23/%38. Gruba özel aylık çarpanla 5 birim %13/%24. Birim bazında yıllık: Çukurova %8 (tespitlerin %57'si), Muğla doğusu/Antalya batısı %14, Mersin %19, Hatay %19, Antalya doğusu %22; aylık Çukurova %16, diğerleri %33–40. Kutularla ölçüldü, il poligonlarıyla değil.
- Repo oluşturuldu, Blockchaindeveloper43 davet edildi

- Karşılaştırma (14 Kas akşam): resmî uyumlaştırılmış hotspot sayım ürünü yok; NASA tarafı yanık alan/FRP üzerinden gidiyor (GFED5NRT en yakın yöntem, Coskuner 2022 Türkiye için 3,9 kat). Challenge metni açıkça hotspot sayısı ve aylık karşılaştırma istiyor. Eksiklerimiz: ürün, bağımsız doğrulama, NOAA-20/21 köprüsü, gerçek arazi örtüsü.

## Decisions
- 14 Kas gece – Yayında yalnızca 4 vitrin bölgesi (TR61, TR62, TR63, TR32); demoyu ekip sürer, jüriye bölge seçtirilmez. Betik 26 bölgeyi üretebilir, yayın listesi `SHOWCASE`.
- 14 Kas gece – Hedef yerel etkinlik; jüri konu uzmanı değil. Öncelik çalışan ürün ve sunum; yöntem araştırması durduruldu.
- 14 Kas gece – Alan birimi İBBS-2 (26 bölge, tüm Türkiye). Sunucu yok, her şey önceden hesaplanmış statik JSON. Serbest çizilen alan yok. Sözleşme `ARCHITECTURE.md` içinde yeniden yazıldı (8 günlük dönem ve `/api` uçları kalktı).
- 14 Kas akşam – Ürün yönü: bölgesel takvim. Birim tek il ya da tüm coğrafi bölge değil, 3–4 ili içine alan gruplar; amaç hata oranını düşürmek (rapora göre ~1°–200 km ölçeği yıllıkta %17–23, tek il ölçeği belirgin biçimde daha kötü).
- 14 Kas akşam – Ekip içi bitiş 15 Kasım 15:00. Bu saatten sonra yalnızca teslim işleri.
- 14 Kas akşam – Sıra: önce uçtan uca çalışan ürün, sonra NOAA-20/21 köprüsü, sonra bağımsız doğrulama. Olay kümeleme denemesi bırakıldı.
- 14 Kas akşam – Çarpan gruba özel olacak: tek bölgesel çarpan gruplarda kalıcı yanlılık bırakıyor (batı ve Mersin +%18, Hatay −%19; takvimde 2012'de sahte basamak demek), gruba özel çarpan bunu %5'in altına indiriyor.
- 14 Kas – Zaman birimi ay (8 günlük dönem her ölçekte daha kötü çıktı).
- 14 Kas – Ölçü ham hotspot sayısı; sabit kaynaklar konum maskesiyle ayıklanır, MODIS `type` etiketine göre filtre yok.
- 14 Kas – Birim VIIRS-eşdeğeri; 2012+ gözlem, öncesi MODIS × aylık çarpan. Ters yön aynı doğrulukta.
- 14 Kas – Kapsam Türkiye, tercihen Akdeniz. Bölgesel çarpanlar kullanılacak.
- 14 Kas – Küçük alanlar için bölgeden ödünç alma ve klimatoloji katkılı modeller reddedildi (yıl sıralamasını bozuyor).

## Kurulum notu
`backend/`, `scripts/make_mocks.py`, `requirements.txt` yarım kalmış, doğrulanmamış dosyalar; repoda yok.

Next step — Masaüstü Türkiye atlasını tarayıcıda gözden geçir. frontend/index.html üzerinden 81 il seçilir, yalnız İzmir için 2012–2025 VIIRS aylık gözlemleri vardır.

Next step — 13 il için MODIS ve VIIRS sekmelerini masaüstünde incele. Uydu altlığı yerel, Birleşmiş sekmesi boş.
