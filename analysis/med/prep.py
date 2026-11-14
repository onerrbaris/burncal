"""Prep: region detections -> 0.25 deg box x month arrays for the Mediterranean study.

Reuses the main study's recipe exactly: drop FIRMS type 1/3, fixed static-source mask
(common.static_mask_keys, by location), outage-free valid days (base_nostatic['valid']),
applied identically to both sensors. Output: analysis/med/cache/arrays.npz (sparse-ish, compressed).
Regions are boxes (no province polygons were used):
  MED   lon 29.0-37.0, lat 35.8-38.4
  AEG   lon 26.0-29.0, lat 36.5-39.5   (COAST = MED + AEG)
"""
import sys
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from common import load, CACHE, static_mask_keys, on_static  # noqa: E402

OUTC = HERE / "cache"
OUTC.mkdir(exist_ok=True)


def main():
    d = load()
    valid = pd.read_pickle(CACHE / "base_nostatic.pkl")["valid"].dayindex.values
    keys = static_mask_keys(d)
    lat, lon = d.latitude.values, d.longitude.values
    med = (lon >= 29) & (lon < 37) & (lat >= 35.8) & (lat < 38.4)
    aeg = (lon >= 26) & (lon < 29) & (lat >= 36.5) & (lat < 39.5)
    m = (med | aeg) & ~d.type.isin([1, 3]).values & d.dayindex.isin(valid).values
    x = d[m].copy()
    x = x[~on_static(x, keys)]
    x["reg"] = np.where(x.longitude.values >= 29, 0, 1)  # 0 MED, 1 AEG
    x["i25"] = x.i05 // 5
    x["j25"] = x.j05 // 5
    x["t"] = (x.year.astype(int) - 2000) * 12 + x.month.astype(int) - 1
    print("detections in COAST after recipe:", len(x), x.groupby(["sensor", "reg"]).size().to_dict())
    boxes = x[["i25", "j25", "reg"]].drop_duplicates().sort_values(["i25", "j25"]).reset_index(drop=True)
    boxes["b"] = np.arange(len(boxes))
    x = x.merge(boxes, on=["i25", "j25", "reg"])
    NB, NT = len(boxes), 26 * 12
    sat = x.sat.astype(str).values
    isV = (x.sensor == "VIIRS").values
    defs = {
        "V": isV, "V_day": isV & x.day.values,
        "M": ~isV, "T": sat == "Terra", "A": sat == "Aqua",
        "M_day": ~isV & x.day.values, "M_nolow": ~isV & (x.conf != "l").values,
        "M_hi": ~isV & (x.conf == "h").values,
    }
    arr = {}
    for k, msk in defs.items():
        a = np.zeros((NB, NT))
        np.add.at(a, (x.b.values[msk], x.t.values[msk]), 1.0)
        arr[k] = a
    # area-weighted MODIS (pixel footprint scan*track, km^2) and FRP sums
    for k, msk, w in [("M_area", ~isV, (x.scan * x.track).values),
                      ("M_invarea", ~isV, 1.0 / (x.scan * x.track).values),
                      ("V_frp", isV, x.frp.values), ("M_frp", ~isV, x.frp.values)]:
        a = np.zeros((NB, NT))
        np.add.at(a, (x.b.values[msk], x.t.values[msk]), w[msk])
        arr[k] = a
    # valid days per month (for info)
    vd = pd.Series(1, index=valid)
    dt = pd.Timestamp("2000-01-01") + pd.to_timedelta(valid, unit="D")
    nvalid = np.zeros(NT)
    np.add.at(nvalid, (dt.year.values - 2000) * 12 + dt.month.values - 1, 1)
    np.savez_compressed(OUTC / "arrays.npz", i25=boxes.i25.values, j25=boxes.j25.values,
                        reg=boxes.reg.values, nvalid=nvalid, **arr)
    # national monthly V and M totals for the national-factor comparison (LOYO refit)
    b = pd.read_pickle(CACHE / "base_nostatic.pkl")["base"]
    nat = b.groupby(["sensor", "year", "month"]).n.sum().unstack(0).fillna(0).reset_index()
    nat.to_csv(HERE / "national_monthly.csv", index=False)
    # detection-level extract for the events table (small)
    ev = x[(x.year >= 2012)][["sensor", "sat", "latitude", "longitude", "year", "month", "frp", "reg", "b"]]
    ev.to_csv(OUTC / "det_region_2012_2025.csv.gz", index=False)
    print("boxes", NB, "MED", int((boxes.reg == 0).sum()), "AEG", int((boxes.reg == 1).sum()))


if __name__ == "__main__":
    main()
