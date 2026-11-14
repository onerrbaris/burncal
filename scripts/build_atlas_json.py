"""Atlas arayuzunun (web/) okudugu web/data/atlas.json dosyasini uretir.

Girdi (ikisi de repoda):
  frontend/atlas-data.js       -> MODIS ve VIIRS il serileri (scripts/build_izmir_atlas.py)
  frontend/harmonized-data.js  -> birlesmis seri ve dogrulama (scripts/build_harmonized.py)

Bu iki dosyadan biri yeniden uretildiginde calistirin:
    python scripts/build_atlas_json.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend"   # il serileri burada uretiliyor
FE = ROOT / "web"         # atlas arayuzu
OUT = FE / "data" / "atlas.json"
ALIAS = {"Afyonkarahisar": "Afyon", "Hakkâri": "Hakkari"}   # harita dosyasindaki adlar
NOTES = {
    "modis": "Kaynak: NASA FIRMS MODIS (Terra + Aqua), type = 0 tespitleri.",
    "viirs": "Kaynak: NASA FIRMS VIIRS S-NPP 375 m, type = 0 tespitleri.",
    "merged": "VIIRS-eşdeğeri sayı: 2012-02'den itibaren VIIRS gözlemi, öncesi MODIS × bölgesel aylık çarpan.",
}


def load_js(path):
    text = path.read_text(encoding="utf-8")
    return json.loads(text[text.index("{"):text.rindex("}") + 1])


def main():
    names = {f["properties"]["name"] for f in
             json.loads((FE / "data" / "tr-provinces.json").read_text(encoding="utf-8"))["features"]}
    atlas, harm = load_js(SRC / "atlas-data.js"), load_js(SRC / "harmonized-data.js")
    sources = {"modis": ("MODIS", atlas["series"]["MODIS"]), "viirs": ("VIIRS", atlas["series"]["VIIRS"]),
               "merged": ("Birleşmiş", harm["series"])}
    provinces, sensors, unknown = {}, {}, set()
    for key, (label, by_prov) in sources.items():
        years = set()
        for name, series in by_prov.items():
            name = ALIAS.get(name, name)
            if name not in names:
                unknown.add(name)
                continue
            # eksik ayi olan yil (2000: MODIS Kasim'da basliyor) takvime alinmaz
            full = {y: row for y, row in series.items() if all(v is not None for v in row)}
            if full:
                provinces.setdefault(name, {})[key] = full
                years.update(int(y) for y in full)
        sensors[key] = {"label": label, "from": min(years), "to": max(years)}
    validation = {}
    for name, p in harm["provinces"].items():
        name = ALIAS.get(name, name)
        if name not in names:
            unknown.add(name)
            continue
        validation[name] = {k: p[k] for k in ("region", "confidence", "annual_wape", "monthly_wape")}
    if unknown:
        sys.exit(f"Haritada karsiligi olmayan il adlari: {sorted(unknown)} (ALIAS'a ekleyin)")
    assert len(provinces) == 81 and len(validation) == 81
    data = {"meta": {"sample": False, "generated": "scripts/build_atlas_json.py",
                     "harmonized_at": harm["meta"]["generated_at"], "notes": NOTES, "sensors": sensors},
            "provinces": provinces, "validation": validation}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"yazildi: {OUT} ({OUT.stat().st_size} bayt, {len(provinces)} il)\n{sensors}")


if __name__ == "__main__":
    main()
