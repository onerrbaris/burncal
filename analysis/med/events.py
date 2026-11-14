"""Big fire months in COAST 2012-2025: observed VIIRS vs held-out (LOYO) harmonized-from-MODIS.
Writes events_months.csv (region-month level) and events_cells.csv (top 0.25/1 deg cells)."""
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
Z = np.load(HERE / "cache" / "preds_COAST.npz")
A = np.load(HERE / "cache" / "arrays.npz")
models = ["reg12", "terra_aqua", "nat12"]
YR = np.arange(2012, 2026)
YR_ = Z["Y|R"][0]  # [14,12]
rows = []
for yi, m in zip(*np.unravel_index(np.argsort(-YR_.ravel())[:10], YR_.shape)):
    r = {"year": YR[yi], "month": m + 1, "V_obs": YR_[yi, m]}
    for mo in models:
        r[mo] = round(float(Z[f"{mo}|R"][0, yi, m]), 1)
    rows.append(r)
ev = pd.DataFrame(rows)
ev.to_csv(HERE / "events_months.csv", index=False)
print(ev.to_string(index=False))

i25, j25 = A["i25"], A["j25"]
cells = []
for _, e in ev.head(6).iterrows():
    yi, m = int(e.year - 2012), int(e.month - 1)
    for sc, lab in [("0.25", "0.25"), ("1", "1")]:
        Y = Z[f"Y|{sc}"][:, yi, m]
        top = np.argsort(-Y)[:4]
        for g in top:
            if sc == "0.25":
                lat, lon = i25[g] * 0.25, j25[g] * 0.25
            else:
                gid = pd.factorize(pd.Series(list(zip(i25 // 4, j25 // 4))))
                k = gid[1][g]; lat, lon = k[0], k[1]
            c = {"year": int(e.year), "month": int(e.month), "scale": lab, "lat_sw": lat, "lon_sw": lon,
                 "V_obs": Y[g], "M_obs": None}
            for mo in models:
                c[mo] = round(float(Z[f"{mo}|{sc}"][g, yi, m]), 1)
            # cell's own percentile across years in VIIRS (is it a P90 month?) and predicted flag
            hist = np.delete(Z[f"Y|{sc}"][g, :, m], yi)
            q = np.quantile(hist, 0.9)
            c["obs_gt_P90"] = bool(Y[g] > q); c["reg12_gt_P90"] = bool(Z[f"reg12|{sc}"][g, yi, m] > q)
            cells.append(c)
cd = pd.DataFrame(cells).drop(columns="M_obs")
cd.to_csv(HERE / "events_cells.csv", index=False)
print(cd.to_string(index=False))
# aggregate skill on the top-50 0.25-deg cell-months (largest VIIRS) 2012-2025
Y = Z["Y|0.25"]; P = Z["reg12|0.25"]; PT = Z["terra_aqua|0.25"]
idx = np.argsort(-Y.ravel())[:50]
y, p, pt = Y.ravel()[idx], P.ravel()[idx], PT.ravel()[idx]
print("top50 0.25 cell-months: sumV", y.sum(), "WAPE reg12", round(np.abs(p - y).sum() / y.sum(), 3),
      "bias", round(p.sum() / y.sum() - 1, 3), "median ratio P/V", round(np.median(p / y), 2),
      "share within x2", round(np.mean((p / y > 0.5) & (p / y < 2)), 2),
      "| TA WAPE", round(np.abs(pt - y).sum() / y.sum(), 3))
Y1 = Z["Y|1"]; P1 = Z["reg12|1"]
idx = np.argsort(-Y1.ravel())[:30]
y, p = Y1.ravel()[idx], P1.ravel()[idx]
print("top30 1deg cell-months: WAPE", round(np.abs(p - y).sum() / y.sum(), 3), "bias", round(p.sum() / y.sum() - 1, 3),
      "within x2", round(np.mean((p / y > 0.5) & (p / y < 2)), 2))
