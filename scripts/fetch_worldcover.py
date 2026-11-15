#!/usr/bin/env python3
r"""Download the ESA WorldCover 2021 (10 m, v200) tiles that cover Turkey. Resumable (curl -C -).

    .venv\Scripts\python.exe scripts/fetch_worldcover.py

Tiles are 3x3 degree GeoTIFFs (~85 MB each) from the public ESA bucket on AWS. The tile list is
the set of tiles whose box intersects the Turkish provinces (data/raw/boundaries/TUR-ADM1.geojson,
bounding boxes of the polygons). Files go to data/raw/worldcover/ (not in git).
Licence: CC BY 4.0, (c) ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021).
"""
import json
import math
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "worldcover"
URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"


def rings(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        yield poly[0]


def tiles():
    """Tiles whose 3x3 degree box intersects a province polygon (shapely), not just the bounding boxes."""
    import shapely
    from shapely.geometry import box, shape
    feats = json.loads((ROOT / "data/raw/boundaries/TUR-ADM1.geojson").read_text(encoding="utf-8"))["features"]
    tr = shapely.union_all([shape(f["geometry"]) for f in feats])
    x0, y0, x1, y1 = tr.bounds
    out = []
    for la in range(math.floor(y0 / 3) * 3, math.floor(y1 / 3) * 3 + 1, 3):
        for lo in range(math.floor(x0 / 3) * 3, math.floor(x1 / 3) * 3 + 1, 3):
            if tr.intersects(box(lo, la, lo + 3, la + 3)):
                out.append(f"N{la:02d}E{lo:03d}")
    return sorted(out)


def fetch(t):
    f = OUT / f"ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
    head = subprocess.run(["curl.exe", "-sI", "--ssl-no-revoke", "--retry", "5", "--retry-all-errors", "-m", "60",
                           URL.format(t=t)], capture_output=True, text=True).stdout
    if " 404" in head.splitlines()[0] if head else False:
        return t, "no tile (sea)"
    size = next((int(l.split(":")[1]) for l in head.splitlines() if l.lower().startswith("content-length")), None)
    for k in range(20):
        if size and f.exists() and f.stat().st_size == size:
            return t, f"ok {size // 2**20} MB"
        subprocess.run(["curl.exe", "-sS", "-L", "--ssl-no-revoke", "--retry", "5", "--retry-all-errors",
                        "-C", "-", "-m", "1800", "-o", str(f), URL.format(t=t)])
        time.sleep(3)
    return t, f"FAILED ({f.stat().st_size if f.exists() else 0} of {size})"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    ts = [t for t in tiles() if t in sys.argv[1:]] if sys.argv[1:] else tiles()   # optional subset (parallel runs)
    print("tiles:", len(ts), ts, flush=True)
    bad = []
    for t in ts:
        r = fetch(t)
        print(*r, flush=True)
        if r[1].startswith("FAILED"):
            bad.append(t)
    sys.exit(1 if bad else 0)
