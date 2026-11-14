r"""Checks the current-year files written by scripts/fetch_firms_recent.py (no model, no frontend).

    .venv\Scripts\python.exe scripts/check_recent.py [--year 2026]

Per file: rows by month and data source (SP/NRT), duplicates, missing `type`, satellites, days with
zero detections, share of rows inside Turkey (geoBoundaries ADM1; the API box also covers neighbours).
Then: Turkey-only monthly counts of the year next to the previous year (archive file), and the
NOAA-20 / NOAA-21 to S-NPP daily ratio on days all report (information for a later transition study;
NOAA data is not used by the harmonized series).
Writes data/raw/recent_check_{year}.json and prints a summary.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
ap = argparse.ArgumentParser()
ap.add_argument("--year", type=int, default=2026)
Y = ap.parse_args().year

gb = json.loads((RAW / "boundaries/TUR-ADM1.geojson").read_text(encoding="utf-8"))["features"]
TR = shapely.union_all([shape(f["geometry"]) for f in gb]).buffer(0.05)   # same 0.05 deg coastal tolerance
shapely.prepare(TR)


def inside(d):
    return shapely.contains_xy(TR, d.longitude.values, d.latitude.values)


out, frames = {}, {}
for name in ["modis", "viirs-snpp", "viirs-noaa20", "viirs-noaa21"]:
    f = RAW / f"{name}_{Y}_Turkey.csv"
    if not f.exists():
        out[name] = "missing"
        continue
    d = pd.read_csv(f, dtype={"satellite": str, "type": "Int64", "data_source": str})
    d["date"] = pd.to_datetime(d.acq_date)
    d["tr"] = inside(d)
    dup = int(d.duplicated(["latitude", "longitude", "acq_date", "acq_time", "satellite"]).sum())
    days = pd.date_range(d.date.min(), d.date.max())
    tr = d[d.tr]
    zero = sorted(set(days.strftime("%Y-%m-%d")) - set(tr.acq_date))
    by = tr.groupby([tr.date.dt.strftime("%Y-%m"), "data_source"]).size()
    out[name] = {
        "rows": len(d), "rows_in_turkey": int(d.tr.sum()), "duplicates": dup,
        "first": str(d.date.min().date()), "last": str(d.date.max().date()),
        "type_missing_by_source": d.groupby("data_source")["type"].apply(lambda s: int(s.isna().sum())).to_dict(),
        "type_counts_SP": {str(k): int(v) for k, v in d[d.data_source == "SP"].type.value_counts().sort_index().items()},
        "satellites": d.satellite.value_counts().to_dict(),
        "sp_nrt_switch": str(d[d.data_source == "NRT"].date.min().date()) if (d.data_source == "NRT").any() else None,
        "turkey_rows_by_month_source": {f"{m} {s}": int(n) for (m, s), n in by.items()},
        "turkey_zero_days": zero,
    }
    frames[name] = tr

# previous year (archive, already Turkey-only) next to this year, Turkey rows, per month
cmp = {}
for name in ["modis", "viirs-snpp"]:
    prev = RAW / f"{name}_{Y - 1}_Turkey.csv"
    if name in frames and prev.exists():
        p = pd.read_csv(prev, usecols=["acq_date"])
        a = pd.to_datetime(p.acq_date).dt.month.value_counts().sort_index()
        b = frames[name].date.dt.month.value_counts().sort_index()
        cmp[name] = {int(m): [int(a.get(m, 0)), int(b.get(m, 0))] for m in range(1, 13)}
out["monthly_prev_vs_this"] = cmp

# NOAA-20/21 vs S-NPP daily counts in Turkey, on days where both have detections
ratios = {}
if "viirs-snpp" in frames:
    s = frames["viirs-snpp"].groupby("acq_date").size()
    for name in ["viirs-noaa20", "viirs-noaa21"]:
        if name in frames:
            n = frames[name].groupby("acq_date").size()
            j = pd.concat([s, n], axis=1, keys=["snpp", "noaa"]).dropna()
            ratios[name] = {"days": len(j), "sum_ratio_noaa_over_snpp": round(float(j.noaa.sum() / j.snpp.sum()), 3),
                            "median_daily_ratio": round(float((j.noaa / j.snpp).median()), 3)}
out["noaa_vs_snpp"] = ratios

(RAW / f"recent_check_{Y}.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
for k, v in out.items():
    if isinstance(v, dict) and "rows" in v:
        print(f"{k:13s} rows={v['rows']:6d} TR={v['rows_in_turkey']:6d} dup={v['duplicates']} {v['first']}..{v['last']} "
              f"SP->NRT {v['sp_nrt_switch']} type_missing={v['type_missing_by_source']} zero_days={len(v['turkey_zero_days'])} sats={v['satellites']}")
    else:
        print(k, v if not isinstance(v, dict) else "")
for name, m in cmp.items():
    print(f"\n{name} month: {Y - 1} vs {Y} (Turkey)")
    print("  " + "  ".join(f"{k}:{a}/{b}" for k, (a, b) in m.items()))
print("\nNOAA vs S-NPP:", ratios)
