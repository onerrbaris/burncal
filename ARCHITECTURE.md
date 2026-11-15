# ARCHITECTURE

BurnCal — NASA Space Apps 2026, challenge *Harmonization of MODIS and VIIRS Hot Spots*.
Ekip içi bitiş **15 Kasım 15:00**; resmî kapanış 23:59. Yöntem bulguları `docs/REPORT.md`; bu belgeyle çelişirse rapor geçerlidir.

## Hedef

Yerel etkinlikte bu challenge'ı yapan az sayıdaki takım arasından sıyrılmak. Jüri konunun uzmanı değil: çalışan, anlaşılır, Türkiye'ye dokunan bir ürün ve net bir hikâye, yöntem derinliğinden daha çok puan getirir. Yöntem çalışması hikâyenin dayanağıdır, kendisi değildir. **Yeni yöntem araştırması yapılmayacak.**

## Ürün, tek cümle

Bölgeni seç → 2000'den bugüne tek ölçekte aylık yanma takvimi, bu ayın 25 yıla göre yeri ve kritik aylar.

## Demo hikâyesi (60 saniye)

1. Türkiye haritası, elle doğrulanmış 4 vitrin bölgesi. Demoyu biz süreriz; jüriye bölge seçtirilmez. Antalya bölgesiyle başlanır.
2. **Ham veri:** 2012'de yanma 3–4 katına çıkmış görünür. Bu yangın değil, uydu değişimi.
3. **Uyumlaştır düğmesi:** basamak kaybolur. Antalya bölgesinde 2021 tek başına öne çıkar.
4. "Bu ay nerede?" kartı: son ay, tarihsel medyana göre yüzdelik ve düz bir cümle.
5. Adana–Mersin'e geç: bambaşka bir takvim, Ağustos–Eylül. **Uydunun gördüğü ateşin yaklaşık %70'i orman değil tarla.**
6. Kapanış: S-NPP 2 Kasım 2026'da bitti, MODIS 2027'de kapanıyor. 25 yıllık kayıt ancak köprülenirse yaşar.

## Kapsam kararları

- **Alan birimi: İBBS-2 (NUTS-2) bölgeleri**, 26 adet, çoğu 3–4 il (TR61 Antalya–Isparta–Burdur, TR62 Adana–Mersin, TR63 Hatay–Kahramanmaraş–Osmaniye, TR32 Aydın–Denizli–Muğla …). Resmî, savunulabilir, "3–4 il" kararını karşılıyor. Tek illik bölgeler (İstanbul, Ankara, İzmir) olduğu gibi kalır.
- **Yayında yalnızca 4 vitrin bölgesi:** TR61 Antalya–Isparta–Burdur, TR62 Adana–Mersin, TR63 Hatay–Kahramanmaraş–Osmaniye, TR32 Aydın–Denizli–Muğla. Hepsi hatanın ölçüldüğü ve arazi örtüsü karolarının indiği alanda. Betik 26 bölgeyi de üretebilir; hangilerinin yayınlanacağı tek bir listeyle belirlenir (`SHOWCASE`). Listeye bölge eklemek, o bölgenin takvimine elle bakıldıktan sonra olur.
- **Zaman birimi ay.** Ölçü: VIIRS-eşdeğeri hotspot sayısı.
- **Çarpan bölgeye özel** (12 aylık çarpan, bölgenin kendi örtüşme verisinden). Veri az olan bölgede komşularla birleşik çarpan; hangisinin kullanıldığı çıktıda yazar.
- **Sunucu yok.** Her şey önceden hesaplanıp statik JSON olarak yayınlanır. Çizilen serbest alan yok (challenge'da isteğe bağlı; küçük alanda sonuç güvenilmez).
- **Güven rozeti:** her bölge için dışarıda bırakılmış yıl hatası üç düzeye indirgenir (yüksek / orta / düşük). Sayı ayrıntı panelinde.
- **2026:** FIRMS anahtarı gelirse Ocak–Ekim 2026 S-NPP'den eklenir. Gelmezse veri Aralık 2025'te biter ve "bu ay" kartı son tam ayı gösterir.

## Yöntem (ürün sürümü, v1)

1. `type` 1 ve 3 atılır. Sabit kaynak maskesi: VIIRS `type` 2 görülen 0,01° hücreler (1.298 hücre). MODIS `type` etiketine göre filtre yok.
2. Bilinen kesinti günleri iki sensörden de çıkarılır.
3. Bölge × ay sayımı. 2012-02'den itibaren VIIRS gözlemi olduğu gibi.
4. Öncesi: MODIS × bölgenin o aya ait çarpanı. Temmuz 2002 öncesi: önce Terra → Terra+Aqua düzeltmesi.
5. Bir yıl dışarıda bırakarak hata (WAPE, yıllık ve aylık) → güven rozeti ve aralık.

`analysis/experiments/review_2026_11_14/` içindeki alternatif modeller ürüne alınmaz; çıktı biçimi aynı kaldığı sürece sonradan değiştirilebilir.

## Bileşenler

```
data/raw/*.csv ─► scripts/build_site_data.py ─► frontend/public/data/index.json
geoBoundaries ADM1 ─┘                       ├─► frontend/public/data/regions.geojson
                                             ├─► frontend/public/data/region/{id}.json
                                             └─► frontend/public/data/csv/{id}.csv
frontend (React + Vite + TS, MapLibre, SVG) ─► statik yayın (Vercel ya da GitHub Pages)
```

Yığın: Python 3.12 (pandas, shapely), Node (Vite, React, TS, MapLibre GL). Veritabanı ve arka uç yok.

## Sözleşme (statik dosyalar)

### Atlas (`web/`): yedi coğrafi bölge görünümü

`scripts/build_atlas_json.py`, il verilerinin yanında `web/data/geographic-regions.json` üretir.
`scripts/build_geographic_regions.py` tek başına da çalıştırılabilir. Yedi bölgenin her biri
`members` (il adları), `series` (merged/modis/viirs → yıl → 12 ay) ve `validation: null` taşır;
`partial` aynı üyelerin süren ay kıyaslarının toplamıdır. Eksik aylar sıfır yapılmaz.
İller bütün olarak gruplanır: bu, coğrafi sınırların il bazında yaklaşımıdır; İBBS-2 katsayı
bölgeleriyle karıştırılmaz. İl uyumlaştırılmış serileri toplanır; yeni katsayı veya hata yüzdesi
türetilmez. Bölge doğrulaması tamamlanana kadar arayüz "Ölçülmedi" gösterir.
Harita alan birimi bağımsızdır; üç sensör sekmesinde de il/bölge seçilebilir.
Yıl/ay aralığı ve ay ayrıntısı sağ grafik panelinde, sekmelerin üstündedir.

Alan adları ön yüz işi başladıktan sonra dondurulur; değişiklik `BACKLOG.md` → Decisions'a yazılır. Örnek dosyalar `shared/mock/` altında.

`index.json`
```jsonc
{ "generated_at": "ISO", "data_range": ["2000-11", "2025-12"], "method_version": "v1",
  "unit": "VIIRS-eşdeğeri hotspot",
  "regions": [ { "id": "TR61", "name": "Antalya, Isparta, Burdur", "provinces": ["Antalya","Isparta","Burdur"],
                 "confidence": "high",              // "high" | "medium" | "low"
                 "latest": { "month": "2025-12", "value": 41, "median": 30, "percentile": 68, "level": "normal" } } ] }
```
`level`: `"low" | "normal" | "high" | "extreme"` (aynı ayın diğer yıllardaki dağılımına göre yüzdelik: <25, 25–75, 75–95, >95).

`region/{id}.json`
```jsonc
{ "id": "TR61", "name": "...", "provinces": [], "area_km2": 0,
  "monthly": [ { "ym": "2021-08", "value": 0, "lo": 0, "hi": 0,
                 "raw_modis": 0, "raw_viirs": 0,        // sensör yoksa null
                 "source": "viirs",                     // "modis_scaled" | "viirs"
                 "percentile": 99, "level": "extreme" } ],
  "climatology": [ { "month": 8, "p25": 0, "median": 0, "p75": 0, "share": 0.21 } ],   // share: yıllık toplamdaki tipik pay
  "annual": [ { "year": 2021, "value": 0, "raw_modis": 0, "raw_viirs": 0, "rank": 1 } ],
  "critical_months": [7, 8, 9], "critical_share": 0.62,
  "factors": [ { "month": 8, "factor": 4.0 } ], "factor_scope": "region",              // "region" | "pooled"
  "validation": { "annual_wape": 0.13, "monthly_wape": 0.24, "raw_annual_wape": 0.7, "n_years": 14,
                  "step_2012": { "raw": 3.9, "harmonized": 1.0 } },                    // 2012–14 ort. / 2009–11 ort.
  "landcover": { "cropland": 0.71, "tree": 0.10, "other": 0.19 },                      // yoksa null
  "insights": [ { "kind": "latest" | "record" | "critical" | "landcover", "text": "..." } ] }
```
`csv/{id}.csv`: `ym,value,lo,hi,raw_modis,raw_viirs,source,percentile`.

Metinler şablondan, hesaplanmış sayılarla üretilir; çalışma anında dil modeli yok.

## Görevler

| # | Görev | Dosyalar | Not |
|---|---|---|---|
| T1 | Mock sözleşme dosyaları (2 bölge, gerçekçi sayılar) | `shared/mock/` | Ön yüz buradan başlar |
| T2 | `scripts/build_site_data.py`: il poligonları → İBBS-2, maske, bölge × ay, çarpan, doğrulama, JSON + CSV | `scripts/`, `frontend/public/data/` | Zor iş. `analysis/med/` ve `analysis/experiments/.../lib.py` yeniden kullanılır |
| T3 | Ön yüz iskeleti: harita (vitrin bölgeleri son aya göre renkli, diğerleri gri), bölge seçimi | `frontend/` | Mock'tan |
| T4 | Takvim ısı haritası (yıl × 12 ay), ham/uyumlaştırılmış düğmesi, erişilebilir renk skalası | `frontend/src/` | Demonun kalbi |
| T5 | "Bu ay nerede" kartı, yıllık sıralama, kritik aylar, doğrulama paneli, CSV indirme | `frontend/src/` | |
| T6 | Gerçek veriye bağla, yayınla | — | Bütünleşme incelemesi burada |
| T7 | Tarım/orman payı (karosu inmiş bölgeler) | `scripts/`, `analysis/agri/` | Ek |
| T8 | 2026 verisi (anahtar gelirse) | `scripts/` | Ek |
| T9 | Sunum: 7 slayt, demo metni, README (kaynaklar, lisans, yapay zekâ kullanımı) | `docs/` | En az 3 saat ayrılır |

T2 ile T3–T5 paralel yürür; dosyaları ayrıktır.

## Reddedilenler

- **Serbest çizilen alan:** küçük alanda aylık hata %40–60; canlı hesap için sunucu gerekir.
- **Arka uç / API:** 26 sabit bölge için gereksiz; yayın ve çökme riski.
- **8 günlük dönem:** her ölçekte aylıktan kötü.
- **Tek ülke çarpanı:** komşu bölgelerde ±%18 kalıcı yanlılık, takvimde sahte 2012 basamağı.
- **Tüm bölgeleri yayınlamak, jüriye bölge seçtirmek:** Akdeniz dışında hata ölçülmedi; demoda kontrol edilmemiş sonuç riski.
- **Küresel kapsam, ikinci ülke:** hedef yerel etkinlik; zaman yok.
- **Karmaşık modeller (regresyon, boosting, olay kümeleme):** küçük ölçekte yıl sıralamasını bozuyor ya da kazancı tek aya özgü.

## Hedef dışı

Yangın tahmini, gerçek zamanlı harita, yanık alan ya da emisyon hesabı, kullanıcı hesabı, uyarı sistemi. Tarım arazisindeki hotspot'a "anız yangını" denmez.
