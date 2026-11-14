"""Static-source mask and outage-day sensitivity (review items P0-B, P0-C, P1-H).

  python analysis/experiments/review_2026_11_14/run_mask.py
Writes: mask_variants.csv, mask_removed.csv, mask_fold_sizes.csv, outage_days.csv, outage_runs.csv
"""
import numpy as np
import pandas as pd
from lib import (HERE, EVI, MODELS, detections, valid_days, mask_keys, box_units, build, loyo, score, show)
from common import load, outages, on_static

d = detections()
valid = valid_days()
full = mask_keys(d)
day0_viirs = int((pd.Timestamp("2012-01-20") - pd.Timestamp("2000-01-01")).days)
alldays = np.arange(day0_viirs, d.dayindex.max() + 1)
MODS = ["reg12", "terra_aqua", "invarea_w"]

# ---------------------------------------------------------------- what the mask removes
rem = []
for name, keys in [("full, buffer 1 (baseline)", full), ("buffer 0", mask_keys(d, buffer=0)),
                   (">=5 type-2 days, buffer 1", mask_keys(d, min_days=5))]:
    on = on_static(d, keys)
    for sensor in ["VIIRS", "MODIS"]:
        for per, pm in [("2000-2011", d.year < 2012), ("2012-2025", d.year >= 2012)]:
            s = (d.sensor == sensor).values & pm.values
            if s.sum() == 0:
                continue
            t0 = s & (d.type == 0).values
            rem.append(dict(mask=name, cells=len(keys), sensor=sensor, period=per, detections=int(s.sum()),
                            removed=int((s & on).sum()), type0=int(t0.sum()), type0_removed=int((t0 & on).sum()),
                            type0_removed_share=(t0 & on).sum() / max(t0.sum(), 1)))
pd.DataFrame(rem).to_csv(HERE / "mask_removed.csv", index=False)
print("== removed by mask (all Turkey)"); show(pd.DataFrame(rem))

# ---------------------------------------------------------------- accuracy under each policy
rows, sizes = [], []
foldkeys = {int(y): mask_keys(d, exclude_year=2000 + int(y)) for y in EVI}
for y, k in foldkeys.items():
    sizes.append(dict(test_year=2000 + y, cells_without_that_year=len(k), cells_full=len(full),
                      share_of_full=len(k) / len(full)))
pd.DataFrame(sizes).to_csv(HERE / "mask_fold_sizes.csv", index=False)
print("\n== fold-specific mask size"); show(pd.DataFrame(sizes))

for reg in ["MED", "COAST"]:
    x, unit, NU, G = box_units(d, reg)
    G = {k: v for k, v in G.items() if k in ("R", "named5", "1")}
    variants = {
        "baseline: full-period mask, buffer 1": dict(D=build(x, unit, NU, valid, full)),
        "fold-specific mask (test year's labels unseen)": dict(
            D=None, Dfold={y: build(x, unit, NU, valid, k) for y, k in foldkeys.items()}),
        "no mask": dict(D=build(x, unit, NU, valid, None)),
        "drop rows labelled type 2 (no location mask)": dict(D=build(x, unit, NU, valid, None, drop_type2=True)),
        "mask buffer 0": dict(D=build(x, unit, NU, valid, mask_keys(d, buffer=0))),
        "mask >=5 type-2 days, buffer 1": dict(D=build(x, unit, NU, valid, mask_keys(d, min_days=5))),
        "baseline mask, outage days NOT removed": dict(D=build(x, unit, NU, alldays, full)),
    }
    for vn, v in variants.items():
        D = v["D"] if v["D"] is not None else v["Dfold"][12]
        Y, P = loyo(D, G, MODS, Dfold=v.get("Dfold"))
        for r in score(Y, P, region=reg, variant=vn):
            r["viirs_total"] = Y["R"].sum()
            rows.append(r)
        print(reg, vn, "done", flush=True)
df = pd.DataFrame(rows)
df.to_csv(HERE / "mask_variants.csv", index=False)
pv = df.pivot_table(index=["region", "variant", "viirs_total"], columns=["model", "scale", "tagg"], values="wape")
print("\n== WAPE by policy"); print(pv.loc[:, pv.columns.get_level_values(2).isin(["month", "year"])].round(3).to_string())
print(df[(df.model == "reg12") & (df.tagg == "year")].pivot_table(index=["region", "variant"], columns="scale", values="year_rank_rho").round(3).to_string())

# ---------------------------------------------------------------- outage days
a = load()
out = outages(a)
span = {s: (a.loc[a.sat == s, "dayindex"].min(), a.loc[a.sat == s, "dayindex"].max()) for s in ["Terra", "Aqua", "N"]}
D0 = pd.Timestamp("2000-01-01")
od, runs = [], []
for s in ["Terra", "Aqua", "N"]:
    days = np.array(sorted(k for k in out[s] if span[s][0] <= k <= span[s][1]))
    yrs = (D0 + pd.to_timedelta(days, unit="D")).year
    for y, n in pd.Series(1, index=yrs).groupby(level=0).sum().items():
        od.append(dict(sat=s, year=int(y), outage_days=int(n)))
    if len(days):
        brk = np.r_[0, np.where(np.diff(days) > 1)[0] + 1, len(days)]
        for i in range(len(brk) - 1):
            seg = days[brk[i]:brk[i + 1]]
            runs.append(dict(sat=s, start=str((D0 + pd.Timedelta(days=int(seg[0]))).date()), days=len(seg)))
od = pd.DataFrame(od); runs = pd.DataFrame(runs)
od.to_csv(HERE / "outage_days.csv", index=False); runs.to_csv(HERE / "outage_runs.csv", index=False)
print("\n== outage days per satellite and year (inside mission span)")
print(od.pivot_table(index="year", columns="sat", values="outage_days", fill_value=0).astype(int).to_string())
print("\n== run-length distribution"); print(runs.groupby(["sat", "days"]).size().unstack(0, fill_value=0).to_string())
print("\n== runs >= 5 days"); show(runs[runs.days >= 5])
# share of detections lost to the common-valid-day rule, 2012+
z = d[(d.dayindex >= day0_viirs)]
lost = z.assign(lost=~z.dayindex.isin(valid).values).groupby(["sensor", "year"]).lost.mean().unstack(0)
lost.to_csv(HERE / "outage_lost_share.csv")
print("\n== share of detections on removed days"); print(lost.round(3).to_string())
mo = (D0 + pd.to_timedelta(np.setdiff1d(alldays, valid), unit="D"))
print("\n== removed days by calendar month (2012-2025):", pd.Series(1, index=mo.month).groupby(level=0).sum().to_dict())
