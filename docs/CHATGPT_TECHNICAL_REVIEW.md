# BurnCal — ChatGPT bağımsız teknik eleştiri (Claude için)

**Tarih:** 14 Kasım 2026  
**Kapsam:** NASA FIRMS MODIS + VIIRS hotspot uyumlaştırması. High Res ertelendi.  
**İnceleme türü:** GitHub'daki kodun statik incelemesi ve commit edilmiş deney sonuçları. **Ham `data/raw` CSV'leri GitHub'da bulunmadığından deneyler bu incelemede yeniden çalıştırılmadı; aşağıdaki hiçbir yeni öneri için ölçülmemiş başarı oranı iddia edilmiyor.**

## Claude'a görev

Bu belgeye bir **teknik yanıt** yaz: her madde için `katılıyorum / kısmen / katılmıyorum`, kanıt olarak ilgili fonksiyon/satır, gerekiyorsa deney tasarımı, mümkünse gerçek NASA verisiyle çalıştırılmış sonuç. Yanıtı `docs/CLAUDE_RESPONSE_TO_REVIEW.md` adıyla commitle. Önce P0 maddelerini çöz; High Res/frontend ve sentetik veri yok. Deney sonuçlarını yeni CSV'ler ve çalıştırma komutlarıyla kaydet. Kod düzeltmelerinde mevcut sonuçların üzerine yazmadan önce sürümle.

## 1. Mevcut ölçülen sonuçlar (MED, tüm bölge)

Kaynak: `analysis/med/metrics.csv`; 2012–2025 yıllarını tek tek dışarıda bırakan modellerin **repo içindeki kayıtlı** sonuçları:

| Model | Aylık WAPE | Sezon WAPE | Yıllık WAPE | Aylık yıl-sıra rho |
| --- | ---: | ---: | ---: | ---: |
| `reg12` | 15,28% | 6,51% | 6,19% | 0,843 |
| `terra_aqua` | 14,68% | 6,37% | 5,68% | 0,852 |
| `power_td` | 14,73% | 4,90% | **4,06%** | 0,842 |
| `invarea_w` | **14,05%** | 4,62% | 4,46% | 0,824 |
| `area_w` | 22,37% | 13,26% | 12,19% | 0,856 |

**İlk eleştiri:** `invarea_w` aylık, `power_td` yıllık en düşük WAPE'yi veriyor; yalnızca WAPE ile “en iyi model” seçilemez. `invarea_w` aylık yıl-sıra korelasyonunu `reg12`ye göre düşürüyor; tüm coğrafyalardaki bias ve ekstrem olaylar görülmeden kazanan ilan etmeyelim. WAPE = Σ|tahmin−VIIRS|/ΣVIIRS; “%85 doğru” ifadesi değildir. VIIRS de gerçek yangın olayı sayısı veya yanmış alan değil, sensör tespitidir.

## 2. Kritik ve doğrulanabilir eleştiriler

### P0-A. Tahmin aralıkları gerçek anlamda nested LOYO değil — [KOD]

**Kanıt:** `analysis/med/evaluate.py`: `run()` her yıl için LOYO nokta tahmini üretiyor; `intervals(Y,P)` ise test yılı y'nin aralığını kurarken *diğer yıllara ait dışarıda-bırakılmış tahminlerin artıklarını* kullanıyor. O diğer yılın modeli y'yi eğitimde görmüş olabileceği için kalibrasyon artıklarına y dolaylı olarak girmiş oluyor. `analysis/harmonize.py` açıklamasında nested / leaky_outer ayrımının zaten farkında olunmuş.

**Düzeltme:** Her dış test yılı y için kalan 13 yılda iç LOYO ile artık elde et; yalnız bu artıklarla y'nin %90 aralığını kur. Raporlanan coverage için yıl-başına, bölge-başına, tüm/aktif/gerçekte pozitif hücre-ay kapsaması ve ortalama aralık genişliğini ver. 14 bağımsız yıl olduğu için nominal 90% garanti iddia etme. **Not:** Nokta tahminlerinin LOYO olması tek başına yanlış değil; eleştiri özellikle aralık kalibrasyonuna.

### P0-B. Test yılının VIIRS bilgisi sabit kaynak maskesine giriyor — [KOD + RİSK]

**Kanıt:** `analysis/common.py:static_mask_keys(d)` 2012–2025 VIIRS `type==2` noktalarının tamamından 0,01° hücre ve ±1 hücre tampon maskesi yapıyor. `analysis/med/prep.py` bunu **LOYO'dan önce** uyguluyor. Test yılının VIIRS sınıflandırması konumsal çıkarma kararını etkileyebilir. Üstelik 2025'te tanımlanan tesisin çevresindeki gerçek 2001 yangınları geriye dönük silinebilir.

**Düzeltme:** Eğitim yıllarından maskeyi fold-başına üretip test yılının *ham* noktasını onunla filtrele. Karşılaştırmalar: maskesiz, `type==2` doğrudan çıkarma, kalıcılık eşiğine dayalı maske, sıfır/tek tampon hücresi. Kayıp `type==0` yangın tespitlerini sensör/yıl/coğrafyaya göre raporla. **Önemli ayrım:** Sabit bir hedef veri temizleme politikası için tüm dönemden sonradan kurulan maske açıklanarak kullanılabilir; fakat bu, “yeni yıl için önceden tahmin başarısı” deneyinden farklı bir değerlendirmedir.

### P0-C. Kesinti/eksik gözlem günleri — [KOD + RİSK]

**Kanıt:** `analysis/common.py:outages(d)` ülke genelinde satelitlerin sıfır tespit günlerinden beklenen sayıyı çıkarıyor. `analysis/med/prep.py` ortak `valid` günlerini veri hazırlanırken kullanıyor. `nvalid` hesaplanıp dizilere yazılıyor; `evaluate.py` model girdilerinde kullanılmıyor. Kısmi tarama/yörünge kapsaması ülke çapında sıfıra düşmeyebilir.

**Düzeltme:** Her sensör×ay için gözlemlenebilir gün/uydu geçişi fırsatı, çıkarılan gün, kısmi kesinti ve veri kalitesi raporla. NASA'nın gerçek geçiş/metaveri ürünleriyle karşılaştırılabilirse yapılmalı; yapay kayıt üretme. Ortak geçerli günleri dışlama ile kapsama-offset yaklaşımını aynı dış testlerde karşılaştır. Kullanıcıya “tüm ayın mutlak sayısı” ile “gözlenen günlere ait sayı” ayrımını açıkça anlat.

### P0-D. 2012 Ocak ve Terra-tek döneminin adil ele alınması — [KOD + RAPOR]

**Kanıt:** VIIRS S-NPP kayıtları 20 Ocak 2012'de başlıyor. `EV=np.arange(2012,2026)` Ocak 2012'yi de kalibrasyon/test döngüsüne alıyor. Aqua ise 2002 Temmuz'da başlıyor. `docs/REPORT.md` bu dönemsellikleri not ediyor.

**Düzeltme:** Ocak 2012'yi tamamen çıkarma, ortak günlerle karşılaştırma ve tüm 2012'yi çıkarma duyarlılık deneylerini yap. 2002 Temmuz'u gün düzeyinde böl. 2000–2002 Terra→Terra+Aqua düzeltmesini yalnız sonraki yılların eğitimiyle ayrı geriye dönük test et. 2000–2011 için gerçek VIIRS olmadığı açık kalsın.

### P1-A. 2021 sonrası rejim/yörünge kayması — [RAPOR + RİSK]

`docs/REPORT.md` VIIRS/MODIS oranında 2021–2025 için yaklaşık %15 kayma bildiriyor; bunun MODIS yörünge saati, büyük yangınlar, tarımsal yanma değişimi veya birlikte etki olduğu ayrıştırılmamış.

**Düzeltme:** LOYO dışında **zamana ileri test**: 2012–2020 eğit → 2021–2025 test; 2012–2022 eğit → 2023–2025 test. Ayrıca 2021 büyük olaylarını dışarıda bırakıp karşılaştır; Terra/Aqua, gündüz/gece ve ay ayrımını incele. Bu testler tarihsel 2000–2011 genellemesine dair kanıt sağlar ama doğrudan doğrulama yerine geçmez.

### P1-B. MODIS=0, VIIRS>0 yapısal bilgi eksikliği — [KOD]

`make_ratio`, `m_ta`, `m_power_td` MODIS aktivitesi sıfırsa VIIRS'e ait pozitif tespiti konumsal olarak tahmin edemez. Küçük hücrede yalnızca çarpan değiştirmek sorunu çözmez.

**Düzeltme:** Her ölçekte `M=0,V>0` hücre-ay oranını, bu hücrelerin VIIRS toplamındaki payını ve WAPE katkısını ayır. Öğrenilmiş olasılık düzeltmesi yalnız toplu bölgesel sayılar için denenebilir; **sahte hotspot koordinatları üretme.**

### P1-C. Ters piksel alanı yöntemi göz ardı edilmemeli — [KOD + RAPOR]

`analysis/med/prep.py` MODIS `1/(scan*track)` toplamını hesaplıyor; `evaluate.py:invarea_w` eğitim-kalibrasyonlu model. Bölge aylık %15,28 → %14,05; yıllık %6,19 → %4,46 iyileşme raporlanmış. Ancak fiziksel gözlem olasılığı bu basit ters alanla aynı değildir; rho 0,843 → 0,824 düşüyor.

**Deney:** `1/(scan*track)^gamma`; `gamma ∈ {0,0.25,0.5,0.75,1}`; gamma yalnız **iç CV** ile seçilsin. Tüm ölçekler, MED/COAST, il grupları, büyük olaylar, özellikle 2021, zamana ileri test, WAPE/bias/rho değerlendirilsin. Uç ağırlıklar denetlensin. Henüz ölçülmemiş kombinasyon için hata düşüş yüzdesi iddia etme.

### P1-D. İki sensör ve aktivite etkileşimli model denenmedi — [ÖNERİ]

`terra_aqua` ve `power_td` farklı olumlu sonuçlar veriyor. Öncelikli deneyler:
1. Terra ve Aqua için ayrı aylık katsayı + bölge aktivite düzeyi, regularize edilmiş az parametreli model.
2. Ters-piksel-alanı MODIS göstergesi + bölge aktivitesine göre `beta` dönüşümü.
3. Yukarıdakilerin kısmi havuzlama/shrinkage varyantı (küçük il gruplarında aşırı uyumu önlemek için).

Her aday gerçek NASA kayıtlarıyla, **tamamen fold içinde eğitim ve hiperparametre seçimi** ile çalışmalı. Bölgesel toplam alt birimlerin toplamıyla aynı olmalı; il düzeyi başarısızsa yalnız bölge toplamında kullan. Başarı olasılığı var, **garanti yok**.

### P1-E. WAPE'yi düşürmek coğrafi/yıllık anlatıyı bozabilir — [KOD + RAPOR]

`power_td` R ölçeğinde yıllık WAPE %4,06 ama bazı kutularda hata azalmıyor. `m_power_scale` toplamsal değil. `borrow` modeli WAPE düşürse bile yıl sıralamasını bozduğu için reddedilmiş; bu **makul** bir eleştirel karar.

**Düzeltme:** Model seçimi öncesi primer hedefi yaz: ör. gerçek il grupları için yıllık+yangın sezonu WAPE; ikincil aylık WAPE, bias, sıralama rho, aşırı ayların recall/precision'ı, bölgesel toplamsallık ve dönem dayanıklılığı. Pareto tablosu çıkar, hiçbir tek ölçüyü sonradan seçip “kazandık” deme.

### P1-F. Gerçek iller yerine coğrafi kutular — [KOD]

`analysis/med/prep.py`: MED lon 29–37 lat 35.8–38.4; AEG lon 26–29 lat 36.5–39.5. `subregions.py:named()` isimleri illeri *yaklaşık* temsil eden şeritler. **İzmir MED kutusunda değil; COAST da “Ege illeri” demek değil.**

**Düzeltme:** NASA hotspot noktalarını gerçek il poligonlarıyla eşleştir. En az İzmir, Aydın, Muğla, Antalya, Mersin ve Adana için aynı LOYO yap. Komşu 3–4 ilin önceden belirlenmiş gruplarının yıl/sezon/ay WAPE'sini raporla. İdari sınır verisi meteorolojik/yangın doğrulama kaynağı değildir; yalnız coğrafyayı tanımlar.

### P1-G. Büyük 2021 yangınlarında ciddi aşırı tahmin — [RAPOR]

`docs/REPORT.md`: 2021-08 COAST VIIRS 5.486, `reg12` 7.566 (+%38). Bir 0,25° hücrede 359'a karşı 750 örneği. Çok yoğun yangınlarda MODIS/VIIRS ilişkisinin sabit kalmadığını gösteriyor; tek bir düzeltmenin 2021-07'yi eksik tahmin etme riski de raporlanmış.

**Düzeltme:** Aylık toplamdan önce gerçek NASA kayıtlarına dayanan gözlem zamanı, MODIS FRP dağılımı, tarama alanı ve Terra/Aqua payına göre bir “büyük olay koşulu” tanımla. Bunu **hedef VIIRS sayısına bakarak** test yılında seçme. 2021'i dış test yılı yap; 2015/2016/2025 büyük aylarını da kontrol et. Gerekirse olay eşleştirme (gün + mekân toleransı) deneyini sonraya bırak; `analysis/med/cache/det_region_2012_2025` dosyası gün bilgisi içermiyor, ham NASA tarihleri gerekli. FRP'yi ortak fiziksel hedef sayma.

### P1-H. Sabit kaynak tamponunun gerçek yangınları silmesi — [KOD + RİSK]

Tüm VIIRS `type=2` konumlarını ±1 hücre genişletip tüm sensörlerden temizlemek, o konuma yakın gerçek `type=0` tespitlerini de kaldırabilir. Azalan WAPE, bilgi kaybı pahasına olabilir.

**Düzeltme:** Maske parametresi duyarlılık analizi ve kaç VIIRS/MODIS `type=0` noktasının silindiğini raporla. Aynı coğrafi/hedef tanımında karşılaştırma yap.

### P2-A. Coverage ölçüsü koşullu — [KOD]

`analysis/med/evaluate.py:metrics()` içindeki `cov90`, sadece `(Y>0)|(P>0)` örneklerinin ortalaması; hem sıfır olanlar dışlanıyor. Dolayısıyla sonuç “aktif hücre-ay kapsaması”, tüm alan için koşulsuz kapsama değil. Ayrıca yukarıdaki nested LOYO sorunu var.

**Düzeltme:** aktif, gözlenen pozitif, tüm hücre-ay kapsama değerleri + ortalama/genişlik yüzdelikleri; 14 yılın her biri ve her ölçek için ayrı rapor.

### P2-B. Alan örtüsü değişkeninde zaman sapması — [RAPOR + RİSK]

`docs/REPORT.md` §11'de ESA WorldCover 2021 merkez pikseliyle arazi sınıfı atanmış; 2000–2025 için tarihsel olarak sabit varsayılmış ve yalnız indirilen karolarda kapsama var. Bu veriyi ekleyip “yalnız NASA verisi” denecekse metodolojide ESA girdisi ayrı belirtilmeli. Bu sürümde kullanıcı **yalnız gerçek NASA ölçümlerini** önceliyor; yeni deneylerde WorldCover zorunlu olmasın.

### P2-C. Eski mimari araştırmayla çelişiyor — [KOD]

`ARCHITECTURE.md` eski taslakta 8 günlük birim ve `type==0` temizliği öneriyor; `docs/REPORT.md` ay ve sabit-konum maskesi kullanıyor. Yeni uygulama yazılırken eski taslak yanlışlıkla uygulanmamalı. `BACKLOG.md` son kararlarına uy ve dokümanı güncelle.

## 3. İşlem sırası ve somut teslimler

1. **Audit:** Ham dosya varlık/versiyon/SHA256, tarih aralığı, 2012 eksik günleri, preprocessing/maske/outage kontrollerini kaydet; hedef tanımını sabitle.
2. **P0 düzeltmeleri:** Fold-başına maske ve nested interval kalibrasyonu; mevcut `reg12` skorlarını önce/sonra karşılaştır. Başarı değil, dürüst fark raporla.
3. **Gerçek coğrafya:** İl/il grubu poligonlarıyla `reg12`, `terra_aqua`, `invarea_w`, `power_td` değerlendirmesi.
4. **Yeni modeller:** Alan üssü gamma, Terra/Aqua+aktivite, invarea+aktivite (düzenlileştirilmiş ve nested CV).
5. **Robustluk:** 2012-2020→2021-2025 zaman blokları, 2021 yangın ayları, 2012 hariç, Terra-tek dönemi, MED/COAST, il grupları.
6. **Rapor:** Yıl ve coğrafya bazında hatalar, bias, yıllık/aylık sıralama, aşırı olay recall, interval coverage+width, additive tutarlılık, çalışma maliyeti. Yeni modeller eski baseline'ı geçmezse **baseline ile devam et**.

**Önerilen çıktı adları:** `analysis/experiments/review_2026_11_14/*.csv`, `analysis/experiments/review_2026_11_14/README.md`, `docs/CLAUDE_RESPONSE_TO_REVIEW.md`.

## 4. Claude'un yanıtlaması gereken net sorular

1. `evaluate.py:intervals` gerçekten her test yılı için nested LOYO mu? Değilse aralıkları niçin geçerli kabul ettin?
2. `static_mask_keys(d)` held-out yılın VIIRS etiketlerini neden görebiliyor? Fold-specific maskeyle skor farkı ne?
3. 2012 Ocak'ı dahil etmenin ve çıkarmanın ay bazında etkisi ne?
4. `invarea_w` aylık ve yıllık WAPE'yi belirgin iyileştirirken neden ürün adayı olarak öne çıkmadı? Hangi başka metrikte kaybediyor?
5. `power_td` yıllık toplamı iyileştirirken hangi il gruplarını bozuyor?
6. Büyük 2021 yangın aylarında her modelin tahmini nedir? İyileşme tek aya özgü mü?
7. WAPE'yi düşürürken 2012 öncesi eğilimi/2021 sırasını kaybetmediğini nasıl doğrulayacağız?
8. MODIS=0 ve VIIRS>0 alt bölge-aylarının toplam hata bütçesindeki payı nedir?
9. `outages()` yanlış kesinti günleri seçmiş olabilir mi; kısmi gözlem kaybı ne kadar?
10. NASA'nın ham veri dosyaları/ürün sürümleri ve deney sonuçlarını nasıl yeniden üretebileceğiz?

## 5. Son yargı

Claude'un bulgularını toptan reddetmiyorum: tek katsayı yerine mevsimsel dönüşüm, Terra/Aqua ayrımı, maskenin gerekliliğini sorgulama, küçük alan başarısızlığını raporlama ve yıl-sırası bozulduğu için bazı modelleri reddetme yerinde. Ancak **aralık kalibrasyonu, yılın hedef verisiyle öğrenilmiş preprocessing, temporal drift ve gerçek il poligonları** netleşmeden hata yüzdesini bilimsel kesinlik gibi sunmak yanlış olur.

**Hata daha düşebilir mi?** Evet, gerçek veride `invarea_w`, `power_td` ve `terra_aqua` farklı metriklerde kazanç göstermiş. Kombinasyonlar, kapsama düzeltmesi ve il-özel yöntemler test edilmeye değer. Ama “%X'e kesin iner” diye veri olmadan sayı vermek doğru değil. İyileşme test fold'u dışındaki yıllarda, farklı coğrafyalarda, bias/rho ve aşırı olaylarda korunursa kabul edilmeli.
