# Yedi coğrafi bölgenin uyumlaştırma doğrulaması

15 Kasım 2026. Birimler il gruplarıdır; iller coğrafi sınırda bölünmez.

| Bölge | Yıllık WAPE | Aylık WAPE |
|---|---:|---:|
| Marmara | %10,0 | %22,1 |
| Ege | %9,9 | %24,1 |
| Akdeniz | %7,0 | %14,5 |
| İç Anadolu | %14,5 | %21,2 |
| Karadeniz | %13,5 | %28,3 |
| Doğu Anadolu | %8,6 | %18,9 |
| Güneydoğu Anadolu | %8,6 | %15,1 |

## Hesaplama

`scripts/validate_geographic_regions.py`, mevcut `data/processed/harmonized_daily_2026.npz`
önbelleğinden il × gün × uydu sayılarını okur. İndirme yapmaz, yayınlanan seriyi değiştirmez.

- Dönem 2012–2025, 14 yıl. Yalnızca Terra, Aqua ve S-NPP'nin üçünün de çalıştığı günler alınır.
- Her yıl sırayla dışarıda bırakılır. Mevcut yöntemdeki 26 İBBS-2 bölgesinin aylık katsayıları
  diğer 13 yıldan hesaplanır. Eğitimde ilgili ayda MODIS sayısı 50'den azsa ulusal katsayı kullanılır.
- Dışarıdaki yıl için il tahmini = ham MODIS × ilin İBBS-2 katsayısı. Önce illerin tahminleri ve
  VIIRS gözlemleri yedi il grubu içinde toplanır, sonra hata hesaplanır. İl hata yüzdeleri ortalanmaz.
- Yıllık WAPE = yıllık toplam tahmin–gözlem mutlak farklarının toplamı / toplam gözlem.
- Aylık WAPE = aylık tahmin–gözlem mutlak farklarının toplamı / toplam gözlem.
- 81 ilin yeniden hesaplanan yıllık ve aylık hataları, `atlas.json` içindeki mevcut değerlerle
  yuvarlama toleransı içinde eşleşmek zorundadır. Bu kontrol geçti.

Güven sınıfları mevcut ürünle aynıdır: yıllık hata en fazla %15 ve yıllık ortalama en az 300
tespitse yüksek; yıllık hata %30 üstüyse veya ortalama 100 altındaysa düşük; diğerleri orta.
Yedi grupta da yıllık güven yüksek çıktı. Bu, aylık hatanın aynı düzeyde olduğu anlamına gelmez;
arayüz iki hata değerini ayrı gösterir.

## Sınırlar

Bu ölçü uyumlaştırılmış uydu tespit sayısının VIIRS ile uyuşmasını değerlendirir. Gerçek yangın
sayısı, yanan alan veya alan tahmininin hatası değildir. 2012 öncesi için doğrudan gözlemsel
doğrulama sağlamaz; 2026 NRT verisi değerlendirmeye alınmaz. İşletim serisindeki kesinti dolgularının
ayrı doğrulaması değildir; yalnızca ortak gözlem günleri ölçülür.

Sabit kaynak maskesi ve kesinti tanımı mevcut yöntemden aynen alınır; sabit kaynak maskesi
2012–2025 arşivinin tamamından üretilmiştir. Bu nedenle ölçüm, bütün ön işleme adımlarının da
her fold içinde yeniden öğrenildiği tamamen bağımsız bir gelecek testi olarak sunulmaz.

## Yeniden üretme

```powershell
.venv/Scripts/python.exe scripts/validate_geographic_regions.py
python scripts/build_geographic_regions.py
.venv/Scripts/python.exe -m unittest discover -s tests -p "test_geographic*.py"
```

Tam hassasiyetli çıktı `web/data/geographic-validation.json` içindedir. İl doğrulaması veya
üyelik listesi değişirse imza kontrolü eski sonucu kullanmayı reddeder; hesaplama yenilenmelidir.
