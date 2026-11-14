"""Load FIRMS Turkey CSVs, drop type 1/3, apply static mask (same recipe as analysis/common.py,
re-implemented here so that importing it does not create folders outside analysis/agri)."""
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
RAW = HERE.parents[1] / "data" / "raw"
CACHE = HERE / "cache"
CACHE.mkdir(exist_ok=True)
COLS = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "frp", "daynight", "type"]


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
    fr = [pd.read_csv(f, usecols=COLS, dtype={"acq_time": str, "confidence": str}) for f in sorted(RAW.glob(pattern))]
    d = pd.concat(fr, ignore_index=True)
    dt = pd.to_datetime(d["acq_date"])
    d["year"] = dt.dt.year.astype(np.int16)
    d["month"] = dt.dt.month.astype(np.int8)
    d["day"] = d["daynight"] == "D"
    return d.drop(columns=["acq_date", "acq_time", "daynight", "confidence"])


def main():
    v = read("viirs-snpp_*_Turkey.csv")
    m = read("modis_*_Turkey.csv")
    keys = static_mask_keys(v)
    print("VIIRS raw", len(v), "MODIS raw", len(m))
    v = v[~v.type.isin([1, 3])]
    m = m[~m.type.isin([1, 3])]
    print("after drop type1/3: VIIRS", len(v), "MODIS", len(m))
    v = v[~on_static(v, keys)].reset_index(drop=True)
    m = m[~on_static(m, keys)].reset_index(drop=True)
    print("MASKED VIIRS", len(v), "MODIS", len(m), "mask cells", len(keys))
    v.to_pickle(CACHE / "viirs.pkl")
    m.to_pickle(CACHE / "modis.pkl")


if __name__ == "__main__":
    main()
