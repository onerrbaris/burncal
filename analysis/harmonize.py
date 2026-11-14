"""Step 3: candidate harmonization models, leave-one-year-out (LOYO) over the overlap.

Directions
    m2v : predict the VIIRS value of a (box, period) from MODIS data  (VIIRS units back to 2000)
    v2m : predict the MODIS value from VIIRS data                       (MODIS units past 2026)

Additive models are fitted on 0.25 deg boxes and their predictions are summed to
1 deg boxes and to the whole country, so any user area is the sum of its parts.
Non-additive models are fitted separately at each scale (they would need a fit per
user area in production).

Every fit for test year y uses only training years != y. Prediction intervals use
nested LOYO residuals (fit without y and y', score y'), so the calibration never
sees y either ("nested"). For the expensive GLMs the calibration pool is the outer
LOYO residuals of the other years ("leaky_outer": the models that produced them saw y).
"""
import time
import numpy as np
import pandas as pd
from common import spearman, nn_poisson_identity, poisson_irls

YEARS_ALL = np.arange(2012, 2026)
MEAS = ["n", "frp", "cd05", "cd25"]
COLS = MEAS + [f"{m}_{s}" for m in MEAS for s in "DN"] + ["scan"]
SCALES = ["country", "b200", "b100", "b50", "b25"]
VALID_MIN = 0.75
BINS = np.array([0, 0.5, 2, 5, 20, 100, 500, 2000, np.inf])
ALPHA = 0.10  # 90 % intervals


# ============================================================================ tables
def _slot_days(res):
    cal = pd.DataFrame({"date": pd.date_range("2012-01-01", "2025-12-31")})
    cal["year"] = cal.date.dt.year
    cal["slot"] = (np.minimum((cal.date.dt.day_of_year - 1) // 8, 45) + 1) if res == "p8" else cal.date.dt.month
    return cal


def wide(B, res, years):
    """0.25 deg box x year x slot table with M_<m>, V_<m>, for all boxes ever active."""
    base, valid = B["base"], B["valid"]
    t = base[base.year.isin(years)]
    g = t.groupby(["sensor", "bi", "bj", "year", res])[COLS].sum().unstack("sensor").fillna(0)
    g.columns = [f"{s[0]}_{m}" for m, s in g.columns]
    g = g.reset_index().rename(columns={res: "slot"})
    boxes = g[["bi", "bj"]].drop_duplicates()
    slots = np.arange(1, 47) if res == "p8" else np.arange(1, 13)
    full = boxes.merge(pd.DataFrame({"year": years}), how="cross").merge(pd.DataFrame({"slot": slots}), how="cross")
    W = full.merge(g, on=["bi", "bj", "year", "slot"], how="left").fillna(0)
    cal = _slot_days(res)
    cal = cal[cal.year.isin(years)]
    tot = cal.groupby(["year", "slot"]).size()
    vv = valid[valid.year.isin(years)]
    nv = vv.groupby(["year", res]).size()
    nv.index.names = ["year", "slot"]
    frac = (nv.reindex(tot.index).fillna(0) / tot).rename("vfrac").reset_index()
    W = W.merge(frac, on=["year", "slot"], how="left")
    yfrac = (vv.groupby("year").size() / cal.groupby("year").size()).rename("yfrac").reset_index()
    W = W.merge(yfrac, on="year", how="left")
    if res == "p8":
        W["season"] = (pd.Timestamp("2001-01-01") + pd.to_timedelta((W.slot - 1) * 8 + 3, unit="D")).dt.month
    else:
        W["season"] = W.slot
    W["b25"] = W.bi * 10000 + W.bj
    for k, f in [("b50", 2), ("b100", 4), ("b200", 8)]:
        W[k] = (W.bi // f) * 10000 + (W.bj // f)
    W["country"] = 0
    return W.reset_index(drop=True)


def scale_table(W, scale, annual):
    cols = [f"{s}_{m}" for s in "MV" for m in COLS]
    keys = [scale, "year"] + ([] if annual else ["slot", "season", "vfrac"])
    T = W.groupby(keys, sort=True)[cols].sum().reset_index()
    if annual:
        T["slot"] = 0; T["season"] = 0
        T = T.merge(W[["year", "yfrac"]].drop_duplicates(), on="year")
        T["vfrac"] = T["yfrac"]
    return T.rename(columns={scale: "box"}).reset_index(drop=True)


class Ctx:
    """All tables + integer indices for one (filter, direction, measure, resolution, years)."""

    def __init__(self, B, direction, meas, res, years=YEARS_ALL):
        self.direction, self.meas, self.res, self.years = direction, meas, res, np.asarray(years)
        fine = "month" if res == "year" else res
        W = wide(B, fine, self.years)
        xs, ys = ("M", "V") if direction == "m2v" else ("V", "M")

        def prep(T):
            T["X"] = T[f"{xs}_{meas}"].astype(float); T["Y"] = T[f"{ys}_{meas}"].astype(float)
            T["XD"] = T[f"{xs}_{meas}_D"].astype(float); T["XN"] = T[f"{xs}_{meas}_N"].astype(float)
            for m in COLS:
                T[f"x_{m}"] = T[f"{xs}_{m}"]
            T["valid"] = (T.vfrac >= VALID_MIN).values
            T["gk"] = pd.factorize(T.box.astype(np.int64) * 100 + T.slot)[0]          # (box, slot) code
            T["bk"] = pd.factorize(T.box)[0]
            T["yi"] = np.searchsorted(self.years, T.year.values)
            return T

        self.TT = {sc: prep(scale_table(W, sc, res == "year")) for sc in SCALES}
        self.Tf = prep(scale_table(W, "b25", False))  # fine table for additive models
        # index from fine rows to each scale table
        fb = self.Tf.box.values
        boxmap = {"b25": fb, "country": np.zeros(len(fb), np.int64)}
        for k, f in [("b50", 2), ("b100", 4), ("b200", 8)]:
            boxmap[k] = (fb // 10000 // f) * 10000 + (fb % 10000) // f
        self.agg = {}
        for sc in SCALES:
            T = self.TT[sc]
            if res == "year":
                idx = pd.MultiIndex.from_arrays([T.box.values, T.year.values])
                src = pd.MultiIndex.from_arrays([boxmap[sc], self.Tf.year.values])
            else:
                idx = pd.MultiIndex.from_arrays([T.box.values, T.year.values, T.slot.values])
                src = pd.MultiIndex.from_arrays([boxmap[sc], self.Tf.year.values, self.Tf.slot.values])
            ix = idx.get_indexer(src)
            assert (ix >= 0).all()
            self.agg[sc] = ix

    def aggregate(self, pf):
        return {sc: np.bincount(self.agg[sc], weights=pf, minlength=len(self.TT[sc])) for sc in SCALES}


def add_clim(T, train):
    """C = mean of Y over training years for the same (box, slot); leave-own-year-out for training rows."""
    ok = (train & T.valid.values).astype(float)
    y = T.Y.values * ok
    gk = T.gk.values
    s = np.bincount(gk, weights=y)[gk]
    c = np.bincount(gk, weights=ok)[gk]
    cnt = c - ok
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(cnt > 0, (s - y) / np.maximum(cnt, 1), 0.0)


# ============================================================================ models
def _ratio(y, x):
    sx = x.sum()
    return y.sum() / sx if sx > 0 else 1.0


class Additive:
    """Fitted on 0.25 deg rows; predictions are summed to larger areas."""
    additive = True
    cheap = True

    def __init__(self, kind, lam=20.0, train_max=None, name=None):
        self.kind, self.lam, self.train_max = kind, lam, train_max
        self.name = name or kind

    def fit(self, T, m):
        X, Y, s = T.X.values[m], T.Y.values[m], T.season.values[m]
        if self.kind == "seasonal_dn":
            XD, XN = T.XD.values[m], T.XN.values[m]
            self.dn = np.ones((13, 2))
            for q in range(13):
                w = s == q
                if w.any():
                    self.dn[q] = nn_poisson_identity(np.c_[XD[w], XN[w]], Y[w])
        elif self.kind == "seasonal_box":
            # seasonal factor x per-box adjustment shrunk toward 1 (lam = prior strength in X units)
            self.ks = np.ones(13)
            for q in range(13):
                w = s == q
                if w.any():
                    self.ks[q] = _ratio(Y[w], X[w])
            base = X * self.ks[s]
            nz = base[base > 0]
            lam = self.lam * (nz.mean() if len(nz) else 1.0)
            bk = T.bk.values[m]; nb = T.bk.values.max() + 1
            sb = np.bincount(bk, weights=base, minlength=nb); sy = np.bincount(bk, weights=Y, minlength=nb)
            self.rb = (sy + lam) / (sb + lam)
            self.rb *= Y.sum() / max((base * self.rb[bk]).sum(), 1e-12)   # keep total unbiased
        elif self.kind == "seasonal_scan":
            # factor by (season, tercile of the X-sensor mean scan of the row); X=0 rows' Y spread per season
            sc = np.where(T.x_n.values > 0, T.x_scan.values / np.maximum(T.x_n.values, 1), np.nan)
            self.edges = np.nanquantile(sc[m][X > 0], [1 / 3, 2 / 3])
            sbin = np.digitize(sc[m], self.edges)
            self.kss = np.ones((13, 3))
            for q in range(13):
                w = s == q
                if not w.any():
                    continue
                pos = w & (X > 0)
                adj = Y[w].sum() / max(Y[pos].sum(), 1e-12)
                kq = _ratio(Y[w], X[w])
                for b in range(3):
                    wb = pos & (sbin == b)
                    self.kss[q, b] = _ratio(Y[wb], X[wb]) * adj if X[wb].sum() > 0 else kq
        elif self.kind == "global":
            self.k = _ratio(Y, X)
        elif self.kind == "seasonal":
            self.ks = np.ones(13)
            for q in range(13):
                w = s == q
                if w.any():
                    self.ks[q] = _ratio(Y[w], X[w])
        elif self.kind == "ratio_box":
            kg = _ratio(Y, X)
            nz = X[X > 0]
            lam = self.lam * (nz.mean() if len(nz) else 1.0)
            bk = T.bk.values
            nb = bk.max() + 1
            sx = np.bincount(bk[m], weights=X, minlength=nb); sy = np.bincount(bk[m], weights=Y, minlength=nb)
            self.kb = (sy + lam * kg) / (sx + lam)
        elif self.kind in ("lin_clim", "clim_only"):
            C = T.C.values[m]
            self.ab = np.zeros((13, 2))
            for q in range(13):
                w = s == q
                if not w.any():
                    continue
                if self.kind == "lin_clim":
                    self.ab[q] = nn_poisson_identity(np.c_[X[w], C[w]], Y[w])
                else:
                    self.ab[q] = [0.0, _ratio(Y[w], C[w])]
        return self

    def predict(self, T):
        X = T.X.values
        if self.kind == "none":
            return X.copy()
        if self.kind == "global":
            return self.k * X
        if self.kind == "seasonal":
            return X * self.ks[T.season.values]
        if self.kind == "seasonal_box":
            return X * self.ks[T.season.values] * self.rb[T.bk.values]
        if self.kind == "seasonal_scan":
            sc = np.where(T.x_n.values > 0, T.x_scan.values / np.maximum(T.x_n.values, 1), 0.0)
            return X * self.kss[T.season.values, np.digitize(sc, self.edges)]
        if self.kind == "seasonal_dn":
            dn = self.dn[T.season.values]
            return dn[:, 0] * T.XD.values + dn[:, 1] * T.XN.values
        if self.kind == "ratio_box":
            return X * self.kb[T.bk.values]
        ab = self.ab[T.season.values]
        return ab[:, 0] * X + ab[:, 1] * T.C.values


def _dummies(season, cats):
    return (season[:, None] == np.asarray(cats)[None, :]).astype(float)


class LogLog:
    additive = False; cheap = True; name = "loglog"

    def fit(self, T, m):
        self.cats = np.unique(T.season.values)
        A = np.c_[_dummies(T.season.values[m], self.cats), np.log1p(T.X.values[m])]
        y = np.log1p(T.Y.values[m])
        self.coef, *_ = np.linalg.lstsq(A, y, rcond=None)
        self.smear = np.mean(np.exp(y - A @ self.coef))   # Duan smearing
        return self

    def predict(self, T):
        A = np.c_[_dummies(T.season.values, self.cats), np.log1p(T.X.values)]
        return np.maximum(np.exp(A @ self.coef) * self.smear - 1, 0)


class GLM:
    """Poisson GLM, log link: log E[Y] = a_season + b log(X+0.5) + c [X=0] (+ d log(C+0.5) + e [C=0])."""
    additive = False; cheap = False

    def __init__(self, clim):
        self.clim = clim
        self.name = "glm_clim" if clim else "glm"

    def _A(self, T):
        cols = [_dummies(T.season.values, self.cats), np.log(T.X.values + 0.5)[:, None], (T.X.values == 0)[:, None].astype(float)]
        if self.clim:
            cols += [np.log(T.C.values + 0.5)[:, None], (T.C.values == 0)[:, None].astype(float)]
        return np.hstack(cols)

    def fit(self, T, m):
        self.cats = np.unique(T.season.values)
        self.beta = poisson_irls(self._A(T)[m], T.Y.values[m])
        return self

    def predict(self, T):
        return np.exp(np.clip(self._A(T) @ self.beta, -30, 30))


class QM:
    """Empirical quantile mapping (mid-rank CDF of X -> quantile of Y); by season or by box."""
    additive = False; cheap = True

    def __init__(self, by):
        self.by = by
        self.name = "qm" if by == "season" else "qm_box"

    def fit(self, T, m):
        g = (T.season.values if self.by == "season" else T.bk.values)[m]
        X, Y = T.X.values[m], T.Y.values[m]
        o = np.argsort(g, kind="stable")
        g, X, Y = g[o], X[o], Y[o]
        cut = np.flatnonzero(np.diff(g)) + 1
        self.maps = {gg[0]: (np.sort(xx), np.sort(yy)) for gg, xx, yy in zip(np.split(g, cut), np.split(X, cut), np.split(Y, cut))}
        self.fallback = (np.sort(X), np.sort(Y))
        return self

    @staticmethod
    def _map(x, xs, ys):
        lo = np.searchsorted(xs, x, "left"); hi = np.searchsorted(xs, x, "right")
        u = (lo + hi) / 2.0 / len(xs)
        pos = np.clip(u * len(ys) - 0.5, 0, len(ys) - 1)
        return np.interp(pos, np.arange(len(ys)), ys)

    def predict(self, T):
        g = T.season.values if self.by == "season" else T.bk.values
        out = np.empty(len(T)); x = T.X.values
        o = np.argsort(g, kind="stable"); gs = g[o]
        cut = np.flatnonzero(np.diff(gs)) + 1
        for idx in np.split(o, cut):
            xs, ys = self.maps.get(g[idx[0]], self.fallback)
            out[idx] = self._map(x[idx], xs, ys)
        return out


class GBM:
    """Gradient boosting (Poisson loss) on X-sensor features incl. day/night split, mean scan, FRP/detection."""
    additive = False; cheap = False; name = "gbm"

    def _A(self, T):
        n = np.maximum(T.x_n.values, 1)
        f = [np.log1p(T[c].values) for c in ["x_n", "x_frp", "x_cd05", "x_cd25", "XD", "XN", "X"]]
        f += [T.x_scan.values / n, T.x_frp.values / n, T.x_n_N.values / n, T.season.values]
        return np.c_[tuple(f)]

    def fit(self, T, m):
        from sklearn.ensemble import HistGradientBoostingRegressor
        self.r = HistGradientBoostingRegressor(loss="poisson", max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
                                               min_samples_leaf=40, l2_regularization=1.0, random_state=0)
        self.r.fit(self._A(T)[m], T.Y.values[m])
        return self

    def predict(self, T):
        return self.r.predict(self._A(T))


def have_sklearn():
    try:
        import sklearn  # noqa: F401
        return True
    except ImportError:
        return False


MODEL_SETS = {
    "full": ["none", "global", "seasonal", "seasonal_nominal", "seasonal_dn", "ratio_box", "lin_clim", "clim_only",
             "loglog", "qm", "qm_box", "glm", "glm_clim", "gbm"],
    "core": ["none", "global", "seasonal", "seasonal_dn", "loglog", "qm", "glm"],
    "tiny": ["none", "global", "seasonal"],
}


def make_model(name):
    if name == "seasonal_nominal":
        return Additive("seasonal", train_max=2020, name="seasonal_nominal")
    if name in ("none", "global", "seasonal", "seasonal_dn", "seasonal_box", "seasonal_scan", "ratio_box", "lin_clim", "clim_only"):
        return Additive(name)
    return {"loglog": LogLog, "qm": lambda: QM("season"), "qm_box": lambda: QM("box"),
            "glm": lambda: GLM(False), "glm_clim": lambda: GLM(True), "gbm": GBM}[name]()


def make_models(which="full"):
    names = MODEL_SETS[which] if isinstance(which, str) else which
    return [make_model(n) for n in names if n != "gbm" or have_sklearn()]


# ============================================================================ metrics
def point_metrics(Y, P):
    P = np.maximum(P, 0)
    sY = Y.sum()
    r = {"n": int(len(Y)), "sumY": float(sY), "zeroY": float(np.mean(Y == 0)),
         "bias": float(P.sum() / sY - 1) if sY > 0 else np.nan,
         "wape": float(np.abs(P - Y).sum() / sY) if sY > 0 else np.nan}
    Pc = np.maximum(P, 1e-3)
    with np.errstate(divide="ignore", invalid="ignore"):
        dev = 2 * (np.where(Y > 0, Y * np.log(Y / Pc), 0) - (Y - Pc))
    r["pdev"] = float(dev.mean())
    ly, lp = np.log1p(Y), np.log1p(P)
    r["r_log"] = float(np.corrcoef(ly, lp)[0, 1]) if ly.std() > 0 and lp.std() > 0 else np.nan
    r["rho"] = spearman(Y, P)
    act = Y >= 5
    if act.sum() > 0:
        q = (P[act] + 1) / (Y[act] + 1)
        r["within_x2_Yge5"] = float(((q >= 0.5) & (q <= 2)).mean())
    return r


def _pct(v, H):
    n = np.sum(~np.isnan(H), axis=1)
    lt = np.sum(H < v[:, None], axis=1); eq = np.sum(H == v[:, None], axis=1)
    return (lt + 0.5 * eq) / np.maximum(n, 1)


def _rowrank(A):
    """Average ranks along rows, NaN-aware (NaN stays NaN)."""
    V = ~np.isnan(A)
    less = np.sum((A[:, None, :] < A[:, :, None]) & V[:, None, :], axis=2)
    eq = np.sum((A[:, None, :] == A[:, :, None]) & V[:, None, :], axis=2)
    R = less + (eq + 1) / 2.0
    R[~V] = np.nan
    return R


def _row_corr(A, B):
    w = ~np.isnan(A) & ~np.isnan(B)
    n = w.sum(1)
    A = np.where(w, A, 0); B = np.where(w, B, 0)
    ma = A.sum(1) / np.maximum(n, 1); mb = B.sum(1) / np.maximum(n, 1)
    da = np.where(w, A - ma[:, None], 0); db = np.where(w, B - mb[:, None], 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        return (da * db).sum(1) / np.sqrt((da ** 2).sum(1) * (db ** 2).sum(1))


def downstream(T, P, years):
    """Percentile / P90-flag agreement across years within each (box, slot)."""
    NY = len(years)
    G = T.gk.max() + 1
    v = T.valid.values
    mats = {}
    for nm, val in [("Y", T.Y.values), ("P", np.maximum(P, 0)), ("X", T.X.values)]:
        Mx = np.full((G, NY), np.nan)
        Mx[T.gk.values[v], T.yi.values[v]] = val[v]
        mats[nm] = Mx
    Ym, Pm, Xm = mats["Y"], mats["P"], mats["X"]
    keep = (np.nansum(Ym, 1) > 0) | (np.nansum(Pm, 1) > 0)
    Ym, Pm, Xm = Ym[keep], Pm[keep], Xm[keep]
    res = {"groups": int(keep.sum())}
    acc = {k: [] for k in ["A", "B", "own"]}
    fl = {k: np.zeros(4) for k in ["A", "B", "own", "Pown"]}
    for i in range(NY):
        others = np.delete(np.arange(NY), i)
        HY, HP, HX = Ym[:, others], Pm[:, others], Xm[:, others]
        y, p, x = Ym[:, i], Pm[:, i], Xm[:, i]
        ok = ~np.isnan(y) & (np.sum(~np.isnan(HY), 1) >= 5)
        y, p, x, HY, HP, HX = y[ok], p[ok], x[ok], HY[ok], HP[ok], HX[ok]
        qY = np.nanquantile(HY, 0.9, axis=1); qP = np.nanquantile(HP, 0.9, axis=1); qX = np.nanquantile(HX, 0.9, axis=1)
        ref_pct = _pct(y, HY); ref_flag = (y > qY) & (y > 0)
        cases = {"A": (_pct(p, HY), (p > qY) & (p > 0)),     # current period converted, history = reference sensor
                 "B": (_pct(y, HP), (y > qP) & (y > 0)),     # current period reference sensor, history converted
                 "own": (_pct(x, HX), (x > qX) & (x > 0)),   # no conversion: each sensor vs its own history
                 "Pown": (None, (p > qP) & (p > 0))}         # fully converted series vs itself
        for k, (pc, f) in cases.items():
            if pc is not None:
                acc[k].append(np.abs(pc - ref_pct))
            fl[k] += [np.sum(f & ref_flag), np.sum(~f & ref_flag), np.sum(f & ~ref_flag), np.sum(~f & ~ref_flag)]
    for k, vv in acc.items():
        res[f"{k}_pct_mae"] = float(np.mean(np.concatenate(vv)))
    for k, (tp, fn, fp, tn) in fl.items():
        res[f"{k}_p90_recall"] = float(tp / (tp + fn)) if tp + fn else np.nan
        res[f"{k}_p90_precision"] = float(tp / (tp + fp)) if tp + fp else np.nan
    tp, fn, fp, tn = fl["A"]
    res["ref_p90_rate"] = float((tp + fn) / (tp + fn + fp + tn))
    # rank agreement of years within each (box, slot)
    nY = np.sum(~np.isnan(Ym), 1)
    def ndist(A):
        S = np.sort(np.where(np.isnan(A), np.inf, A), 1)
        return 1 + np.sum((np.diff(S, axis=1) > 0) & np.isfinite(S[:, 1:]), 1)
    ok = (nY >= 5) & (ndist(Ym) >= 3) & (ndist(Pm) >= 3)
    if ok.sum():
        rho = _row_corr(_rowrank(Ym[ok]), _rowrank(Pm[ok]))
        res["year_rank_rho"] = float(np.nanmean(rho))
        res["year_rank_rho_p10"] = float(np.nanquantile(rho, 0.1))
    res["year_rank_groups"] = int(ok.sum())
    # within-year ranking of periods (seasonal shape) per (box, year)
    if T.slot.max() > 0:
        bk = pd.factorize(T.box)[0]
        NS = int(T.slot.max())
        key = bk * NY + T.yi.values
        Ys = np.full((key.max() + 1, NS), np.nan); Ps = Ys.copy()
        Ys[key[v], T.slot.values[v] - 1] = T.Y.values[v]
        Ps[key[v], T.slot.values[v] - 1] = np.maximum(P, 0)[v]
        ok = (np.sum(~np.isnan(Ys), 1) >= 5) & (ndist(Ys) >= 3) & (ndist(Ps) >= 3)
        if ok.sum():
            rho = _row_corr(_rowrank(Ys[ok]), _rowrank(Ps[ok]))
            res["season_rank_rho"] = float(np.nanmean(rho))
            res["season_rank_groups"] = int(ok.sum())
    return res


# ============================================================================ driver
def _intervals(cal, P):
    e = np.log1p(cal[:, 1]) - np.log1p(np.maximum(cal[:, 0], 0))
    b = np.digitize(np.maximum(cal[:, 0], 0), BINS) - 1
    qlo = np.zeros(len(BINS)); qhi = np.zeros(len(BINS))
    for k in range(len(BINS)):
        ek = e[b == k]
        if len(ek) < 50:
            ek = e[np.abs(b - k) <= 1] if np.sum(np.abs(b - k) <= 1) >= 50 else e
        qlo[k], qhi[k] = np.quantile(ek, [ALPHA / 2, 1 - ALPHA / 2])
    p = np.maximum(P, 0)
    bb = np.digitize(p, BINS) - 1
    return np.maximum((p + 1) * np.exp(qlo[bb]) - 1, 0), (p + 1) * np.exp(qhi[bb]) - 1, (qlo, qhi)


def fit_predict(ctx, model, train_years):
    out = {}
    tm = getattr(model, "train_max", None)
    if tm is not None:
        train_years = train_years[train_years <= tm]
    if model.additive:
        T = ctx.Tf
        tr = np.isin(T.year.values, train_years)
        if model.name in ("lin_clim", "clim_only"):
            T = T.copy(); T["C"] = add_clim(T, tr)
        mdl = model if model.name == "none" else model.fit(T, tr & T.valid.values)
        return ctx.aggregate(mdl.predict(T))
    for sc in SCALES:
        T = ctx.TT[sc].copy()
        tr = np.isin(T.year.values, train_years)
        T["C"] = add_clim(T, tr)
        out[sc] = model.fit(T, tr & T.valid.values).predict(T)
    return out


def run(ctx, models, intervals=True, keep=(), log=print, eval_years=None):
    years = ctx.years
    eval_years = years if eval_years is None else np.asarray(eval_years)
    rows, preds = [], {}
    for model in models:
        t0 = time.time()
        P = {sc: np.full(len(ctx.TT[sc]), np.nan) for sc in SCALES}
        LO = {sc: np.full(len(ctx.TT[sc]), np.nan) for sc in SCALES}
        HI = {sc: np.full(len(ctx.TT[sc]), np.nan) for sc in SCALES}
        LOs = {sc: np.full(len(ctx.TT[sc]), np.nan) for sc in SCALES}
        HIs = {sc: np.full(len(ctx.TT[sc]), np.nan) for sc in SCALES}
        cal = {}
        for y in years:
            train = years[years != y]
            pr = fit_predict(ctx, model, train)
            for sc in SCALES:
                w = ctx.TT[sc].year.values == y
                P[sc][w] = pr[sc][w]
            if intervals and model.cheap:
                pool = []
                for y2 in train:
                    pr2 = fit_predict(ctx, model, train[train != y2])
                    for si, sc in enumerate(SCALES):
                        T = ctx.TT[sc]
                        w = (T.year.values == y2) & T.valid.values
                        pool.append(np.c_[pr2[sc][w], T.Y.values[w], np.full(w.sum(), si)])
                cal[y] = np.vstack(pool)
        if intervals:
            for y in years:
                if not model.cheap:
                    pool = []
                    for si, sc in enumerate(SCALES):
                        T = ctx.TT[sc]
                        w = (T.year.values != y) & T.valid.values
                        pool.append(np.c_[P[sc][w], T.Y.values[w], np.full(w.sum(), si)])
                    cal[y] = np.vstack(pool)
                for si, sc in enumerate(SCALES):
                    w = ctx.TT[sc].year.values == y
                    LO[sc][w], HI[sc][w], _ = _intervals(cal[y], P[sc][w])
                    cs = cal[y][cal[y][:, 2] == si]
                    LOs[sc][w], HIs[sc][w], _ = _intervals(cs, P[sc][w])
        for sc in SCALES:
            T = ctx.TT[sc]
            ev = np.isin(T.year.values, eval_years)
            v = T.valid.values & ev
            row = {"direction": ctx.direction, "measure": ctx.meas, "res": ctx.res, "scale": sc, "model": model.name}
            row.update(point_metrics(T.Y.values[v], P[sc][v]))
            if intervals:
                inside = (T.Y.values[v] >= LO[sc][v]) & (T.Y.values[v] <= HI[sc][v])
                row["cov90"] = float(inside.mean())
                act = T.Y.values[v] > 0
                row["cov90_Ypos"] = float(inside[act].mean()) if act.any() else np.nan
                row["pi_width_rel"] = float(np.sum(HI[sc][v] - LO[sc][v]) / max(T.Y.values[v].sum(), 1))
                ins2 = (T.Y.values[v] >= LOs[sc][v]) & (T.Y.values[v] <= HIs[sc][v])
                row["cov90_scalecal"] = float(ins2.mean())
                row["cov90_scalecal_Ypos"] = float(ins2[act].mean()) if act.any() else np.nan
                row["pi_width_rel_scalecal"] = float(np.sum(HIs[sc][v] - LOs[sc][v]) / max(T.Y.values[v].sum(), 1))
                row["interval_calibration"] = "nested" if model.cheap else "leaky_outer"
            yr = pd.DataFrame({"y": T.year.values[v], "Y": T.Y.values[v], "P": P[sc][v]}).groupby("y").sum()
            yerr = yr.P / yr.Y - 1
            row["worst_year_bias"] = float(yerr.abs().max()); row["worst_year"] = int(yerr.abs().idxmax())
            Tsub = T[ev]
            row.update(downstream(Tsub.assign(yi=np.searchsorted(eval_years, Tsub.year.values)), P[sc][ev], eval_years))
            rows.append(row)
            if model.name in keep:
                preds[(model.name, sc)] = T[["box", "year", "slot", "season", "X", "Y", "valid"]].assign(P=P[sc], LO=LO[sc], HI=HI[sc], LOs=LOs[sc], HIs=HIs[sc])
        log(f"  {ctx.direction} {ctx.meas} {ctx.res} {model.name}: {time.time() - t0:.1f}s")
    return rows, preds


if __name__ == "__main__":
    import sys
    from build import build
    B = build("nostatic")
    ctx = Ctx(B, "m2v", "cd05", sys.argv[1] if len(sys.argv) > 1 else "month")
    rows, _ = run(ctx, make_models(sys.argv[2].split(",") if len(sys.argv) > 2 else "core"), intervals=True)
    df = pd.DataFrame(rows)
    pd.set_option("display.width", 250); pd.set_option("display.max_columns", 40)
    print(df.reindex(columns=["scale", "model", "bias", "wape", "pdev", "r_log", "cov90", "cov90_scalecal", "A_pct_mae", "B_pct_mae",
              "own_pct_mae", "A_p90_recall", "year_rank_rho", "season_rank_rho"]).round(3))
