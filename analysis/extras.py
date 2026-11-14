"""Step 5: targeted analyses of the MODIS-VIIRS relationship (writes out/extras.json).

1. additive problem: how much target-sensor activity falls in (box, period) cells where the other sensor saw 0
2. size / intensity dependence: log-log slope, ratio by activity level, by MODIS FRP per detection, by mean scan
3. day vs night ratios by month
4. spatial heterogeneity of the ratio (1 deg boxes): spread and split-half stability
5. measure comparison incl. non-additive measures (cd01, cd50, 1-deg fire-days): LOYO seasonal-ratio error
"""
import json
import numpy as np
import pandas as pd
from build import build
from harmonize import Ctx, YEARS_ALL, point_metrics
from common import OUT, spearman

R = {}
B = build("nostatic")

# --------------------------------------------------------------------- 1. additive problem
add = {}
for d in ["m2v", "v2m"]:
    for meas in ["cd05", "n"]:
        for res in ["p8", "month", "year"]:
            ctx = Ctx(B, d, meas, res)
            for sc, T in ctx.TT.items():
                T = T[T.valid]
                Y, X = T.Y.values, T.X.values
                add[f"{d}_{meas}_{res}_{sc}"] = {
                    "share_of_Y_where_X0": round(float(Y[X == 0].sum() / Y.sum()), 4),
                    "share_rows_X0_Ypos": round(float(np.mean((X == 0) & (Y > 0))), 4),
                    "share_rows_Xpos_Y0": round(float(np.mean((X > 0) & (Y == 0))), 4),
                    "share_rows_both0": round(float(np.mean((X == 0) & (Y == 0))), 4),
                    "share_of_X_where_Y0": round(float(X[Y == 0].sum() / max(X.sum(), 1)), 4)}
R["additive_problem"] = add
print("additive m2v cd05:", {k: v["share_of_Y_where_X0"] for k, v in add.items() if k.startswith("m2v_cd05")})

# --------------------------------------------------------------------- 2. size / intensity dependence
size = {}
for res in ["p8", "month", "year"]:
    ctx = Ctx(B, "m2v", "cd05", res)
    for sc, T in ctx.TT.items():
        T = T[T.valid & (T.X > 0) & (T.Y > 0)]
        if len(T) < 20:
            continue
        b = np.polyfit(np.log(T.X.values), np.log(T.Y.values), 1)
        size[f"loglog_slope_{res}_{sc}"] = round(float(b[0]), 3)
ctx = Ctx(B, "m2v", "cd05", "month")
for sc in ["b25", "b100", "country"]:
    T = ctx.TT[sc]; T = T[T.valid]
    bins = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000, np.inf]
    lab = pd.cut(T.X, bins, right=False)
    g = T.groupby(lab, observed=True).agg(sx=("X", "sum"), sy=("Y", "sum"), rows=("X", "size"))
    size[f"ratio_by_MODIS_level_month_{sc}"] = {str(k): {"ratio": round(r.sy / r.sx, 3) if r.sx else None, "rows": int(r.rows),
                                                     "VIIRS_sum": float(r.sy)} for k, r in g.iterrows()}
# FRP per detection and scan (MODIS side), b100 x month, rows with >= 5 MODIS cell-days
T = ctx.TT["b100"]; T = T[T.valid & (T.X >= 5)].copy()
T["frp_per_det"] = T.x_frp / T.x_n
T["scan_mean"] = T.x_scan / T.x_n
T["night_share"] = T.x_n_N / T.x_n
for f in ["frp_per_det", "scan_mean", "night_share"]:
    q = pd.qcut(T[f], 4, duplicates="drop")
    g = T.groupby(q, observed=True).agg(sx=("X", "sum"), sy=("Y", "sum"), rows=("X", "size"))
    size[f"ratio_by_{f}_quartile_b100_month"] = {str(k): round(r.sy / r.sx, 3) for k, r in g.iterrows()}
    # partial check: within the same activity level (X tercile), does the factor still matter?
    T["xl"] = pd.qcut(T.X, 3, labels=False, duplicates="drop")
    sub = {}
    for xl, gg in T.groupby("xl"):
        q2 = pd.qcut(gg[f].rank(method="first"), 3, labels=["low", "mid", "high"])
        h = gg.groupby(q2, observed=True).apply(lambda z: z.Y.sum() / z.X.sum())
        sub[f"Xtercile{xl}"] = {str(k): round(float(v), 3) for k, v in h.items()}
    size[f"ratio_by_{f}_within_X_tercile"] = sub
R["size_dependence"] = size
print("loglog slopes:", {k: v for k, v in size.items() if k.startswith("loglog")})

# --------------------------------------------------------------------- 3. day vs night
T = ctx.TT["country"]; T = T[T.valid]
dn = {}
for s in ["D", "N"]:
    g = T.groupby("season").agg(v=(f"V_cd05_{s}", "sum"), m=(f"M_cd05_{s}", "sum"))
    dn[s] = (g.v / g.m).round(2).to_dict()
dn["share_VIIRS_cd05_night"] = round(float(T.V_cd05_N.sum() / (T.V_cd05_D.sum() + T.V_cd05_N.sum())), 3)
dn["share_MODIS_cd05_night"] = round(float(T.M_cd05_N.sum() / (T.M_cd05_D.sum() + T.M_cd05_N.sum())), 3)
R["day_night_ratio_by_month"] = dn
print("day/night:", dn)

# --------------------------------------------------------------------- 4. spatial heterogeneity (1 deg)
T = ctx.TT["b100"]; T = T[T.valid]
g = T.groupby("box").agg(sx=("X", "sum"), sy=("Y", "sum"))
g = g[g.sx >= 100]
r = np.log(g.sy / g.sx)
h1 = T[T.year <= 2016].groupby("box").agg(sx=("X", "sum"), sy=("Y", "sum"))
h2 = T[(T.year >= 2017) & (T.year <= 2020)].groupby("box").agg(sx=("X", "sum"), sy=("Y", "sum"))
hh = h1.join(h2, lsuffix="1", rsuffix="2")
hh = hh[(hh.sx1 >= 50) & (hh.sx2 >= 50)]
R["spatial_ratio_b100"] = {"boxes": int(len(g)), "ratio_p10_p50_p90": [round(float(np.exp(q)), 2) for q in np.quantile(r, [.1, .5, .9])],
                           "split_half_corr_log_ratio": round(float(np.corrcoef(np.log(hh.sy1 / hh.sx1), np.log(hh.sy2 / hh.sx2))[0, 1]), 3),
                           "split_half_boxes": int(len(hh))}
print("spatial:", R["spatial_ratio_b100"])

# --------------------------------------------------------------------- 5. measure comparison incl. non-additive measures
ex = B["extra"]; ex = ex[ex.year.between(2012, 2025)]
base = B["base"]; base = base[base.year.between(2012, 2025)]
vd = B["valid"]
cal = pd.DataFrame({"date": pd.date_range("2012-01-01", "2025-12-31")})
tot = cal.groupby([cal.date.dt.year, cal.date.dt.month]).size()
nv = vd.groupby(["year", "month"]).size()
tot.index.names = ["year", "month"]
vfrac = (nv.reindex(tot.index).fillna(0) / tot)
good = set(vfrac[vfrac >= 0.75].index)


def loyo_seasonal(t, val):
    """t: rows with sensor, key..., year, month, value; returns metrics of LOYO seasonal ratio (MODIS->VIIRS)."""
    p = t.pivot_table(index=[c for c in t.columns if c not in ("sensor", val)], columns="sensor", values=val, aggfunc="sum").fillna(0).reset_index()
    p = p[[ (y, m) in good for y, m in zip(p.year, p.month)]]
    P = np.zeros(len(p))
    for y in YEARS_ALL:
        tr = p.year != y
        k = p[tr].groupby("month").apply(lambda g: g.VIIRS.sum() / max(g.MODIS.sum(), 1e-9))
        w = p.year == y
        P[w.values] = p.loc[w, "MODIS"].values * p.loc[w, "month"].map(k).values
    m = point_metrics(p.VIIRS.values, P)
    ann = p.assign(P=P).groupby("year")[["VIIRS", "MODIS"]].sum()
    m["annual_ratio_cv"] = float((ann.VIIRS / ann.MODIS).std() / (ann.VIIRS / ann.MODIS).mean())
    return {k: round(v, 4) if isinstance(v, float) else v for k, v in m.items() if k in ("bias", "wape", "pdev", "r_log", "annual_ratio_cv")}


mc = {}
for sc in ["country", "b100"]:
    for val, src in [("n", base), ("frp", base), ("cd05", base), ("cd25", base), ("cd01", ex), ("cd50", ex), ("fd", ex)]:
        t = src.copy()
        if src is base:
            t["Bi"] = t.bi // 4; t["Bj"] = t.bj // 4
        keys = ["sensor", "year", "month"] + (["Bi", "Bj"] if sc == "b100" else [])
        if val == "fd" and sc == "country":
            # country fire-days: days with >= 1 detection anywhere
            t = t.drop_duplicates(["sensor", "dayindex"]).assign(fd=1)
        g = t.groupby(keys)[val].sum().reset_index()
        mc[f"{sc}_month_{val}"] = loyo_seasonal(g, val)
R["measure_comparison_seasonal_loyo"] = mc
for k, v in mc.items():
    print(k, v)

json.dump(R, open(OUT / "extras.json", "w"), indent=1, default=str)
