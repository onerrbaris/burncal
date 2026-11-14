r"""Atlas icin yil yil ates noktasi dosyalari uretir: web/data/points/{yil}.json

    .venv\Scripts\python.exe scripts/build_points.py

Bicim: {"modis": [x, y, gun, frp, il, ...], "viirs": [...]}  (5'li gruplar, tam sayi)
  x = boylam*1000, y = enlem*1000, gun = yilin gunu (1-366), frp = MW (yuvarlanmis),
  il = web/data/tr-provinces.json icindeki il sirasi (0-80).
Arayuz bu dosyalardan haritadaki noktalari ve "tespit listesi" CSV'sini uretir.

Filtre scripts/build_harmonized.py ile ayni: FIRMS type 1 (volkan) ve 3 (acik deniz) atilir; 2012-2025
arasinda herhangi bir VIIRS type 2 tespiti olan 0,01 derecelik hucreler (+-1 hucre genisletilmis) iki
sensorden de cikarilir. Il atamasi (geoBoundaries, build_harmonized.py ile ayni): poligon icinde; kiyida disarida kalanlar 0,05 dereceye kadar en
yakin ile. Hicbir ile dusmeyen noktalar (komsu ulkeler, API kutusundan gelenler) atilir.
"""
from pathlib import Path
import json
import unicodedata

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / "data" / "raw", ROOT / "web" / "data" / "points"
OUT.mkdir(parents=True, exist_ok=True)
COLS = ["latitude", "longitude", "acq_date", "frp", "type"]

# Il atamasi build_harmonized.py ile ayni sinirlarla (geoBoundaries ADM1) yapilir, boylece CSV'deki
# il sayilari paneldeki ham sayilarla birebir tutar; il numarasi ise haritadaki il sirasidir.
def norm(s):
    s = s.replace("ı", "i").replace("İ", "I")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower().strip()
    return {"afyon": "afyonkarahisar"}.get(s, s)


web = [f["properties"]["name"] for f in json.loads((ROOT / "web/data/tr-provinces.json").read_text(encoding="utf-8"))["features"]]
gb = json.loads((RAW / "boundaries/TUR-ADM1.geojson").read_text(encoding="utf-8"))["features"]
widx = {norm(n): i for i, n in enumerate(web)}
GB2WEB = np.array([widx[norm(f["properties"]["shapeName"])] for f in gb])
assert len(set(GB2WEB)) == 81
TREE = shapely.STRtree([shape(f["geometry"]) for f in gb])


def load(path):
    d = pd.read_csv(path, usecols=COLS)
    d["cx"] = np.floor(d.longitude * 100).astype(int)
    d["cy"] = np.floor(d.latitude * 100).astype(int)
    return d


def year_of(p):
    return int(p.name.split("_")[1])


viirs = {year_of(p): load(p) for p in sorted(RAW.glob("viirs-snpp_*_Turkey.csv"))}
modis = {year_of(p): p for p in sorted(RAW.glob("modis_*_Turkey.csv"))}
core = set()
for y, d in viirs.items():
    if y <= 2025:                       # sabit maske yalnizca arsiv yillarindan (NRT'de type yok)
        s = d[d.type == 2]
        core.update(zip(s.cx, s.cy))
mask = {(x + i, y + j) for x, y in core for i in (-1, 0, 1) for j in (-1, 0, 1)}


def province(lon, lat):
    pts = shapely.points(lon, lat)
    pi, gi = TREE.query(pts, predicate="intersects")
    prov = np.full(len(pts), -1, np.int32)
    first = np.unique(pi, return_index=True)[1]
    prov[pi[first]] = gi[first]
    miss = np.where(prov < 0)[0]
    if len(miss):
        mi, mg = TREE.query_nearest(pts[miss], max_distance=0.05)
        prov[miss[mi]] = mg
    return np.where(prov >= 0, GB2WEB[np.maximum(prov, 0)], -1)


def pack(d):
    d = d[~d.type.isin([1, 3])]
    d = d[[k not in mask for k in zip(d.cx, d.cy)]]
    prov = province(d.longitude.values, d.latitude.values)
    d, prov = d[prov >= 0], prov[prov >= 0]
    doy = pd.to_datetime(d.acq_date).dt.day_of_year
    a = np.column_stack([np.round(d.longitude * 1000), np.round(d.latitude * 1000), doy,
                         np.round(d.frp.fillna(0)), prov]).astype(int)
    return a.ravel().tolist()


# noktalar da birlesmis serinin son veri gunune kadar (S-NPP'nin son gunu; build_harmonized ile ayni)
_h = (ROOT / "frontend/harmonized-data.js").read_text(encoding="utf-8")
THROUGH = pd.Timestamp(json.loads(_h[_h.index("{"):_h.rindex("}") + 1])["meta"].get("data_through", "2025-12-31"))
_load = load
def load(path):
    d = _load(path)
    return d[pd.to_datetime(d.acq_date) <= THROUGH]
viirs = {y: d[pd.to_datetime(d.acq_date) <= THROUGH] for y, d in viirs.items()}

total = 0
for y in sorted(set(modis) | set(viirs)):
    out = {"modis": pack(load(modis[y])) if y in modis else [], "viirs": pack(viirs[y]) if y in viirs else []}
    f = OUT / f"{y}.json"
    f.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    total += f.stat().st_size
    print(y, len(out["modis"]) // 5, len(out["viirs"]) // 5, f.stat().st_size // 1024, "KB")
print("maske hucresi", len(mask), "| toplam", total // 1024, "KB")
