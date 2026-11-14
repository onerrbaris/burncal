# Araştırma raporu: MODIS + VIIRS hotspot uyumlaştırması

NASA Space Apps 2026 (14–15 Kasım), challenge: *Harmonization of MODIS and VIIRS Hot Spots*.
Durum: 14 Kasım 2026 öğleden sonra. Ürün yönü henüz seçilmedi; bu belge yalnızca keşif ve yöntem bulgularıdır.
Tüm doğruluk sayıları Türkiye verisinde, 2012–2025 arasında her seferinde bir yıl dışarıda bırakılarak ölçülmüştür.

## 1. Challenge ve kurallar

- Sayfa: https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/
- İstenen: (1) sensörün hangisi olduğu önemini yitirecek şekilde uyumlaştırma; (2) kullanıcının alan ve tarih aralığı seçtiği, yanma takvimi gösteren, çıktı indirilebilen bir web uygulaması. Örnek soru: "bu ay, seçilen alanın tarihsel medyanına göre nerede?"
- İsteğe bağlı sayılanlar: haritada alan çizme, erişilebilir renk skalası, anomali göstergeleri, CSV indirme. Kapsamda orman yangını yanında tarımsal ve endüstriyel yanma da var.
- Teslim: 15 Kasım Pazar 23:59 yerel saat. Demo: en fazla 7 slayt ya da çok kısa video (süre sınırı doğrulanmadı).
- Puanlama (1–5): Etki, Yaratıcılık, Geçerlilik, İlgililik, Sunum.
- Zorunlu: yapay zekâ kullanımının açıklanması, tüm kaynakların atfı, lisans.
- Challenge metni (14 Kasım akşamı tarayıcıdan okundu) ölçüyü açıkça "2000'lerin başından bugüne tespit edilen hotspot sayısı" olarak veriyor; örnekleri aylık ("hangi ay ve yıllar en yüksekti", "bu ay tarihsel medyana göre nerede"). "Resources" sekmesinde yalnızca FIRMS var. "Teams" sekmesi bu challenge için 841 takım gösteriyor.
- Doğrulanamayan: teslim kılavuzu (video süresi).

## 2. Veri kaynakları

| Kaynak | Durum |
|---|---|
| FIRMS ülke arşivi `https://firms.modaps.eosdis.nasa.gov/data/country/{modis\|viirs-snpp}/{Y}/{sensor}_{Y}_{Country}.csv` | Anahtarsız, girişsiz. MODIS 2000–2025, VIIRS S-NPP 2012–2025. Ülke adı `Turkey`. 2026 ve NOAA-20/21 yok. |
| FIRMS API (`/api/area/csv/{KEY}/{SOURCE}/{w,s,e,n}/{1-5}/{DATE}`) | Ücretsiz MAP_KEY gerekli (e-postayla). Çağrı başına en fazla 5 gün, 10 dakikada 5000 çağrı. 2026 ve NOAA-20/21 için tek yol. |
| FIRMS son 24s/48s/7g küresel CSV'ler | Anahtarsız ama geçmiş yok; tarayıcıdan CORS engelli. |
| NASA GIBS vektör katmanları | Anahtarsız, CORS açık; yalnızca harita görseli için. |
| geoBoundaries (`https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM1/`) | İl sınırları, anahtarsız. |
| ESA WorldCover 10 m | Açık S3, 3°'lik karo başına ~98 MB. Arazi örtüsü için; denenmedi. |

İndirilen: Türkiye, 40 dosya, 64 MB (`scripts/fetch_firms.py` ile yeniden indirilebilir). MODIS 251.361 satır (2000-11-01 → 2025-12-29), VIIRS 605.609 satır (2012-01-20 → 2025-12-31).

Sütunlar iki sensörde aynı sırada; yalnızca parlaklık sütunlarının adı farklı. `confidence` MODIS'te 0–100, VIIRS'te `l/n/h`. `acq_time` sıfır dolgulu HHMM (UTC) metin. `satellite`: `Terra`/`Aqua`/`N`.

Sensör takvimi: S-NPP verisi FIRMS'te 2 Kasım 2026'da sona ermiş. MODIS'in 2027'de kapatılması planlanıyor (Terra Ocak, Aqua Eylül civarı). NOAA-20 (2018→) ve NOAA-21 (2023→) sürüyor.

## 3. Ham veride gözlenenler

- VIIRS/MODIS ham sayı oranı 2021'de aya göre 2,9–10,2 (yıllık 4,3). Sabit kaynaklar ayıklanınca yaklaşık 2,9.
- VIIRS satırlarının %30,5'i `type` 2 (sabit kaynak), MODIS'te %6,7. VIIRS `type` 2 gerçekten sabit: hücre başına ortanca 164 tespit günü, %95 gece.
- **MODIS `type` etiketi güvenilmez:** sürüm 2018'de değişiyor, `type` 2 payı %0,4–2,2'den %6,7–10,8'e sıçrıyor. `type == 0` filtresi 2018'de %6–8'lik yapay basamak yaratır.
- Toplam FRP ortak ölçü olamıyor: büyük yangın aylarında MODIS toplamı daha yüksek, diğer aylarda VIIRS.
- **MODIS kendi içinde tutarlı değil:**
  - 3 Temmuz 2002'ye kadar yalnızca Terra. Düzeltilmezse −%45 basamak.
  - Yörünge kayması veride görülüyor: Terra gündüz geçişi 11,0 → 10,0 (2021→2025), Aqua 13,1 → 14,2. S-NPP 12,9–13,1'de sabit.
  - MODIS/VIIRS oranı 2012–2020'de sabit, 2021–2025'te yaklaşık %15 düşük.
- Mayıs–Haziran çarpanları düşük ve bu gerçek: Haziran'da MODIS tespitlerinin ~%80'i Güneydoğu'da (buğday anızı), ~%70'i Terra'dan (sabah geçişi). Oran her yıl 1,8–2,7 aralığında.
- Sensör kesintileri: S-NPP 2022-07-27 (15 gün) ve 2024 yazında üç kısa kesinti; Aqua 2012-12-04 (22 gün), 2022-03-31 (19 gün); Terra 2022-10-11 (13 gün).

## 4. Önerilen birleştirme yöntemi

1. Volkan (`type` 1) ve açık deniz (`type` 3) kayıtlarını at.
2. Sabit kaynakları konum maskesiyle ayıkla: 2012–2025'te herhangi bir VIIRS `type` 2 tespiti olan her 0,01° hücre, ±1 hücre genişletilmiş (8.875 hücre). MODIS `type` etiketine göre filtreleme yapma.
3. Kesinti günlerini iki sensörden de çıkar.
4. Ölçü: aylık hotspot sayısı. (0,05° hücre-gün de savunulabilir, biraz daha kötü.)
5. 2012-01-20'den itibaren VIIRS olduğu gibi.
6. Öncesinde MODIS × o ayın çarpanı (VIIRS-eşdeğeri).
7. Kasım 2000 – Temmuz 2002: önce Terra → Terra+Aqua aylık çarpanı, sonra 6. adım.
8. Her değere %90 tahmin aralığı (dışarıda bırakılan yılların artıklarından, alan büyüklüğü sınıfına göre).

Ulusal aylık çarpanlar (VIIRS/MODIS, `analysis/out/final_factors.json`):

| Ay | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sayı, 2012–2025 | 3,00 | 2,89 | 3,37 | 2,89 | 1,19 | 1,99 | 3,04 | 4,18 | 4,67 | 3,79 | 2,49 | 2,86 |
| Sayı, 2012–2020 | 3,32 | 3,22 | 3,21 | 3,18 | 1,52 | 1,96 | 3,46 | 4,43 | 4,59 | 3,75 | 2,51 | 2,85 |
| Hücre-gün, 2012–2020 | 2,77 | 2,95 | 2,97 | 2,84 | 1,26 | 1,39 | 2,45 | 3,09 | 3,39 | 3,08 | 2,23 | 2,35 |

Terra-tek düzeltmesi (Terra+Aqua/Terra, 2003–2020): 3,53 · 3,03 · 2,21 · 1,79 · 1,59 · 1,42 · 1,55 · 1,72 · 1,87 · 2,01 · 2,55 · 3,37. Dışarıda bırakılan yıllarda ülke yıllık hatası %2,5, aylık %6,9.

Bu çarpanlar Türkiye'nin tamamına aittir ve Güneydoğu anız rejiminin ağırlığını taşır; bölgesel kullanımda yeniden hesaplanmalıdır (bkz. `analysis/med/`, sürüyor).

## 5. Doğruluk

Hata = WAPE (Σ|tahmin − gerçek| / Σgerçek). Mevsimsel çarpan, MODIS→VIIRS, hücre-gün ölçüsü:

| Alan | Yıllık | Aylık | 8 günlük |
|---|---|---|---|
| Türkiye | %6 | %12 | %19 |
| ~200 km | %17 | %32 | %43 |
| ~100 km | %24 | %43 | %59 |
| ~50 km | %33 | %57 | %77 |
| ~25 km | %45 | %74 | %96 |

Düzeltmesiz MODIS: her ölçekte %60–80 hata, −%60 yanlılık. Uyumlaştırılmış seride yanlılık ~0.

Ülke ölçeğinde sıralama: yıl sıra korelasyonu 0,94 (yıllık); en yüksek %10'daki yılların tamamı doğru yakalandı; olağandışı ayların %69'u yakalandı. %90 aralığın gerçek kapsaması ülkede %87, 1°'de %93.

### Model karşılaştırması (aylık, hücre-gün)

| Model | Türkiye | ~100 km | ~25 km | Not |
|---|---|---|---|---|
| Düzeltme yok | %60 | %65 | %74 | |
| Tek çarpan | %30 | %50 | %78 | |
| **Aylık çarpan** | **%12** | **%43** | **%74** | Önerilen |
| Log-log regresyon | %11 | %43 | %84 | Küçük alanda yıl sıralamasını bozuyor (ρ 0,15) |
| Poisson GLM | %10 | %40 | %81 | Aynı sorun; toplanabilir değil |
| Yüzdelik eşleme | %16 | %39 | %67 | Küçük alanda −%13 yanlı; toplanabilir değil |
| Klimatoloji katkılı | %20 | %39 | %65 | Yıllar arası bilgiyi siliyor (ρ ≤ 0,2) |
| Gradient boosting | %23 | %38 | %77 | Ülke ölçeğinde veri az |

### İki yön

| Ölçek (aylık) | MODIS→VIIRS | VIIRS→MODIS | VIIRS→MODIS + seyreltme |
|---|---|---|---|
| Türkiye | %12,3 | %13,2 | %12,3–13,3 |
| ~100 km | %42,9 | %45,1 | %42,7–43,2 |
| ~25 km | %74,3 | %76,1 | %71,4–72,1 |

Farklar belirsizlik aralığının içinde. Seyreltme = 5 MW altı VIIRS tespitlerini atmak, ya da hücre-günü yalnızca ≥2 tespit veya ≥10 MW toplam FRP varsa tutmak.

### Gürültü tabanı

| Ölçek (aylık) | Kusursuz model (Poisson) | Terra→Aqua | MODIS↔VIIRS |
|---|---|---|---|
| Türkiye | %3 | %12 | %12–13 |
| ~100 km | %22 | %53 | %43–45 |
| ~25 km | %50 | %87 | %71–76 |

MODIS–VIIRS dönüşümü, iki özdeş MODIS cihazı arasındaki dönüşüm kadar iyi. Küçük alandaki hatanın büyük kısmı sayım gürültüsü: 0,25° kutuların yarısında MODIS yılda birden az hücre-gün kaydetmiş; aylık VIIRS etkinliğinin %25'i MODIS'in hiçbir şey görmediği kutulara düşüyor.

### Ölçü ve filtre duyarlılığı (aylık)

| Seçenek | Türkiye | ~100 km | ~25 km |
|---|---|---|---|
| Ham sayı, maskeli | %11,0 | %37,5 | %64,2 |
| Hücre-gün 0,05°, maskeli | %12,3 | %42,9 | %74,3 |
| + düşük güvenliler atılmış | %11,7 | %42,6 | %74,2 |
| Yalnızca gündüz | %12,3 | %43,5 | %75,5 |
| `type == 0` | %12,9 | %44,7 | %77,5 |
| Toplam FRP | %18,8 | %47,1 | %70,6 |
| Filtre yok | %16,3 | %58,3 | %94,2 |
| Yalnızca gece | %27,5 | %79,4 | %110 |

## 6. Sınırlar ve sınanmayanlar

- Doğrulama dolaylı: hata 2012–2025'te ölçüldü; çarpanların 2000–2011'de de geçerli olduğu bir varsayım.
- Yalnızca Türkiye. Çarpanlar ve sabit kaynak maskesi başka ülkede yeniden üretilmeli. Maske 2012'den önce kapanmış tesisleri kaçırır.
- Testler sabit kutularla yapıldı, kullanıcı poligonlarıyla değil.
- 2012 en zayıf yıl (+%13; VIIRS 20 Ocak'ta başlıyor).
- 2021–2025'teki oran düşüşü yörünge kayması mı büyük yangın etkisi mi, ayrıştırılmadı.
- Sınanmadı: NOAA-20/21 geçişi, arazi örtüsü ayrımı, yangın olayı kümeleme. Tarama açısı ve kutuya özel modeller koşuldu ama sonuçları incelenmedi.

## 7. Mevcut araçlar ve fark

14 Kasım akşamı yapılan tarama. Ağ sorunları yüzünden bazı sayfalar açılamadı; yalnızca özet ya da arama sonucundan görülenler "(doğrulanmadı)" ile işaretli.

### 7.1 NASA ve literatür ne yapıyor

- **Resmî uyumlaştırılmış hotspot sayım ürünü yok.** FIRMS, GFED5, GFAS ve FEDS'te bulunamadı. FIRMS sensörleri ayrı katman ve ayrı indirme olarak veriyor; sensörleri karıştırma konusunda yönerge bulunamadı.
- **NASA uyumlaştırma projesi (Boschetti, Roy, Giglio):** hedef 25 yıllık, 0,25°'lik, belirsizlikli MODIS/VIIRS kaydı; ama yanık alan üzerinden ve Landsat-8/Sentinel-2 ile kalibre ederek. 2023 sunumunda gecikme bildirilmiş; yayımlanmış ürün bulunamadı (doğrulanmadı, sunumlar açılamadı). https://modis.gsfc.nasa.gov/sci_team/meetings/202305/presentations/boschetti.pdf
- **GFED5NRT (Chen vd. 2026, ESSD 18:7535):** yöntemce bize en yakın iş. Günlük VIIRS sayısını bölge × arazi örtüsü katsayılarıyla yanık alana, sonra emisyona çeviriyor; katsayılar 2012–2022 örtüşmesinde kalibre; bakış geometrisi düzeltmesi ve 0,01° sabit kaynak maskesi var; 0,25° ızgara. Doğruluk yerine GFED5 ile uyum skoru veriyor (bölgeye göre 0,62–0,98). https://essd.copernicus.org/articles/18/7535/2026/
- **Zheng vd. 2026 (Remote Sensing 18:1650):** Aqua ve VIIRS FRP'sini düzeltip birleştiriyor, yalnızca 2012–2024 (yalnızca özet görüldü). https://www.mdpi.com/2072-4292/18/10/1650
- **Sofiev ve Kouznetsov 2026 (GMD 19:10123):** tespit eşiğini piksel alanına bağlı modelliyor. MODIS gündüz ~5,7 MW (tarama kenarında ~40 MW), VIIRS gündüz ~3,7 MW, gece 0,5–0,7 MW. https://gmd.copernicus.org/articles/19/10123/2026/
- **Li vd. 2018 (JGR-Atmos 123:4545):** MODIS FRP'si bakış açısına güçlü bağlı (kenarda nadire göre %300'e kadar yüksek); büyük boreal yangınlarda VIIRS FRP'si ~%47 düşük. https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2017jd027823
- **Schroeder vd. 2014 (RSE 143:85):** VIIRS 375 m ürününün tanıtımı. Giglio vd. 2016: MODIS C6. MODIS C6 kullanıcı kılavuzu: 8 günden kısa aralıklarda örnekleme yanlılığı.
- **Bölgesel sayım oranları (VIIRS/MODIS):** Türkiye 2015–2019 3,9 kat (Coskuner 2022, iForest 15:85; yer kayıtlarına göre 10 ha üstü yangınların MODIS %16,6'sını, VIIRS %25,6'sını yakalıyor; tespitlerde tarımsal yakma baskın) https://iforest.sisef.org/contents/?id=ifor3754-015 · Pencap 4,8–6,5 kat (Vadrevu 2018) https://pmc.ncbi.nlm.nih.gov/articles/PMC6108185/ · Çin 2013–2024 ortanca 3,55 kat (doğrulanmadı).
- **Geçiş takvimi:** S-NPP verisi 2 Kasım 2026'da bitti; FIRMS kullanıcıları NOAA-20/21'e yönlendiriyor. https://www.earthdata.nasa.gov/news/blog/transitioning-from-s-npp-viirs-omps-what-nasa-firms-users-need-know · Terra MODIS Ocak 2027, Aqua MODIS Eylül 2027 civarı. https://atmosphere.copernicus.eu/drifting-away-modis-cams-global-fire-assimilation-system · Aqua yörünge kaymasının yangın ürünlerine etkisi "inceleniyor" (Giglio, Mayıs 2025).

### 7.2 Mevcut araçlar

| Araç | Sensör | Tek birleşik seri | Seçilebilir alan | Mevsim / anomali |
|---|---|---|---|---|
| FIRMS | MODIS 2000+, VIIRS 2012+ | Hayır, ayrı | Ülke ya da istekle özel alan | Yok |
| Global Forest Watch | MODIS, VIIRS ayrı | Hayır | İdari birim (doğrulanmadı) | Haftalık grafik, "olağandışı" göstergesi |
| GWIS / EFFIS | MODIS + VIIRS'ten yanık alan olayları | Sayım değil | Ülke (doğrulanmadı) | Haftalık zarf, 2012+ (doğrulanmadı) |
| GFED analiz aracı | Yanık alan, emisyon | Sayım değil | Özel bölge | Aylık |

En yakın eşdeğer Global Forest Watch'un mevsim ve "olağandışı etkinlik" grafikleri. İncelenebilen araçların hiçbiri MODIS ve VIIRS hotspot sayılarını tek bir kalibre edilmiş 2000–2026 serisinde birleştirmiyor.

Aynı challenge'da çok sayıda takım var ve benzer fikirler kuruluyor: H3 altıgenlerinde LightGBM ile aylık köprü, sabit kaynak maskesi ve %90 aralık (https://github.com/Warren-530/fire-harmony); hücre başına Aqua/VIIRS aylık çarpanı (https://github.com/shahedrayhan23/Chronofire). İkisi de yalnızca arama sonucundan görüldü (doğrulanmadı).

### 7.3 Fark

| | NASA / literatür | Bu çalışma |
|---|---|---|
| Hedef birim | Fiziksel büyüklük (yanık alan, emisyon, FRP) | VIIRS-eşdeğeri hotspot sayısı (challenge'ın istediği ölçü) |
| Kapsam | Küresel, sabit 0,25°–1° ızgara | Türkiye, kullanıcının seçtiği alan |
| Değişkenler | Arazi örtüsü, bakış açısı, tespit olasılığı | Ay, bölge, Terra/Aqua ağırlığı |
| Doğrulama | Bağımsız referans (yanık alan, yer kaydı) | VIIRS'e karşı, bir yıl dışarıda bırakarak |
| Doğruluk beyanı | Çoğunlukla uyum skoru | Ölçeğe göre açık hata |

### 7.4 Katkı sayılabilecekler

- **Gürültü tabanı:** MODIS→VIIRS dönüşümü, iki özdeş MODIS cihazı (Terra→Aqua) arasındaki dönüşüm kadar iyi. Kalan hatanın çoğu yöntemden değil sayım gürültüsünden geliyor. Literatürde bu biçimde görülmedi.
- **Ölçeğe göre güven:** hangi alan ve zaman biriminde sonucun güvenilir olduğu ölçüldü; küçük hücrede regresyon ve makine öğrenmesi modelleri yıl sıralamasını bozuyor.
- **Veri tuzakları:** MODIS `type` etiketinin 2018 kırılması, Terra-tek dönem, kesinti günleri, 2021 sonrası yörünge kaymasının veride görülmesi.
- **Olumsuz sonuçlar:** 8 günlük dönem aylıktan kötü; yalnızca Aqua daha kötü; büyük yangınlarda aşırı tahmin (Li vd.'nin FRP bulgusuyla uyumlu, sayım olarak ölçülmüş).

### 7.5 Zaten bilinenler

VIIRS/MODIS oranının 3–6 kat olup değişmesi, FRP'nin sensörler arasında birbirinin yerine geçmemesi, sabit kaynak maskesi ihtiyacı, örtüşme döneminde bölge ve mevsime özel katsayıyla kalibrasyon (GFED5NRT), küçük alanın gürültülü olması.

### 7.6 Eksikler

- Ürün (web uygulaması) henüz yok.
- Doğrulama döngüsel: VIIRS gerçek kabul ediliyor; yanık alan (MCD64/VNP64) ya da yer kaydıyla bağımsız karşılaştırma yok.
- NOAA-20/21 köprüsü sınanmadı; S-NPP bittiği için 2026 ve sonrası buna bağlı.
- Gerçek arazi örtüsü değişkeni yok; tarama açısı modeli koşuldu ama incelenmedi.
- Yalnızca Türkiye.

## 8. Yeniden üretim

- Veri: `python scripts/fetch_firms.py` (yalnızca standart kütüphane).
- Analiz: `.venv\Scripts\python.exe analysis\run_all.py` (pandas, numpy, scipy, scikit-learn). Uzun sürer (≈2 saat).
- Özet sonuçlar: `analysis/out/results_all.csv`, `reverse.csv`, `thinning.csv`, `floors.csv`, `final_factors.json`.

## 9. Yapay zekâ kullanımı

Keşif, analiz kodu ve raporun hazırlanmasında yapay zekâ destekli kodlama araçlarından yararlanıldı. Yöntem kararları ekip tarafından verildi; tüm sayılar gerçek FIRMS verisi üzerinde çalıştırılan koddan gelir ve `analysis/` altındaki betiklerle yeniden üretilebilir.

## 10. Akdeniz bölgesi çalışması (14 Kasım, öğleden sonra)

Kod ve sonuçlar: `analysis/med/` (`metrics.csv`, `factors_MED.json`, `factors_COAST.json`, `events_*.csv`). Bölgeler kutu olarak tanımlandı, gerçek il sınırları kullanılmadı: MED = boylam 29–37, enlem 35,8–38,4; COAST = MED + Ege kıyısı (boylam 26–29, enlem 36,5–39,5). Ölçü ham hotspot sayısı; doğrulama yine bir yıl dışarıda bırakılarak.

### Bölgesel çarpanlar

| | Oca | Şub | Mar | Nis | May | Haz | Tem | Ağu | Eyl | Eki | Kas | Ara |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MED | 3,39 | 2,75 | 3,15 | 2,04 | 1,51 | 2,49 | 2,96 | 4,04 | 4,45 | 3,61 | 2,20 | 2,38 |
| COAST | 3,82 | 3,01 | 3,38 | 2,29 | 1,52 | 2,46 | 2,96 | 3,85 | 4,44 | 3,62 | 2,28 | 2,59 |
| Ulusal | 3,00 | 2,89 | 3,37 | 2,89 | 1,19 | 1,99 | 3,04 | 4,18 | 4,67 | 3,79 | 2,49 | 2,86 |

Bölgesel çarpanlar ulusal olanları geçiyor ama az: bölge aylık %15,3'e karşı %16,6; yıllık %6,2'ye karşı %7,1. Ulusal çarpanlar MED'de +%3,8 yanlı. Yangın sezonunda (Tem–Eki) fark yalnızca %3–5; asıl fark Nisan–Haziran ve kışta.

### Bölge içi doğruluk (MED, bölgesel aylık çarpan, WAPE)

| | Bölge | ~1° | ~0,5° | ~0,25° |
|---|---|---|---|---|
| Yıllık | %6,2 | %23,0 | %29,0 | %37,3 |
| Yangın sezonu (Haz–Eki) | %6,5 | %23,0 | %29,2 | %37,2 |
| Aylık | %15,3 | %37,7 | %47,0 | %58,1 |
| Düzeltmesiz, aylık | %70,1 | %73,3 | %75,4 | %78,0 |

Yıl sıra korelasyonu: bölge yıllık 0,99; 1° yıllık 0,83; 1° aylık 0,48; 0,25° aylık 0,44. %90 aralığın kapsaması bölgede %79 (14 değere dayanıyor), 1° yıllıkta %85.

Bu çalışmada aynı hücreler için Poisson tabanı çok daha düşük çıktı (0,25° aylık %18). Önceki bölümdeki %50 taban MODIS hücre-gün hedefi içindi; VIIRS sayım hedefinde geçerli değil. Poisson, kümelenmiş tespitler için zayıf bir tabandır; Terra→Aqua karşılaştırması bölge içinde yeniden yapılmadı.

### Hata azaltma denemeleri

| Fikir | Sonuç |
|---|---|
| Terra ve Aqua'ya ayrı aylık ağırlık | Küçük ama tutarlı kazanç: bölge aylık %14,7, yıllık %5,7. Tutulabilir. |
| Yalnızca Aqua | Daha kötü (0,25° aylık %65,7). |
| Daha az mevsim parametresi (harmonik, 4 mevsim) | Kazanç yok; 12 serbest çarpan aşırı uyum yapmıyor. |
| Etkinliğe bağlı çarpan (β = 0,88), bölge toplamına uygulanmış | Bölge yıllık %4,1, sezon %4,9. Kutularda etkisi yok. 2021-08 aşırı tahminini düzeltiyor, 2021-07'yi eksik tahmin ediyor. |
| Aynı şey kutu bazında | Reddedildi: −%16 yanlılık, toplanabilir değil. |
| Anız/orman ayrımı (mevsimsellikten türetilmiş vekil) | Kazanç yok. |
| Küçük alan için bölgeden ödünç alma | Reddedildi: WAPE düşüyor ama yıl sıralaması çöküyor (0,25° aylık ρ 0,44 → 0,22). |
| Düşük güvenlileri atmak | Etkisiz. Yalnızca yüksek güven ya da yalnızca gündüz: daha kötü. |

Terra-tek dönem (2000 – 2002 ortası) bölgede yalnızca bölge/yıl düzeyinde kullanılabilir: yıllık %12,9, aylık %23,7.

### Büyük olaylar (COAST, dışarıda bırakılmış)

| Ay | VIIRS gözlem | Tahmin |
|---|---|---|
| 2015-09 | 5966 | 6039 |
| 2021-08 | 5486 | 7566 (+%38) |
| 2021-07 | 4469 | 4794 |
| 2016-08 | 4394 | 3919 |
| 2013-08 | 4158 | 3945 |

- En büyük yangın aylarının çoğu orman yangını değil, Çukurova/Adana ovasındaki tarımsal yakma.
- 2021-07 Manavgat 0,25° hücrede iyi: 1048 gözlem, 1084 tahmin.
- 2021-08 Marmaris/Milas aşırı tahmin ediliyor (bir hücrede 359'a karşı 750): çok büyük yangınlarda MODIS tespiti başına VIIRS tespiti azalıyor.
- En büyük 50 hücre-ayda (0,25°) hata %17,6, %94'ü 2 katın içinde.

### Bölge için güvenilir çözünürlük

- Güvenilir: tüm bölge (yıl, sezon, ay); ~1° birimler yıllık ve sezonluk toplamda; tekil büyük olaylar 0,25° aylıkta bile ~%20 içinde.
- Güvenilir değil: 1° aylık; 0,5° ve altı; 2000–2002 için bölge/yıl dışındaki her şey.

Sınanmadı: gerçek il poligonları, modellerin birleşimi (Terra/Aqua ağırlığı + β), tarama açısı düzeltmesi.
