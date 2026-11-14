"""Summarize out/reverse.csv side by side + year-block bootstrap of WAPE for the seasonal model.

The bootstrap re-runs the seasonal LOYO (cheap, deterministic) keeping predictions, then
resamples held-out YEARS with replacement (2000 draws) to get a 90% interval of WAPE per
direction and of the paired WAPE difference is not meaningful (different targets), so we report
each direction's interval and whether they overlap.
"""
import numpy as np
import pandas as pd
from common import OUT

R = pd.read_csv(OUT / "reverse.csv")
cols = ["wape", "bias", "r_log", "A_pct_mae", "B_pct_mae", "A_p90_recall", "year_rank_rho", "zeroY", "own_pct_mae"]
pd.set_option("display.width", 250); pd.set_option("display.max_rows", 200)
for meas in ["cd05", "n"]:
    for per in ["2012-2025", "2012-2020"]:
        sub = R[(R.measure == meas) & (R.period == per)]
        t = sub.pivot_table(index=["scale", "model"], columns="direction", values=cols)
        t = t.reindex(columns=pd.MultiIndex.from_product([cols, ["m2v", "v2m"]]))
        t = t.reindex([(s, m) for s in ["country", "b100", "b25"] for m in ["none", "global", "seasonal", "glm"]])
        print(f"\n=== {meas} {per}")
        print(t.round(3).to_string())

# ---- bootstrap over held-out years for the seasonal model
from build import build
from harmonize import Ctx, run, make_models
B = build("nostatic")
rng = np.random.default_rng(0)
rows = []
for meas in ["cd05", "n"]:
    for y1 in [2025, 2020]:
        for d in ["m2v", "v2m"]:
            ctx = Ctx(B, d, meas, "month", years=np.arange(2012, y1 + 1))
            _, pr = run(ctx, make_models(["seasonal"]), intervals=False, keep=("seasonal",), log=lambda *a: None)
            for sc in ["country", "b100", "b25"]:
                t = pr[("seasonal", sc)]
                t = t[t.valid]
                g = t.assign(ae=(t.P - t.Y).abs()).groupby("year")[["ae", "Y"]].sum()
                yrs = g.index.values
                draws = []
                for _ in range(2000):
                    s = rng.choice(len(yrs), len(yrs), replace=True)
                    draws.append(g.ae.values[s].sum() / g.Y.values[s].sum())
                rows.append(dict(measure=meas, period=f"2012-{y1}", direction=d, scale=sc,
                                 wape=g.ae.sum() / g.Y.sum(), lo=np.quantile(draws, 0.05), hi=np.quantile(draws, 0.95)))
bt = pd.DataFrame(rows)
bt.to_csv(OUT / "reverse_boot.csv", index=False)
print("\n=== seasonal WAPE with 90% year-bootstrap interval")
print(bt.round(3).to_string())
