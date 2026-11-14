"""Agricultural-burning analysis. Run: analysis\\agri\\.venv\\Scripts\\python.exe -I analysis\\agri\\run.py
(needs prep.py run first; tiles in analysis/agri/tiles)."""
from pathlib import Path
import numpy as np
import pandas as pd
import rasterio
from rasterio.windows import Window

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
TILES = HERE / "tiles"
import sys
ONLY = set(sys.argv[1].split(",")) if len(sys.argv) > 1 else None  # restrict to these tiles (e.g. while others download)
CLS = {10: "tree", 20: "shrub", 30: "grass", 40: "crop", 50: "built", 60: "bare", 70: "snow",
       80: "water", 90: "wetland", 95: "mangrove", 100: "moss", 0: "nodata"}

v = pd.read_pickle(CACHE / "viirs.pkl")
m = pd.read_pickle(CACHE / "modis.pkl")
v = v[v.year.between(2012, 2025)].reset_index(drop=True)


def save(df, name, idx=True):
    df.to_csv(HERE / name, index=idx)


# ---------------------------------------------------------------- land cover sampling
def sample(d):
    """Return uint8 array of WorldCover class per row (255 = no tile / not covered)."""
    out = np.full(len(d), 255, np.uint8)
    lat, lon = d.latitude.values, d.longitude.values
    tl = (np.floor(lat / 3) * 3).astype(int)
    tn = (np.floor(lon / 3) * 3).astype(int)
    for la in np.unique(tl):
        for lo in np.unique(tn):
            f = TILES / f"ESA_WorldCover_10m_2021_v200_N{la:02d}E{lo:03d}_Map.tif"
            sel = np.where((tl == la) & (tn == lo))[0]
            if len(sel) == 0 or not f.exists() or (ONLY and f"N{la:02d}E{lo:03d}" not in ONLY):
                continue
            with rasterio.open(f) as ds:
                rows, cols = rasterio.transform.rowcol(ds.transform, lon[sel], lat[sel])
                rows, cols = np.asarray(rows), np.asarray(cols)
                ok = (rows >= 0) & (rows < ds.height) & (cols >= 0) & (cols < ds.width)
                sel, rows, cols = sel[ok], rows[ok], cols[ok]
                # windowed reads: process in row blocks of 512 rows
                order = np.argsort(rows)
                sel, rows, cols = sel[order], rows[order], cols[order]
                b = rows // 512
                for bb in np.unique(b):
                    k = b == bb
                    r0 = int(bb) * 512
                    win = Window(0, r0, ds.width, min(512, ds.height - r0))
                    arr = ds.read(1, window=win)
                    out[sel[k]] = arr[rows[k] - r0, cols[k]]
    return out


def lc_tables():
    # NB: a point is a 375 m (VIIRS) / 1 km (MODIS) pixel centre sampled in a 10 m map: label is of the centre pixel only.
    for name, d in (("viirs", v), ("modis", m)):
        d["lc"] = sample(d)
        d.to_pickle(CACHE / f"{name}_lc.pkl")
    # covered mask: inside any tile that exists (lc != 255). Restrict to area covered; report.
    for name, d in (("viirs", v), ("modis", m)):
        c = d[d.lc != 255].copy()
        c["cls"] = c.lc.map(CLS).fillna("other")
        c["crop"] = c.cls == "crop"
        print(name, "covered", len(c), "of", len(d), "nodata/no-tile", int((d.lc == 255).sum()))
        t = c.cls.value_counts()
        save((t / t.sum() * 100).round(2).rename("pct").to_frame().assign(n=t), f"lc_share_overall_{name}.csv")
        mo = pd.crosstab(c.month, c.cls, normalize="index").mul(100).round(2)
        mo["n"] = c.groupby("month").size()
        save(mo, f"lc_share_by_month_{name}.csv")
        yr = pd.crosstab(c.year, c.cls, normalize="index").mul(100).round(2)
        yr["n"] = c.groupby("year").size()
        save(yr, f"lc_share_by_year_{name}.csv")
        print(name, "overall %\n", (t / t.sum() * 100).round(1).to_string())
        print(name, "cropland % by month\n", mo["crop"].to_string())
    return


# ---------------------------------------------------------------- proxy
BOXES = {"Cukurova": (34.5, 36.5, 36.5, 37.6), "SE_GAP": (37.0, 42.0, 36.6, 38.2), "Thrace": (26.0, 28.5, 40.6, 42.1),
         "Konya": (31.5, 34.5, 37.3, 39.0), "AntMugla_forest": (27.5, 32.5, 36.0, 37.5)}


def proxy():
    rows, mon = [], {}
    nat = len(v) / 14
    allsets = {"Turkey": v}
    for k, (a, b, c, d_) in BOXES.items():
        allsets[k] = v[(v.longitude >= a) & (v.longitude < b) & (v.latitude >= c) & (v.latitude < d_)]
    for k, x in allsets.items():
        mc = x.groupby("month").size().reindex(range(1, 13), fill_value=0)
        # mean over years of each year's monthly share
        ym = x.groupby(["year", "month"]).size().unstack(fill_value=0).reindex(columns=range(1, 13), fill_value=0)
        sh = ym.div(ym.sum(1), axis=0).mean() * 100
        mon[k] = sh.round(2)
        pk = sh.idxmax()
        rows.append(dict(region=k, mean_annual=round(len(x) / 14, 1), share_of_national_pct=round(100 * len(x) / len(v), 2),
                         peak_month=int(pk), peak_share_pct=round(sh[pk], 1), day_pct=round(100 * x.day.mean(), 1),
                         median_frp=round(x.frp.median(), 2),
                         jun_jul_pct=round(sh[[6, 7]].sum(), 1), jul_aug_pct=round(sh[[7, 8]].sum(), 1)))
    t = pd.DataFrame(rows)
    save(t, "proxy_boxes.csv", False)
    mm = pd.DataFrame(mon)
    mm.index.name = "month"
    save(mm, "proxy_monthly_share.csv")
    print(t.to_string(index=False))
    print(mm.to_string())


# ---------------------------------------------------------------- top cells
def top():
    d = v.copy()
    d["i"] = np.floor(d.latitude * 4).astype(int)
    d["j"] = np.floor(d.longitude * 4).astype(int)
    g = d.groupby(["i", "j", "year", "month"]).size().rename("n").reset_index().sort_values("n", ascending=False).head(20)
    out = []
    for r in g.itertuples():
        s = d[(d.i == r.i) & (d.j == r.j) & (d.year == r.year) & (d.month == r.month)]
        row = dict(lat=r.i / 4 + .125, lon=r.j / 4 + .125, year=r.year, month=r.month, n=r.n,
                   median_frp=round(s.frp.median(), 1), day_pct=round(100 * s.day.mean()))
        if "lc" in s:
            c = s[s.lc != 255]
            row["crop_pct"] = round(100 * (c.lc == 40).mean(), 1) if len(c) else np.nan
            row["tree_pct"] = round(100 * (c.lc == 10).mean(), 1) if len(c) else np.nan
            row["n_lc"] = len(c)
        out.append(row)
    t = pd.DataFrame(out)
    save(t, "top20_cell_months.csv", False)
    print(t.to_string(index=False))


if __name__ == "__main__":
    proxy()
    lc_tables()
    top()
