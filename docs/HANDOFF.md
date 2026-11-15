# Devir notu (yeni oturum için)

Yazıldığı an: 14 Kasım 2026, ~15:30 yerel. Teslim: **15 Kasım Pazar 23:59**. Henüz ürün kodu yok; yalnızca keşif ve yöntem çalışması bitti.

Okuma sırası: bu dosya → `BACKLOG.md` → `docs/REPORT.md`. `ARCHITECTURE.md` eski bir taslak; raporla çelişen yerlerde rapor geçerli.

## 1. Kullanıcı nasıl çalışmak istiyor

- **Önce tartış, sonra inşa et.** İlk oturumda fikir istenmişken mimariyi yazıp işçileri başlattım; kullanıcı buna açıkça itiraz etti. Yön kararı kullanıcının. Onay gelmeden tasarım sabitleme, işçi başlatma.
- Sohbet Türkçe. Kullanıcı kısa, net, dürüst değerlendirme istiyor ("gerçekçi ol").
- "Sakın hata yapma": sayılar ölçülmüş olmalı; ölçülmeyen şey ölçülmedi diye söylenmeli.
- Takım 2 kişi: Barış (`onerrbaris`) ve `Blockchaindeveloper43` (repoya yazma yetkisiyle davet edildi; kabul edip etmediği bilinmiyor). Takım arkadaşının güçlü yanı sorulmadı.
- Kullanım kotası kısıtlı. Kullanıcı, hız için gerekirse yönetici oturumun işi alt ajana vermeden kendisinin yapmasına izin verdi.

## 2. Bekleyen karar

Ürün yönü seçilmedi. Kullanıcının söylediği tek kısıt: **kapsam Türkiye, mümkünse yalnızca Akdeniz.**

Benim önerim (kullanıcı henüz onaylamadı): Akdeniz için **il / orman bölge müdürlüğü ölçeğinde (~100 km), yıllık ve yangın sezonu (Haz–Eki) bazında yanma takvimi**; aylık görünüm yalnızca tüm bölge için; 2012 sonrası ayrıntı; ölçeğe göre güven rozeti; doğrulama paneli; küçük alanlar için "en büyük olaylar" görünümü. Çerçeve "orman yangını" değil "yanma: orman + tarım" olmalı, çünkü bölgenin sayıca baskın rejimi Çukurova'daki tarımsal yakma.

Daha önce konuşulan diğer yönler: bilim-önce (açık veri seti/API), yalnızca anız, anomali nöbetçisi (2026 verisi şart), iklim/sezon kayması hikâyesi. Ayrıntı ve gerekçeler sohbetteydi; özetleri REPORT §7 ve bu notta.

## 3. Yöntemin tek paragraf özeti

Volkan ve açık deniz kayıtlarını at; sabit kaynakları konum maskesiyle ayıkla (MODIS `type` etiketine güvenme); ölçü aylık ham hotspot sayısı; 2012-01-20'den itibaren VIIRS olduğu gibi; öncesinde MODIS × o ayın bölgesel çarpanı (ya da Terra ve Aqua'ya ayrı ağırlık); 2002 ortasından önce Terra-tek çarpanları; her değere %90 aralık. Akdeniz çarpanları `analysis/med/factors_MED.json`, ulusal olanlar `analysis/out/final_factors.json`.

Akdeniz'de hata (bir yıl dışarıda, WAPE): bölge yıllık %6, aylık %15; ~100 km yıllık %23, aylık %38; ~25 km aylık %58. Düzeltmesiz %70+. Büyük olaylar 25 km'de bile ~%20 içinde.

## 4. Sunumda iddiaların sınırları

Ölçülmüş, söylenebilir:
- Uyumlaştırma, Türkiye ölçeğinde iki özdeş MODIS cihazının (Terra→Aqua) kendi aralarındaki uyum kadar iyi: aylık %12'ye karşı %12.
- Düzeltmesiz MODIS, VIIRS'e göre %60 eksik sayıyor; yöntem yanlılığı ~0'a indiriyor.
- İki yön (MODIS→VIIRS, VIIRS→MODIS) aynı doğrulukta.
- MODIS `type == 0` filtresi 2018'de yapay basamak yaratır; Terra-tek dönem düzeltilmezse −%45 basamak.
- Yedi bölgenin hatası 2012–2025'te bir yıl dışarıda bırakılarak ölçüldü (ör. Akdeniz yıllık %7,0, aylık %14,5; ayrıntı `docs/GEOGRAPHIC_VALIDATION.md`).

Sınırlar (bu ifadeler kullanılmaz):
- Hata oranı doğruluk yüzdesi değildir: "%93 doğru" gibi çeviriler yapılmaz, WAPE olarak söylenir.
- "25 km'de hatanın yarısı giderilemez gürültü" denmez; o taban MODIS hücre-gün hedefi içindi, VIIRS sayım hedefinde ~%18.
- "Akdeniz = orman yangını" denmez; tespitlerde baskın olan tarımsal yakma.
- 2000–2011 doğruluğu doğrudan ölçülemez (o yıllarda VIIRS yok); katsayıların o döneme taşınması varsayımdır.
- ~100 km alt bölge ölçümleri kutularla yapıldı, il poligonlarıyla değil.
- Çizilen alan için ayrı doğrulama yok; değerler il serilerinin alana düşen payından gelir.
- Bölge seçmek her durumda hatayı düşürür denmez; iller arası fazla ve eksik tahminler birbirini dengeleyebilir.
- Türkiye dışına genelleme yok.
- Büyük yangın aylarında aylık katsayı fazla tahmin edebiliyor (2021-08: +%38).
- Uydu tespiti yanan alan değildir: ağaçlık pikseldeki tespit kaç hektar orman yandığını söylemez.

## 5. Bu makinenin (Barış, Windows 11) tuhaflıkları

- **Ağ kesik kesik:** DNS rastgele düşüyor (`Could not resolve host`). Her ağ işlemi yeniden denemeli olmalı. curl için `--ssl-no-revoke --retry 5 --retry-all-errors`. `git push` ve `gh` için birkaç saniye arayla döngüyle yeniden dene; genelde 2–5 denemede geçiyor. Telefon hotspot'u önerildi, kullanıldığı bilinmiyor.
- `spaceappschallenge.org` bu makineden TLS hatası veriyor; kullanıcı tarayıcıdan bakmalı.
- Araçlar bu oturumda kuruldu; PATH'te olmayabilir, tam yol kullan:
  - Python 3.12: `C:\Users\Barış Öner\AppData\Local\Programs\Python\Python312\python.exe`
  - Proje venv: `.venv\Scripts\python.exe` (pandas, numpy, scipy 1.18.1, scikit-learn 1.9.1 kurulu; fastapi/uvicorn kurulumu doğrulanmadı; matplotlib yok)
  - Node 26.13.1: `C:\Program Files\nodejs\`
  - GitHub CLI: `C:\Program Files\GitHub CLI\gh.exe` (`onerrbaris` olarak giriş yapılı)
- winget'te `--source winget` verilmezse msstore kaynağı yüzünden başarısız oluyor.
- Kullanıcı adında Türkçe karakter ve boşluk var; yolları tırnak içine al.
- Git satır sonu uyarıları (LF→CRLF) zararsız.

## 6. Diskte olup repoda olmayanlar

- `data/raw/`: Türkiye, 40 CSV, 64 MB. Yoksa: `python scripts/fetch_firms.py` (yeniden denemeli, kaldığı yerden sürer).
- `analysis/cache/` (277 MB) ve `analysis/out/jobs/` (1,7 GB ara dosya): yeniden üretilebilir, `run_all.py` ~2 saat sürer. Gerekmedikçe yeniden koşma; özet CSV'ler repoda.
- `backend/app.py`, `backend/__init__.py`, `scripts/make_mocks.py`, `requirements.txt`: durdurulan bir işçinin yarım, **doğrulanmamış** dosyaları. Eski taslak sözleşmeye (8 günlük dönem) göre yazıldı. Yön seçilince büyük olasılıkla baştan yazılmalı; kullanmadan önce oku.

## 7. Sonuç dosyalarını okuma

- `analysis/out/results_all.csv` ve `analysis/out/jobs/*.csv`: sütunlar `direction` (m2v/v2m), `measure` (n=sayı, cd05, cd25, frp), `res` (month/p8/year), `scale` (country, b200, b100, b50, b25 = 2°, 1°, 0,5°, 0,25°), `model`, `wape`, `bias`, `r_log`, `A_pct_mae`, `A_p90_recall`, `A_p90_precision`, `year_rank_rho`, `cov90_scalecal`, `zeroY`.
- `analysis/med/metrics.csv`: bölge × model × ölçek × çözünürlük.
- Model adları: `seasonal` = aylık çarpan (önerilen), `seasonal_nominal` = yalnızca 2012–2020'den fit.

## 8. Alt ajanlarla ilgili dersler

- İlk analiz işçisi ~3 saat sürdü ve defalarca "kendi arka plan işini bekliyor" durumunda kaldı; final raporunu hiç teslim etmedi, sonuçları dosyalardan ben okudum. İkinci işçi, **katı kurallarla** 6 dakikada bitti: "40 dakikada rapor, her şey ön planda, tek koşu ≤5 dk, arka plan işi yok, bekleme yok".
- Alt ajanlar `REPORT.md` yazamıyor (harness engelliyor); raporu son mesaj olarak isteyip dosyaya yönetici yazmalı.
- Paralel işçilere ayrık dosya listesi ver; `data/raw` salt okunur.
- Orkestrasyon kuralları: `/orchestration` skill'i (lider + işçi katmanları, aynı anda en fazla 2 işçi).

## 9. İnsanlardan beklenenler

- **FIRMS MAP_KEY** (2026 verisi ve NOAA-20/21 için tek yol): https://firms.modaps.eosdis.nasa.gov/api/map_key/ . Alınıp alınmadığı bilinmiyor. `.env` içine, commit'leme.
- Challenge "Resources" sekmesi ve teslim kılavuzu (video süresi sınırı doğrulanmadı; "30 saniye" otomatik altyazıdan).
- Deploy hesapları (Render, Vercel) henüz yok.
- Repo özel; teslimde herkese açık yapmak gerekebilir: `gh repo edit onerrbaris/burncal --visibility public --accept-visibility-change-consequences`.
- Teslimde zorunlu: yapay zekâ kullanım açıklaması, kaynak atıfları, lisans dosyası (henüz yok).

## 10. Yön onaylanırsa ilk adımlar (öneri)

1. `ARCHITECTURE.md`'yi rapora göre yeniden yaz: aylık/yıllık/sezon birimleri, konum maskesi, bölgesel çarpanlar, sabit coğrafi birimler (iller), güven rozeti. Sözleşmeyi kullanıcıya göster, onay al.
2. Gerçek il sınırlarını indir (geoBoundaries TUR ADM1) ve doğruluğu il bazında yeniden ölç; rozet eşikleri bu sayılardan gelsin.
3. Tek seferlik `build_dataset.py`: temiz, maskeli, uyumlaştırılmış aylık tablo (il × ay × yıl, aralıklı). Frontend bunu statik JSON olarak da okuyabilsin (backend olmadan demo).
4. Frontend ve varsa backend paralel; entegrasyon noktasında bağımsız inceleme (yazan ajan kendi işini incelemez).
5. Son 4 saat: kod dondur, 7 slayt, README, lisans.

Süre dar: kapsamı küçük tut, statik veriyle çalışan bir demo öncelikli.

## 11. Takım arkadaşının değişikliği

`Blockchaindeveloper43` daveti kabul etti ve 14 Kasım 15:37'de bir commit attı: rapordan ve mimariden yapay zekâ model adlarını çıkardı, REPORT §9'u genel bir ifadeyle değiştirdi. Bu nota da model adı yazılmadı. Dikkat: challenge kuralları teslimde yapay zekâ araçlarının nasıl kullanıldığının açıklanmasını zorunlu tutuyor; teslim formundaki açıklama gerçeği yansıtmalı (keşif, analiz kodu ve rapor taslağı yapay zekâ ile üretildi).
