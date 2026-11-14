# `CHATGPT_TECHNICAL_REVIEW.md` için teknik yanıt

14 Kasım 2026 akşamı. Tüm sayılar gerçek FIRMS arşiv dosyalarından (`data/raw`, 40 CSV), sentetik veri yok.
Kod ve çıktılar: `analysis/experiments/review_2026_11_14/`. Mevcut `analysis/med/` sonuçlarının üzerine yazılmadı.

```
.venv\Scripts\python.exe analysis\experiments\review_2026_11_14\run_boxes.py   # pareto, forward, events, zero_modis, sens2012, intervals
.venv\Scripts\python.exe analysis\experiments\review_2026_11_14\run_mask.py    # mask_*, outage_*
```

Sağlama: yeni kod eski sonucu birebir üretiyor (MED, `reg12`, bölge aylık WAPE %15,3; yıllık %6,2).
Aksi yazılmadıkça sayılar MED kutusu, bir yıl dışarıda (2012–2025), WAPE. "5 grup" = `subregions.py`'deki il benzeri 5 kutu; gerçek il poligonu değil.

**Süre nedeniyle yapılmayanlar en altta.** Yapılmayan hiçbir şey için sayı verilmiyor.

## Özet

| Madde | Karar | Ölçülen |
|---|---|---|
| P0-A aralıklar nested değil | Kısmen | Nested ile fark yok denecek kadar küçük |
| P0-B maske test yılını görüyor | Kısmen | Fold'a özel maske ile skor değişmiyor |
| P0-C kesinti günleri | Katılıyorum | Günleri çıkarmak hatayı az düşürüyor; kısmi kesinti ölçülmedi |
| P0-D Ocak 2012 | Katılmıyorum (etki yok) | Çıkarınca aylık %15,3 → %15,3 |
| P1-A zamana ileri test | **Katılıyorum, en önemli bulgu** | İleri testte hata LOYO'nun ~1,5 katı |
| P1-B MODIS=0, VIIRS>0 | Kısmen | Ürün ölçeğinde hatanın %1'i; 0,25°'de %26'sı |
| P1-C ters piksel alanı | Katılıyorum | Bölge toplamında ve ileri testte kazanç gerçek |
| P1-D birleşik modeller | Kısmen | Denendi; tek başına modelleri anlamlı geçmiyor |
| P1-E tek ölçüyle seçim | Katılıyorum | Pareto tablosu aşağıda |
| P1-F gerçek iller | Katılıyorum | **Yapılmadı** (poligonlar indirildi) |
| P1-G 2021 aşırı tahmin | Katılıyorum | Hiçbir model iki ayı birden düzeltmiyor |
| P1-H tampon gerçek yangın siliyor | Kısmen | `type 0` kaybı %1,5–3,2; tamponsuz skor aynı |
| P2-A kapsama koşullu | Katılıyorum | Koşulsuz kapsama küçük hücrede çöküyor |
| P2-B WorldCover | Katılıyorum | Uyumlaştırmada kullanılmıyor |
| P2-C eski mimari | Katılıyorum | `ARCHITECTURE.md` yeniden yazılacak |

## P0-A. Aralıklar — kısmen

Tespit doğru: `evaluate.py:intervals` y yılının aralığını, y'yi eğitimde görmüş modellerin artıklarıyla kuruyor. Bu, CV+/cross-conformal kurgusudur; docstring de böyle adlandırıyor. Sızıntı ikinci derecedendir: y'nin hedefi kendi aralığına doğrudan girmiyor.

Gerçek nested (her dış yıl için 13 yılda iç LOYO) ile karşılaştırma, `intervals.csv`:

| Ölçek | Zaman | Kapsama, mevcut | Kapsama, nested | Göreli genişlik (mevcut / nested) |
|---|---|---|---|---|
| Bölge | ay | 0,851 | 0,875 | 0,66 / 0,66 |
| Bölge | yıl | 0,786 | 0,786 | 0,21 / 0,21 |
| 5 grup | ay | 0,894 | 0,897 | 1,18 / 1,19 |
| 5 grup | yıl | 0,843 | 0,843 | 0,67 / 0,67 |
| 1° | ay | 0,911 | 0,912 | 1,46 / 1,46 |
| 1° | yıl | 0,852 | 0,852 | 0,90 / 0,90 |

Sonuç: nested'e geçmek sonucu değiştirmiyor. Asıl sorunlar başka ve ikisinde de haklısın:
- 14 yıl var; bölge-yıl düzeyinde kapsama 14 değerden 11'i. Nominal %90 garanti iddia edilmeyecek.
- Yıl başına kapsama oynak (5 grup yıllık: en kötü yıl 0,60).

## P0-B. Maske test yılının etiketini görüyor — kısmen

Tespit doğru: `static_mask_keys` 2012–2025'in tamamını kullanıyor ve LOYO'dan önce uygulanıyor. Ama maske bir veri temizleme politikası (hedef tanımı), sayım bilgisi taşımıyor; bu ayrımı sen de yazmışsın.

Fold'a özel maske (test yılının `type 2` etiketleri görülmeden kurulmuş; hem eğitim hem hedef o maskeyle), `mask_variants.csv`:

| Politika | Bölge ay | Bölge yıl | 5 grup yıl | 1° yıl |
|---|---|---|---|---|
| Tüm dönem maskesi (mevcut) | %15,3 | %6,2 | %15,4 | %23,0 |
| Fold'a özel maske | %15,3 | %6,2 | %15,4 | %23,0 |
| ≥5 gün `type 2` şartı | %15,3 | %6,2 | %15,4 | %23,0 |
| Tampon 0 | %15,3 | %6,0 | %15,4 | %22,9 |
| Yalnızca `type 2` satırlarını at | %16,7 | %8,5 | %16,6 | %23,6 |
| Maske yok | %22,6 | %11,3 | %31,8 | %42,7 |

Fold'a özel maske, tam maskenin %96–100'ü kadar hücre içeriyor (`mask_fold_sizes.csv`). Skor farkı yok; sızıntı pratikte etkisiz.

## P1-H. Tampon gerçek yangınları siliyor mu — kısmen

Tüm Türkiye, `mask_removed.csv`. Maske 1.298 hücre (tamponsuz 290). Rapordaki "8.875 hücre" sayısını yeniden üretemedim; raporun o sayısı yanlış görünüyor, düzeltilmeli.

| Sensör, dönem | `type 0` tespit | Maskenin sildiği | Pay |
|---|---|---|---|
| VIIRS 2012–2025 | 445.576 | 14.374 | %3,2 |
| MODIS 2012–2025 | 131.922 | 2.765 | %2,1 |
| MODIS 2000–2011 | 112.171 | 1.672 | %1,5 |

Kayıp var ama küçük. Tamponun kendisi doğruluğa bir şey katmıyor (tampon 0 ile skor aynı); gerekçesi MODIS'in ~1 km konum belirsizliği. Geriye dönük silme riski gerçek: 2000–2011'de silinen 1.672 MODIS tespitinin kaçının sonradan kurulmuş tesis çevresindeki gerçek yangın olduğu ölçülmedi.

## P0-C. Kesinti günleri — katılıyorum

`outage_days.csv`, `outage_runs.csv`. `outages()` yalnızca ülke genelinde sıfır tespit olan günleri yakalıyor; kısmi tarama kaybını göremez, bu doğru.

- Bulunan uzun kesintiler bilinen olaylarla örtüşüyor: Aqua 2012-12-04 (22 gün), 2022-03-31 (19); Terra 2022-10-11 (13), 2024-01-11 (13); S-NPP 2022-07-27 (15).
- Zayıf nokta: tek günlük "kesinti" çok (Aqua 70, Terra 67). Bunların bir kısmı gerçek kesinti değil, yanlış alarm olabilir; doğrulanmadı.
- Çıkarılan günlerin tespit payı 2012–2021'de %0–7, 2022–2025'te %7–14.
- Günleri hiç çıkarmamak: bölge aylık %15,3 → %16,2; yıllık %6,2 → %6,8. Etki küçük.

Ürün için sonuç: gösterilen sayı "tüm ayın sayısı" değil, "ortak geçerli günlerin sayısı". Bu ya gün sayısıyla ölçeklenmeli ya da arayüzde açıkça yazılmalı. Gün ölçeklemesi ve NASA geçiş metaverisiyle karşılaştırma **yapılmadı**.

## P0-D. Ocak 2012 — etki yok

Veri zaten yalnızca ortak geçerli günleri içeriyor; Ocak 2012'de bu 20–31 Ocak. `sens2012.csv`:

| Değişken | Bölge ay | Bölge yıl | Ocak ayları |
|---|---|---|---|
| Mevcut | %15,3 | %6,2 | %24,4 |
| Ocak 2012 çıkarılmış | %15,3 | %6,2 | %23,8 |
| Tüm 2012 çıkarılmış | %15,1 | %6,1 | %23,8 |

2012 yılı yanlılığı +%9,6 (Ocak çıkarılınca +%9,7); sorun Ocak'tan gelmiyor.
Terra-tek dönem: raporda var (2003–2020'de Aqua atılarak benzetim; MED yıllık %12,9, aylık %23,7). Temmuz 2002'nin gün düzeyinde bölünmesi **kontrol edilmedi**.

## P1-A. Zamana ileri test — katılıyorum, en önemli bulgu

`forward.csv`, `forward_years.csv`. `reg12`:

| Test | Bölge ay | Bölge yıl | 5 grup ay | 5 grup yıl |
|---|---|---|---|---|
| LOYO (raporlanan) | %15,3 | %6,2 | %27,1 | %15,4 |
| 2012–2020 → 2021–2025 | %24,1 | %9,3 | %35,5 | %25,4 |
| 2012–2022 → 2023–2025 | %23,4 | %8,5 | %35,1 | %24,7 |
| 2016–2025 → 2012–2015 (geriye) | %14,4 | %7,1 | %28,2 | %14,0 |
| 2017–2020 → 2012–2016 (geriye) | %12,6 | %4,8 | %24,4 | %10,8 |

- İleri yönde hata LOYO'nun yaklaşık 1,5 katı. LOYO sayıları 2021 sonrası için iyimser.
- Yıl yanlılığı (2012–2020 eğitim): 2021 +%16, 2022 +%2, 2023 −%8, 2024 −%10, 2025 −%3.
- Geriye doğru test LOYO ile aynı düzeyde. Ürünün yaptığı iş de geriye doğru tahmin (2000–2011), ve o dönemde MODIS yörüngeleri kararlıydı. Bu, geriye tahmin için olumlu ama dolaylı kanıt; 2000–2011 doğrudan doğrulanmadı.
- Kaymanın nedeni (yörünge saati mi, büyük yangınlar mı) hâlâ ayrıştırılmadı.

## P1-C, P1-D, P1-E. Model seçimi — katılıyorum

`invarea_w`'nin öne çıkmamasının iyi bir gerekçesi yoktu; bölge çalışmasında incelenmeden geçilmiş. `pareto.csv`:

| Model | Bölge ay | Bölge yıl | 5 grup ay | 5 grup yıl | 1° yıl | ρ (5 grup, yıl) |
|---|---|---|---|---|---|---|
| `reg12` | %15,3 | %6,2 | %27,1 | %15,4 | %23,0 | 0,914 |
| `terra_aqua` | %14,7 | %5,7 | %26,8 | %15,2 | %22,7 | 0,912 |
| `invarea_w` (γ=1) | %14,1 | %4,5 | %27,0 | %13,9 | %22,7 | 0,914 |
| γ=0,5 | %14,0 | %5,0 | %26,6 | %14,4 | %22,6 | 0,918 |
| γ iç CV ile | %14,2 | %4,7 | %26,9 | %14,2 | %22,6 | 0,914 |
| `power_td` | %14,7 | %4,1 | %26,5 | %13,5 | %21,2 | 0,896 |
| `terra_aqua` + etkinlik | %14,3 | %4,5 | %26,0 | %15,1 | %22,5 | 0,907 |
| `invarea` + etkinlik | %13,8 | %3,9 | %26,5 | %13,7 | %22,7 | 0,908 |

- Kazanç bölge toplamında belirgin (yıllık %6,2 → %4–5), ürün ölçeğinde (5 grup, 1°) küçük: 0,5–2 puan.
- İç CV γ'yı 14 fold'un 13'ünde 0,5–0,75 seçiyor (`gamma_choice.csv`).
- İleri testte alan ağırlığı daha dayanıklı: 2012–2020 → 2021–2025, bölge ay %24,1 → %21,0, 5 grup yıl %25,4 → %21,4.
- Sıra korelasyonu modeller arasında fark etmiyor (0,90–0,92). Soru 4'ün yanıtı: `invarea_w` başka bir ölçüde kaybetmiyor; yalnızca 2021-07'yi eksik tahmin ediyor (aşağıda).
- Soru 5: `power_td` hiçbir ölçekte toplam hatayı bozmuyor; grup bazında kırılım **çıkarılmadı**.
- Birleşik modeller tek başına `invarea_w` ya da `power_td`'yi anlamlı geçmiyor.

Karar önerisi: birincil hedef 5 grup (gerçek il gruplarıyla yeniden ölçülecek) yıllık + sezon WAPE; ikincil aylık WAPE, yanlılık, ρ, ileri test. Bu ölçülerde `invarea_w` (γ 0,5–1) `reg12`'den kötü değil, çoğunda biraz iyi. Ürün adayı olarak `reg12` yerine alınabilir; fark küçük olduğu için süre yetmezse `reg12` ile devam etmek de savunulabilir.

## P1-G. Büyük 2021 ayları — katılıyorum

Dışarıda bırakılmış tahminin gözleme göre sapması, `events.csv`:

| Ay | VIIRS | `reg12` | `terra_aqua` | `invarea_w` | `power_td` | `inv`+etkinlik |
|---|---|---|---|---|---|---|
| COAST 2021-08 | 5.486 | +%38 | +%36 | +%25 | +%21 | +%20 |
| COAST 2021-07 | 4.469 | +%7 | +%8 | −%16 | −%17 | −%18 |
| COAST 2015-09 | 5.966 | +%1 | +%2 | +%3 | −%13 | −%1 |
| COAST 2013-09 | 3.340 | +%21 | +%20 | +%16 | +%14 | +%13 |

Soru 6'nın yanıtı: iyileşme tek aya özgü. Ağustos 2021'i düzelten her model Temmuz 2021'i bozuyor. Olay eşleştirme ve "büyük olay koşulu" **denenmedi**.

## P1-B. MODIS = 0, VIIRS > 0 — kısmen

`zero_modis.csv`:

| Ölçek | Bu hücre-ayların payı | VIIRS toplamındaki payı | Hatadaki payı |
|---|---|---|---|
| 5 grup | %7,5 | %0,3 | %0,9 |
| 1° | %29 | %3,7 | %9,9 |
| 0,5° | %45 | %8,6 | %18 |
| 0,25° | %53 | %15 | %26 |

Ürün ölçeğinde (il grupları) bu sorun yok sayılabilir. Küçük hücrede gerçek; orada çarpanla çözülmez, bu yüzden küçük hücre ürünün ana görünümü değil. Sahte koordinat üretilmiyor.

## P2-A. Kapsama koşullu — katılıyorum

`cov90` yalnızca etkin hücre-ayları sayıyor. Tüm hücre-aylarda kapsama: 5 grup ay 0,86; 1° ay 0,71; 0,25° ay 0,24. Neden: aralıklar etkin hücrelerde kalibre edildiği için, tahmini sıfır olan hücreye sıfırı dışlayan bir alt sınır veriyor. Küçük hücrede aralıklar bu haliyle kullanılamaz; sıfır tahminli hücreler ayrı ele alınmalı. Ürün ölçeğinde hemen her hücre-ay etkin olduğundan fark küçük.

## P1-F. Gerçek iller — katılıyorum, yapılmadı

İtiraz yok: tüm sayılar kutularla. geoBoundaries TUR ADM1 (81 il, OSM kaynaklı, CC BY-SA 2.0) `data/raw/boundaries/` altına indirildi ve `shapely` kuruldu; eşleştirme ve il grubu LOYO'su koşulmadı. Bu, inşadan önceki ilk iş.

## Net sorulara kısa yanıtlar

1. Hayır, nested değil; CV+ türü. Nested ile fark yok (P0-A).
2. Maske tüm dönemden kuruluyor; fold'a özel maskeyle skor farkı sıfır (P0-B).
3. Etkisi yok (P0-D).
4. Geçerli bir gerekçe yoktu; aday olarak alınmalı (P1-C).
5. Toplamda bozmuyor; grup kırılımı çıkarılmadı.
6. Tablo P1-G'de; iyileşme tek aya özgü.
7. Sıra korelasyonu tabloda (modeller arası fark yok). 2012 öncesi eğilim için elimizde yalnızca geriye doğru test var; doğrudan doğrulama mümkün değil.
8. Tablo P1-B'de.
9. Uzun kesintiler doğru; tek günlükler şüpheli; kısmi kayıp ölçülmedi (P0-C).
10. `python scripts/fetch_firms.py` + yukarıdaki iki komut. Ürün sürümleri: MODIS C6.03 / 6.2 / 61.03, VIIRS v2. Dosya SHA256 kaydı **çıkarılmadı**.

## Yapılmayanlar

- Gerçek il poligonlarıyla il ve il grubu doğrulaması (P1-F).
- Kısmi kesinti, gün ölçeklemesi, NASA geçiş metaverisi (P0-C).
- Büyük olay koşulu ve olay eşleştirme (P1-G).
- Temmuz 2002'nin gün düzeyinde bölünmesi; Terra-tek dönemin ayrı geriye testi (P0-D).
- Kaymanın nedeninin ayrıştırılması; 2021 olayları çıkarılmış ileri test (P1-A).
- `power_td` için grup kırılımı; shrinkage'lı varyantlar (P1-D).
- Ham dosya SHA256 denetimi.

## Raporda değişmesi gerekenler

- LOYO hatalarının yanına ileri test hataları yazılmalı; "ölçeğe göre hata" tek sayı olarak sunulmamalı.
- Maske hücre sayısı 8.875 değil 1.298.
- "%90 aralık" yerine "yaklaşık %80–90 kapsayan aralık, 14 yıla dayanıyor".
- Sayılar "ortak geçerli günlerin" sayısıdır.
