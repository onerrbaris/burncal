"""Accuracy at sub-region scale (between the whole Mediterranean box and 1 deg boxes).

Reuses the leave-one-year-out predictions already saved by evaluate.py (preds_MED.npz, 0.25 deg
boxes, additive models) and only re-aggregates them to coarser groupings, then scores with the
same metrics() as the main study. Nothing is refitted here.
Groupings are lon/lat boxes, NOT province polygons; the "named" set only approximates provinces.
Output: subregion_metrics.csv, subregion_units.csv
"""
import sys
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from evaluate import Z, agg, metrics, taggs  # noqa: E402

sel = Z["reg"] == 0
lat = Z["i25"][sel] / 4.0  # south-west corner of each 0.25 deg box
lon = Z["j25"][sel] / 4.0
P = np.load(HERE / "cache" / "preds_MED.npz")


def strips(edges):
    return np.digitize(lon, edges[1:-1])


def named():
    g = np.full(len(lon), -1)
    g[lon < 31] = 0                                   # Mugla east + Antalya west
    g[(lon >= 31) & (lon < 32.75)] = 1                # Antalya east
    g[(lon >= 32.75) & (lon < 34.75)] = 2             # Mersin
    east = lon >= 34.75
    g[east] = 3                                       # Cukurova (Adana, Osmaniye)
    g[east & (lon >= 35.75) & (lat < 36.75)] = 4      # Hatay
    return g


NAMES = ["Mugla-D/Antalya-B", "Antalya-D", "Mersin", "Cukurova", "Hatay"]
GROUPS = {
    "region(1)": np.zeros(len(lon), int),
    "halves(2)": strips([29, 33, 37]),
    "thirds(3)": strips([29, 32, 34.5, 37]),
    "strips2deg(4)": strips([29, 31, 33, 35, 37]),
    "named(5)": named(),
    "grid2deg": pd.factorize(pd.Series(list(zip(np.floor(lat / 2), np.floor(lon / 2)))))[0],
    "strips1deg(8)": strips(list(range(29, 38))),
    "grid1deg": pd.factorize(pd.Series(list(zip(np.floor(lat), np.floor(lon)))))[0],
}

rows, units = [], []
for model in ["raw", "reg12", "terra_aqua"]:
    if f"{model}|0.25" not in P.files:
        continue
    Y0, P0 = P["Y|0.25"].astype(float), P[f"{model}|0.25"].astype(float)
    for gname, g in GROUPS.items():
        Y, Ph = agg(Y0, g), agg(P0, g)
        Ty, Tp = taggs(Y), taggs(Ph)
        for ta in Ty:
            r = metrics(Ty[ta], Tp[ta])
            r.update(model=model, grouping=gname, n_units=int(g.max() + 1), tagg=ta)
            rows.append(r)
        if gname in ("named(5)", "strips2deg(4)", "thirds(3)") and model != "raw":
            for u in range(g.max() + 1):
                for ta in ("year", "season", "month"):
                    y, p = Ty[ta][u], Tp[ta][u]
                    units.append(dict(model=model, grouping=gname, unit=u,
                                      name=NAMES[u] if gname == "named(5)" else f"u{u}",
                                      tagg=ta, viirs_per_year=Y[u].sum() / Y.shape[1],
                                      share=Y[u].sum() / Y.sum(),
                                      wape=np.abs(p - y).sum() / y.sum(), bias=p.sum() / y.sum() - 1))

df = pd.DataFrame(rows); du = pd.DataFrame(units)
df.to_csv(HERE / "subregion_metrics.csv", index=False)
du.to_csv(HERE / "subregion_units.csv", index=False)
pd.set_option("display.width", 220)
cols = ["model", "grouping", "n_units", "tagg", "wape", "bias", "year_rank_rho", "cov90", "poisson_floor"]
print(df[cols].round(3).to_string(index=False))
print()
print(du.round(3).to_string(index=False))


# ------------------------------------------------------------------ per-unit factors (refit, LOYO)
# The single regional factor leaves a persistent bias per sub-region. Test three per-unit variants,
# each fitted on 13 years and scored on the 14th (same protocol as evaluate.py).
from evaluate import region, EVI, ratio  # noqa: E402

D, _ = region("MED")
V, M = D["V"], D["M"]
SEAS4 = np.array([0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0])


def fit_predict(g, kind, tr, te):
    Vu, Mu = agg(V, g), agg(M, g)                       # [units, 26, 12]
    f_reg = ratio(V, M, tr)                             # [12]
    if kind == "unit_x_month":                          # 12 factors per unit
        num, den = Vu[:, tr].sum(1), Mu[:, tr].sum(1)
        f = np.where(den > 0, num / np.maximum(den, 1e-9), f_reg[None, :])
    elif kind == "unit_x_seas4":                        # 4 factors per unit
        num = agg(Vu[:, tr].sum(1).T, SEAS4).T; den = agg(Mu[:, tr].sum(1).T, SEAS4).T
        f = np.where(den > 0, num / np.maximum(den, 1e-9), 1.0)[:, SEAS4]
    else:                                               # regional month factor x one scalar per unit
        c = Vu[:, tr].sum((1, 2)) / np.maximum((Mu[:, tr] * f_reg).sum((1, 2)), 1e-9)
        f = c[:, None] * f_reg[None, :]
    return Mu[:, te] * f


rows2, units2 = [], []
for gname in ["thirds(3)", "strips2deg(4)", "named(5)", "strips1deg(8)", "grid1deg"]:
    g = GROUPS[gname]
    Y = agg(V, g)[:, EVI]
    for kind in ["unit_scalar", "unit_x_seas4", "unit_x_month"]:
        Ph = np.zeros_like(Y)
        for yi, y in enumerate(EVI):
            tr = np.array([k for k in EVI if k != y])
            Ph[:, yi] = fit_predict(g, kind, tr, y)
        Ty, Tp = taggs(Y), taggs(Ph)
        for ta in Ty:
            r = metrics(Ty[ta], Tp[ta]); r.update(model=kind, grouping=gname, n_units=int(g.max() + 1), tagg=ta)
            rows2.append(r)
        if gname == "named(5)":
            for u in range(5):
                units2.append(dict(model=kind, name=NAMES[u],
                                   **{f"{ta}_wape": np.abs(Tp[ta][u] - Ty[ta][u]).sum() / Ty[ta][u].sum()
                                      for ta in ("year", "season", "month")},
                                   bias=Ph[u].sum() / Y[u].sum() - 1))
d2 = pd.DataFrame(rows2)
d2.to_csv(HERE / "subregion_metrics_unitfit.csv", index=False)
print("\n--- per-unit factors (LOYO refit) ---")
print(d2[cols].round(3).to_string(index=False))
print(pd.DataFrame(units2).round(3).to_string(index=False))
