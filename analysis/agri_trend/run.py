"""Cropland-burning trend test (A), forest-fire series (B), cropland burning next to forest (C).
Run after prep.py:  analysis\\agri\\.venv\\Scripts\\python.exe -I -W ignore analysis\\agri_trend\\run.py
Writes CSVs into analysis/agri_trend/out/."""
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)

v = pd.read_pickle(CACHE / "viirs.pkl")
m = pd.read_pickle(CACHE / "modis.pkl")
v = v[v.year.between(2012, 2025) & (v.lc != 255)].reset_index(drop=True)
m = m[m.year.between(2003, 2025) & (m.lc != 255)].reset_index(drop=True)
od = pd.read_csv(CACHE / "outage_days.csv")
OUTG = {s: set(od.dayindex[od.sat == s]) for s in ["Terra", "Aqua", "N"]}
N0 = int(v.dayindex.min())  # first S-NPP day in data
bad_any = OUTG["Terra"] | OUTG["Aqua"] | OUTG["N"]
v["valid"] = ~v.dayindex.isin(bad_any)
m["valid"] = ~m.dayindex.isin(bad_any)
m["n_out"] = m.dayindex.isin(OUTG["N"]) & (m.dayindex >= N0 - 30)  # S-NPP outage days (incl. Jan 2012 before start)

REG = {"Covered": None, "Southeast": (37.0, 42.0, 36.6, 38.2), "Cukurova": (34.5, 36.5, 36.5, 37.6),
       "Konya": (31.5, 34.5, 37.3, 39.0), "AntMugla": (27.5, 32.5, 36.0, 37.5), "Eskisehir": (30.0, 32.2, 39.0, 40.2)}
OV = list(range(2012, 2026))
YM, YV = list(range(2003, 2026)), OV
MON = list(range(1, 13))


def inbox(d, b):
    if b is None:
        return np.ones(len(d), bool)
    a, bb, c, e = b
    return ((d.longitude >= a) & (d.longitude < bb) & (d.latitude >= c) & (d.latitude < e)).values


def pv(d, years):
    return d.groupby(["year", "month"]).size().unstack(fill_value=0).reindex(index=years, columns=MON, fill_value=0).astype(float)


def factor(Vv, Mv, years):
    return Vv.loc[years].sum() / Mv.loc[years].sum().replace(0, np.nan)


def loyo(Vv, Mv, Mv_apply=None, Vv_obs=None):
    """Leave-one-year-out on the overlap. Factor fitted on (Vv, Mv); applied to Mv_apply (default Mv)
    and compared with Vv_obs (default Vv). Returns monthly/annual WAPE and bias in %."""
    Mv_apply = Mv if Mv_apply is None else Mv_apply
    Vv_obs = Vv if Vv_obs is None else Vv_obs
    P = []
    for y in OV:
        f = factor(Vv, Mv, [x for x in OV if x != y]).fillna(0)
        P.append(Mv_apply.loc[y] * f)
    P = pd.DataFrame(P, index=OV)
    O = Vv_obs.loc[OV]
    tot = O.values.sum()
    return dict(wape_m=100 * np.abs(P - O).values.sum() / tot, wape_a=100 * np.abs(P.sum(1) - O.sum(1)).sum() / tot,
                bias=100 * (P.values.sum() - tot) / tot)


def trend(s, years=None):
    s = s.dropna()
    if years is not None:
        s = s.loc[[y for y in years if y in s.index]]
    x, y = np.array(s.index, float), s.values
    sl = stats.theilslopes(y, x)[0]
    p = stats.kendalltau(x, y).pvalue
    return 100 * sl / y.mean(), p


def build(reg, vsel, msel, msat=None):
    """Monthly matrices for one region / subset. vsel, msel: boolean masks on v, m."""
    b = REG[reg]
    V = v[vsel & inbox(v, b)]
    M = m[msel & inbox(m, b)]
    if msat:
        M = M[M.sat.isin(msat)]
    Vall, Mall = pv(V, YV), pv(M, YM)
    Vv, Mv = pv(V[V.valid], YV), pv(M[M.valid], YM)
    f = factor(Vv, Mv, OV).fillna(0)
    Mfill = pv(M[M.n_out], YV)  # MODIS on S-NPP outage days -> fill
    H = pd.concat([Mall.loc[2003:2011] * f, Vall])
    Vfill = Vall + Mfill * f
    return dict(V=Vall, M=Mall, H=H, Vfill=Vfill, f=f, Vv=Vv, Mv=Mv)


def stats_row(name, s, early, late):
    sl, p = trend(s)
    srt = s.sort_values()
    return dict(series=name, years=f"{s.index.min()}-{s.index.max()}", mean=round(s.mean()), slope_pct_yr=round(sl, 1),
                mk_p=round(p, 3), early_mean=round(s.loc[early[0]:early[1]].mean()), late_mean=round(s.loc[late[0]:late[1]].mean()),
                late_vs_early_pct=round(100 * (s.loc[late[0]:late[1]].mean() / s.loc[early[0]:early[1]].mean() - 1)),
                top3=",".join(map(str, srt.index[::-1][:3])), bottom3=",".join(map(str, srt.index[:3])))


# ------------------------------------------------------------------ A: cropland
crop_v, crop_m = (v.lc == 40).values, (m.lc == 40).values
tree_v, tree_m = (v.lc == 10).values, (m.lc == 10).values
all_v, all_m = np.ones(len(v), bool), np.ones(len(m), bool)

trows, frows, lrows, annual, robust = [], [], [], {}, []
for reg in REG:
    C = build(reg, crop_v, crop_m)
    A = build(reg, all_v, all_m)
    T = build(reg, tree_v, tree_m)
    # factor comparison
    for cls, X in (("crop", C), ("tree", T), ("all", A)):
        frows.append(dict(region=reg, cls=cls, **{str(k): round(x, 2) for k, x in X["f"].items()},
                          annual_ratio=round(X["Vv"].values.sum() / X["Mv"].values.sum(), 2)))
    # LOYO error: own-class factor vs all-classes factor
    for cls, X in (("crop", C), ("tree", T)):
        own = loyo(X["Vv"], X["Mv"])
        gen = loyo(A["Vv"], A["Mv"], Mv_apply=X["Mv"], Vv_obs=X["Vv"])
        lrows.append(dict(region=reg, cls=cls, factor="own-class", **{k: round(x, 1) for k, x in own.items()}))
        lrows.append(dict(region=reg, cls=cls, factor="all-classes", **{k: round(x, 1) for k, x in gen.items()}))
    sM, sV, sH = C["M"].sum(1), C["V"].sum(1), C["H"].sum(1)
    sVf = C["Vfill"].sum(1)
    annual[reg] = pd.DataFrame({"modis_only": sM, "viirs_only": sV, "harmonized": sH, "viirs_outage_filled": sVf})
    for nm, s, e, l in (("MODIS only", sM, (2003, 2010), (2018, 2025)), ("VIIRS only", sV, (2012, 2016), (2021, 2025)),
                        ("Harmonized", sH, (2003, 2010), (2018, 2025)), ("VIIRS outage-filled", sVf, (2012, 2016), (2021, 2025))):
        trows.append(dict(region=reg, **stats_row(nm, s, e, l)))
    # robustness
    Ter = build(reg, crop_v, crop_m, ["Terra"])["M"].sum(1)
    Aq = build(reg, crop_v, crop_m, ["Aqua"])["M"].sum(1)
    annual[reg]["modis_terra"], annual[reg]["modis_aqua"] = Ter, Aq
    rr = dict(region=reg)
    for nm, s in (("modis", sM), ("harm", sH), ("terra", Ter), ("aqua", Aq)):
        rr[f"{nm}_03_25"] = round(trend(s)[0], 1); rr[f"{nm}_03_25_p"] = round(trend(s)[1], 3)
        rr[f"{nm}_03_20"] = round(trend(s, range(2003, 2021))[0], 1); rr[f"{nm}_03_20_p"] = round(trend(s, range(2003, 2021))[1], 3)
    rr["viirs_12_20"] = round(trend(sV, range(2012, 2021))[0], 1); rr["viirs_12_20_p"] = round(trend(sV, range(2012, 2021))[1], 3)
    rr["viirs_no22_24"] = round(trend(sV.drop([2022, 2024]))[0], 1); rr["viirs_no22_24_p"] = round(trend(sV.drop([2022, 2024]))[1], 3)
    # MODIS/VIIRS ratio drift on cropland: annual V/M in 2012-2020 vs 2021-2025 (valid days)
    r = C["Vv"].sum(1) / C["Mv"].loc[OV].sum(1)
    rr["crop_V_over_M_12_20"] = round(r.loc[2012:2020].mean(), 2); rr["crop_V_over_M_21_25"] = round(r.loc[2021:2025].mean(), 2)
    robust.append(rr)
    pd.concat({"modis": C["M"], "viirs": C["V"], "harmonized": C["H"]}).to_csv(OUT / f"monthly_crop_{reg}.csv")

    # stubble-like: cropland + day + two peak months of VIIRS crop-day climatology
    cd_v = crop_v & v.day.values
    cd_m = crop_m & m.day.values
    clim = pv(v[cd_v & inbox(v, REG[reg])], YV)
    pk = list(clim.div(clim.sum(1).replace(0, np.nan), axis=0).mean().nlargest(2).index)
    S = build(reg, cd_v & v.month.isin(pk).values, cd_m & m.month.isin(pk).values)
    ls = loyo(S["Vv"], S["Mv"])
    for nm, s, e, l in (("Stubble MODIS", S["M"].sum(1), (2003, 2010), (2018, 2025)), ("Stubble VIIRS", S["V"].sum(1), (2012, 2016), (2021, 2025)),
                        ("Stubble harmonized", S["H"].sum(1), (2003, 2010), (2018, 2025))):
        row = dict(region=reg, **stats_row(f"{nm} (m{pk[0]},{pk[1]})", s, e, l))
        if "harm" in nm:
            row["loyo_wape_a"] = round(ls["wape_a"], 1)
        trows.append(row)
    annual[reg]["stubble_harmonized"] = S["H"].sum(1)
    annual[reg]["stubble_viirs"] = S["V"].sum(1)
    annual[reg]["stubble_modis"] = S["M"].sum(1)
    # B: tree cover harmonized
    annual[reg]["tree_harmonized"] = T["H"].sum(1)
    annual[reg]["tree_viirs"] = T["V"].sum(1)
    annual[reg]["tree_modis"] = T["M"].sum(1)
    annual[reg]["all_harmonized"] = A["H"].sum(1)

trend_t = pd.DataFrame(trows); trend_t.to_csv(OUT / "A_trend_stats.csv", index=False)
fac_t = pd.DataFrame(frows); fac_t.to_csv(OUT / "A_factors_by_class.csv", index=False)
loyo_t = pd.DataFrame(lrows); loyo_t.to_csv(OUT / "A_loyo_factor_error.csv", index=False)
rob_t = pd.DataFrame(robust); rob_t.to_csv(OUT / "A_robustness.csv", index=False)
ann = pd.concat(annual, names=["region", "year"]); ann.round(1).to_csv(OUT / "annual_series.csv")
print("== A trend stats\n", trend_t.to_string(index=False))
print("== factors\n", fac_t.to_string(index=False))
print("== LOYO\n", loyo_t.to_string(index=False))
print("== robustness\n", rob_t.T.to_string())

# ------------------------------------------------------------------ B: forest fires
brows = []
for reg in REG:
    s = ann.loc[reg, "tree_harmonized"]
    srt = s.sort_values(ascending=False)
    sl, p = trend(s)
    sl2, p2 = trend(s, range(2003, 2021))
    brows.append(dict(region=reg, mean=round(s.mean()), median=round(s.median()), top3=",".join(map(str, srt.index[:3])),
                      top3_vals=",".join(str(int(x)) for x in srt.values[:3]), top3_share_pct=round(100 * srt.values[:3].sum() / s.sum(), 1),
                      top1_share_pct=round(100 * srt.values[0] / s.sum(), 1), slope_pct_yr=round(sl, 1), mk_p=round(p, 3),
                      slope_03_20=round(sl2, 1), mk_p_03_20=round(p2, 3),
                      crop_share_of_harm_pct=round(100 * ann.loc[reg, "harmonized"].sum() / ann.loc[reg, "all_harmonized"].sum(), 1)))
bt = pd.DataFrame(brows); bt.to_csv(OUT / "B_forest_fire.csv", index=False)
print("== B\n", bt.to_string(index=False))
print(ann.xs("Covered")[["harmonized", "tree_harmonized"]].round(0).T.to_string())

# ------------------------------------------------------------------ C: cropland next to forest
c = v[crop_v & v.tree1km.notna().values].copy()
c["p8"] = np.minimum((pd.to_datetime("2000-01-01") + pd.to_timedelta(c.dayindex, unit="D")).dt.dayofyear.sub(1) // 8, 45) + 1
crow, mon, cells, yrs = [], {}, [], {}
for reg in REG:
    x = c[inbox(c, REG[reg])]
    e = x[x.tree1km >= 0.2]
    nt = v[tree_v & inbox(v, REG[reg])]
    crow.append(dict(region=reg, crop_n=len(x), edge10_pct=round(100 * (x.tree1km >= .1).mean(), 1), edge20_pct=round(100 * (x.tree1km >= .2).mean(), 1),
                     edge30_pct=round(100 * (x.tree1km >= .3).mean(), 1), edge20_per_yr=round(len(e) / 14),
                     edge20_day_pct=round(100 * e.day.mean(), 1), nonedge_day_pct=round(100 * x[x.tree1km < .2].day.mean(), 1),
                     edge20_med_frp=round(e.frp.median(), 1), nonedge_med_frp=round(x[x.tree1km < .2].frp.median(), 1),
                     tree_fire_per_yr=round(len(nt) / 14)))
    mon[(reg, "crop_all")] = x.groupby("month").size().reindex(MON, fill_value=0) / len(x) * 100
    mon[(reg, "crop_edge20")] = e.groupby("month").size().reindex(MON, fill_value=0) / max(len(e), 1) * 100
    mon[(reg, "tree_fires")] = nt.groupby("month").size().reindex(MON, fill_value=0) / max(len(nt), 1) * 100
    yrs[reg] = e.groupby("year").size().reindex(YV, fill_value=0)
    e = e.assign(ci=np.floor(e.latitude * 10).astype(int), cj=np.floor(e.longitude * 10).astype(int))
    g = e.groupby(["ci", "cj"])
    t = g.size().rename("n").to_frame()
    t["years_active"] = g.year.nunique()
    t["peak_month"] = g.month.agg(lambda s: s.value_counts().idxmax())
    t["peak_month_share_pct"] = g.month.agg(lambda s: round(100 * s.value_counts().iloc[0] / len(s)))
    t["peak_p8"] = g.p8.agg(lambda s: s.value_counts().idxmax())
    t["top_year_share_pct"] = g.year.agg(lambda s: round(100 * s.value_counts().iloc[0] / len(s)))
    t = t.sort_values("n", ascending=False).reset_index()
    # persistence: rank correlation of cell counts 2012-2018 vs 2019-2025 among cells with >=5 edge hotspots
    a = e[e.year <= 2018].groupby(["ci", "cj"]).size(); b_ = e[e.year >= 2019].groupby(["ci", "cj"]).size()
    j = pd.concat([a, b_], axis=1).fillna(0); j = j[j.sum(1) >= 5]
    crow[-1]["cells_ge5"] = len(j)
    crow[-1]["persist_spearman"] = round(stats.spearmanr(j.iloc[:, 0], j.iloc[:, 1])[0], 2) if len(j) > 3 else np.nan
    crow[-1]["top10_cells_share_pct"] = round(100 * t.n.head(10).sum() / max(t.n.sum(), 1), 1)
    top = t.head(10).assign(region=reg, lat=lambda q: (q.ci / 10 + .05).round(2), lon=lambda q: (q.cj / 10 + .05).round(2))
    cells.append(top[["region", "lat", "lon", "n", "years_active", "peak_month", "peak_month_share_pct", "peak_p8", "top_year_share_pct"]])
ct = pd.DataFrame(crow); ct.to_csv(OUT / "C_forest_edge_summary.csv", index=False)
mt = pd.DataFrame(mon).round(1); mt.index.name = "month"; mt.to_csv(OUT / "C_monthly_share.csv")
cl = pd.concat(cells); cl.to_csv(OUT / "C_top_cells.csv", index=False)
yt = pd.DataFrame(yrs); yt.index.name = "year"; yt.to_csv(OUT / "C_edge20_per_year.csv")
print("== C\n", ct.to_string(index=False))
print(mt.to_string())
print(yt.T.to_string())
print(cl.to_string(index=False))
