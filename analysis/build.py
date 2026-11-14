"""Step 2: aggregate detections into (box, period) tables for both sensors.

Base unit: 0.25 deg box x day. Additive measures are computed there and summed
upwards, so 0.25 deg boxes, 1 deg boxes and the whole country are consistent:
    n     detection count
    frp   summed FRP (MW)
    cd05  distinct (0.05 deg cell, day) pairs
    cd25  distinct (0.25 deg cell, day) pairs
Non-additive extras (country / 1 deg only, for sensitivity):
    cd01  distinct (0.1 deg cell, day); cd50, cd100 similarly; fd = fire-days of the area.

Valid days: a day is used only if none of Terra, Aqua, S-NPP has a detected outage
(common.outages). Invalid days are removed from BOTH sensors.
"""
import numpy as np
import pandas as pd
from common import load, CACHE, GRID, static_mask_keys, on_static, outages

FILTERS = {
    # name: (rule, drop low confidence, day/night)
    "nostatic": ("mask", False, None),   # DEFAULT: drop type 1/3 and a fixed static-source mask, keep the rest
    "nostatic_nolow": ("mask", True, None),
    "nostatic_day": ("mask", False, "D"),
    "nostatic_night": ("mask", False, "N"),
    "t0": ("type0", False, None),        # FIRMS type label == 0 (inhomogeneous for MODIS at 2018)
    "all": ("all", False, None),         # no static filtering at all
}


def valid_days(d, sats=("Terra", "Aqua", "N")):
    """Days on which none of `sats` has a detected outage (see common.outages)."""
    out = outages(d)
    full = np.arange(d.dayindex.min(), d.dayindex.max() + 1)
    bad = set().union(*[out[s] for s in sats])
    return set(full.tolist()) - bad


_MASK = {}


def filt(d, name):
    rule, nolow, dn = FILTERS[name]
    if rule == "mask":
        if "k" not in _MASK:
            _MASK["k"] = static_mask_keys(d)
        m = ~d.type.isin([1, 3]).values & ~on_static(d, _MASK["k"])
    elif rule == "type0":
        m = (d.type == 0).values
    else:
        m = np.ones(len(d), bool)
    if nolow:
        m &= (d.conf != "l").values
    if dn == "D":
        m &= d.day.values
    elif dn == "N":
        m &= ~d.day.values
    return d[m]


def _measures(x):
    keys = ["sensor", "bi", "bj", "dayindex"]
    t = x.groupby(keys, observed=True).agg(n=("frp", "size"), frp=("frp", "sum"), scan=("scan", "sum"))
    t["cd05"] = x.drop_duplicates(["sensor", "i05", "j05", "dayindex"]).groupby(keys, observed=True).size()
    t["cd25"] = 1
    return t


def base_table(d, name, valid):
    """(sensor, b25i, b25j, dayindex) -> n, frp, cd05, cd25, scan(sum) and the same split by day (_D) / night (_N)."""
    x = filt(d, name)
    x = x[x.dayindex.isin(valid)]
    x = x.assign(bi=x.i05 // 5, bj=x.j05 // 5)
    t = _measures(x)
    for lab, m in [("D", x.day.values), ("N", ~x.day.values)]:
        part = _measures(x[m]).drop(columns="scan").add_suffix("_" + lab)
        t = t.join(part, how="left")
    return t.fillna(0).reset_index()


def extra_table(d, name, valid):
    """Non-additive measures per (sensor, b100 box, day) and per (sensor, day) country-wide."""
    x = filt(d, name)
    x = x[x.dayindex.isin(valid)]
    x = x.assign(Bi=x.i05 // 20, Bj=x.j05 // 20)
    rows = {}
    for g, k in [("cd01", 2), ("cd50", 10)]:
        rows[g] = x.assign(ci=x.i05 // k, cj=x.j05 // k).drop_duplicates(
            ["sensor", "ci", "cj", "dayindex"]).groupby(["sensor", "Bi", "Bj", "dayindex"], observed=True).size()
    t1 = pd.concat(rows, axis=1).reset_index()
    t1["fd"] = 1  # 1-deg box fire-day (== cd100 at 1 deg)
    return t1


def add_time(t):
    dt = pd.Timestamp("2000-01-01") + pd.to_timedelta(t.dayindex, unit="D")
    t["year"] = dt.dt.year.values
    t["month"] = dt.dt.month.values
    doy = dt.dt.day_of_year.values
    t["p8"] = np.minimum((doy - 1) // 8, 45) + 1
    return t


def build(name="nostatic", force=False):
    cp = CACHE / f"base_{name}.pkl"
    if cp.exists() and not force:
        return pd.read_pickle(cp)
    d = load()
    valid = valid_days(d)
    t = add_time(base_table(d, name, valid))
    e = add_time(extra_table(d, name, valid))
    vd = add_time(pd.DataFrame({"dayindex": sorted(valid)}))
    res = {"base": t, "extra": e, "valid": vd}
    pd.to_pickle(res, cp)
    return res


if __name__ == "__main__":
    for n in FILTERS:
        r = build(n, force=True)
        print(n, {k: len(v) for k, v in r.items()})
