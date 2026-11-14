"""Supplementary checks: which months drive the Cukurova decline; Southeast June (wheat stubble) series;
tree-class share inside cropland-dominated boxes. Run after run.py."""
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
m = pd.read_pickle(HERE / "cache" / "modis.pkl")
v = pd.read_pickle(HERE / "cache" / "viirs.pkl")
m = m[m.year.between(2003, 2025) & (m.lc != 255)]
v = v[v.year.between(2012, 2025) & (v.lc != 255)]


def box(d, b):
    a, bb, c, e = b
    return d[(d.longitude >= a) & (d.longitude < bb) & (d.latitude >= c) & (d.latitude < e)]


def ts(s):
    x = np.array(s.index, float)
    return round(100 * stats.theilslopes(s.values, x)[0] / s.mean(), 1), round(stats.kendalltau(x, s.values).pvalue, 3)


lines = []
cu = box(m[m.lc == 40], (34.5, 36.5, 36.5, 37.6))
t = cu.groupby(["year", "month"]).size().unstack(fill_value=0)
per = pd.DataFrame({"2003-2007": t.loc[2003:2007].mean(), "2012-2016": t.loc[2012:2016].mean(), "2021-2025": t.loc[2021:2025].mean()}).round(0)
lines.append("Cukurova MODIS cropland hotspots, mean per month\n" + per.T.to_string())
for nm, mo in (("Jun-Jul", [6, 7]), ("Aug-Sep", [8, 9]), ("Oct-May", [10, 11, 12, 1, 2, 3, 4, 5])):
    s = t[[c for c in mo if c in t]].sum(1).reindex(range(2003, 2026), fill_value=0)
    lines.append(f"Cukurova MODIS crop {nm}: TheilSen %/yr, MK p = {ts(s)}; 2003-07 mean {s.loc[2003:2007].mean():.0f}, 2021-25 mean {s.loc[2021:2025].mean():.0f}")
cv = box(v[v.lc == 40], (34.5, 36.5, 36.5, 37.6)).groupby(["year", "month"]).size().unstack(fill_value=0)
s = cv[[6, 7]].sum(1); lines.append(f"Cukurova VIIRS crop Jun-Jul: {ts(s)} values {s.to_dict()}")
for src, d, y0 in (("MODIS", m, 2003), ("VIIRS", v, 2012)):
    se = box(d[(d.lc == 40) & d.day], (37.0, 42.0, 36.6, 38.2))
    s = se[se.month == 6].groupby("year").size().reindex(range(y0, 2026), fill_value=0)
    lines.append(f"Southeast {src} crop daytime June: TheilSen %/yr, MK p = {ts(s)}; series {s.to_dict()}")
for nm, b in (("Cukurova", (34.5, 36.5, 36.5, 37.6)), ("AntMugla", (27.5, 32.5, 36.0, 37.5)), ("Southeast", (37.0, 42.0, 36.6, 38.2))):
    x = box(v, b)
    lines.append(f"{nm} VIIRS class shares %: " + (x.lc.value_counts(normalize=True) * 100).round(1).head(6).to_dict().__repr__())
txt = "\n".join(lines)
(OUT / "extra_checks.txt").write_text(txt, encoding="utf-8")
print(txt)
