"""VIIRS -> MODIS-equivalent by THINNING, plus noise floors. Monthly cd05, LOYO.

Thinning candidates (applied to VIIRS detections, nostatic filter, valid days):
  frp_T     : keep detections with FRP >= T, then count 0.05 deg cell-days
  clu_k_S   : keep a 0.05 deg cell-day if it has >= k VIIRS detections OR summed FRP >= S
For each held-out year the candidate is chosen on TRAINING years only (in-sample WAPE of
thinned+seasonal vs MODIS at 0.25 deg x month); a seasonal ratio (fit on training years)
is always applied after thinning ("thin+seasonal").

Noise floors:
  terra_aqua : predict Aqua-only cd05 from Terra-only cd05 (seasonal, LOYO): two looks by the same sensor
  poisson    : (i) WAPE a perfect-mean predictor would get if the target were Poisson around the
               seasonal prediction; (ii) percentile/P90 agreement between two independent Poisson
               draws around the observed target (plug-in).
Writes out/thinning.csv, out/thinning_choice.csv, out/floors.csv
"""
import numpy as np
import pandas as pd
from build import build, filt, add_time
from common import load, OUT
from harmonize import Ctx, make_model, fit_predict, point_metrics, downstream, SCALES, COLS

SC3 = ["country", "b100", "b25"]


def viirs_dets():
    B = build("nostatic")
    valid = set(B["valid"].dayindex)
    d = filt(load(), "nostatic")
    return B, d[d.dayindex.isin(valid)]


def base_from(x, sensor_label):
    """detections -> base-table rows (sensor, bi, bj, dayindex, COLS...)."""
    x = x.assign(bi=x.i05 // 5, bj=x.j05 // 5)
    keys = ["bi", "bj", "dayindex"]
    t = x.groupby(keys).agg(n=("frp", "size"), frp=("frp", "sum")).reset_index()
    c = x.drop_duplicates(["i05", "j05", "dayindex"]).groupby(keys).size().rename("cd05").reset_index()
    t = t.merge(c, on=keys)
    t["cd25"] = 1
    for col in COLS:
        if col not in t:
            t[col] = 0.0
    t["sensor"] = sensor_label
    return add_time(t)


def thinned(v, spec):
    if spec == "raw":
        return v
    kind, *p = spec.split("_")
    if kind == "frp":
        return v[v.frp >= float(p[0])]
    k, S = int(p[0]), float(p[1])
    g = v.groupby(["i05", "j05", "dayindex"]).frp.agg(["size", "sum"])
    keep = g[(g["size"] >= k) | (g["sum"] >= S)].index
    idx = pd.MultiIndex.from_arrays([v.i05, v.j05, v.dayindex])
    return v[idx.isin(keep)]


CANDS = ["raw"] + [f"frp_{t}" for t in [3, 5, 8, 12, 20]] + \
        [f"clu_{k}_{s}" for k in [2, 3, 4] for s in [10, 25, 50, 1e9]]


def loyo_selected(B, v, years, family):
    """Returns per-scale held-out predictions (thin+seasonal, threshold chosen on training years) and choices."""
    modis = B["base"][B["base"].sensor == "MODIS"]
    cands = [c for c in CANDS if c == "raw" or c.startswith(family)]
    ctxs = {}
    for c in cands:
        Bc = {"base": pd.concat([modis, base_from(thinned(v, c), "VIIRS")], ignore_index=True), "valid": B["valid"]}
        ctxs[c] = Ctx(Bc, "v2m", "cd05", "month", years=years)
    ref = ctxs[cands[0]]
    P = {sc: np.full(len(ref.TT[sc]), np.nan) for sc in SCALES}
    choice = []
    m = make_model("seasonal")
    for y in years:
        train = years[years != y]
        best, bs = None, np.inf
        for c in cands:
            ctx = ctxs[c]
            T = ctx.Tf
            tr = np.isin(T.year.values, train) & T.valid.values
            pf = make_model("seasonal").fit(T, tr).predict(T)
            score = np.abs(pf[tr] - T.Y.values[tr]).sum() / T.Y.values[tr].sum()
            if score < bs:
                best, bs = c, score
        pr = fit_predict(ctxs[best], m, train)
        for sc in SCALES:
            Tb, Tr = ctxs[best].TT[sc], ref.TT[sc]
            s_ = pd.Series(pr[sc], index=pd.MultiIndex.from_arrays([Tb.box.values, Tb.year.values, Tb.slot.values]))
            mapped = s_.reindex(pd.MultiIndex.from_arrays([Tr.box.values, Tr.year.values, Tr.slot.values])).fillna(0).values
            w = Tr.year.values == y
            P[sc][w] = mapped[w]
        choice.append(dict(family=family, period=f"{years[0]}-{years[-1]}", year=int(y), chosen=best, train_wape=bs))
    return ref, P, choice


def score(ctx, P, label, period):
    rows = []
    for sc in SC3:
        T = ctx.TT[sc]
        v = T.valid.values
        r = {"model": label, "period": period, "scale": sc}
        r.update(point_metrics(T.Y.values[v], P[sc][v]))
        r.update(downstream(T, P[sc], ctx.years))
        rows.append(r)
    return rows


def pois_mad(mu):
    """E|Pois(mu) - mu| (exact for mu < 60, normal approx above)."""
    from scipy.stats import poisson
    mu = np.asarray(mu, float)
    out = np.sqrt(2 * mu / np.pi)
    small = mu < 60
    k = np.arange(0, 200)
    for i in np.flatnonzero(small):
        out[i] = np.sum(np.abs(k - mu[i]) * poisson.pmf(k, mu[i]))
    return out


if __name__ == "__main__":
    B, d = viirs_dets()
    v = d[d.sensor == "VIIRS"]
    rows, choices, floors = [], [], []
    for y1 in [2020, 2025]:
        years = np.arange(2012, y1 + 1)
        per = f"2012-{y1}"
        for fam in ["frp", "clu"]:
            ctx, P, ch = loyo_selected(B, v, years, fam)
            rows += score(ctx, P, f"thin_{fam}+seasonal", per)
            choices += ch
        # reference ratio models on the same tables
        ctx = Ctx(B, "v2m", "cd05", "month", years=years)
        for mname in ["none", "seasonal"]:
            mdl = make_model(mname)
            P = {sc: np.full(len(ctx.TT[sc]), np.nan) for sc in SCALES}
            for y in years:
                pr = fit_predict(ctx, mdl, years[years != y])
                for sc in SCALES:
                    w = ctx.TT[sc].year.values == y
                    P[sc][w] = pr[sc][w]
            rows += score(ctx, P, mname, per)
            if mname == "seasonal":
                # Poisson floors around this model and around the observed target
                rng = np.random.default_rng(0)
                for sc in SC3:
                    T = ctx.TT[sc]; vv = T.valid.values
                    f1 = pois_mad(np.maximum(P[sc][vv], 0)).sum() / T.Y.values[vv].sum()
                    Y1 = rng.poisson(T.Y.values); Y2 = rng.poisson(T.Y.values)
                    Tp = T.copy(); Tp["Y"] = Y1.astype(float)
                    ds = downstream(Tp, Y2.astype(float), years)
                    floors.append(dict(floor="poisson", period=per, scale=sc, wape_perfect_mean=f1,
                                       wape_two_draws=np.abs(Y1 - Y2)[vv].sum() / max(Y1[vv].sum(), 1),
                                       A_pct_mae=ds["A_pct_mae"], A_p90_recall=ds["A_p90_recall"],
                                       A_p90_precision=ds["A_p90_precision"], year_rank_rho=ds.get("year_rank_rho")))
    # Terra-only vs Aqua-only (nominal years only: orbit drift after 2020)
    years = np.arange(2012, 2021)
    m = d[d.sensor == "MODIS"]
    Bta = {"base": pd.concat([base_from(m[m.sat == "Terra"], "MODIS"), base_from(m[m.sat == "Aqua"], "VIIRS")], ignore_index=True),
           "valid": B["valid"]}
    ctx = Ctx(Bta, "m2v", "cd05", "month", years=years)   # X = Terra, Y = Aqua
    P = {sc: np.full(len(ctx.TT[sc]), np.nan) for sc in SCALES}
    for y in years:
        pr = fit_predict(ctx, make_model("seasonal"), years[years != y])
        for sc in SCALES:
            w = ctx.TT[sc].year.values == y
            P[sc][w] = pr[sc][w]
    for r in score(ctx, P, "terra->aqua seasonal", "2012-2020"):
        r["floor"] = "terra_aqua"; floors.append(r)
    pd.DataFrame(rows).to_csv(OUT / "thinning.csv", index=False)
    pd.DataFrame(choices).to_csv(OUT / "thinning_choice.csv", index=False)
    pd.DataFrame(floors).to_csv(OUT / "floors.csv", index=False)
    cols = ["model", "period", "scale", "wape", "bias", "r_log", "A_pct_mae", "B_pct_mae", "A_p90_recall", "A_p90_precision", "year_rank_rho", "zeroY"]
    pd.set_option("display.width", 250)
    print(pd.DataFrame(rows)[cols].round(3).to_string())
    print(pd.DataFrame(choices).groupby(["family", "period"]).chosen.value_counts().to_string())
    print(pd.DataFrame(floors).round(3).to_string())
