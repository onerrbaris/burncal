"""Shared code for the review experiments (response to docs/CHATGPT_TECHNICAL_REVIEW.md).

Everything here runs on the real FIRMS archive files (analysis/cache/all.pkl, built from
data/raw by common.load). No synthetic data. Existing results in analysis/med are not touched.
"""
import sys
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
AN = HERE.parents[1]
sys.path.insert(0, str(AN))
sys.path.insert(0, str(AN / "med"))
from common import load, CACHE, on_static  # noqa: E402
import evaluate as EVM  # noqa: E402  (metrics, taggs, agg, ratio, pois_offset, MODELS)

agg, ratio, taggs, metrics = EVM.agg, EVM.ratio, EVM.taggs, EVM.metrics
EVI = EVM.EVI  # year indices 12..25 (2012..2025)
GAMMAS = [0.25, 0.5, 0.75]
XKEYS = ["M", "M_g25", "M_g50", "M_g75", "M_invarea"]  # (scan*track)^-gamma, gamma = 0 .. 1


# ------------------------------------------------------------------ data
def detections():
    """All Turkey detections minus volcano / offshore types (1, 3)."""
    d = load()
    return d[~d.type.isin([1, 3]).values].copy()


def valid_days():
    return pd.read_pickle(CACHE / "base_nostatic.pkl")["valid"].dayindex.values


def mask_keys(d, exclude_year=None, buffer=1, min_days=1):
    """Static-source mask from VIIRS type-2 labels. exclude_year: build it without that year."""
    s = d[(d.type == 2) & (d.sensor == "VIIRS")]
    if exclude_year is not None:
        s = s[s.year != exclude_year]
    k = np.floor(s.latitude.values * 100).astype(np.int64) * 100000 + np.floor(s.longitude.values * 100).astype(np.int64)
    if min_days > 1:
        nd = pd.DataFrame({"k": k, "day": s.dayindex.values}).drop_duplicates().groupby("k").size()
        base = nd.index.values[nd.values >= min_days]
    else:
        base = np.unique(k)
    out = set()
    for a in base.tolist():
        i, j = divmod(a, 100000)
        for da in range(-buffer, buffer + 1):
            for db in range(-buffer, buffer + 1):
                out.add((i + da) * 100000 + (j + db))
    return out


def build(x, unit, NU, valid=None, keys=None, drop_type2=False):
    """Detections -> dict of [NU, 26, 12] monthly arrays. x must carry `unit` ids (>=0)."""
    m = np.ones(len(x), bool)
    if valid is not None:
        m &= x.dayindex.isin(valid).values
    if keys is not None:
        m &= ~on_static(x, keys)
    if drop_type2:
        m &= (x.type != 2).values
    x = x[m]; u = unit[m]
    t = (x.year.values.astype(int) - 2000) * 12 + x.month.values.astype(int) - 1
    sat = x.sat.astype(str).values
    isV = (x.sensor == "VIIRS").values
    area = (x.scan * x.track).values
    D = {}

    def put(name, msk, w=None):
        a = np.zeros((NU, 26 * 12))
        np.add.at(a, (u[msk], t[msk]), 1.0 if w is None else w[msk])
        D[name] = a.reshape(NU, 26, 12)

    put("V", isV); put("M", ~isV); put("T", sat == "Terra"); put("A", sat == "Aqua")
    put("M_invarea", ~isV, 1.0 / area)
    for g in GAMMAS:
        put(f"M_g{int(g * 100)}", ~isV, area ** (-g))
    D["_kept"] = m
    return D


def box_units(x, region="MED"):
    """0.25 deg boxes of the Mediterranean study (same boxes as analysis/med/prep.py)."""
    lat, lon = x.latitude.values, x.longitude.values
    med = (lon >= 29) & (lon < 37) & (lat >= 35.8) & (lat < 38.4)
    aeg = (lon >= 26) & (lon < 29) & (lat >= 36.5) & (lat < 39.5)
    sel = med if region == "MED" else (med | aeg)
    x = x[sel]
    i, j = (x.i05 // 5).values, (x.j05 // 5).values
    key = i.astype(np.int64) * 10000 + j
    uq, unit = np.unique(key, return_inverse=True)
    bi, bj = uq // 10000, uq % 10000
    blat, blon = bi / 4.0, bj / 4.0
    G = {"R": np.zeros(len(uq), int),
         "1": pd.factorize(pd.Series(list(zip(bi // 4, bj // 4))))[0],
         "0.5": pd.factorize(pd.Series(list(zip(bi // 2, bj // 2))))[0],
         "0.25": np.arange(len(uq))}
    if region == "MED":
        g = np.zeros(len(uq), int)
        g[(blon >= 31) & (blon < 32.75)] = 1
        g[(blon >= 32.75) & (blon < 34.75)] = 2
        east = blon >= 34.75
        g[east] = 3
        g[east & (blon >= 35.75) & (blat < 36.75)] = 4
        G["named5"] = g
    return x, unit, len(uq), G


# ------------------------------------------------------------------ models
def make_gamma_cv(name="gamma_cv"):
    """Pixel-area exponent chosen by an inner leave-one-year-out inside the training years."""
    def f_(D, G, tr, te):
        err = np.zeros(len(XKEYS))
        for j in tr:
            inner = np.array([k for k in tr if k != j])
            for xi, xk in enumerate(XKEYS):
                f = ratio(D["V"], D[xk], inner)
                err[xi] += np.abs((D[xk][:, j] * f).sum(0) - D["V"][:, j].sum(0)).sum()
        xk = XKEYS[int(np.argmin(err))]
        EVM.rec(name, [XKEYS.index(xk)])
        return D[xk][:, te] * ratio(D["V"], D[xk], tr)
    return f_


def with_activity(base):
    """base (additive) + 2-parameter regional activity correction  V_R = exp(a) * B_R^b.
    a, b fitted on the training years' region-month totals only; boxes keep the base shares."""
    def f_(D, G, tr, te):
        B = np.stack([base(D, G, tr, j).sum(0) for j in tr])  # [ntr, 12] in-sample base totals
        VR = D["V"][:, tr].sum(0)
        ok = (B > 0).ravel()
        X = np.column_stack([np.ones(ok.sum()), np.log(B.ravel()[ok])])
        b = EVM.pois_offset(X, VR.ravel()[ok], np.zeros(ok.sum()))
        Bte = base(D, G, tr, te); BR = Bte.sum(0)
        Rhat = np.where(BR > 0, np.exp(b[0] + b[1] * np.log(np.maximum(BR, 1e-9))), 0)
        return Bte * np.where(BR > 0, Rhat / np.maximum(BR, 1e-9), 0)
    return f_


def by_group(base, groups):
    """Fit `base` separately inside each group of units (group-specific factors)."""
    groups = np.asarray(groups)
    def f_(D, G, tr, te):
        out = np.zeros((len(groups), 12))
        for g in np.unique(groups):
            s = groups == g
            Dg = {k: v[s] for k, v in D.items() if isinstance(v, np.ndarray) and v.ndim == 3}
            out[s] = base(Dg, G, tr, te)
        return out
    return f_


M = EVM.MODELS
MODELS = {
    "raw": M["raw"], "reg12": M["reg12"], "terra_aqua": M["terra_aqua"],
    "invarea_w": M["invarea_w"], "power_td": M["power_td"],
    "g25": EVM.make_ratio("g25", "M_g25"), "g50": EVM.make_ratio("g50", "M_g50"),
    "g75": EVM.make_ratio("g75", "M_g75"), "gamma_cv": make_gamma_cv(),
    "ta+act": with_activity(M["terra_aqua"]), "inv+act": with_activity(M["invarea_w"]),
}


# ------------------------------------------------------------------ evaluation
def loyo(D, G, models, ev=EVI, Dfold=None, table=MODELS):
    """Leave-one-year-out. Dfold: optional {year index: D} = fold-specific data (e.g. a mask
    built without the test year); then both the fit and the target of fold y come from Dfold[y]."""
    ev = np.asarray(ev)
    Y = {sc: np.zeros((g.max() + 1, len(ev), 12)) for sc, g in G.items()}
    P = {n: {sc: np.zeros_like(Y[sc]) for sc in G} for n in models}
    for yi, y in enumerate(ev):
        Dy = D if Dfold is None else Dfold[int(y)]
        tr = np.array([k for k in ev if k != y])
        for sc, g in G.items():
            Y[sc][:, yi] = agg(Dy["V"][:, y], g)
        for n in models:
            out = table[n](Dy, G, tr, y)
            for sc, g in G.items():
                P[n][sc][:, yi] = agg(out, g)
    return Y, P


def score(Y, P, **tags):
    rows = []
    for n, Ps in P.items():
        for sc in Ps:
            Ty, Tp = taggs(Y[sc]), taggs(Ps[sc])
            for ta in Ty:
                r = metrics(Ty[ta], Tp[ta]); r.update(model=n, scale=sc, tagg=ta, **tags)
                rows.append(r)
    return rows


COLS = ["model", "scale", "tagg", "wape", "bias", "year_rank_rho", "p90_recall", "p90_prec", "cov90", "groups"]


def show(df, cols=None, **kw):
    pd.set_option("display.width", 250); pd.set_option("display.max_rows", 500)
    print(df[cols or [c for c in df.columns]].round(3).to_string(index=False, **kw))
