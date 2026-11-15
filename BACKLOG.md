# BACKLOG

Repo: https://github.com/onerrbaris/burncal (private). Yeni oturum: önce `docs/HANDOFF.md`. Bulgular: `docs/REPORT.md`. `ARCHITECTURE.md` taslaktır.

## Next step
Yedi bölgenin LOYO doğrulaması tamamlandı (`docs/GEOGRAPHIC_VALIDATION.md`). Yöntem/üyelik değişirse `.venv/Scripts/python.exe scripts/validate_geographic_regions.py` → `python scripts/build_geographic_regions.py`. Bölge toplamları atlas veri üretiminde otomatik yenilenir.
Küçük yıl kontrolünü masaüstü/mobilde görsel olarak kontrol et; renk ölçeği artık isteğe bağlı açılır.
Kenar oklarını tarayıcıda görsel olarak kontrol et: liste solda kapalı; il özeti sola, grafik paneli sağa kayar. Deniz ilk uydu görünümünde.
Mat mavi su yüzeylerini deniz kıyıları ve göllerde tarayıcıda görsel olarak kontrol et.
Şehir etiketlerinin yeni fontunu ve yakınlaşınca belirmesini tarayıcıda görsel olarak kontrol et (uzakta gizli, z6.4–7 arası açılır).
Sunum (7 slayt) ve teslim formu. Veri güncellemek için: `python scripts/fetch_firms_recent.py` → `scripts/check_recent.py` → `build_harmonized.py --force` → `build_points.py` → `build_atlas_json.py` (MAP_KEY `.env` içinde). İngilizce arayüz en sona (kullanıcı kararı). Açık: NOAA-20/21'in S-NPP serisine geçişi ayrı değerlendirilecek (oranlar `docs/data_2026/recent_check_2026.json`).

## In progress
- (yok)

## Open
- İl gruplarını gerçek il poligonlarıyla tanımla (3–4 komşu il, benzer yanma rejimi) ve hatayı yeniden ölç. Kutularla ilk ölçüm yapıldı: `analysis/med/subregions.py`.
- Gerçek il sınırlarıyla doğrulama (şimdiye kadar kutularla yapıldı)
- Eleştiri yanıtı: `docs/CLAUDE_RESPONSE_TO_REVIEW.md` (deneyler `analysis/experiments/review_2026_11_14/`). Açık kalanlar o dosyanın "Yapılmayanlar" bölümünde; ilki gerçek il poligonları (geoBoundaries `data/raw/boundaries/` altında, `shapely` kurulu). Öne çıkan bulgu: zamana ileri testte hata LOYO'nun ~1,5 katı; `invarea_w` ürün adayı.
- 2026 verisi: FIRMS MAP_KEY gerekli
- **Olay kümeleme denemesi (gece, en fazla 2 saat).** Amaç: büyük yangınlarda MODIS tespiti başına VIIRS tespitinin azalmasını yakalamak (2021-08 Marmaris/Milas +%38 aşırı tahmin). Yapılacak: MED/COAST'ta MODIS noktalarını yer + gün yakınlığına göre olaylara grupla (tarih için `data/raw` yeniden okunmalı; `med/cache/det_region` yalnızca yıl/ay içeriyor), olay başına VIIRS/MODIS oranını olay büyüklüğü ve FRP'ye göre modelle, `analysis/med/evaluate.py` ölçüleriyle bir yıl dışarıda bırakarak aylık çarpanla kıyasla (WAPE, yanlılık, yıl sıra korelasyonu; bölge, 1°, 0,25°). Sonuç ne olursa olsun `docs/REPORT.md`'ye yazılacak. Ortamda pandas/scikit-learn kurulu değil.
- Terra/Aqua ayrı ağırlığı ürüne al (`analysis/med/evaluate.py:135`; bölge aylık %15,3 → %14,7).

## Ürün fikri (karar değil, tasarımda değerlendirilecek)
- **Türe ayrılmış takvim ve tarla ateşi eğilimi haritaya eklenebilir.** Bulgu: Çukurova'da tarım arazisindeki ateşler 20 yılda ~%70 azalmış, Güneydoğu'da azalmamış; üç bağımsız seri uyumlu (`docs/REPORT.md` 12. bölüm, `analysis/agri_trend/fig1_cropland_annual.png`). Olası biçim: tarla ateşi / orman yangını için iki ayrı takvim (türe özel çarpanla), Çukurova–Güneydoğu karşılaştırması, 2021 orman yangınları ikinci sahne. Orman kenarı katmanı ve Eskişehir denendi, gösterilebilir sonuç çıkmadı.

## İkinci ön yüz: `web/` (masa reposundan taşındı)
- `Blockchaindeveloper43/masa` reposundaki atlas ön yüzü (MapLibre küre, uydu, arazi) `web/` klasörüne kopyalandı. `frontend/` klasörüne dokunulmadı; hangisinin ana ürün olacağı ekip kararı.
- `web/` içinde hazır olanlar: birleşmiş seri (2001–2025), yıl × ay takvimi, medyana göre karşılaştırma, güven rozeti, CSV indirme, il arama.
- Veri: `python scripts/build_atlas_json.py` → `web/data/atlas.json`. Girdileri `frontend/atlas-data.js` ve `frontend/harmonized-data.js`; ikisinden biri yeniden üretilince çalıştırılmalı.
- Çalıştırma: `cd web && python -m http.server 8000`, sonra http://localhost:8000 (dosyadan doğrudan açılmaz).
- **Yapılmadı:** tarayıcıda görsel kontrol (dosyalar sunuluyor, betikler ayrıştırılıyor, 81 il adı eşleşiyor; sayfa açılıp bakılmadı). Çevrimdışı güvenlik: uydu, yol/etiket ve arazi karoları ile yazı tipi internetten geliyor; ağ yoksa harita boş kalır. `frontend/terrain.jpg` yerel yedek katman olarak eklenebilir. GitHub Pages iş akışı taşınmadı.

## Birleşmiş sekmesi için veri hazır
- `frontend/harmonized-data.js` ve `frontend/harmonized.csv` (`scripts/build_harmonized.py`). 81 il, 2000–2025, sayım ilden, çarpan ilin İBBS-2 bölgesinden. Bağlama satırları, önerilen demo illeri (Adana, Şanlıurfa, Antalya) ve filtre uyarısı: `docs/DEMO_ILLER.md`. Atlas dosyalarına dokunulmadı.
- Güven: 10 il yüksek, 37 orta, 34 düşük. Arayüzde rozet olarak gösterilmesi önerilir.

## Team to-do (humans)
- FIRMS MAP_KEY iste: https://firms.modaps.eosdis.nasa.gov/api/map_key/ → `.env` içine `FIRMS_MAP_KEY=...` (commit'leme)
- Teslim kılavuzuna (video süresi) tarayıcıdan bak. ("Resources" sekmesine bakıldı: yalnızca FIRMS listeleniyor. "Teams" sekmesi bu challenge için 841 takım gösteriyor.)
- Deploy için Render + Vercel hesapları

## Done
- 15 Kas: Yılları oynat düğmesi, zamanlayıcısı ve boşluk kısayolu kaldırıldı; yıl kaydırıcısı ve elle yıl seçimi korundu, yardım metni güncellendi.
- 15 Kas: Bölge kartının uzun teknik açıklaması arazi türü bölümünün altındaki kapalı "Veri ve yöntem" notuna taşındı; "Ateşler nerede yanıyor?" doğrudan doğrulama kartından sonra görünür.
- 15 Kas: Doğrulama kartı tam genişliğe alındı, yıllık/aylık yüzdeler kesilmeden okunuyor. OSM orman katmanı kaldırıldı; renk katmanı "Tespit yoğunluğu" oldu ve il/bölge geçişinde tercihi korunuyor. İller/Bölgeler seçimi üst aramanın soluna taşındı, ayrı bölge listesi kaldırıldı. Tarayıcıda arama, iki yönde açık/kapalı tercih ve konsol kontrolü geçti.
- 15 Kas: Günlük önbellekten 2012–2025 LOYO tahminleri yeniden üretildi; 81 ilde mevcut yıllık/aylık WAPE ile eşleşti. Tahmin ve gözlemler yedi bölge içinde toplanıp gerçek bölge hataları hesaplandı; kartta yıllık/aylık hata ve yıllık güven gösteriliyor (Akdeniz %7,0 / %14,5). Üyelik/yöntem imzaları eski çıktıyı reddeder. Sekiz test ve yedi kartın tarayıcı kontrolü geçti; konsol temiz. Yöntem ve sınırlar `docs/GEOGRAPHIC_VALIDATION.md` içinde.
- 15 Kas: Bölge özetine arazi türü yüzdeleri eklendi. Bölgedeki illerin seçili yıl/ay aralığındaki tespitleri sınıf bazında toplanır; il yüzdelerinin ortalaması alınmaz. Şehir kartının görünümü ve 20 tespit eşiği korunur.
- 15 Kas: Yıl/ay aralığı filtreleri ve Ay ayrıntısı kartı sol özetten sağ grafik paneline, sekmelerin üstüne taşındı; il ve bölge görünümünde aynı kontroller kullanılır. Tarayıcıda Akdeniz ve Adana için yıl aralığı/ay değişimi denendi; sol panelde bu kontroller yok, sağdaki kart/grafikler güncelleniyor; yeni konsol hatası yok.
- 15 Kas: Atlas'a İller / 7 bölge seçimi eklendi. Marmara, Ege, Akdeniz, İç Anadolu, Karadeniz, Doğu Anadolu, Güneydoğu Anadolu haritadan/menüden seçilir; renk, takvim, kıyas, sıralama, CSV ve süren ay kıyası il serilerinin toplamını kullanır. 81 il tek kez kapsanır; 804 ay/sensör toplamı ve indirilen 75 aylık CSV doğrulandı. Tarayıcıda yedi seçim, Akdeniz–2021, sensörler, sekmeler, ay filtresi ve il görünümüne dönüş denendi; konsol temiz.
- 15 Kas: Arazi türü (ESA WorldCover 2021, 10 m, 19 parça, Türkiye tamamı): her noktanın sınıfı (nokta dosyaları artık 6'lı, "stride":6), il×yıl×ay×4 grup sayımı (web/data/landcover.json), ~270 m renkli katman (web/data/landcover/). Kontroller: Antalya/Muğla Tem–Ağu 2021 %77–80 ağaçlık; Adana 2025 %81, Şanlıurfa Haz 2025 %94 tarım; 20 m katmanla 290/300 uyum. Sırayla: build_points → build_landcover.
- 15 Kas: Varsayılan harita katmanları yalnızca 3B arazi açık olacak şekilde düzenlendi; il renkleri, noktalar, orman, yer adları ve yollar kapalı. Stil ve kutucuk durumları eşleştirildi; JS ve stil üretimi doğrulandı.
- 15 Kas: Yıl çubuğu altta ortalanmış en fazla 480 px genişlikte, yaklaşık 48 px yüksekliğinde kompakt kontrole dönüştürüldü. Oynatma ve kaydırıcı korundu; renk ölçeği açılır menüye taşındı, mobil yerleşim ayarlandı. JS ve HTTP sunumu doğrulandı; görsel kontrol bekliyor.
- 15 Kas: Deniz ilk yarı saydam uydu görünümüne döndürüldü. Sıralama ve iki il paneline bağımsız, animasyonlu kenar okları eklendi; liste başlangıçta gizli, yeni il seçilince il panelleri açılır. Sözdizimi, panel etkileşimleri ve HTTP sunumu doğrulandı; görsel kontrol bekliyor.
- 15 Kas: Son görselden ölçülen #49659B tüm su yüzeylerine uygulandı; önbellek sürümleri yenilendi, JS ve stil doğrulandı.
- 15 Kas: Son renk örneğinden ölçülen #A6D6E3 tüm su yüzeylerine uygulandı; önbellek sürümleri yenilendi, JS ve stil doğrulandı.
- 15 Kas: Su rengi ekli PNG pikselinden birebir #BED9F7 olarak ölçülüp uygulandı; app.js ve mapstyle.js önbellek sürümleri yenilendi.
- 15 Kas: Kullanıcının yeni renk örneğine göre tüm su yüzeyleri açık pastel maviye (#bbd9f3) çevrildi; düz ve opak görünüm korundu.
- 15 Kas: Atlas deniz, göl ve diğer su poligonları referans görseldeki gibi düz mat mavi (#203f62) yapıldı; tüm yakınlaşmalarda opak, uydu ve il renklerinin üzerinde. JS ve stil katman sırası doğrulandı; görsel kontrol bekliyor.
- 15 Kas: İl seçilince iki panel (kullanıcı isteği): solda özet, kutular, filtreler, ay ayrıntısı ve İndir (#side); sağda geniş grafik paneli (#panel, 540 px, grafikler 500 birim genişlikte, setChartWidth). İl listesi panel açıkken gizli. Chrome'da takvim tıklama, sezon filtresi, CSV/PNG denendi.
- 15 Kas: Arayüz baştan tasarlandı (kullanıcı isteği): koyu grafit tema, Inter yazı tipi, tek turuncu vurgu; panelde önce özet (büyük sayı + "olağan/olağandan yüksek" etiketi + tek cümle), sonra 3 kutu, filtreler, ay ayrıntısı, sekmeler; indirmeler tek "İndir" menüsünde; "Nasıl kullanılır?" yardım menüsü; "medyan" yerine "orta değer". Dosyalarda `?v=` sürüm etiketi var (önbellek); CSS/JS değişince artırın. Chrome'da ekran görüntüsüyle kontrol edildi.
- 15 Kas: Atlas şehir etiketleri Noto Sans Regular, doğal büyük/küçük harf ve sade kırık beyaz görünümle yenilendi; uzak görünümde gizli, yakınlaşınca kademeli görünür. Yerleşim etiketlerine geçiş yumuşatıldı. JS sözdizimi, stil üretimi, yakınlaşma eşikleri ve yerel HTTP sunumu doğrulandı; görsel kontrol bekliyor.
- 15 Kas: Haritadaki ateş noktaları tıklanabilir (Codex + gözden geçirme): balonda tarih, sensör, FRP, il, SP/NRT, aynı konumdaki tespit sayısı ve "Bu ayı takvimde aç". Ek veri/istek yok; tıklama önbellekteki yıl dizisinde ±8 px arar, enlem/boylam ön elemesiyle ~0,7 ms (Adana 2021, eğik kamerada da). Noktasız yere tıklama il seçimini korur. Chrome'da denendi.
- 15 Kas: 2026 verisi FIRMS API'den (MAP_KEY) indirildi: MODIS, S-NPP, NOAA-20, NOAA-21; SP/NRT işaretli, kayıt `docs/data_2026/`. Tekrar yok; NRT'de `type` boş (beklenen). S-NPP NRT 2 Kasım'da bitiyor → seri 2026-11-02'de kesildi (MODIS 2026'da düzensiz: Ocak'ta S-NPP'nin %4'ü, 2025'te %26; MODIS×çarpan dolgusu güvenilmez olurdu). Kesinti oranları ve maske yalnızca 2012–2025 arşivinden: 2000–2025 değerleri birebir aynı kaldı (0 satır fark). NOAA-20/S-NPP toplam oranı 1,05, NOAA-21 1,00 (285 gün); seriye eklenmedi. Açılış kartı süren ay <7 günse son tam ayı okur.
- 15 Kas: Arayüz sadeleşti (WASD, konum göstergesi, "Aylar" sekmesi kalktı; efektler ve MODIS/VIIRS ham sekmeleri duruyor, kullanıcı isteği). İle tıklayınca yumuşak yakınlaşma artık Windows "animasyon efektleri" kapalıyken de oynuyor (sebep buydu: tarayıcı prefers-reduced-motion bildiriyordu). Eklenenler: ay penceresi (yangın sezonu), tespit listesi CSV'si (sayılar paneldeki ham sayılarla birebir), grafik PNG/SVG, OGM sekmesi (ulusal 2001–2025 + 2025 OBM; uydu–OGM Spearman 0,04 / alan −0,33, sebebi tarım), süren ay/yıl için aynı-günler kıyası. 2026 için `scripts/fetch_firms_recent.py` hazır, MAP_KEY bekliyor. Yarım yıl yolu `BURNCAL_CUTOFF=2025-09-13` ile Chrome'da denendi.
- Keşif: FIRMS arşivi + API, challenge kuralları, rakipler
- Türkiye verisi indirildi (`python scripts/fetch_firms.py`)
- Uyumlaştırma yöntemi çalışması: iki yön, seyreltme, gürültü tabanı, filtre duyarlılığı (`analysis/`)
- Akdeniz bölgesi çalışması (`analysis/med/`)
- Alt bölge ölçeği ölçümü (`analysis/med/subregions.py`, `subregion_*.csv`; bir yıl dışarıda, WAPE yıllık/aylık). Tek bölgesel çarpanla: 1 birim %6/%15, 3 birim %13/%26, 5 birim %15/%27, ~100 km (26 birim) %23/%38. Gruba özel aylık çarpanla 5 birim %13/%24. Birim bazında yıllık: Çukurova %8 (tespitlerin %57'si), Muğla doğusu/Antalya batısı %14, Mersin %19, Hatay %19, Antalya doğusu %22; aylık Çukurova %16, diğerleri %33–40. Kutularla ölçüldü, il poligonlarıyla değil.
- Repo oluşturuldu, Blockchaindeveloper43 davet edildi

- Karşılaştırma (14 Kas akşam): resmî uyumlaştırılmış hotspot sayım ürünü yok; NASA tarafı yanık alan/FRP üzerinden gidiyor (GFED5NRT en yakın yöntem, Coskuner 2022 Türkiye için 3,9 kat). Challenge metni açıkça hotspot sayısı ve aylık karşılaştırma istiyor. Eksiklerimiz: ürün, bağımsız doğrulama, NOAA-20/21 köprüsü, gerçek arazi örtüsü.

- Challenge eksikleri kapatıldı (14 Kas gece): tarih aralığı seçimi, "bu ay medyana göre" kartı (yüzdelik + düzey), takvimde anomali işaretleri, yıl/ay sıralaması, ham–uyumlaştırılmış yıllık grafik, zengin CSV, düşük güven uyarısı. Üç sekme artık aynı konum maskesini kullanıyor (`build_atlas_json.py` veriyi `frontend/harmonized.csv`'den alıyor; MODIS sekmesi 2001'de başlıyor). `README.md`, `LICENSE` (MIT), `docs/SOURCES.md` eklendi. Başsız Edge ile denendi; gerçek tarayıcıda elle bakılmadı. Açık kalan: 2026 verisi, İngilizce arayüz, sunum.

## Decisions
- 15 Kas: Yedi bölge hata kartı artık 2012–2025 LOYO ölçümünü kullanır; tahminler ve VIIRS gözlemleri toplandıktan sonra WAPE hesaplanır. Bu, yanan alan hatası veya 2012 öncesi/2026 doğrulaması olarak sunulmaz. Önceki "Ölçülmedi" geçici kararı bu hesaplamayla tamamlandı.
- 15 Kas: Yedi bölge görünümü coğrafi bölgelerin il gruplarıyla yaklaşımıdır (iller bölünmez); sınır notu ve üye iller panelde gösterilir. Mevcut il uyumlaştırılmış serileri toplanır, yeni bölge çarpanı türetilmez; bağımsız bölge hatası ölçülene kadar güven rozeti "Ölçülmedi" olur.
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

Next step — Masaüstü 3B arazi kamerası ve animasyonlu takvim penceresi için kullanıcı geri bildirimi al.

Next step — 81 ilin MODIS (2000–2025) ve VIIRS (2012–2025) takvimlerini haritada incele. Birleşmiş sekmesi boş.

Next step — Türkiye maskesi, deniz dokusu ve il seçimi kamera geçişlerini masaüstünde incele.

Next step — İl seçimiyle açılan 1536 px çevrimiçi uydu dokusunu ve alçalan kamerayı incele.

Next step — Site yayını: `pages-yayini` dalını `master`e al, sonra Settings → Pages → Source: GitHub Actions seç. `master`e giden her `web/` değişikliği https://onerrbaris.github.io/burncal/ adresine yayınlanır. Yerelde: `cd web` → `python -m http.server 8000`.
