"""Review experiments on the Mediterranean boxes (same data recipe as analysis/med/prep.py).

  python analysis/experiments/review_2026_11_14/run_boxes.py
Writes: pareto.csv, forward.csv, forward_years.csv, events.csv, zero_modis.csv,
        sens2012.csv, intervals.csv, gamma_choice.csv
"""
import numpy as np
import pandas as pd
from lib import (HERE, EVI, EVM, MODELS, XKEYS, agg, taggs, detections, valid_days, mask_keys,
                 box_units, build, loyo, score, show, COLS)

d = detections()
valid = valid_days()
keys = mask_keys(d)
ALL = list(MODELS)
SEASON = EVM.SEASON

pareto, fwd, fwdy, events, zero, sens, itv, gch = [], [], [], [], [], [], [], []
for reg in ["MED", "COAST"]:
    x, unit, NU, G = box_units(d, reg)
    D = build(x, unit, NU, valid=valid, keys=keys)

    # ---- 1. Pareto table: every candidate, every scale, LOYO 2012-2025
    EVM.FIT.clear()
    Y, P = loyo(D, G, ALL)
    pareto += score(Y, P, region=reg)
    if "gamma_cv" in EVM.FIT:
        ch = np.array(EVM.FIT["gamma_cv"]).ravel().astype(int)
        gch.append(dict(region=reg, **{XKEYS[k]: int((ch == k).sum()) for k in range(len(XKEYS))}))

    # ---- 2. big months at region level (held-out)
    YR = Y["R"][0]
    for yi, m in zip(*np.unravel_index(np.argsort(-YR.ravel())[:8], YR.shape)):
        r = dict(region=reg, year=2012 + yi, month=m + 1, viirs=YR[yi, m], modis=agg(D["M"], G["R"])[0, EVI[yi], m])
        for n in ALL:
            if n != "raw":
                r[n] = round(P[n]["R"][0, yi, m] / YR[yi, m] - 1, 3)
        events.append(r)

    # ---- 3. forward-in-time tests
    for lab, tr, te in [("2012-2020 -> 2021-2025", np.arange(12, 21), np.arange(21, 26)),
                        ("2012-2022 -> 2023-2025", np.arange(12, 23), np.arange(23, 26)),
                        ("2016-2025 -> 2012-2015 (backward)", np.arange(16, 26), np.arange(12, 16)),
                        ("2017-2020 -> 2012-2016 (backward, pre-drift only)", np.arange(17, 21), np.arange(12, 17))]:
        for n in ALL:
            Pf = {sc: np.stack([agg(MODELS[n](D, G, tr, y), g) for y in te], 1) for sc, g in G.items()}
            for sc, g in G.items():
                Yf = agg(D["V"], g)[:, te]
                for ta, yy in taggs(Yf).items():
                    pp = taggs(Pf[sc])[ta]
                    fwd.append(dict(region=reg, split=lab, model=n, scale=sc, tagg=ta,
                                    wape=np.abs(pp - yy).sum() / yy.sum(), bias=pp.sum() / yy.sum() - 1))
            for k, y in enumerate(te):
                fwdy.append(dict(region=reg, split=lab, model=n, year=2000 + y,
                                 bias_year=Pf["R"][0, k].sum() / D["V"][:, y].sum() - 1))

    # ---- 4. MODIS = 0 and VIIRS > 0 : share of cell-months, of VIIRS, of the absolute error
    for sc, g in G.items():
        Mg, Vg = agg(D["M"], g)[:, EVI], Y[sc]
        E = np.abs(P["reg12"][sc] - Vg)
        act = (Mg > 0) | (Vg > 0); z = (Mg == 0) & (Vg > 0)
        zero.append(dict(region=reg, scale=sc, active_cell_months=int(act.sum()),
                         share_cells_M0_Vpos=z.sum() / act.sum(), share_viirs=Vg[z].sum() / Vg.sum(),
                         share_abs_error=E[z].sum() / E.sum(), wape_all=E.sum() / Vg.sum(),
                         wape_if_those_were_perfect=E[~z].sum() / Vg.sum()))

    # ---- 5. 2012 sensitivity (VIIRS starts 2012-01-20; only common valid days are in the data)
    def cut(D, jan_only):
        D2 = {k: (v.copy() if isinstance(v, np.ndarray) and v.ndim == 3 else v) for k, v in D.items()}
        for k, v in D2.items():
            if isinstance(v, np.ndarray) and v.ndim == 3:
                if jan_only: v[:, 12, 0] = 0
        return D2
    for lab, Dx, ev in [("baseline", D, EVI), ("drop Jan 2012", cut(D, True), EVI), ("drop all 2012", D, EVI[1:])]:
        Y2, P2 = loyo(Dx, {"R": G["R"]}, ["reg12", "terra_aqua"], ev=ev)
        for n in P2:
            y, p = Y2["R"], P2[n]["R"]
            sens.append(dict(region=reg, variant=lab, model=n,
                             wape_month=np.abs(p - y).sum() / y.sum(),
                             wape_year=np.abs(p.sum(2) - y.sum(2)).sum() / y.sum(),
                             wape_january=np.abs(p[:, :, 0] - y[:, :, 0]).sum() / max(y[:, :, 0].sum(), 1),
                             bias_2012=(p[0, 0].sum() / y[0, 0].sum() - 1) if ev[0] == 12 else np.nan,
                             bias=p.sum() / y.sum() - 1))

    # ---- 6. intervals: current cross-conformal (leaky outer) vs truly nested, reg12
    def bins_q(e, b, act):
        e, b = e[act], b[act]; q = {}
        for k in range(len(EVM.BINS) - 1):
            ek = e[b == k]
            if len(ek) < 30: ek = e[np.abs(b - k) <= 1]
            if len(ek) < 30: ek = e
            q[k] = np.quantile(ek, [0.05, 0.95])
        return q

    model = MODELS["reg12"]
    for sc, g in G.items():
        inner = {}  # (outer y, inner j) -> prediction of j fitted without y and j
        for y in EVI:
            tr = np.array([k for k in EVI if k != y])
            for j in tr:
                inner[(y, j)] = agg(model(D, G, np.array([k for k in tr if k != j]), j), g)
        for ta in ["month", "season", "year"]:
            Yt, Pt = taggs(Y[sc])[ta], taggs(P["reg12"][sc])[ta]
            LOl, HIl = EVM.intervals(Yt, Pt)
            LOn, HIn = np.zeros_like(Pt), np.zeros_like(Pt)
            for yi, y in enumerate(EVI):
                tr = [k for k in EVI if k != y]
                Yc = np.stack([taggs(Y[sc][:, [k - 12]])[ta][:, 0] for k in tr], 1)
                Pc = np.stack([taggs(inner[(y, k)][:, None, :])[ta][:, 0] for k in tr], 1)
                q = bins_q((np.log1p(Yc) - np.log1p(Pc)).ravel(), (np.digitize(Pc, EVM.BINS) - 1).ravel(),
                           ((Yc > 0) | (Pc > 0)).ravel())
                b = np.digitize(Pt[:, yi], EVM.BINS) - 1
                for k, (lo, hi) in q.items():
                    s = b == k
                    LOn[:, yi][s] = np.maximum((Pt[:, yi][s] + 1) * np.exp(lo) - 1, 0)
                    HIn[:, yi][s] = (Pt[:, yi][s] + 1) * np.exp(hi) - 1
            for lab, LO, HI in [("current (cross-conformal)", LOl, HIl), ("nested", LOn, HIn)]:
                inside = (Yt >= LO - 1e-9) & (Yt <= HI + 1e-9)
                act = (Yt > 0) | (Pt > 0); pos = Yt > 0
                peryear = [inside[:, i][act[:, i]].mean() for i in range(len(EVI))]
                itv.append(dict(region=reg, scale=sc, tagg=ta, method=lab, n_active=int(act.sum()),
                                cov_active=inside[act].mean(), cov_positive=inside[pos].mean(),
                                cov_all=inside.mean(), cov_year_min=min(peryear), cov_year_max=max(peryear),
                                rel_width=(HI - LO)[act].sum() / Yt[act].sum(),
                                median_hi_over_lo=float(np.median(((HI + 1) / (LO + 1))[act]))))
    print(reg, "done", flush=True)

out = {"pareto": pareto, "forward": fwd, "forward_years": fwdy, "events": events, "zero_modis": zero,
       "sens2012": sens, "intervals": itv, "gamma_choice": gch}
for k, v in out.items():
    pd.DataFrame(v).to_csv(HERE / f"{k}.csv", index=False)

pa = pd.DataFrame(pareto)
print("\n== sanity: reg12 MED R month must equal analysis/med/metrics.csv (0.153)")
show(pa[(pa.model == "reg12") & (pa.scale == "R")], ["region"] + COLS)
print("\n== pareto (R, named5, 1)")
pv = pa[pa.scale.isin(["R", "named5", "1"])].pivot_table(index=["region", "model"], columns=["scale", "tagg"], values="wape")
print(pv.round(3).to_string())
print("\n== rho"); print(pa[pa.scale.isin(["R", "named5", "1"])].pivot_table(index=["region", "model"], columns=["scale", "tagg"], values="year_rank_rho").round(3).to_string())
for k in ["events", "zero_modis", "sens2012", "intervals", "gamma_choice"]:
    print("\n==", k); show(pd.DataFrame(out[k]))
f = pd.DataFrame(fwd)
print("\n== forward"); print(f[f.scale.isin(["R", "named5", "1"])].pivot_table(index=["region", "split", "model"], columns=["scale", "tagg"], values="wape").round(3).to_string())
print(f[f.scale == "R"].pivot_table(index=["region", "split", "model"], columns="tagg", values="bias").round(3).to_string())
print(pd.DataFrame(fwdy).pivot_table(index=["region", "split", "model"], columns="year", values="bias_year").round(3).to_string())
