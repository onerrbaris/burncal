r"""Atlas icin yil yil ates noktasi dosyalari uretir: web/data/points/{yil}.json

    analysisgri\.venv\Scripts\python.exe scripts/build_points.py

Bicim: {"modis": [x, y, ay, x, y, ay, ...], "viirs": [...]}  (x = boylam*1000, y = enlem*1000, tam sayi)
Filtre scripts/build_harmonized.py ile ayni: FIRMS type 1 (volkan) ve 3 (acik deniz) atilir; herhangi bir
VIIRS type 2 tespiti olan 0,01 derecelik hucreler (+-1 hucre genisletilmis) iki sensorden de cikarilir.
"""
from pathlib import Path
import json
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / "data" / "raw", ROOT / "web" / "data" / "points"
OUT.mkdir(parents=True, exist_ok=True)
COLS = ["latitude", "longitude", "acq_date", "type"]


def load(path):
    d = pd.read_csv(path, usecols=COLS)
    d["cx"] = np.floor(d.longitude * 100).astype(int)
    d["cy"] = np.floor(d.latitude * 100).astype(int)
    return d


viirs = {int(p.name.split("_")[1]): load(p) for p in sorted(RAW.glob("viirs-snpp_*_Turkey.csv"))}
core = set()
for d in viirs.values():
    s = d[d.type == 2]
    core.update(zip(s.cx, s.cy))
mask = {(x + i, y + j) for x, y in core for i in (-1, 0, 1) for j in (-1, 0, 1)}


def pack(d):
    d = d[~d.type.isin([1, 3])]
    keep = [k not in mask for k in zip(d.cx, d.cy)]
    d = d[keep]
    m = pd.to_datetime(d.acq_date).dt.month
    a = np.column_stack([np.round(d.longitude * 1000), np.round(d.latitude * 1000), m]).astype(int)
    return a.ravel().tolist()


total = 0
for p in sorted(RAW.glob("modis_*_Turkey.csv")):
    y = int(p.name.split("_")[1])
    out = {"modis": pack(load(p)), "viirs": pack(viirs[y]) if y in viirs else []}
    f = OUT / f"{y}.json"
    f.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    total += f.stat().st_size
    print(y, len(out["modis"]) // 3, len(out["viirs"]) // 3, f.stat().st_size // 1024, "KB")
print("maske hucresi", len(mask), "| toplam", total // 1024, "KB")
