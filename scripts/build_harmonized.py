"""Build the harmonized (VIIRS-equivalent) monthly hotspot series per province for the atlas.

    analysis\\agri\\.venv\\Scripts\\python.exe scripts/build_harmonized.py [--force]

Writes frontend/harmonized-data.js (global `harmonized`) and frontend/harmonized.csv.
Method (docs/REPORT.md sections 3, 4, 10):
  1. drop FIRMS type 1 (volcano) and 3 (offshore); static-source location mask = every 0.01 deg cell
     with any VIIRS type-2 detection 2012-2025, dilated +-1 cell, removed from both sensors.
     MODIS is not filtered by its own type label (version break in 2018).
  2. satellite outage days detected statistically (copy of analysis/common.outages, all types).
     Factor fitting and validation use only days on which Terra, Aqua and S-NPP all report.
     In the output series an outage day of one satellite is filled from the others (see below).
  3. every hotspot -> one of 81 provinces (geoBoundaries ADM1, STRtree point-in-polygon;
     points just outside every polygon, e.g. on the coast, go to the nearest province within 0.05 deg).
  4. monthly unit. From 2012-02: observed S-NPP count (S-NPP outage days filled with MODIS x factor).
     Before: MODIS (Terra+Aqua) x monthly VIIRS/MODIS factor of the province's NUTS-2 region.
     Terra-only days (before 2002-07-04 or Aqua outage): Terra x national (T+A)/T monthly factor
     fitted on 2003-2020; Aqua-only days likewise with (T+A)/A.
  5. regional factors = ratio of sums over 2012-2025 valid days; national factor when the region
     has fewer than MIN_MODIS MODIS detections in that calendar month over the overlap.
  6. leave-one-year-out validation 2012-2025 per province and region.
"""
from pathlib import Path
import json
import os
import sys
import time
import unicodedata
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

T0 = time.time()
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
PROC.mkdir(parents=True, exist_ok=True)
FORCE = "--force" in sys.argv
EPOCH = pd.Timestamp("2000-01-01")
# Years = 2000 .. last year with a raw file. The running year (scripts/fetch_firms_recent.py) is partial:
# everything after the last full data day is null. Factors and validation stay on the complete
# overlap years 2012-2025, so adding the running year never changes the method.
LAST_YEAR = max(int(p.name.split("_")[1]) for p in RAW.glob("*_Turkey.csv"))
YEARS = list(range(2000, LAST_YEAR + 1))
NY = len(YEARS)
FIT_YEARS = list(range(2012, 2026))
# test aid: BURNCAL_CUTOFF=2025-09-13 pretends the data ends that day (exercises the partial-year path)
CUTOFF = os.environ.get("BURNCAL_CUTOFF")
MASK_TO = pd.Timestamp("2025-12-31")   # static-source mask from archive years only (NRT has no type column)
MIN_MODIS = 50          # fallback rule: region-month MODIS detections over 2012-2025 overlap
GJ_URL = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/TUR/ADM1/geoBoundaries-TUR-ADM1.geojson"

REGIONS = {
    "TR10": "İstanbul", "TR21": "Tekirdağ, Edirne, Kırklareli", "TR22": "Balıkesir, Çanakkale",
    "TR31": "İzmir", "TR32": "Aydın, Denizli, Muğla", "TR33": "Manisa, Afyonkarahisar, Kütahya, Uşak",
    "TR41": "Bursa, Eskişehir, Bilecik", "TR42": "Kocaeli, Sakarya, Düzce, Bolu, Yalova",
    "TR51": "Ankara", "TR52": "Konya, Karaman", "TR61": "Antalya, Isparta, Burdur", "TR62": "Adana, Mersin",
    "TR63": "Hatay, Kahramanmaraş, Osmaniye", "TR71": "Kırıkkale, Aksaray, Niğde, Nevşehir, Kırşehir",
    "TR72": "Kayseri, Sivas, Yozgat", "TR81": "Zonguldak, Karabük, Bartın", "TR82": "Kastamonu, Çankırı, Sinop",
    "TR83": "Samsun, Tokat, Çorum, Amasya", "TR90": "Trabzon, Ordu, Giresun, Rize, Artvin, Gümüşhane",
    "TRA1": "Erzurum, Erzincan, Bayburt", "TRA2": "Ağrı, Kars, Iğdır, Ardahan",
    "TRB1": "Malatya, Elazığ, Bingöl, Tunceli", "TRB2": "Van, Muş, Bitlis, Hakkari",
    "TRC1": "Gaziantep, Adıyaman, Kilis", "TRC2": "Şanlıurfa, Diyarbakır", "TRC3": "Mardin, Batman, Şırnak, Siirt",
}
ALIAS = {"afyon": "afyonkarahisar", "k. maras": "kahramanmaras", "kmaras": "kahramanmaras", "icel": "mersin"}


def norm(s):
    s = s.replace("ı", "i").replace("İ", "I")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower().strip()
    return ALIAS.get(s, s)


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


# ------------------------------------------------------------------ provinces + regions
def load_provinces():
    for p in [RAW / "boundaries/TUR-ADM1.geojson", PROC / "boundaries/TUR-ADM1.geojson"]:
        if p.exists():
            break
    else:
        import urllib.request
        p.parent.mkdir(parents=True, exist_ok=True)
        for k in range(5):
            try:
                urllib.request.urlretrieve(GJ_URL, p)
                break
            except Exception as e:  # flaky network: retry
                log("download retry", k, e)
                time.sleep(3)
    feats = json.loads(p.read_text(encoding="utf8"))["features"]
    names = [f["properties"]["shapeName"] for f in feats]
    geoms = [shape(f["geometry"]) for f in feats]
    assert len(names) == 81 and len(set(names)) == 81
    bynorm = {norm(n): n for n in names}
    assert len(bynorm) == 81
    region_of, members = {}, {}
    for code, lst in REGIONS.items():
        members[code] = []
        for part in lst.split(","):
            n = bynorm[norm(part)]          # KeyError = spelling mismatch
            assert n not in region_of, n
            region_of[n] = code
            members[code].append(n)
    assert len(region_of) == 81 and set(region_of) == set(names)
    return names, geoms, region_of, members


# ------------------------------------------------------------------ raw data
def read_raw():
    frames = []
    for pat in ["modis_*_Turkey.csv", "viirs-snpp_*_Turkey.csv"]:
        for f in sorted(RAW.glob(pat)):
            d = pd.read_csv(f, usecols=["latitude", "longitude", "acq_date", "satellite", "type"],
                            dtype={"satellite": str})
            frames.append(d)
    d = pd.concat(frames, ignore_index=True)
    d["sat"] = d.satellite.map({"Terra": 0, "Aqua": 1, "N": 2}).astype(np.int8)
    assert d.sat.notna().all()
    d["day"] = ((pd.to_datetime(d.acq_date) - EPOCH).dt.days).astype(np.int32)
    return d[["latitude", "longitude", "day", "sat", "type"]]


def outages(day, sat, nd, min_expected=10.0):
    """Copy of analysis/common.outages on integer arrays. Returns (outage[3, nd], inspan[3, nd])."""
    cnt = np.zeros((3, nd), np.int64)
    np.add.at(cnt, (sat, day), 1)
    month = (EPOCH + pd.to_timedelta(np.arange(nd), unit="D")).month.values
    insp = np.zeros((3, nd), bool)
    for s in range(3):
        dd = day[sat == s]
        insp[s, dd.min():dd.max() + 1] = True
    out = np.zeros((3, nd), bool)
    for s in range(3):
        o = [x for x in range(3) if x != s]
        ref = sum(np.where(insp[x], cnt[x], 0) for x in o)
        both = insp[s] & (cnt[s] > 0) & (ref > 0)
        ratio = pd.Series(cnt[s][both]).groupby(month[both]).sum() / pd.Series(ref[both]).groupby(month[both]).sum()
        expected = ref * pd.Series(month).map(ratio).fillna(ratio.mean()).values
        zero = cnt[s] == 0
        o_ = (zero & (expected >= min_expected)) | ~insp[s]
        run_id = np.cumsum(~zero)
        o_ |= zero & np.isin(run_id, np.unique(run_id[o_ & zero]))
        out[s] = o_ & insp[s]
    return out, insp


def static_mask(d):
    v = d[(d.type == 2) & (d.sat == 2) & (d.day <= (MASK_TO - EPOCH).days)]
    ii = np.floor(v.latitude.values * 100).astype(np.int64)
    jj = np.floor(v.longitude.values * 100).astype(np.int64)
    base = np.unique(ii * 100000 + jj)
    bi, bj = base // 100000, base % 100000
    keys = np.unique(np.concatenate([(bi + a) * 100000 + (bj + b) for a in (-1, 0, 1) for b in (-1, 0, 1)]))
    k = np.floor(d.latitude.values * 100).astype(np.int64) * 100000 + np.floor(d.longitude.values * 100).astype(np.int64)
    return np.isin(k, keys), len(keys)


def daily_cube(names, geoms):
    """cnt[province, day, sat] after filtering, plus outage/span arrays and stats (cached)."""
    cp = PROC / f"harmonized_daily_{LAST_YEAR}{'_' + CUTOFF if CUTOFF else ''}.npz"
    if cp.exists() and not FORCE:
        z = np.load(cp, allow_pickle=True)
        return z["cnt"], z["out"], z["insp"], z["stats"].item()
    d = read_raw()
    log("rows read", len(d))
    # last full data day: the newest day (today's NRT is still filling up) is dropped unless it is Dec 31
    last = int(d.day.max())
    if (EPOCH + pd.Timedelta(days=last)).strftime("%m-%d") != "12-31":
        last -= 1
    if CUTOFF:
        last = min(last, int((pd.Timestamp(CUTOFF) - EPOCH).days))
    d = d[d.day <= last].reset_index(drop=True)
    nd = int((pd.Timestamp(f"{LAST_YEAR}-12-31") - EPOCH).days) + 1
    out, insp = outages(d.day.values, d.sat.values, nd)
    keep = ~d.type.isin([1, 3]).values
    st, ncells = static_mask(d)
    stats = {"rows": len(d), "type13": int((~keep).sum()), "static_cells": int(ncells),
             "static_removed": int((st & keep).sum())}
    d = d[keep & ~st].reset_index(drop=True)
    log("after filters", len(d))
    pts = shapely.points(d.longitude.values, d.latitude.values)
    tree = shapely.STRtree(geoms)
    pi, gi = tree.query(pts, predicate="intersects")
    prov = np.full(len(d), -1, np.int32)
    first = np.unique(pi, return_index=True)[1]
    prov[pi[first]] = gi[first]
    miss = np.where(prov < 0)[0]
    if len(miss):
        mi, mg = tree.query_nearest(pts[miss], max_distance=0.05)
        prov[miss[mi]] = mg
    stats.update(points=len(d), nearest=int(len(miss)), unassigned=int((prov < 0).sum()), last_day=last)
    ok = prov >= 0
    cnt = np.zeros((81, nd, 3), np.int32)
    np.add.at(cnt, (prov[ok], d.day.values[ok], d.sat.values[ok]), 1)
    np.savez_compressed(cp, cnt=cnt, out=out, insp=insp, stats=np.array(stats, dtype=object))
    return cnt, out, insp, stats


def ranges(mask):
    idx = np.where(mask)[0]
    if not len(idx):
        return []
    br = np.where(np.diff(idx) > 1)[0]
    starts, ends = np.r_[idx[0], idx[br + 1]], np.r_[idx[br], idx[-1]]
    return [((EPOCH + pd.Timedelta(days=int(a))).strftime("%Y-%m-%d"), int(b - a + 1)) for a, b in zip(starts, ends)]


# ------------------------------------------------------------------ main
names, geoms, region_of, members = load_provinces()
codes = list(REGIONS)
reg_idx = np.array([codes.index(region_of[n]) for n in names])
cnt, out, insp, stats = daily_cube(names, geoms)
nd = cnt.shape[1]
log("cube", cnt.shape, stats)

dates = EPOCH + pd.to_timedelta(np.arange(nd), unit="D")
yr, mo = dates.year.values, dates.month.values
ym = (yr - 2000) * 12 + (mo - 1)                      # month index 0..311
NM = NY * 12
LAST_DAY = int(stats.get("last_day", nd - 1))
DATA_THROUGH = EPOCH + pd.Timedelta(days=LAST_DAY)
last_m = (DATA_THROUGH.year - 2000) * 12 + DATA_THROUGH.month - 1   # month index of the last data day
PARTIAL = DATA_THROUGH.strftime("%m-%d") != "12-31"
avail = insp & ~out                                    # [3, nd]
T, A, N = cnt[:, :, 0].astype(float), cnt[:, :, 1].astype(float), cnt[:, :, 2].astype(float)


def msum(x, daymask=None):
    """Sum a [P, nd] (or [nd]) array per month -> [P, 312]."""
    x = np.atleast_2d(x)
    if daymask is not None:
        x = x * daymask
    r = np.zeros((x.shape[0], NM))
    np.add.at(r.T, ym, x.T)
    return r


# Terra -> Terra+Aqua and Aqua -> Terra+Aqua national monthly factors, 2003-2020, both available
both_ta = avail[0] & avail[1] & (yr >= 2003) & (yr <= 2020)
kTA, kAA = np.zeros(13), np.zeros(13)
for m in range(1, 13):
    sel = both_ta & (mo == m)
    t, a = T[:, sel].sum(), A[:, sel].sum()
    kTA[m], kAA[m] = (t + a) / t, (t + a) / a
log("Terra->T+A", np.round(kTA[1:], 2))

# MODIS-equivalent (Terra+Aqua) daily count
meq = np.where(avail[0] & avail[1], T + A,
               np.where(avail[0], T * kTA[mo], np.where(avail[1], A * kAA[mo], 0.0)))

# overlap fitting tables: days where all three satellites report, from S-NPP start
fitday = avail[0] & avail[1] & avail[2]
Mfit = msum(T + A, fitday).reshape(81, NY, 12)
Vfit = msum(N, fitday).reshape(81, NY, 12)
fy = np.array(FIT_YEARS) - 2000


def fit_factors(excl=None):
    ys = [y for y in fy if y != excl]
    MR = np.zeros((26, 12)); VR = np.zeros((26, 12))
    np.add.at(MR, reg_idx, Mfit[:, ys].sum(1)); np.add.at(VR, reg_idx, Vfit[:, ys].sum(1))
    nat = VR.sum(0) / MR.sum(0)
    F = np.where(MR >= MIN_MODIS, VR / np.maximum(MR, 1e-9), nat[None, :])
    return F, MR < MIN_MODIS, nat


F, fb, nat = fit_factors()
log("national factor", np.round(nat, 2))

# ---------------------------------------------------------------- harmonized series
viirs_from = pd.Timestamp("2012-02-01")
Fd = F[reg_idx][:, mo - 1]                                     # [P, nd]
veq = np.where(avail[2][None, :], N, meq * Fd)
h_day = np.where((dates >= viirs_from)[None, :], veq, meq * Fd)
H = msum(h_day).reshape(81, NY, 12)
first_month = ym[np.where(avail[0])[0][0]]                     # first month with MODIS data (2000-11)
Hn = H.copy().reshape(81, NM); Hn[:, :first_month] = np.nan; Hn[:, last_m + 1:] = np.nan; H = Hn.reshape(81, NY, 12)
raw_m = msum(T + A); raw_m[:, last_m + 1:] = np.nan; raw_m = raw_m.reshape(81, NY, 12)
raw_v = msum(N); raw_v[:, last_m + 1:] = np.nan; raw_v = raw_v.reshape(81, NY, 12)
raw_v[:, :12] = np.nan
src_viirs = (np.arange(NM) >= (2012 - 2000) * 12 + 1).reshape(NY, 12)

# ---------------------------------------------------------------- validation (LOYO)
pred = np.zeros_like(Mfit)
for y in fy:
    Fy, _, _ = fit_factors(excl=y)
    pred[:, y] = Mfit[:, y] * Fy[reg_idx]


def scores(P, O):
    """P, O: [n, 26 years, 12] restricted to fit years -> annual wape, monthly wape, bias."""
    P, O = P[:, fy], O[:, fy]
    so = O.sum((1, 2))
    aw = np.abs(P.sum(2) - O.sum(2)).sum(1) / np.maximum(so, 1e-9)
    mw = np.abs(P - O).sum((1, 2)) / np.maximum(so, 1e-9)
    bias = P.sum((1, 2)) / np.maximum(so, 1e-9) - 1
    return aw, mw, bias


aw, mw, bias = scores(pred, Vfit)
PR = np.zeros((26, NY, 12)); OR = np.zeros((26, NY, 12))
np.add.at(PR, reg_idx, pred); np.add.at(OR, reg_idx, Vfit)
raw_, rmw, rbias = scores(PR, OR)
HR = np.zeros((26, NY, 12)); np.add.at(HR, reg_idx, np.nan_to_num(H))
HR.reshape(26, NM)[:, :first_month] = np.nan
HR.reshape(26, NM)[:, last_m + 1:] = np.nan

ann = np.nansum(H, 2); ann[:, 0] = np.nan                       # 2000 incomplete
naive = np.where(np.arange(NY)[None, :] < 12, np.nansum(raw_m, 2), np.nansum(raw_v, 2))


def step(a):
    lo = a[..., 9:12].mean(-1)
    return a[..., 12:15].mean(-1) / np.where(lo > 0, lo, np.nan)


step_raw, step_h = step(naive), step(ann)
step_m = step(np.nansum(raw_m, 2))                                     # MODIS-only reference: real activity change
FULL = min(2025, DATA_THROUGH.year - (1 if PARTIAL else 0)) - 2000 + 1   # index after the last complete year (<= 2025)
mean_ann = ann[:, 12:FULL].mean(1)
annR = np.nansum(HR, 2)
mean_annR = annR[:, 12:FULL].mean(1)


def conf(w, m):
    if w > 0.30 or m < 100:
        return "low"
    if w <= 0.15 and m >= 300:
        return "high"
    return "medium"


def r3(x):
    return None if not np.isfinite(x) else round(float(x), 3)


def ser(a):
    return {str(Y): [None if not np.isfinite(v) else int(round(v)) for v in a[i]] for i, Y in enumerate(YEARS)}


Hfull = H[:, 1:FULL]                                            # quantiles over 2001-2025
provinces, series = {}, {}
for p, n in enumerate(names):
    series[n] = ser(H[p])
    provinces[n] = dict(region=region_of[n], confidence=conf(aw[p], mean_ann[p]), annual_wape=r3(aw[p]),
                        monthly_wape=r3(mw[p]), bias=r3(bias[p]), mean_annual=int(round(mean_ann[p])),
                        median=[int(round(v)) for v in np.median(Hfull[p], 0)],
                        p25=[int(round(v)) for v in np.percentile(Hfull[p], 25, 0)],
                        p75=[int(round(v)) for v in np.percentile(Hfull[p], 75, 0)],
                        step_raw=r3(step_raw[p]), step_harmonized=r3(step_h[p]), step_modis=r3(step_m[p]))
regions = {}
for r, c in enumerate(codes):
    regions[c] = dict(name=REGIONS[c], provinces=members[c], factors=[round(float(v), 3) for v in F[r]],
                      factor_fallback_months=[m + 1 for m in range(12) if fb[r, m]],
                      confidence=conf(raw_[r], mean_annR[r]), annual_wape=r3(raw_[r]), monthly_wape=r3(rmw[r]),
                      bias=r3(rbias[r]), mean_annual=int(round(mean_annR[r])), series=ser(HR[r]))

outs = {s: ranges(out[i]) for i, s in enumerate(["Terra", "Aqua", "S-NPP"])}
meta = dict(
    generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    unit="VIIRS-equivalent hotspot count per calendar month (S-NPP 375 m detections)",
    data_range=f"2000-11 .. {DATA_THROUGH:%Y-%m-%d} (2000 Jan-Oct null: no MODIS data)",
    data_through=f"{DATA_THROUGH:%Y-%m-%d}",
    viirs_from="2012-02",
    method=[
        "Drop FIRMS type 1 (volcano) and 3 (offshore); remove static sources with a fixed mask: 0.01 deg cells with any VIIRS type-2 detection 2012-2025, dilated +-1 cell, applied to both sensors and all years.",
        "From 2012-02: observed S-NPP VIIRS count; S-NPP outage days filled with MODIS x factor.",
        "Before 2012-02: MODIS Terra+Aqua count x monthly VIIRS/MODIS factor of the province's NUTS-2 region (ratio of sums, 2012-2025, days where all satellites report).",
        f"Region-months with < {MIN_MODIS} MODIS detections over 2012-2025 use the national factor.",
        "Terra-only days (before 2002-07-04, Aqua outages): Terra x national (Terra+Aqua)/Terra monthly factor fitted 2003-2020.",
        "Outage days detected statistically per satellite (zero detections when others imply >= 10 expected); excluded from factor fitting and validation.",
        "Validation: leave-one-year-out 2012-2025, WAPE = sum|pred-obs|/sum obs; confidence high: annual WAPE <= 0.15 and mean annual >= 300; low: annual WAPE > 0.30 or mean annual < 100.",
        "step = mean(2012-2014) / mean(2009-2011) annual totals; raw = MODIS before 2012, VIIRS after; step_modis = MODIS alone (the real change the harmonized step should match).",
    ],
    national_factors=[round(float(v), 3) for v in nat],
    terra_to_terra_aqua=[round(float(v), 3) for v in kTA[1:]],
    outages={s: [f"{a} ({k} d)" for a, k in v] for s, v in outs.items()},
    provinces_source="geoBoundaries TUR ADM1 (OSM, CC BY-SA 2.0)",
)
# Running month/year: the same calendar window (day 1 .. last data day) in every year, so a partial
# month or year is compared with like-for-like values, not with full months.
partial = None
if PARTIAL:
    dm, dd_ = DATA_THROUGH.month, DATA_THROUGH.day
    dom = dates.day.values
    def window(sel):
        r = np.zeros((81, NY))
        np.add.at(r.T, yr[sel] - 2000, h_day[:, sel].T)
        return r
    mtd = window((mo == dm) & (dom <= dd_))
    ytd = window((mo < dm) | ((mo == dm) & (dom <= dd_)))
    yrs = YEARS[1:]                                    # 2000 has no MODIS before November
    partial = dict(through=f"{DATA_THROUGH:%Y-%m-%d}", month=dm, day=dd_, years=yrs,
                   mtd={n: [int(round(v)) for v in mtd[p, 1:]] for p, n in enumerate(names)},
                   ytd={n: [int(round(v)) for v in ytd[p, 1:]] for p, n in enumerate(names)})
doc = dict(meta=meta, series=series, provinces=provinces, regions=regions, partial=partial)
js = "const harmonized=" + json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + ";\n"
(ROOT / "frontend/harmonized-data.js").write_text(js, encoding="utf8")

rows = []
for p, n in enumerate(names):
    for i, Y in enumerate(YEARS):
        for m in range(12):
            v = H[p, i, m]
            rows.append((n, region_of[n], Y, m + 1, None if np.isnan(v) else int(round(v)),
                         "viirs" if src_viirs[i, m] else "modis_scaled",
                         None if np.isnan(v) else int(raw_m[p, i, m]),
                         None if np.isnan(raw_v[p, i, m]) else int(raw_v[p, i, m])))
pd.DataFrame(rows, columns=["province", "region", "year", "month", "value", "source", "raw_modis", "raw_viirs"]) \
    .astype({"value": "Int64", "raw_modis": "Int64", "raw_viirs": "Int64"}) \
    .to_csv(ROOT / "frontend/harmonized.csv", index=False, encoding="utf-8")

# ---------------------------------------------------------------- report
log(f"harmonized-data.js {len(js.encode()) / 1024:.0f} KB")
print("\nOutage days used:", {s: [f'{a}({k})' for a, k in v if k >= 3] + [f'+{sum(1 for _, k in v if k < 3)} short'] for s, v in outs.items()})
print("\nNational annual totals")
print(pd.DataFrame({"raw_naive": naive.sum(0).round(), "harmonized": np.nansum(ann, 0).round()}, index=YEARS).iloc[1:].astype(int).to_string())
print("data through", f"{DATA_THROUGH:%Y-%m-%d}", "partial" if PARTIAL else "")
print(f"national step raw {step(naive.sum(0)):.3f}  harmonized {step(np.nansum(ann, 0)):.3f}  MODIS-only {step(np.nansum(raw_m, (0, 2))):.3f}")
print("regional factors\n", pd.DataFrame(F, index=codes, columns=range(1, 13)).round(2).to_string())
for n in ["Antalya", "Adana", "İzmir", "Şanlıurfa", "Eskişehir"]:
    p = names.index(n); a = ann[p, 1:FULL]
    top = [YEARS[1 + i] for i in np.argsort(-a)[:3]]
    print(f"\n{n} ({region_of[n]}) conf={provinces[n]['confidence']} annWAPE={aw[p]:.3f} monWAPE={mw[p]:.3f} bias={bias[p]:+.3f} "
          f"mean={mean_ann[p]:.0f} step raw={step_raw[p]:.2f} harm={step_h[p]:.2f} modis={step_m[p]:.2f} top3={top}")
    print("  ", dict(zip(YEARS[1:], a.round().astype(int).tolist())))
cs = pd.Series({n: v["confidence"] for n, v in provinces.items()})
print("\nconfidence counts", cs.value_counts().to_dict())
print("low:", sorted(cs[cs == "low"].index))
print("region confidence", {c: regions[c]["confidence"] for c in codes})
print("fallback:", {c: regions[c]["factor_fallback_months"] for c in codes if regions[c]["factor_fallback_months"]})
print("factor range", F.min().round(2), F.max().round(2), "neg values:", int((np.nan_to_num(H) < 0).sum()))
rel = step_h / step_m
odd = [(n, round(step_h[p], 2), round(step_m[p], 2), round(step_raw[p], 2)) for p, n in enumerate(names)
       if np.isfinite(rel[p]) and (rel[p] > 1.5 or rel[p] < 2 / 3)]
print("national-level residual step (harm/modis) median", round(float(np.nanmedian(rel)), 2))
print("provinces where harmonized step differs from MODIS-only step by >1.5x (harm, modis, raw):", odd)
log("done")
