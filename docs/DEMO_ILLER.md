# Demoda gösterilecek iller

Kaynak: `frontend/harmonized-data.js` (`scripts/build_harmonized.py` çıktısı). Hata = bir yıl dışarıda bırakılarak ölçülen WAPE. Değişim = 2003–2007 yıllık ortalamasından 2021–2025 yıllık ortalamasına, uyumlaştırılmış seri, tüm arazi türleri. "Basamak" = 2012–2014 ortalaması / 2009–2011 ortalaması.

## Önerilen sıra

| Sıra | İl | Güven | Yıllık / aylık hata | Ne gösterir |
|---|---|---|---|---|
| 1 | **Adana** | Yüksek | %12 / %18 | Ham seri 2012'de 2,6 kat artış gösteriyor; uyumlaştırılmış seri azalış (0,72). 20 yılda −%79. En yüksek yıllar 2003, 2005, 2004. |
| 2 | **Şanlıurfa** | Yüksek | %13 / %21 | Karşıtlık: aynı dönemde +%168. En yüksek yıllar 2015, 2020, 2024. Tepe ay Haziran (Adana'da Eylül). |
| 3 | **Antalya** | Orta | %21 / %41 | 2021: 3.874 tespit, 25 yılın en yükseği. Bu değer doğrudan VIIRS gözlemi, tahmin değil. Yalnızca yıllık görünümde gösterilmeli. |

Anlatı: "Ham veri Adana'da yanmanın arttığını söylüyor; gerçekte beşte birine inmiş. Şanlıurfa'da ise neredeyse üçe katlanmış. Antalya'da tek bir yıl, 2021, her şeyin üstünde."

## Yedekler (hepsi yüksek güven)

| İl | Yıllık / aylık hata | Not |
|---|---|---|
| Mersin | %11 / %22 | −%62; Adana ile aynı yön |
| Mardin | %12 / %22 | +%107; Şanlıurfa ile aynı yön |
| Kahramanmaraş | %9 / %24 | En düşük yıllık hata |
| Diyarbakır | %14 / %20 | Değişim yok (−%2); 2009 tek başına çok yüksek |

## Gösterilmemesi gerekenler

- **Düşük güvenli 34 il** (Karadeniz, Doğu Anadolu, İstanbul, Eskişehir, Isparta, Burdur, Uşak, Kütahya …): tespit çok az. Karabük, Rize, Artvin, Tunceli, İstanbul ve Ordu'da uyumlaştırılmış seri yalnızca MODIS'le tutmuyor.
- **İzmir** (orta, %27 / %46): hata yüksek; ayrıca MODIS/VIIRS sekmeleri `type == 0` filtresiyle sanayi tespitlerini içeriyor (aşağıda), sekmeler arası sayılar tutmaz.
- **Konya ve Kırşehir:** güven yüksek ama 2009–2011 medyanın 7–13 katı. Gerçek görünüyor (Ağustos–Ekim, gündüz) ama nedenini açıklayamıyoruz; soru davet eder.
- **Antalya'nın aylık görünümü:** aylık hata %41.

## Söylenebilecekler ve söylenemeyecekler

- Söylenebilir: "uydu tespitleri azaldı / arttı", "ham seri yönü bile yanlış gösteriyor".
- Söylenemez: düşüşün ya da artışın nedeni (denetim, ürün deseni, sulama); tespitlerin anız yakma olduğu. Adana'daki düşüş tarım arazisi tespitleriyle ayrıca doğrulandı (`docs/REPORT.md` 12. bölüm); Şanlıurfa'daki artış il düzeyinde ve tüm arazi türleri için, tarım arazisi ayrımıyla sınanmadı (Güneydoğu kutusunda tarım arazisi serisi 2003–2010'dan 2018–2025'e +%18).
- Ülke geneli: 2009–2011'den 2012–2014'e ham seri +%66, uyumlaştırılmış seri −%57 (yalnızca MODIS −%52). 2009–2011 olağandışı yüksek yıllar.

## Arayüze bağlama

```html
<script src="harmonized-data.js"></script>
```
```js
const months = harmonized.series[name]?.[year];   // 12 değer; 2000 Oca–Eki null
const info = harmonized.provinces[name];          // confidence, annual_wape, monthly_wape, median, p25, p75, region
```
İl adları `atlas.series.VIIRS` ile aynı (81/81). Bölge verisi `harmonized.regions[info.region]`. İndirme: `harmonized.csv`.

## Filtre uyarısı

Birleşmiş seri sabit kaynakları konum maskesiyle ayıklıyor; MODIS ve VIIRS sekmeleri `type == 0` kullanıyor. İzmir 2025: maskeyle 1.453, `type == 0` ile 1.910. İzmir çevresinde maskenin attığı `type 0` tespitlerinin %95'i gece ve aynı hücrelerde tekrarlıyor (sanayi tesisi). Ülke genelinde maske `type 0` tespitlerinin %3,2'sini atıyor. Üç sekmenin de aynı maskeyi kullanması önerilir.

Yeniden üretim: `analysis\agri\.venv\Scripts\python.exe scripts/build_harmonized.py --force` (~60 sn; il sınırlarını yoksa kendisi indirir).
