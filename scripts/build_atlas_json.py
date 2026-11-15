"""Atlas arayuzunun (web/) okudugu web/data/atlas.json dosyasini uretir.

Girdi (ikisi de repoda, scripts/build_harmonized.py uretir):
  frontend/harmonized.csv      -> il x ay: birlesmis deger, kaynak, ham MODIS ve ham VIIRS sayilari.
                                  Uc sekme de bu dosyadan gelir; ham sayilar birlesmis seriyle ayni
                                  sabit kaynak (konum) maskesinden gecmistir.
  frontend/harmonized-data.js  -> dogrulama, bolge carpanlari, 2012 basamak olculeri

Yalnizca standart kutuphane (pandas gerekmez). Girdiler yeniden uretildiginde calistirin:
    python scripts/build_atlas_json.py
"""
import csv
import json
import sys
from pathlib import Path
try:
    from .build_geographic_regions import build as build_geographic_regions, load_validation
except ImportError:
    from build_geographic_regions import build as build_geographic_regions, load_validation

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend"   # il serileri burada uretiliyor
FE = ROOT / "web"         # atlas arayuzu
OUT = FE / "data" / "atlas.json"
ALIAS = {"Afyonkarahisar": "Afyon", "Hakkâri": "Hakkari"}   # harita dosyasindaki adlar
MASK = "sabit kaynaklar (sanayi vb.) üç sekmede de aynı konum maskesiyle ayıklandı"
NOTES = {
    "modis": f"Kaynak: NASA FIRMS MODIS (Terra + Aqua) ham sayı; {MASK}.",
    "viirs": f"Kaynak: NASA FIRMS VIIRS S-NPP 375 m ham sayı; {MASK}.",
    "merged": "VIIRS-eşdeğeri tespit: 2012-02'den itibaren VIIRS gözlemi (uydu kesintisi günleri MODIS × çarpanla dolduruldu), "
              f"öncesi MODIS × bölgesel aylık çarpan; {MASK}.",
}
COLS = {"modis": "raw_modis", "viirs": "raw_viirs", "merged": "value"}
LABELS = {"modis": "MODIS", "viirs": "VIIRS", "merged": "Birleşmiş"}


def load_js(path):
    text = path.read_text(encoding="utf-8")
    return json.loads(text[text.index("{"):text.rindex("}") + 1])


def num(s):
    if s == "":
        return None
    v = float(s)
    return int(v) if v.is_integer() else round(v, 1)


def main():
    names = {f["properties"]["name"] for f in
             json.loads((FE / "data" / "tr-provinces.json").read_text(encoding="utf-8"))["features"]}
    harm = load_js(SRC / "harmonized-data.js")
    through = harm["meta"].get("data_through", "2025-12-31")
    last_y, last_m = int(through[:4]), int(through[5:7])   # son veri ayi (yil, 1-12)
    raw, unknown = {}, set()   # raw[key][il][yil] = 12 ay
    with open(SRC / "harmonized.csv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            name = ALIAS.get(r["province"], r["province"])
            if name not in names:
                unknown.add(name)
                continue
            y, m = r["year"], int(r["month"]) - 1
            for key, col in COLS.items():
                raw.setdefault(key, {}).setdefault(name, {}).setdefault(y, [None] * 12)[m] = num(r[col])
    provinces, sensors = {}, {}
    for key, by_prov in raw.items():
        years = set()
        for name, series in by_prov.items():
            # eksik ayi olan yil (2000: MODIS Kasim'da basliyor; VIIRS 2012 oncesi yok) takvime alinmaz;
            # icinde bulunulan yil son veri ayina kadar doluysa alinir (sonraki aylar null kalir)
            def ok(y, row):
                if int(y) == last_y and last_m < 12:
                    return all(v is not None for v in row[:last_m])
                return all(v is not None for v in row)
            full = {y: row for y, row in sorted(series.items()) if ok(y, row)}
            if full:
                provinces.setdefault(name, {})[key] = full
                years.update(int(y) for y in full)
        sensors[key] = {"label": LABELS[key], "from": min(years), "to": max(years)}
    validation = {}
    for name, p in harm["provinces"].items():
        name = ALIAS.get(name, name)
        if name not in names:
            unknown.add(name)
            continue
        validation[name] = {k: p[k] for k in ("region", "confidence", "annual_wape", "monthly_wape", "mean_annual",
                                              "step_raw", "step_harmonized", "step_modis")}
    if unknown:
        sys.exit(f"Haritada karsiligi olmayan il adlari: {sorted(unknown)} (ALIAS'a ekleyin)")
    assert len(provinces) == 81 and len(validation) == 81
    assert all(set(p) == set(COLS) for p in provinces.values())
    regions = {c: {"name": r["name"], "factors": r["factors"]} for c, r in harm["regions"].items()}
    meta = {"sample": False, "generated": "scripts/build_atlas_json.py", "harmonized_at": harm["meta"]["generated_at"],
            "notes": NOTES, "sensors": sensors, "viirs_from": harm["meta"]["viirs_from"],
            "last_month": f"{last_y}-{last_m:02d}", "data_through": through, "unit": "VIIRS-eşdeğeri tespit"}
    data = {"meta": meta, "provinces": provinces, "validation": validation, "regions": regions}
    # SP/NRT: guncel yil API'den gelir; hangi tarihten itibaren NRT oldugu indirme kaydindan okunur
    man = ROOT / "data" / "raw" / f"recent_manifest_{last_y}.json"
    if man.exists():
        files = json.loads(man.read_text(encoding="utf-8"))["files"]
        nrt = {}
        for key, fn in (("modis", f"modis_{last_y}_Turkey.csv"), ("viirs", f"viirs-snpp_{last_y}_Turkey.csv")):
            months = sorted(k.split()[0] for k in files.get(fn, {}).get("rows_by_month_source", {}) if k.endswith("NRT"))
            if months:
                nrt[key] = months[0]
        meta["nrt_from"] = nrt
    part = harm.get("partial")
    if part:   # icinde bulunulan ay/yil: her yilin ayni takvim penceresi (1. gun .. son veri gunu)
        data["partial"] = {**{k: part[k] for k in ("through", "month", "day", "years")},
                           **{k: {ALIAS.get(n, n): v for n, v in part[k].items()}
                              for k in ("mtd", "ytd", "mtd_modis", "mtd_viirs") if k in part}}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # İl serileri yenilenince yedi bölgenin toplamları da aynı veriden yenilenir.
    geo = json.loads((FE / "data" / "tr-provinces.json").read_text(encoding="utf-8"))
    regional = build_geographic_regions(data, geo, load_validation(data))
    (FE / "data" / "geographic-regions.json").write_text(
        json.dumps(regional, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"yazildi: {OUT} ({OUT.stat().st_size} bayt, {len(provinces)} il, {len(regions)} bolge)\n{sensors}")


if __name__ == "__main__":
    main()
