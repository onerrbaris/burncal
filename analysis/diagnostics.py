"""Step 1: data diagnostics (record homogeneity, filters, static sources, outages, drift).

Writes analysis/out/diagnostics.json and prints a human readable summary.
"""
import json
import numpy as np
import pandas as pd
from common import load, OUT, cell

R = {}


def say(k, v):
    R[k] = v
    print(f"{k}: {v}")


d = load()
M = d[d.sensor == "MODIS"]
V = d[d.sensor == "VIIRS"]
say("rows_modis", int(len(M)))
say("rows_viirs", int(len(V)))
say("modis_first_last", [str(M.date.min().date()), str(M.date.max().date())])
say("viirs_first_last", [str(V.date.min().date()), str(V.date.max().date())])
say("version_counts", {s: d[d.sensor == s].version.value_counts().to_dict() for s in ["MODIS", "VIIRS"]})
say("type_counts", {s: d[d.sensor == s].type.value_counts(dropna=False).to_dict() for s in ["MODIS", "VIIRS"]})
say("sat_counts", {s: d[d.sensor == s].sat.value_counts().to_dict() for s in ["MODIS", "VIIRS"]})
# version by year (NRT vs standard)
vy = d.groupby(["sensor", "year", "version"], observed=True).size().unstack(fill_value=0)
say("version_by_year", {f"{a}_{b}": r[r > 0].to_dict() for (a, b), r in vy.iterrows() if (r > 0).sum() > 1 or b >= 2024})

# ---- re-verify the 2021 observations -------------------------------------
def monthly(df, f):
    return df.groupby("month").apply(f)

y21 = d[d.year == 2021]
m21, v21 = y21[y21.sensor == "MODIS"], y21[y21.sensor == "VIIRS"]
cnt = (v21.groupby("month").size() / m21.groupby("month").size())
i, j = cell(m21, 0.1); mc = pd.DataFrame({"m": m21.month.values, "i": i, "j": j, "t": m21.dayindex.values}).drop_duplicates().groupby("m").size()
i, j = cell(v21, 0.1); vc = pd.DataFrame({"m": v21.month.values, "i": i, "j": j, "t": v21.dayindex.values}).drop_duplicates().groupby("m").size()
frp = v21.groupby("month").frp.sum() / m21.groupby("month").frp.sum()
say("2021_count_ratio_by_month", cnt.round(2).to_dict())
say("2021_count_ratio_annual", round(len(v21) / len(m21), 2))
say("2021_celldays01_ratio_by_month", (vc / mc).round(2).to_dict())
say("2021_frp_ratio_by_month", frp.round(2).to_dict())
say("2021_type2_share", {"VIIRS": round((v21.type == 2).mean(), 3), "MODIS": round((m21.type == 2).mean(), 3)})
say("2021_night_share", {"VIIRS": round((~v21.day).mean(), 3), "MODIS": round((~m21.day).mean(), 3)})

# ---- type 2: is it really persistent static sources? ---------------------
def persistence(df, g=0.01):
    # distinct days on which the same ~1 km location is detected, across the record
    key = pd.DataFrame({"i": np.floor(df.latitude * 100).astype(int), "j": np.floor(df.longitude * 100).astype(int),
                        "t": df.dayindex.values, "y": df.year.values})
    days = key.drop_duplicates(["i", "j", "t"]).groupby(["i", "j"]).agg(nd=("t", "size"), ny=("y", "nunique"))
    return days

out = {}
for s, df in [("MODIS", M), ("VIIRS", V)]:
    for t in [0, 2, 3]:
        sub = df[df.type == t]
        if len(sub) == 0:
            continue
        p = persistence(sub)
        # attach per-detection persistence (detection-weighted)
        k = pd.DataFrame({"i": np.floor(sub.latitude * 100).astype(int), "j": np.floor(sub.longitude * 100).astype(int)})
        w = k.merge(p, left_on=["i", "j"], right_index=True, how="left")
        out[f"{s}_type{t}"] = {"n": int(len(sub)),
                               "median_days_same_1km_loc": float(w.nd.median()),
                               "share_det_at_loc_seen_in_>=5_years": round(float((w.ny >= 5).mean()), 3),
                               "night_share": round(float((~sub.day).mean()), 3),
                               "n_locations": int(len(p))}
say("type_persistence", out)
# type-0 detections that sit on a type-2 location (leakage of static sources into type 0)
t2loc = set(zip(np.floor(V[V.type == 2].latitude * 100).astype(int), np.floor(V[V.type == 2].longitude * 100).astype(int)))
v0 = V[V.type == 0]
on2 = np.array([(a, b) in t2loc for a, b in zip(np.floor(v0.latitude * 100).astype(int), np.floor(v0.longitude * 100).astype(int))])
say("viirs_type0_share_on_type2_1km_locations", round(float(on2.mean()), 4))
# type 2 by year (does the static mask change over time?)
say("type2_share_by_year", {s: d[d.sensor == s].groupby("year").apply(lambda x: round((x.type == 2).mean(), 3)).to_dict() for s in ["MODIS", "VIIRS"]})
say("type_missing_by_year", {s: d[d.sensor == s].groupby("year").apply(lambda x: int(x.type.isna().sum())).to_dict() for s in ["MODIS", "VIIRS"]})

# ---- overpass time drift ---------------------------------------------------
drift = {}
for sat in ["Terra", "Aqua", "N"]:
    sub = d[(d.sat == sat)]
    for dn, flag in [("day", True), ("night", False)]:
        s2 = sub[sub.day == flag]
        # local solar time approx = UTC + lon/15
        lst = (s2.utc_h + s2.longitude / 15.0) % 24
        drift[f"{sat}_{dn}"] = lst.groupby(s2.year).median().round(2).to_dict()
say("median_local_solar_time_by_year", drift)

# ---- outages: days with zero detections of ANY type per satellite --------
# type-2 static sources make Turkey non-empty almost every day if the sensor is up.
out = {}
for sat in ["Terra", "Aqua", "N"]:
    sub = d[d.sat == sat]
    days = np.sort(sub.dayindex.unique())
    full = np.arange(days.min(), days.max() + 1)
    missing = np.setdiff1d(full, days)
    # runs of consecutive missing days
    runs = []
    if len(missing):
        start = prev = missing[0]
        for x in missing[1:]:
            if x == prev + 1:
                prev = x
                continue
            runs.append((start, prev)); start = prev = x
        runs.append((start, prev))
    base = pd.Timestamp("2000-01-01")
    long_runs = [(str((base + pd.Timedelta(days=int(a))).date()), int(b - a + 1)) for a, b in runs if b - a + 1 >= 4]
    out[sat] = {"days_span": int(len(full)), "days_without_any_detection": int(len(missing)),
                "runs_ge4days": long_runs}
say("gaps", out)

# ---- MODIS: Terra vs Aqua, by year ----------------------------------------
f = d[(d.sensor == "MODIS") & (d.type == 0)]
ta = f.groupby(["year", "sat"], observed=True).size().unstack(fill_value=0)
say("modis_type0_counts_by_year_sat", ta.to_dict())
say("aqua_over_terra_by_year", (ta["Aqua"] / ta["Terra"]).round(3).to_dict())
say("aqua_first_date", str(d[d.sat == "Aqua"].date.min().date()))

# ---- scan angle / pixel size -------------------------------------------------
say("modis_scan_quantiles", M.scan.quantile([.1, .5, .9, .99]).round(2).to_dict())
say("viirs_scan_quantiles", V.scan.quantile([.1, .5, .9, .99]).round(2).to_dict())
say("confidence_mix", {s: d[(d.sensor == s) & (d.type == 0)].conf.value_counts(normalize=True).round(3).to_dict() for s in ["MODIS", "VIIRS"]})

# ---- same-scene duplicates: multiple detections per 0.1 cell per overpass ----
for s, df in [("MODIS", M[M.type == 0]), ("VIIRS", V[V.type == 0])]:
    i, j = cell(df, 0.1)
    k = pd.DataFrame({"i": i, "j": j, "t": df.dayindex.values})
    say(f"{s}_detections_per_celldays01", round(len(k) / len(k.drop_duplicates()), 2))

json.dump(R, open(OUT / "diagnostics.json", "w"), indent=1, default=str)
