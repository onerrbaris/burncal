"""Leave-one-year-out (2012-2025) evaluation of MODIS->VIIRS count harmonization in the
Mediterranean region (MED) and the Mediterranean-climate coast belt (COAST = MED + Aegean).

Every model is fitted on 13 years and scored on the 14th; nothing is fitted on the scored year
(national factors are refitted LOYO too; the borrowing weight is chosen by an inner LOYO inside
the 13 training years). 90% intervals are cross-conformal: for year y, log1p residual quantiles
of the OTHER years' held-out predictions, binned by predicted level.
Outputs: metrics.csv, factors.json, borrow_w.json, preds_<region>.npz (small).
"""
import json
import sys
import time
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import poisson

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from common import nn_poisson_identity  # noqa: E402

Z = np.load(HERE / "cache" / "arrays.npz")
KEYS = ["V", "V_day", "M", "T", "A", "M_day", "M_nolow", "M_hi", "M_area", "M_invarea", "V_frp", "M_frp"]
YRS = np.arange(2000, 2026)
EV = np.arange(2012, 2026)
EVI = EV - 2000
SCALES = ["R", "1", "0.5", "0.25"]
SEASON = [5, 6, 7, 8, 9]  # Jun..Oct (0-based months)
BINS = np.array([0, 0.5, 2, 5, 20, 100, 500, np.inf])

nat = pd.read_csv(HERE / "national_monthly.csv")
NATV = np.zeros((26, 12)); NATM = np.zeros((26, 12))
NATV[nat.year.values - 2000, nat.month.values - 1] = nat.VIIRS.values
NATM[nat.year.values - 2000, nat.month.values - 1] = nat.MODIS.values


def agg(a, g):
    out = np.zeros((g.max() + 1,) + a.shape[1:])
    np.add.at(out, g, a)
    return out


def region(name):
    sel = (Z["reg"] == 0) if name == "MED" else np.ones(len(Z["reg"]), bool)
    D = {k: Z[k][sel].reshape(sel.sum(), 26, 12) for k in KEYS}
    i, j = Z["i25"][sel], Z["j25"][sel]
    G = {"0.25": np.arange(sel.sum()),
         "0.5": pd.factorize(pd.Series(list(zip(i // 2, j // 2))))[0],
         "1": pd.factorize(pd.Series(list(zip(i // 4, j // 4))))[0],
         "R": np.zeros(sel.sum(), int)}
    return D, G


def ratio(V, X, tr):
    num = V[:, tr].sum((0, 1)); den = X[:, tr].sum((0, 1))
    return np.where(den > 0, num / np.maximum(den, 1e-9), 1.0)


def pois_offset(X, y, off, iters=60, ridge=1e-6):
    beta = np.zeros(X.shape[1]); beta[0] = np.log(max(y.sum(), 1e-6) / max(np.exp(off).sum(), 1e-6))
    for _ in range(iters):
        eta = np.clip(X @ beta + off, -30, 30); mu = np.exp(eta)
        z = eta - off + (y - mu) / mu
        W = X * mu[:, None]
        new = np.linalg.solve(X.T @ W + ridge * np.eye(X.shape[1]), W.T @ z)
        if np.max(np.abs(new - beta)) < 1e-9:
            return new
        beta = new
    return beta


# ------------------------------------------------------------------ models
# each: f(D, G, tr, te) -> array [boxes, 12] (additive, summed to coarser scales)
#                          or dict scale -> [groups, 12] (scale specific)
FIT = {}  # model -> list of fitted parameter vectors (one per fold), for reporting


def rec(name, v):
    FIT.setdefault(name, []).append(np.asarray(v, float).tolist())


def m_raw(D, G, tr, te):
    return D["M"][:, te]


def m_nat12(D, G, tr, te):
    f = NATV[tr].sum(0) / NATM[tr].sum(0); rec("nat12", f)
    return D["M"][:, te] * f


def make_ratio(name, X="M"):
    def f_(D, G, tr, te):
        f = ratio(D["V"], D[X], tr); rec(name, f)
        return D[X][:, te] * f
    return f_


def make_group(name, groups):
    groups = np.asarray(groups)
    def f_(D, G, tr, te):
        V = D["V"][:, tr].sum((0, 1)); M = D["M"][:, tr].sum((0, 1))
        gv = np.bincount(groups, V); gm = np.bincount(groups, M)
        f = (gv / gm)[groups]; rec(name, f)
        return D["M"][:, te] * f
    return f_


def make_harm(name, K):
    mm = np.arange(12)
    cols = [np.ones(12)]
    for k in range(1, K + 1):
        cols += [np.cos(2 * np.pi * k * mm / 12), np.sin(2 * np.pi * k * mm / 12)]
    H = np.column_stack(cols)
    def f_(D, G, tr, te):
        VR = D["V"][:, tr].sum(0); MR = D["M"][:, tr].sum(0)  # [ntr, 12]
        ok = MR > 0
        X = np.tile(H, (len(tr), 1))[ok.ravel()]
        b = pois_offset(X, VR.ravel()[ok.ravel()], np.log(MR.ravel()[ok.ravel()]))
        f = np.exp(H @ b); rec(name, f)
        return D["M"][:, te] * f
    return f_


def m_ta(D, G, tr, te):
    out = np.zeros((D["M"].shape[0], 12)); pars = []
    for m in range(12):
        A = np.column_stack([D["T"][:, tr, m].ravel(), D["A"][:, tr, m].ravel()])
        c = nn_poisson_identity(A, D["V"][:, tr, m].ravel())
        pars.append(c); out[:, m] = c[0] * D["T"][:, te, m] + c[1] * D["A"][:, te, m]
    rec("terra_aqua", np.array(pars).ravel())
    return out


def m_ta_smooth(D, G, tr, te):
    """Terra/Aqua weights with a common share across months: V = f_m (w T + (1-w) A)*2; w shared."""
    best = None
    for w in np.linspace(0, 1, 21):
        X = w * D["T"] + (1 - w) * D["A"]
        f = ratio(D["V"], X, tr)
        err = np.abs(X[:, tr] * f - D["V"][:, tr]).sum()
        if best is None or err < best[0]:
            best = (err, w, f)
    _, w, f = best; rec("ta_shared_w", np.r_[w, f])
    return (w * D["T"][:, te] + (1 - w) * D["A"][:, te]) * f


def m_power_td(D, G, tr, te):
    """Activity-dependent factor at region level, distributed to boxes by MODIS share (additive, zero-safe)."""
    VR = D["V"][:, tr].sum(0); MR = D["M"][:, tr].sum(0)
    ok = (MR > 0).ravel()
    X = np.column_stack([np.tile(np.eye(12), (len(tr), 1)), np.log(MR.ravel())])[ok]
    b = pois_offset(X, VR.ravel()[ok], np.zeros(ok.sum()))
    rec("power_td", b)
    Mte = D["M"][:, te]; MRte = Mte.sum(0)
    Rhat = np.where(MRte > 0, np.exp(b[:12] + b[12] * np.log(np.maximum(MRte, 1e-9))), 0)
    return Mte * np.where(MRte > 0, Rhat / np.maximum(MRte, 1e-9), 0)


def m_power_scale(D, G, tr, te):
    """Activity-dependent factor fitted per scale on that scale's units (NOT additive)."""
    out = {}
    for sc in SCALES:
        V = agg(D["V"], G[sc]); M = agg(D["M"], G[sc])
        Vt, Mt = V[:, tr], M[:, tr]
        mi = np.broadcast_to(np.arange(12), Mt.shape)
        ok = Mt > 0
        X = np.column_stack([np.eye(12)[mi[ok]], np.log(Mt[ok])])
        b = pois_offset(X, Vt[ok], np.zeros(ok.sum()))
        rec("power_scale_" + sc, b)
        Me = M[:, te]
        out[sc] = np.where(Me > 0, np.exp(b[:12][None, :] + b[12] * np.log(np.maximum(Me, 1e-9))), 0)
    return out


def m_strat(D, G, tr, te, thr=0.5):
    V = D["V"][:, tr].sum(1)  # [b,12]
    tot = V.sum(1)
    crop_share = V[:, [4, 5, 9, 10]].sum(1) / np.maximum(tot, 1)
    cls = ((crop_share >= thr) & (tot >= 10)).astype(int)
    out = np.zeros((len(cls), 12)); pars = []
    for c in (0, 1):
        s = cls == c
        f = ratio(D["V"][s], D["M"][s], tr) if s.any() else np.ones(12)
        pars.append(f); out[s] = D["M"][s][:, te] * f
    rec("strat", np.r_[np.array(pars).ravel(), cls.mean()])
    return out


BORROW_W = {}


def _borrow_pred(V, M, tr, te, w):
    f = ratio(V, M, tr)
    Rhat = (M[:, te] * f).sum(0)  # regional harmonized total [12]
    sh = V[:, tr].sum(1) / np.maximum(V[:, tr].sum((0, 1)), 1e-9)  # [g,12] VIIRS-era share
    return w * (M[:, te] * f) + (1 - w) * Rhat[None, :] * sh


def make_borrow(name, fixed_w=None):
    WG = np.linspace(0, 1, 11)
    def f_(D, G, tr, te):
        out = {}
        for sc in SCALES:
            V = agg(D["V"], G[sc]); M = agg(D["M"], G[sc])
            if sc == "R":
                out[sc] = M[:, te] * ratio(V, M, tr); continue
            if fixed_w is not None:
                w = fixed_w
            else:
                err = np.zeros(len(WG))
                for j in tr:
                    inner = np.array([k for k in tr if k != j])
                    for wi, w in enumerate(WG):
                        err[wi] += np.abs(_borrow_pred(V, M, inner, j, w) - V[:, j]).sum()
                w = WG[np.argmin(err)]
                BORROW_W.setdefault(sc, []).append(float(w))
            out[sc] = _borrow_pred(V, M, tr, te, w)
        return out
    return f_


MODELS = {
    "raw": m_raw,
    "nat12": m_nat12,
    "reg12": make_ratio("reg12"),
    "reg1": make_group("reg1", [0] * 12),
    "seas4": make_group("seas4", [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0]),
    "harm1": make_harm("harm1", 1),
    "harm2": make_harm("harm2", 2),
    "aqua_only": make_ratio("aqua_only", "A"),
    "terra_only": make_ratio("terra_only", "T"),
    "terra_aqua": m_ta,
    "ta_shared_w": m_ta_smooth,
    "power_td": m_power_td,
    "power_scale": m_power_scale,
    "strat": m_strat,
    "borrow": make_borrow("borrow"),
    "share_only": make_borrow("share_only", 0.0),
    "day_only": make_ratio("day_only", "M_day"),
    "nolow": make_ratio("nolow", "M_nolow"),
    "hiconf": make_ratio("hiconf", "M_hi"),
    "area_w": make_ratio("area_w", "M_area"),
    "invarea_w": make_ratio("invarea_w", "M_invarea"),
}


# ------------------------------------------------------------------ metrics
def poisson_floor(Y):
    mu = Y[Y > 0]
    mad = 2 * mu * poisson.pmf(np.floor(mu), mu)
    return mad.sum() / max(Y.sum(), 1e-9)


def intervals(Y, P):
    """Cross-conformal 90% intervals; Y,P [g, NY, S]."""
    e = np.log1p(Y) - np.log1p(P)
    b = np.digitize(P, BINS) - 1
    LO = np.zeros_like(P); HI = np.zeros_like(P)
    NY = Y.shape[1]
    for i in range(NY):
        oth = np.delete(np.arange(NY), i)
        eo, bo = e[:, oth].ravel(), b[:, oth].ravel()
        act = (Y[:, oth].ravel() > 0) | (P[:, oth].ravel() > 0)
        eo, bo = eo[act], bo[act]
        for k in range(len(BINS) - 1):
            ek = eo[bo == k]
            if len(ek) < 30:
                ek = eo[np.abs(bo - k) <= 1]
            if len(ek) < 30:
                ek = eo
            lo, hi = np.quantile(ek, [0.05, 0.95])
            s = b[:, i] == k
            LO[:, i][s] = np.maximum((P[:, i][s] + 1) * np.exp(lo) - 1, 0)
            HI[:, i][s] = (P[:, i][s] + 1) * np.exp(hi) - 1
    return LO, HI


def _pct(v, H):
    return ((H < v[:, None]).sum(1) + 0.5 * (H == v[:, None]).sum(1)) / H.shape[1]


def rowrank(A):
    return np.apply_along_axis(lambda r: pd.Series(r).rank().values, 1, A)


def metrics(Y, P):
    P = np.maximum(P, 0)
    r = {"sumY": Y.sum(), "wape": np.abs(P - Y).sum() / Y.sum(), "bias": P.sum() / Y.sum() - 1,
         "poisson_floor": poisson_floor(Y)}
    g, NY, S = Y.shape
    Yg = Y.transpose(0, 2, 1).reshape(-1, NY); Pg = P.transpose(0, 2, 1).reshape(-1, NY)
    keep = (Yg.sum(1) > 0) | (Pg.sum(1) > 0)
    Yg, Pg = Yg[keep], Pg[keep]
    pe, tp, fn, fp = [], 0, 0, 0
    for i in range(NY):
        oth = np.delete(np.arange(NY), i)
        H = Yg[:, oth]; y, p = Yg[:, i], Pg[:, i]
        pe.append(np.abs(_pct(p, H) - _pct(y, H)))
        q = np.quantile(H, 0.9, axis=1)
        fr = (y > q) & (y > 0); fpred = (p > q) & (p > 0)
        tp += np.sum(fr & fpred); fn += np.sum(fr & ~fpred); fp += np.sum(~fr & fpred)
    r["pct_err"] = float(np.mean(np.concatenate(pe)))
    r["p90_recall"] = tp / max(tp + fn, 1); r["p90_prec"] = tp / max(tp + fp, 1)
    nd = lambda A: np.array([len(np.unique(a)) for a in A])
    ok = (nd(Yg) >= 3) & (nd(Pg) >= 3)
    if ok.sum():
        ry, rp = rowrank(Yg[ok]), rowrank(Pg[ok])
        ry -= ry.mean(1, keepdims=True); rp -= rp.mean(1, keepdims=True)
        rho = (ry * rp).sum(1) / np.sqrt((ry ** 2).sum(1) * (rp ** 2).sum(1))
        r["year_rank_rho"] = float(np.nanmean(rho)); r["rho_groups"] = int(ok.sum())
    LO, HI = intervals(Y, P)
    act = (Y > 0) | (P > 0)
    r["cov90"] = float(((Y >= LO - 1e-9) & (Y <= HI + 1e-9))[act].mean())
    r["groups"] = int(keep.sum())
    return r


def taggs(A):
    """[g, NY, 12] -> dict of time aggregations."""
    return {"month": A, "season": A[:, :, SEASON].sum(2, keepdims=True), "year": A.sum(2, keepdims=True)}


def run(regname, models):
    D, G = region(regname)
    rows, preds = [], {}
    Ysc = {sc: agg(D["V"], G[sc])[:, EVI] for sc in SCALES}
    for name in models:
        t0 = time.time()
        P = {sc: np.zeros_like(Ysc[sc]) for sc in SCALES}
        for yi, y in enumerate(EVI):
            tr = np.array([k for k in EVI if k != y])
            out = MODELS[name](D, G, tr, y)
            for sc in SCALES:
                P[sc][:, yi] = out[sc] if isinstance(out, dict) else agg(out, G[sc])
        for sc in SCALES:
            preds[f"{name}|{sc}"] = P[sc].astype(np.float32)
            Ty, Tp = taggs(Ysc[sc]), taggs(P[sc])
            for ta in Ty:
                r = metrics(Ty[ta], Tp[ta]); r.update(region=regname, model=name, scale=sc, tagg=ta)
                rows.append(r)
        print(f"{regname} {name:12s} {time.time() - t0:5.1f}s", flush=True)
    return rows, preds, Ysc


if __name__ == "__main__":
    models = sys.argv[1].split(",") if len(sys.argv) > 1 else list(MODELS)
    allrows = []
    for regname in ["MED", "COAST"]:
        FIT.clear(); BORROW_W.clear()
        rows, preds, Ysc = run(regname, models)
        allrows += rows
        np.savez_compressed(HERE / "cache" / f"preds_{regname}.npz", **preds,
                            **{f"Y|{k}": v for k, v in Ysc.items()})
        json.dump({k: np.mean(np.array(v), 0).round(3).tolist() for k, v in FIT.items()},
                  open(HERE / f"factors_{regname}.json", "w"), indent=0)
        json.dump(BORROW_W, open(HERE / f"borrow_w_{regname}.json", "w"))
    df = pd.DataFrame(allrows)
    tag = "" if len(sys.argv) <= 1 else "_" + sys.argv[2] if len(sys.argv) > 2 else "_partial"
    df.to_csv(HERE / f"metrics{tag}.csv", index=False)
    print("done", len(df))
