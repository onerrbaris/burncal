r"""Land cover (ESA WorldCover 2021, 10 m) for the atlas. Run after scripts/build_points.py.

    .venv\Scripts\python.exe scripts/build_landcover.py

1. Every hotspot in web/data/points/{year}.json gets the WorldCover class of the 10 m pixel under its
   stored position (lon/lat rounded to 0.001 deg). The files become 6-value groups:
   x, y, day, frp, province, class   (class = index into CLASSES below, 0 = no data), "stride": 6.
2. web/data/landcover.json: per province, year and month, detections in four groups
   (cropland, tree cover, shrub+grass, other). Source per year as in the harmonized series:
   VIIRS S-NPP from 2012, MODIS before. Shares only; counts of different sensors are not mixed in one year.
3. web/data/landcover/{tile}.png: colour-coded overview (~270 m, the tile's 1/32 overview level),
   transparent outside Turkey, plus index.json with the tile bounds for the map layer.

Tiles are read block by block (1024 x 1024), never whole (a full tile is 1.3 GB in memory).
Inputs: data/raw/worldcover/*.tif (scripts/fetch_worldcover.py), data/raw/boundaries/TUR-ADM1.geojson.
Licence of the land cover: CC BY 4.0, (c) ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021).
"""
import json
import time
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
TILES = ROOT / "data" / "raw" / "worldcover"
PTS = ROOT / "web" / "data" / "points"
OUT_IMG = ROOT / "web" / "data" / "landcover"
PX = 12000                       # pixels per degree (10 m tiles, 3 degrees = 36000 px)
T0 = time.time()

# index, WorldCover code, Turkish label, colour (dark-theme friendly), group (0 crop, 1 tree, 2 shrub/grass, 3 other)
CLASSES = [
    (0, 0, "Veri yok", (0, 0, 0, 0), 3),
    (1, 10, "Ağaçlık alan (orman ya da bahçe)", (46, 125, 79, 255), 1),
    (2, 20, "Çalılık", (138, 152, 72, 255), 2),
    (3, 30, "Otlak / çayır", (196, 196, 112, 255), 2),
    (4, 40, "Tarım arazisi", (236, 186, 82, 255), 0),
    (5, 50, "Yapılaşmış alan", (204, 82, 72, 255), 3),
    (6, 60, "Çıplak / seyrek bitki", (150, 140, 124, 255), 3),
    (7, 70, "Kar ve buz", (232, 238, 244, 255), 3),
    (8, 80, "Su", (62, 122, 190, 255), 3),
    (9, 90, "Sulak alan", (62, 166, 160, 255), 3),
    (10, 95, "Mangrov", (40, 120, 90, 255), 1),
    (11, 100, "Yosun / liken", (200, 200, 170, 255), 2),
]
CODE2IDX = np.zeros(256, np.uint8)
for i, code, *_ in CLASSES:
    CODE2IDX[code] = i
GROUP = np.array([c[4] for c in CLASSES], np.uint8)
GROUPS = ["Tarım arazisi", "Ağaçlık alan", "Çalılık ve otlak", "Diğer"]


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def tile_name(lon, lat):
    return f"N{int(np.floor(lat / 3) * 3):02d}E{int(np.floor(lon / 3) * 3):03d}"


def classify(path, lo, la, lon, lat):
    """WorldCover class index for points inside one tile, decoding only the 1024 px blocks they touch."""
    col = np.clip(((lon - lo) * PX).astype(np.int64), 0, 3 * PX - 1)
    row = np.clip(((la + 3 - lat) * PX).astype(np.int64), 0, 3 * PX - 1)
    out = np.zeros(len(lon), np.uint8)
    with tifffile.TiffFile(path) as tif:
        page, fh = tif.pages[0], tif.filehandle
        tw, th = page.tilewidth, page.tilelength
        ntx = -(-page.shape[1] // tw)
        block = (row // th) * ntx + (col // tw)
        for b in np.unique(block):
            sel = np.where(block == b)[0]
            fh.seek(page.dataoffsets[b])
            data, _, _ = page.decode(fh.read(page.databytecounts[b]), int(b))
            data = data.reshape(th, tw)
            out[sel] = CODE2IDX[data[row[sel] % th, col[sel] % tw]]
    return out


def overview(path, lo, la, turkey_rings):
    """Colour image from the 1/32 overview level, transparent outside Turkey."""
    with tifffile.TiffFile(path) as tif:
        lev = tif.series[0].levels[5].asarray()
    h, w = lev.shape
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    sx, sy = w / 3, h / 3
    for ring in turkey_rings:
        draw.polygon([((x - lo) * sx, (la + 3 - y) * sy) for x, y in ring], fill=255)
    idx = CODE2IDX[lev]
    idx[np.asarray(mask) == 0] = 0
    # Paletli PNG (sınıf başına bir renk, 0 saydam): RGBA'ya göre birkaç kat küçük.
    img = Image.fromarray(idx, "P")
    img.putpalette([v for c in CLASSES for v in c[3][:3]])
    img.info["transparency"] = 0
    return img


def main():
    tiles = {p.name.split("_")[5]: p for p in TILES.glob("ESA_WorldCover_10m_2021_v200_*_Map.tif")}
    log("tiles", len(tiles))
    years = sorted(int(p.stem) for p in PTS.glob("*.json"))
    files = {y: json.loads((PTS / f"{y}.json").read_text(encoding="utf-8")) for y in years}

    # 1. classes for every point, grouped by tile so each tile is opened once
    allpts = []    # (year, sensor, array view)
    for y, d in files.items():
        for s in ("modis", "viirs"):
            a = np.asarray(d.get(s, []), np.int64)
            stride = d.get("stride", 5)
            a = a.reshape(-1, stride)[:, :5] if len(a) else np.zeros((0, 5), np.int64)
            allpts.append((y, s, a))
    lon = np.concatenate([a[:, 0] for *_, a in allpts]) / 1000
    lat = np.concatenate([a[:, 1] for *_, a in allpts]) / 1000
    cls = np.zeros(len(lon), np.uint8)
    names = np.array([tile_name(x, y) for x, y in zip(lon, lat)])
    missing = sorted(set(names) - set(tiles))
    if missing:
        log("WARNING: no tile for", missing, "points:", int(np.isin(names, missing).sum()))
    for t in sorted(set(names) & set(tiles)):
        sel = np.where(names == t)[0]
        la, lo = int(t[1:3]), int(t[4:7])
        cls[sel] = classify(tiles[t], lo, la, lon[sel], lat[sel])
        log(t, len(sel), "points")

    # write points back with the class as 6th value
    k = 0
    stats = {}
    for y, s, a in allpts:
        n = len(a)
        c = cls[k:k + n]; k += n
        files[y][s] = np.column_stack([a, c]).ravel().tolist()
        files[y]["stride"] = 6
        # province x month x group, source sensor as in the harmonized series
        if (s == "viirs") == (y >= 2012) and n:
            month = (np.datetime64(f"{y}-01-01") + (a[:, 2] - 1).astype("timedelta64[D]")).astype("datetime64[M]").astype(int) % 12
            arr = np.zeros((81, 12, 4), np.int64)
            np.add.at(arr, (a[:, 4], month, GROUP[c]), 1)
            stats[y] = arr
    for y, d in files.items():
        (PTS / f"{y}.json").write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
    log("points written")

    web = [f["properties"]["name"] for f in json.loads((ROOT / "web/data/tr-provinces.json").read_text(encoding="utf-8"))["features"]]
    by_prov = {n: {str(y): stats[y][i].ravel().tolist() for y in sorted(stats)} for i, n in enumerate(web)}
    share = np.bincount(GROUP[cls], minlength=4) / max(1, len(cls))
    doc = {"source": "ESA WorldCover 2021 v200 (10 m), CC BY 4.0; class of the pixel under each detection",
           "groups": GROUPS, "layout": "per province: year -> 12 months x 4 groups (row-major)",
           "classes": [{"i": i, "code": code, "label": lab, "color": "#%02x%02x%02x" % col[:3], "group": g}
                       for i, code, lab, col, g in CLASSES if code],
           "all_points_group_share": [round(float(v), 4) for v in share],
           "provinces": by_prov}
    (ROOT / "web/data/landcover.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log("landcover.json", (ROOT / "web/data/landcover.json").stat().st_size // 1024, "KB; group shares", doc["all_points_group_share"])

    # 3. overview images for the map layer
    gb = json.loads((ROOT / "data/raw/boundaries/TUR-ADM1.geojson").read_text(encoding="utf-8"))["features"]
    rings = []
    for f in gb:
        g = f["geometry"]
        for poly in ([g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]):
            rings.append(poly[0])
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    index = []
    for t, p in sorted(tiles.items()):
        la, lo = int(t[1:3]), int(t[4:7])
        img = overview(p, lo, la, rings)
        if img.getbbox() is None:      # Türkiye bu parçada yok (yalnızca deniz / komşu ülke)
            continue
        f = OUT_IMG / f"{t}.png"
        img.save(f, optimize=True, transparency=0)
        index.append({"tile": t, "file": f"data/landcover/{t}.png",
                      "coordinates": [[lo, la + 3], [lo + 3, la + 3], [lo + 3, la], [lo, la]]})
        log("image", t, f.stat().st_size // 1024, "KB")
    (OUT_IMG / "index.json").write_text(json.dumps({"tiles": index, "legend": [
        {"label": lab, "color": "#%02x%02x%02x" % col[:3]} for i, code, lab, col, g in CLASSES if code and code not in (95, 100)]},
        ensure_ascii=False, indent=1), encoding="utf-8")
    log("done")


if __name__ == "__main__":
    main()
