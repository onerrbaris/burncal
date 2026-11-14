"""Shared loading / gridding helpers for the MODIS-VIIRS harmonization study.

All grids are nested multiples of a 0.05 deg integer index so that every box
size used (0.05, 0.1, 0.25, 0.3, 0.5, 1.0 deg) aligns exactly:
    i05 = floor(lat * 20), j05 = floor(lon * 20)
"""
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "analysis" / "out"
CACHE = ROOT / "analysis" / "cache"
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

# grid size in deg -> number of 0.05 deg sub-cells per side
GRID = {0.05: 1, 0.1: 2, 0.25: 5, 0.3: 6, 0.5: 10, 1.0: 20}


def period8(doy):
    """8-day period 1..46 as defined in the project (last period absorbs 5-6 days)."""
    return np.minimum((doy - 1) // 8, 45) + 1


def _read(pattern, sensor):
    frames = []
    for f in sorted(RAW.glob(pattern)):
        d = pd.read_csv(f, dtype={"acq_time": str, "confidence": str, "version": str})
        d = d.rename(columns={"bright_ti4": "bright", "brightness": "bright",
                              "bright_ti5": "bright2", "bright_t31": "bright2"})
        d["file"] = f.name
        frames.append(d)
    d = pd.concat(frames, ignore_index=True)
    d["sensor"] = sensor
    return d


def load(force=False):
    """Return one DataFrame with both sensors and derived columns (cached)."""
    cp = CACHE / "all.pkl"
    if cp.exists() and not force:
        return pd.read_pickle(cp)
    m = _read("modis_*_Turkey.csv", "MODIS")
    v = _read("viirs-snpp_*_Turkey.csv", "VIIRS")
    d = pd.concat([m, v], ignore_index=True)
    d["date"] = pd.to_datetime(d["acq_date"])
    d["year"] = d["date"].dt.year.astype(np.int16)
    d["month"] = d["date"].dt.month.astype(np.int8)
    d["doy"] = d["date"].dt.dayofyear.astype(np.int16)
    d["p8"] = period8(d["doy"]).astype(np.int8)
    d["hhmm"] = d["acq_time"].astype(int)
    d["utc_h"] = (d["hhmm"] // 100) + (d["hhmm"] % 100) / 60.0
    d["i05"] = np.floor(d["latitude"] * 20).astype(np.int32)
    d["j05"] = np.floor(d["longitude"] * 20).astype(np.int32)
    # unified confidence class: low / nominal / high
    conf = pd.Series(index=d.index, dtype=object)
    ism = d["sensor"] == "MODIS"
    cm = pd.to_numeric(d.loc[ism, "confidence"], errors="coerce")
    conf.loc[ism] = np.where(cm < 30, "l", np.where(cm < 80, "n", "h"))
    conf.loc[~ism] = d.loc[~ism, "confidence"].str.lower().str[0]
    d["conf"] = conf.astype("category")
    d["sat"] = d["satellite"].astype("category")
    d["day"] = (d["daynight"] == "D")
    d["dayindex"] = (d["date"] - pd.Timestamp("2000-01-01")).dt.days.astype(np.int32)
    d = d.drop(columns=["acq_date", "acq_time", "satellite", "instrument", "daynight"])
    d.to_pickle(cp)
    return d


def static_mask_keys(d, buffer=1):
    """Fixed static-source mask: 0.01 deg cells holding any VIIRS type-2 detection
    (2012-2025), dilated by `buffer` cells (~1 km) for MODIS geolocation.
    Applied identically to all years / both sensors, so it cannot create steps in time.
    MODIS type-2 labels are NOT used: they appear mostly from the 2018 version switch on
    and behave like fires (median 3 detection days per cell, 95% daytime; see diagnostics)."""
    s = d[(d.type == 2) & (d.sensor == "VIIRS")]
    ii = np.floor(s.latitude.values * 100).astype(np.int64)
    jj = np.floor(s.longitude.values * 100).astype(np.int64)
    base = set(zip(ii.tolist(), jj.tolist()))
    out = set()
    for a, b in base:
        for da in range(-buffer, buffer + 1):
            for db in range(-buffer, buffer + 1):
                out.add((a + da) * 100000 + (b + db))
    return out


def on_static(d, keys):
    k = np.floor(d.latitude.values * 100).astype(np.int64) * 100000 + np.floor(d.longitude.values * 100).astype(np.int64)
    return np.isin(k, np.fromiter(keys, dtype=np.int64))


def outages(d, min_expected=10.0):
    """Detect satellite outages statistically.

    A day with zero detections (any type) for satellite s is an outage when the other
    satellites' detections that day, scaled by the typical s/other ratio for that calendar
    month, make >= min_expected detections expected for s. Otherwise it is treated as a
    genuine zero (all sensors quiet). Returns dict sat -> set(dayindex) of outage days,
    including days outside the satellite's mission span.
    """
    cnt = d.groupby(["dayindex", "sat"], observed=True).size().unstack(fill_value=0)
    full = np.arange(d.dayindex.min(), d.dayindex.max() + 1)
    cnt = cnt.reindex(full, fill_value=0)
    month = (pd.Timestamp("2000-01-01") + pd.to_timedelta(full, unit="D")).month
    span = {s: (d.loc[d.sat == s, "dayindex"].min(), d.loc[d.sat == s, "dayindex"].max()) for s in ["Terra", "Aqua", "N"]}
    insp = {s: (full >= span[s][0]) & (full <= span[s][1]) for s in span}
    res = {}
    for s in ["Terra", "Aqua", "N"]:
        others = [o for o in ["Terra", "Aqua", "N"] if o != s]
        # reference = sum of other satellites that are in span that day
        ref = sum(np.where(insp[o], cnt[o].values, 0) for o in others)
        both = insp[s] & (cnt[s].values > 0) & (ref > 0)
        ratio = pd.Series(cnt[s].values[both]).groupby(month[both]).sum() / pd.Series(ref[both]).groupby(month[both]).sum()
        expected = ref * pd.Series(month).map(ratio).fillna(ratio.mean()).values
        zero = cnt[s].values == 0
        out = (zero & (expected >= min_expected)) | ~insp[s]
        # extend: a zero-day adjacent to an outage day inside the same zero-run is an outage too
        run_id = np.cumsum(~zero)
        flagged_runs = set(run_id[out & zero])
        out |= zero & np.isin(run_id, list(flagged_runs))
        res[s] = set(full[out].tolist())
    return res


# ----------------------------------------------------------------- numpy-only stats
def rank(a):
    return pd.Series(a).rank(method="average").values


def spearman(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if a.std() == 0 or b.std() == 0:
        return np.nan
    return float(np.corrcoef(rank(a), rank(b))[0, 1])


def nnls2(A, y):
    """Least squares with coef >= 0 for 2 columns (exhaustive active-set)."""
    best, bestc = np.inf, np.zeros(A.shape[1])
    cands = []
    c, *_ = np.linalg.lstsq(A, y, rcond=None)
    cands.append(c)
    for j in range(A.shape[1]):
        cj = np.zeros(A.shape[1])
        den = A[:, j] @ A[:, j]
        cj[j] = max((A[:, j] @ y) / den, 0) if den > 0 else 0
        cands.append(cj)
    for c in cands:
        if np.all(c >= 0):
            r = np.sum((A @ c - y) ** 2)
            if r < best:
                best, bestc = r, c
    return bestc


def nn_poisson_identity(A, y, iters=2000, tol=1e-10):
    """Non-negative Poisson MLE for E[y] = A @ c (identity link), multiplicative (EM) updates.
    Reduces to the ratio of sums for one column. Rows with all-zero inputs cannot be fitted;
    like the ratio of sums, the result is rescaled so that sum(A @ c) == sum(y) over ALL rows,
    i.e. activity seen only by the target sensor is spread proportionally."""
    ytot = y.sum()
    Aall = A
    keep = A.sum(1) > 0
    A, y = A[keep], y[keep]
    colsum = A.sum(0)
    c = np.where(colsum > 0, y.sum() / max(colsum.sum(), 1e-12), 0.0) * np.ones(A.shape[1])
    for _ in range(iters):
        mu = np.maximum(A @ c, 1e-12)
        new = c * (A.T @ (y / mu)) / np.maximum(colsum, 1e-12)
        if np.max(np.abs(new - c)) < tol * max(1.0, np.max(np.abs(c))):
            c = new
            break
        c = new
    tot = (Aall @ c).sum()
    return c * (ytot / tot) if tot > 0 else c


def trend_test(years, values, nperm=20000, seed=0):
    """OLS slope of log(values) on year (% per year) + two-sided permutation p-value."""
    x = np.asarray(years, float); y = np.log(np.asarray(values, float))
    xc = x - x.mean()
    slope = (xc @ (y - y.mean())) / (xc @ xc)
    rng = np.random.default_rng(seed)
    perm = np.array([(xc @ (rng.permutation(y) - y.mean())) / (xc @ xc) for _ in range(nperm)])
    p = (np.sum(np.abs(perm) >= abs(slope)) + 1) / (nperm + 1)
    return float(100 * (np.exp(slope) - 1)), float(p)


def poisson_irls(A, y, iters=50, ridge=1e-6):
    """Poisson GLM with log link, no intercept added (put it in A)."""
    beta = np.zeros(A.shape[1])
    beta[0] = np.log(max(y.mean(), 1e-6)) if np.allclose(A[:, 0], 1) else 0.0
    for _ in range(iters):
        eta = np.clip(A @ beta, -30, 30)
        mu = np.exp(eta)
        z = eta + (y - mu) / mu
        AW = A * mu[:, None]
        H = A.T @ AW + ridge * np.eye(A.shape[1])
        new = np.linalg.solve(H, AW.T @ z)
        if np.max(np.abs(new - beta)) < 1e-8:
            beta = new
            break
        beta = new
    return beta


def cell(d, g):
    """Integer cell ids (i, j) at grid g deg."""
    k = GRID[g]
    return d["i05"].values // k, d["j05"].values // k
