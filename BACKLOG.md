# BACKLOG

Repo: https://github.com/onerrbaris/burncal (private). Yeni oturum: önce `docs/HANDOFF.md`. Bulgular: `docs/REPORT.md`. `ARCHITECTURE.md` taslaktır.

## Next step
Ürün yönüne karar ver (öneri: Akdeniz için il/bölge ölçeğinde yıllık + yangın sezonu yanma takvimi, orman ve tarım birlikte). Karar verilince ARCHITECTURE.md yeniden yazılacak ve inşa başlayacak.

## In progress
- (yok)

## Open
- Ürün yönü kararı
- ARCHITECTURE.md'yi rapora göre güncelle (aylık birim, konum maskesi, ölçeğe göre güven)
- Gerçek il sınırlarıyla doğrulama (şimdiye kadar kutularla yapıldı)
- 2026 verisi: FIRMS MAP_KEY gerekli
- **Olay kümeleme denemesi (gece, en fazla 2 saat).** Amaç: büyük yangınlarda MODIS tespiti başına VIIRS tespitinin azalmasını yakalamak (2021-08 Marmaris/Milas +%38 aşırı tahmin). Yapılacak: MED/COAST'ta MODIS noktalarını yer + gün yakınlığına göre olaylara grupla (tarih için `data/raw` yeniden okunmalı; `med/cache/det_region` yalnızca yıl/ay içeriyor), olay başına VIIRS/MODIS oranını olay büyüklüğü ve FRP'ye göre modelle, `analysis/med/evaluate.py` ölçüleriyle bir yıl dışarıda bırakarak aylık çarpanla kıyasla (WAPE, yanlılık, yıl sıra korelasyonu; bölge, 1°, 0,25°). Sonuç ne olursa olsun `docs/REPORT.md`'ye yazılacak. Ortamda pandas/scikit-learn kurulu değil.
- Terra/Aqua ayrı ağırlığı ürüne al (`analysis/med/evaluate.py:135`; bölge aylık %15,3 → %14,7).

## Team to-do (humans)
- FIRMS MAP_KEY iste: https://firms.modaps.eosdis.nasa.gov/api/map_key/ → `.env` içine `FIRMS_MAP_KEY=...` (commit'leme)
- Challenge "Resources" sekmesine ve teslim kılavuzuna (video süresi) tarayıcıdan bak
- Deploy için Render + Vercel hesapları

## Done
- Keşif: FIRMS arşivi + API, challenge kuralları, rakipler
- Türkiye verisi indirildi (`python scripts/fetch_firms.py`)
- Uyumlaştırma yöntemi çalışması: iki yön, seyreltme, gürültü tabanı, filtre duyarlılığı (`analysis/`)
- Akdeniz bölgesi çalışması (`analysis/med/`)
- Repo oluşturuldu, Blockchaindeveloper43 davet edildi

## Decisions
- 14 Kas – Zaman birimi ay (8 günlük dönem her ölçekte daha kötü çıktı).
- 14 Kas – Ölçü ham hotspot sayısı; sabit kaynaklar konum maskesiyle ayıklanır, MODIS `type` etiketine göre filtre yok.
- 14 Kas – Birim VIIRS-eşdeğeri; 2012+ gözlem, öncesi MODIS × aylık çarpan. Ters yön aynı doğrulukta.
- 14 Kas – Kapsam Türkiye, tercihen Akdeniz. Bölgesel çarpanlar kullanılacak.
- 14 Kas – Küçük alanlar için bölgeden ödünç alma ve klimatoloji katkılı modeller reddedildi (yıl sıralamasını bozuyor).

## Kurulum notu
`backend/`, `scripts/make_mocks.py`, `requirements.txt` yarım kalmış, doğrulanmamış dosyalar; repoda yok.
