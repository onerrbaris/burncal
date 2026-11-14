"""Step 4: homogeneity of the record.

(a) Is the VIIRS/MODIS relationship stable 2012-2025 or trending? (also per MODIS satellite)
(b) Terra-only (Nov 2000 - Jul 2002) vs Terra+Aqua: size of the step and a LOYO-tested correction.
(c) Does the Aqua/Terra ratio drift (orbit drift of both platforms)?
"""
import json
import numpy as np
import pandas as pd
from common import load, OUT, trend_test, spearman

R = {}
from build import filt
from common import outages
full = load()
OUTG = outages(full)
ALL = set(range(int(full.dayindex.min()), int(full.dayindex.max()) + 1))
d = filt(full, "nostatic")
DAY0 = pd.Timestamp("2000-01-01")


def measures(x, keys):
    """n, cd05, cd25 for grouping keys (list of column names)."""
    out = x.groupby(keys).size().rename("n").to_frame()
    out["cd05"] = x.drop_duplicates(["i05", "j05", "dayindex"]).groupby(keys).size()
    x25 = x.assign(i25=x.i05 // 5, j25=x.j05 // 5)
    out["cd25"] = x25.drop_duplicates(["i25", "j25", "dayindex"]).groupby(keys).size()
    out["frp"] = x.groupby(keys).frp.sum()
    return out.fillna(0)


# ---------------------------------------------------------------- (a) ratio trend
vd = ALL - OUTG["Terra"] - OUTG["Aqua"] - OUTG["N"]
x = d[d.dayindex.isin(vd) & (d.year >= 2012)]
x = x.assign(season=np.where(x.month.isin([6, 7, 8, 9, 10]), "JJASO", "NDJFMAM"))
trend = {}
for label, sub_m in [("MODIS_TA", x[x.sensor == "MODIS"]), ("Terra", x[x.sat == "Terra"]), ("Aqua", x[x.sat == "Aqua"])]:
    mv = measures(x[x.sensor == "VIIRS"], ["year"])
    mm = measures(sub_m, ["year"])
    for m in ["n", "cd05", "cd25", "frp"]:
        r = (mv[m] / mm[m])
        sl, p = trend_test(r.index.values, r.values)
        trend[f"{label}_{m}"] = {"ratio_by_year": r.round(3).to_dict(),
                                 "slope_pct_per_year": round(sl, 2),
                                 "p_perm": round(p, 4), "spearman": round(spearman(r.index, r.values), 3),
                                 "cv_pct": round(100 * r.std() / r.mean(), 1)}
    for s in ["JJASO", "NDJFMAM"]:
        mv = measures(x[(x.sensor == "VIIRS") & (x.season == s)], ["year"])
        mm = measures(sub_m[sub_m.season == s], ["year"])
        r = mv["cd05"] / mm["cd05"]
        sl, p = trend_test(r.index.values, r.values)
        trend[f"{label}_cd05_{s}"] = {"ratio_by_year": r.round(3).to_dict(), "slope_pct_per_year": round(sl, 2), "p_perm": round(p, 4)}
R["ratio_trend"] = trend
for k, v in trend.items():
    print(k, v.get("slope_pct_per_year"), v.get("p_perm"), v.get("cv_pct"), v["ratio_by_year"])

# ---------------------------------------------------------------- (c) Aqua/Terra drift
vta = ALL - OUTG["Terra"] - OUTG["Aqua"]
y = d[(d.sensor == "MODIS") & d.dayindex.isin(vta) & (d.year >= 2003)]
yall = y
mt = measures(y[y.sat == "Terra"], ["year"]); ma = measures(y[y.sat == "Aqua"], ["year"])
mta = measures(y, ["year"])
at = {}
for m in ["n", "cd05", "cd25"]:
    r = ma[m] / mt[m]
    s1, p1 = trend_test(r.index.values, r.values)
    s2, p2 = trend_test(r.loc[2003:2020].index.values, r.loc[2003:2020].values)
    at[m] = {"aqua_over_terra": r.round(3).to_dict(), "slope_pct_per_year_all": round(s1, 2),
             "p_all": round(p1, 4), "slope_2003_2020": round(s2, 2), "p_2003_2020": round(p2, 4),
             "mean_2003_2020": round(float(r.loc[2003:2020].mean()), 3), "mean_2022_2025": round(float(r.loc[2022:2025].mean()), 3),
             "TA_over_Terra": (mta[m] / mt[m]).round(3).to_dict()}
R["aqua_terra"] = at
print("Aqua/Terra cd05", at["cd05"]["aqua_over_terra"])
print("TA/Terra cd05", at["cd05"]["TA_over_Terra"])

# ---------------------------------------------------------------- (b) Terra-only correction, LOYO 2003-2025
# Tables at 0.25 deg box x month and x p8 ; TA (Terra+Aqua union) vs T (Terra only)
from harmonize import point_metrics


NOMINAL = np.arange(2003, 2021)


def box_tables(res):
    keys = ["bi", "bj", "year", res]
    y = yall[yall.year <= 2020]
    yy = y.assign(bi=y.i05 // 5, bj=y.j05 // 5)
    T = measures(yy[yy.sat == "Terra"], keys).add_prefix("T_")
    TA = measures(yy, keys).add_prefix("A_")
    t = TA.join(T, how="outer").fillna(0).reset_index().rename(columns={res: "slot"})
    boxes = t[["bi", "bj"]].drop_duplicates()
    yrs = NOMINAL
    slots = np.arange(1, 47) if res == "p8" else np.arange(1, 13)
    g = boxes.merge(pd.DataFrame({"year": yrs}), how="cross").merge(pd.DataFrame({"slot": slots}), how="cross")
    t = g.merge(t, how="left", on=["bi", "bj", "year", "slot"]).fillna(0)
    t["season"] = t.slot if res == "month" else (DAY0 + pd.to_timedelta((t.slot - 1) * 8 + 3, unit="D")).dt.month
    return t


corr = {}
for res in ["p8", "month"]:
    t = box_tables(res)
    for m in ["n", "cd05", "cd25"]:
        P = np.zeros(len(t)); P0 = t[f"T_{m}"].values.astype(float)
        ks_all = {}
        for yr in NOMINAL:
            tr = t.year != yr
            ks = t[tr].groupby("season").apply(lambda g: g[f"A_{m}"].sum() / max(g[f"T_{m}"].sum(), 1))
            ks_all[yr] = ks
            w = t.year == yr
            P[w.values] = t.loc[w, f"T_{m}"].values * t.loc[w, "season"].map(ks).values
        for sc, key in [("country", None), ("b100", "b100"), ("b25", "b25")]:
            tt = t.assign(P=P, P0=P0, b100=(t.bi // 4) * 10000 + t.bj // 4, b25=t.bi * 10000 + t.bj)
            gk = (["year", "slot"] if key is None else [key, "year", "slot"])
            a = tt.groupby(gk)[[f"A_{m}", "P", "P0"]].sum()
            corr[f"{res}_{m}_{sc}_seasonal"] = point_metrics(a[f"A_{m}"].values, a.P.values)
            corr[f"{res}_{m}_{sc}_none"] = point_metrics(a[f"A_{m}"].values, a.P0.values)
            ann = tt.groupby(([] if key is None else [key]) + ["year"])[[f"A_{m}", "P", "P0"]].sum()
            corr[f"year_{m}_{sc}_seasonal_from{res}"] = point_metrics(ann[f"A_{m}"].values, ann.P.values)
        full_k = t.groupby("season").apply(lambda g: g[f"A_{m}"].sum() / max(g[f"T_{m}"].sum(), 1))
        early = t[t.year <= 2011].groupby("season").apply(lambda g: g[f"A_{m}"].sum() / max(g[f"T_{m}"].sum(), 1))
        corr[f"{res}_{m}_k_by_season_2003_2020"] = full_k.round(3).to_dict()
        corr[f"{res}_{m}_k_by_season_2003_2011"] = early.round(3).to_dict()
R["terra_only_correction"] = corr
for k, v in corr.items():
    if "cd05" in k and isinstance(v, dict) and "wape" in v:
        print(k, round(v["bias"], 3), round(v["wape"], 3), round(v.get("r_log", np.nan), 3))

# Terra-only era: what fraction of the 2000-11..2002-07 period is valid, Aqua start
R["aqua_first_day"] = str(full.loc[full.sat == "Aqua", "date"].min().date())
R["terra_first_day"] = str(full.loc[full.sat == "Terra", "date"].min().date())
json.dump(R, open(OUT / "era.json", "w"), indent=1, default=str)
