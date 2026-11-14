# BACKLOG

Repo: https://github.com/onerrbaris/burncal (private). Yeni oturum: önce `docs/HANDOFF.md`. Bulgular: `docs/REPORT.md`. `ARCHITECTURE.md` taslaktır.

## Next step
ARCHITECTURE.md'yi yeni ürün yönüne göre yeniden yaz (3–4 illik gruplar, aylık takvim), sonra inşaya başla. **Ekip içi bitiş: 15 Kasım saat 15:00** (resmî kapanış 23:59).

## In progress
- (yok)

## Open
- ARCHITECTURE.md'yi rapora göre güncelle (aylık birim, konum maskesi, ölçeğe göre güven, il grupları)
- İl gruplarını tanımla (3–4 komşu il, benzer yanma rejimi) ve her grup için dışarıda bırakılmış hatayı ölç
- Gerçek il sınırlarıyla doğrulama (şimdiye kadar kutularla yapıldı)
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
- Repo oluşturuldu, Blockchaindeveloper43 davet edildi

- Karşılaştırma (14 Kas akşam): resmî uyumlaştırılmış hotspot sayım ürünü yok; NASA tarafı yanık alan/FRP üzerinden gidiyor (GFED5NRT en yakın yöntem, Coskuner 2022 Türkiye için 3,9 kat). Challenge metni açıkça hotspot sayısı ve aylık karşılaştırma istiyor. Eksiklerimiz: ürün, bağımsız doğrulama, NOAA-20/21 köprüsü, gerçek arazi örtüsü.

## Decisions
- 14 Kas akşam – Ürün yönü: bölgesel takvim. Birim tek il ya da tüm coğrafi bölge değil, 3–4 ili içine alan gruplar; amaç hata oranını düşürmek (rapora göre ~1°–200 km ölçeği yıllıkta %17–23, tek il ölçeği belirgin biçimde daha kötü).
- 14 Kas akşam – Ekip içi bitiş 15 Kasım 15:00. Bu saatten sonra yalnızca teslim işleri.
- 14 Kas akşam – Sıra: önce uçtan uca çalışan ürün, sonra NOAA-20/21 köprüsü, sonra bağımsız doğrulama. Olay kümeleme denemesi bırakıldı.
- 14 Kas – Zaman birimi ay (8 günlük dönem her ölçekte daha kötü çıktı).
- 14 Kas – Ölçü ham hotspot sayısı; sabit kaynaklar konum maskesiyle ayıklanır, MODIS `type` etiketine göre filtre yok.
- 14 Kas – Birim VIIRS-eşdeğeri; 2012+ gözlem, öncesi MODIS × aylık çarpan. Ters yön aynı doğrulukta.
- 14 Kas – Kapsam Türkiye, tercihen Akdeniz. Bölgesel çarpanlar kullanılacak.
- 14 Kas – Küçük alanlar için bölgeden ödünç alma ve klimatoloji katkılı modeller reddedildi (yıl sıralamasını bozuyor).

## Kurulum notu
`backend/`, `scripts/make_mocks.py`, `requirements.txt` yarım kalmış, doğrulanmamış dosyalar; repoda yok.
