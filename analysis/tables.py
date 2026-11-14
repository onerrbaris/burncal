"""Step 6: evidence tables + worst cases from the LOYO results (writes out/tables.md, out/worst.json)."""
import json
import numpy as np
import pandas as pd
from common import OUT

R = pd.read_csv(OUT / "results_all.csv")
lines = []
P = lambda s: lines.append(s)  # noqa: E731
SC = ["country", "b200", "b100", "b50", "b25"]
SCN = {"country": "Turkey", "b200": "2°", "b100": "1°", "b50": "0.5°", "b25": "0.25°"}


def fmt(x, nd=2, pct=False):
    if pd.isna(x):
        return "–"
    return f"{100 * x:.0f}%" if pct else f"{x:.{nd}f}"


def evidence(df, title, scales=("country", "b100", "b25")):
    P(f"\n#### {title}\n")
    hdr = "| model | " + " | ".join(f"{SCN[s]} WAPE | {SCN[s]} bias | {SCN[s]} r_log | {SCN[s]} cov90 | {SCN[s]} pct-err A/B | {SCN[s]} P90 rec A | {SCN[s]} ρ_years" for s in scales) + " |"
    P(hdr)
    P("|" + "---|" * (1 + 7 * len(scales)))
    for m in df.model.unique():
        cells = [m]
        for s in scales:
            r = df[(df.model == m) & (df.scale == s)]
            if r.empty:
                cells += ["–"] * 7
                continue
            r = r.iloc[0]
            cov = r.get("cov90_scalecal", np.nan)
            cells += [fmt(r.wape, pct=True), fmt(r.bias, pct=True), fmt(r.r_log), fmt(cov, pct=True),
                      f"{fmt(r.A_pct_mae)}/{fmt(r.B_pct_mae)}", fmt(r.A_p90_recall, pct=True), fmt(r.year_rank_rho)]
        P("| " + " | ".join(cells) + " |")


# ---------------------------------------------------------------- main evidence (A jobs)
A = R[R.tag.str.startswith("A_")]
for d in ["m2v", "v2m"]:
    for res in ["p8", "month", "year"]:
        sub = A[(A.direction == d) & (A.res == res)]
        own = sub[sub.model == "none"][["scale", "own_pct_mae", "own_p90_recall"]].set_index("scale")
        evidence(sub, f"{d} · cd05 · {res} · LOYO 2012–2025 (no-conversion own-sensor percentile error: "
                 + ", ".join(f"{SCN[s]} {own.loc[s, 'own_pct_mae']:.2f}" for s in ["country", "b100", "b25"] if s in own.index) + ")")

# ---------------------------------------------------------------- scale ladder for chosen models
P("\n### Scale ladder (all five scales), cd05, m2v\n")
P("| res | model | scale | WAPE | bias | r_log | within×2 (Y≥5) | cov90 (scale-cal) | PI width/ΣY | pct-err A | pct-err B | own pct-err | P90 recall A | P90 prec A | ρ years | ρ season | zero share |")
P("|" + "---|" * 17)
for res in ["p8", "month", "year"]:
    for m in ["seasonal", "glm", "qm", "none"]:
        for s in SC:
            r = A[(A.direction == "m2v") & (A.res == res) & (A.model == m) & (A.scale == s)]
            if r.empty:
                continue
            r = r.iloc[0]
            P(f"| {res} | {m} | {SCN[s]} | {fmt(r.wape, pct=True)} | {fmt(r.bias, pct=True)} | {fmt(r.r_log)} | {fmt(r.get('within_x2_Yge5'), pct=True)} | "
              f"{fmt(r.cov90_scalecal, pct=True)} | {fmt(r.pi_width_rel_scalecal)} | {fmt(r.A_pct_mae)} | {fmt(r.B_pct_mae)} | {fmt(r.own_pct_mae)} | "
              f"{fmt(r.A_p90_recall, pct=True)} | {fmt(r.A_p90_precision, pct=True)} | {fmt(r.year_rank_rho)} | {fmt(r.get('season_rank_rho'))} | {fmt(r.zeroY, pct=True)} |")

# ---------------------------------------------------------------- measures (B jobs + A for cd05)
P("\n### Measure comparison (seasonal model, LOYO 2012–2025)\n")
P("| direction | res | measure | Turkey WAPE | Turkey r_log | 1° WAPE | 1° r_log | 1° ρ years | 0.25° WAPE | 0.25° r_log | 0.25° pct-err A |")
P("|" + "---|" * 11)
MB = R[(R.tag.str.startswith("B_") | R.tag.str.startswith("A_")) & (R.model == "seasonal")]
for d in ["m2v", "v2m"]:
    for res in ["p8", "month", "year"]:
        for meas in ["n", "cd05", "cd25", "frp"]:
            g = MB[(MB.direction == d) & (MB.res == res) & (MB.measure == meas)].set_index("scale")
            if g.empty:
                continue
            P(f"| {d} | {res} | {meas} | {fmt(g.loc['country', 'wape'], pct=True)} | {fmt(g.loc['country', 'r_log'])} | {fmt(g.loc['b100', 'wape'], pct=True)} | "
              f"{fmt(g.loc['b100', 'r_log'])} | {fmt(g.loc['b100', 'year_rank_rho'])} | {fmt(g.loc['b25', 'wape'], pct=True)} | {fmt(g.loc['b25', 'r_log'])} | {fmt(g.loc['b25', 'A_pct_mae'])} |")

# ---------------------------------------------------------------- nominal years (C jobs)
P("\n### Nominal-orbit years only (train & test within 2012–2020), cd05\n")
P("| direction | res | model | Turkey WAPE | Turkey bias | 1° WAPE | 0.25° WAPE | Turkey cov90 | 1° cov90 | Turkey ρ years | 1° ρ years |")
P("|" + "---|" * 11)
C = R[R.tag.str.startswith("C_")]
for d in ["m2v", "v2m"]:
    for res in ["p8", "month", "year"]:
        for m in C.model.unique():
            g = C[(C.direction == d) & (C.res == res) & (C.model == m)].set_index("scale")
            if g.empty:
                continue
            P(f"| {d} | {res} | {m} | {fmt(g.loc['country', 'wape'], pct=True)} | {fmt(g.loc['country', 'bias'], pct=True)} | {fmt(g.loc['b100', 'wape'], pct=True)} | "
              f"{fmt(g.loc['b25', 'wape'], pct=True)} | {fmt(g.loc['country', 'cov90_scalecal'], pct=True)} | {fmt(g.loc['b100', 'cov90_scalecal'], pct=True)} | "
              f"{fmt(g.loc['country', 'year_rank_rho'])} | {fmt(g.loc['b100', 'year_rank_rho'])} |")

# ---------------------------------------------------------------- filters (D jobs)
P("\n### Filter sensitivity (cd05, seasonal model, LOYO 2012–2025)\n")
P("| direction | res | filter | Turkey WAPE | Turkey r_log | 1° WAPE | 1° r_log | 0.25° WAPE | 1° ρ years |")
P("|" + "---|" * 9)
D = R[(R.tag.str.startswith("D_") | R.tag.str.startswith("A_")) & (R.model == "seasonal") & (R.res != "year")]
for d in ["m2v", "v2m"]:
    for res in ["p8", "month"]:
        for flt in ["nostatic", "nostatic_nolow", "nostatic_day", "nostatic_night", "t0", "all"]:
            g = D[(D.direction == d) & (D.res == res) & (D["filter"] == flt) & (D.measure == "cd05")].set_index("scale")
            if g.empty:
                continue
            P(f"| {d} | {res} | {flt} | {fmt(g.loc['country', 'wape'], pct=True)} | {fmt(g.loc['country', 'r_log'])} | {fmt(g.loc['b100', 'wape'], pct=True)} | "
              f"{fmt(g.loc['b100', 'r_log'])} | {fmt(g.loc['b25', 'wape'], pct=True)} | {fmt(g.loc['b100', 'year_rank_rho'])} |")

open(OUT / "tables.md", "w", encoding="utf-8").write("\n".join(lines))
print("\n".join(lines[:5]))

# ---------------------------------------------------------------- worst cases (seasonal, m2v cd05)
W = {}
for res in ["month", "p8", "year"]:
    f = OUT / "jobs" / f"A_m2v_cd05_{res}_preds.pkl"
    if not f.exists():
        continue
    pr = pd.read_pickle(f)
    for m in ["seasonal", "glm"]:
        if (m, "country") not in pr:
            continue
        t = pr[(m, "country")]
        t = t[t.valid].copy()
        t["relerr"] = t.P / t.Y - 1
        t["inPI"] = (t.Y >= t.LOs) & (t.Y <= t.HIs)
        W[f"{res}_{m}_country_worst"] = t.reindex(t.relerr.abs().sort_values(ascending=False).index).head(8)[
            ["year", "slot", "X", "Y", "P", "LOs", "HIs", "relerr", "inPI"]].round(3).to_dict("records")
        yr = t.groupby("year")[["X", "Y", "P"]].sum()
        W[f"{res}_{m}_country_by_year_bias"] = (yr.P / yr.Y - 1).round(3).to_dict()
        if res != "year":
            t1 = pr[(m, "b100")]
            t1 = t1[t1.valid]
            by = t1.groupby(["box", "year"])[["Y", "P"]].sum()
            by = by[by.Y >= 50]
            by["relerr"] = by.P / by.Y - 1
            W[f"{res}_{m}_b100_boxyear_relerr_quantiles(Y>=50)"] = by.relerr.quantile([.05, .25, .5, .75, .95]).round(3).to_dict()
            W[f"{res}_{m}_b100_boxyear_worst(Y>=50)"] = by.reindex(by.relerr.abs().sort_values(ascending=False).index).head(6).reset_index().round(3).to_dict("records")
json.dump(W, open(OUT / "worst.json", "w"), indent=1, default=str)
for k, v in W.items():
    if "by_year" in k or "quantiles" in k:
        print(k, v)
