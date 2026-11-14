"""Prep for the cropland-burning trend test.
Loads FIRMS Turkey CSVs (same recipe as analysis/agri/prep.py: drop type 1/3, static-source
mask from VIIRS type 2 cells dilated +-1 cell), detects satellite outage days (copy of
analysis/common.outages), labels every hotspot with ESA WorldCover 2021 (centre pixel) and,
for VIIRS, the tree-cover fraction in a 201x201 px window (~1.9 km N-S x ~1.5 km E-W) around it.

Run: analysis\\agri\\.venv\\Scripts\\python.exe -I analysis\\agri_trend\\prep.py
"""
from pathlib import Path
import time
import numpy as np
import pandas as pd
import rasterio
from rasterio.windows import Window

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RAW = ROOT / "data" / "raw"
TILES = ROOT / "analysis" / "agri" / "tiles"
CACHE = HERE / "cache"
CACHE.mkdir(exist_ok=True)
COLS = ["latitude", "longitude", "acq_date", "satellite", "frp", "daynight", "type"]
# tiles reported complete by the team; anything else in the folder is unverified and ignored
WHITELIST = ["N36E027", "N36E030", "N36E033", "N36E036", "N36E039", "N36E042", "N39E027", "N39E030", "N39E033"]
HALF = 100   # window half-size in pixels for tree fraction
BAND = 1024


def static_mask_keys(v, buffer=1):
    s = v[v.type == 2]
    ii = np.floor(s.latitude.values * 100).astype(np.int64)
    jj = np.floor(s.longitude.values * 100).astype(np.int64)
    base = set(zip(ii.tolist(), jj.tolist()))
    out = set()
    for a, b in base:
        for da in range(-buffer, buffer + 1):
            for db in range(-buffer, buffer + 1):
                out.add((a + da) * 100000 + (b + db))
    return np.fromiter(out, dtype=np.int64)


def on_static(d, keys):
    k = np.floor(d.latitude.values * 100).astype(np.int64) * 100000 + np.floor(d.longitude.values * 100).astype(np.int64)
    return np.isin(k, keys)


def read(pattern):
    fr = [pd.read_csv(f, usecols=COLS) for f in sorted(RAW.glob(pattern))]
    d = pd.concat(fr, ignore_index=True)
    dt = pd.to_datetime(d["acq_date"])
    d["year"] = dt.dt.year.astype(np.int16)
    d["month"] = dt.dt.month.astype(np.int8)
    d["dayindex"] = (dt - pd.Timestamp("2000-01-01")).dt.days.astype(np.int32)
    d["day"] = d["daynight"] == "D"
    d["sat"] = d["satellite"].astype(str)
    return d.drop(columns=["acq_date", "daynight", "satellite"])


def outages(d, min_expected=10.0):
    """Copy of analysis/common.outages (statistical zero-day detection per satellite)."""
    cnt = d.groupby(["dayindex", "sat"]).size().unstack(fill_value=0)
    full = np.arange(d.dayindex.min(), d.dayindex.max() + 1)
    cnt = cnt.reindex(full, fill_value=0)
    month = (pd.Timestamp("2000-01-01") + pd.to_timedelta(full, unit="D")).month
    sats = ["Terra", "Aqua", "N"]
    span = {s: (d.loc[d.sat == s, "dayindex"].min(), d.loc[d.sat == s, "dayindex"].max()) for s in sats}
    insp = {s: (full >= span[s][0]) & (full <= span[s][1]) for s in sats}
    res = {}
    for s in sats:
        others = [o for o in sats if o != s]
        ref = sum(np.where(insp[o], cnt[o].values, 0) for o in others)
        both = insp[s] & (cnt[s].values > 0) & (ref > 0)
        ratio = pd.Series(cnt[s].values[both]).groupby(month[both]).sum() / pd.Series(ref[both]).groupby(month[both]).sum()
        expected = ref * pd.Series(month).map(ratio).fillna(ratio.mean()).values
        zero = cnt[s].values == 0
        out = (zero & (expected >= min_expected)) | ~insp[s]
        run_id = np.cumsum(~zero)
        flagged = set(run_id[out & zero])
        out |= zero & np.isin(run_id, list(flagged))
        res[s] = full[out]
    return res, span


def sample_tile(f, lat, lon, want_tree):
    """Centre class and tree fraction for points in one tile. Raises on any read failure."""
    n = len(lat)
    lc = np.full(n, 255, np.uint8)
    tf = np.full(n, np.nan, np.float32)
    with rasterio.open(f) as ds:
        rows, cols = rasterio.transform.rowcol(ds.transform, lon, lat)
        rows, cols = np.asarray(rows), np.asarray(cols)
        ok = (rows >= 0) & (rows < ds.height) & (cols >= 0) & (cols < ds.width)
        idx = np.where(ok)[0]
        b = rows[idx] // BAND
        for bb in np.unique(b):
            k = idx[b == bb]
            r0 = int(bb) * BAND
            top = max(0, r0 - HALF)
            bot = min(ds.height, r0 + BAND + HALF + 1)
            arr = ds.read(1, window=Window(0, top, ds.width, bot - top))
            rr, cc = rows[k] - top, cols[k]
            lc[k] = arr[rr, cc]
            tk = k[want_tree[k]]
            if len(tk):
                rr, cc = rows[tk] - top, cols[tk]
                # integral images of tree pixels and of valid (non-nodata) pixels
                def integ(mask):
                    s = np.zeros((mask.shape[0] + 1, mask.shape[1] + 1), np.int32)
                    np.cumsum(np.cumsum(mask, 0, dtype=np.int32), 1, out=s[1:, 1:])
                    return s
                St = integ(arr == 10)
                Sv = integ(arr != 0)
                del arr
                a0 = np.clip(rr - HALF, 0, St.shape[0] - 1); a1 = np.clip(rr + HALF + 1, 0, St.shape[0] - 1)
                c0 = np.clip(cc - HALF, 0, St.shape[1] - 1); c1 = np.clip(cc + HALF + 1, 0, St.shape[1] - 1)
                box = lambda S: S[a1, c1] - S[a0, c1] - S[a1, c0] + S[a0, c0]
                nv = box(Sv)
                tf[tk] = np.where(nv > 0, box(St) / np.maximum(nv, 1), np.nan)
                del St, Sv
    return lc, tf


def label(d, want_tree, used):
    lc = np.full(len(d), 255, np.uint8)
    tf = np.full(len(d), np.nan, np.float32)
    lat, lon = d.latitude.values, d.longitude.values
    tl = (np.floor(lat / 3) * 3).astype(int)
    tn = (np.floor(lon / 3) * 3).astype(int)
    for name in WHITELIST:
        la, lo = int(name[1:3]), int(name[4:7])
        f = TILES / f"ESA_WorldCover_10m_2021_v200_{name}_Map.tif"
        sel = np.where((tl == la) & (tn == lo))[0]
        if len(sel) == 0:
            continue
        if not f.exists() or used.get(name) is False:
            used[name] = False
            continue
        t0 = time.time()
        try:
            a, b = sample_tile(f, lat[sel], lon[sel], want_tree[sel])
        except Exception as e:  # incomplete / corrupt tile: skip entirely
            print("SKIP tile", name, type(e).__name__, str(e)[:120])
            used[name] = False
            continue
        lc[sel], tf[sel] = a, b
        used[name] = True
        print(f"  {name}: {len(sel)} pts, {time.time() - t0:.0f}s", flush=True)
    return lc, tf


def main():
    v = read("viirs-snpp_*_Turkey.csv")
    m = read("modis_*_Turkey.csv")
    allp = pd.concat([v[["dayindex", "sat"]], m[["dayindex", "sat"]]], ignore_index=True)
    out, span = outages(allp)
    od = pd.DataFrame([(s, int(x)) for s in out for x in out[s]], columns=["sat", "dayindex"])
    od.to_csv(CACHE / "outage_days.csv", index=False)
    keys = static_mask_keys(v)
    print("VIIRS raw", len(v), "MODIS raw", len(m), "mask cells", len(keys))
    v = v[~v.type.isin([1, 3])]
    m = m[~m.type.isin([1, 3])]
    v = v[~on_static(v, keys)].reset_index(drop=True)
    m = m[~on_static(m, keys)].reset_index(drop=True)
    print("masked VIIRS", len(v), "MODIS", len(m))
    used = {}
    print("VIIRS labelling")
    v["lc"], v["tree1km"] = label(v, np.ones(len(v), bool), used)
    print("MODIS labelling")
    m["lc"], _ = label(m, np.zeros(len(m), bool), used)
    for name, okk in used.items():  # a tile that failed in either pass is dropped from both
        if not okk:
            la, lo = int(name[1:3]), int(name[4:7])
            for d in (v, m):
                s = (np.floor(d.latitude / 3) * 3 == la) & (np.floor(d.longitude / 3) * 3 == lo)
                d.loc[s, "lc"] = 255
                if "tree1km" in d:
                    d.loc[s, "tree1km"] = np.nan
    print("tiles used:", {k: x for k, x in used.items()})
    pd.Series(used).to_csv(CACHE / "tiles_used.csv")
    v.to_pickle(CACHE / "viirs.pkl")
    m.to_pickle(CACHE / "modis.pkl")


if __name__ == "__main__":
    main()
