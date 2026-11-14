"""Direction comparison: MODIS->VIIRS (m2v) vs VIIRS->MODIS (v2m), monthly, LOYO.

Two periods: 2012-2025 and 2012-2020 (nominal MODIS orbits; train AND test inside the period).
Writes out/reverse.csv. Usage: python reverse.py  (runs 8 jobs in parallel)
"""
import sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from common import OUT

MODELS = ["none", "global", "seasonal", "glm"]


def one(spec):
    from build import build
    from harmonize import Ctx, run, make_models
    d, meas, y0, y1 = spec
    ctx = Ctx(build("nostatic"), d, meas, "month", years=np.arange(y0, y1 + 1))
    rows, _ = run(ctx, make_models(MODELS), intervals=False, log=lambda *a: None)
    df = pd.DataFrame(rows)
    df["period"] = f"{y0}-{y1}"
    return df


if __name__ == "__main__":
    specs = [(d, m, 2012, y1) for d in ["m2v", "v2m"] for m in ["cd05", "n"] for y1 in [2025, 2020]]
    with ProcessPoolExecutor(max_workers=int(sys.argv[1]) if len(sys.argv) > 1 else 4) as ex:
        out = pd.concat(list(ex.map(one, specs)), ignore_index=True)
    out.to_csv(OUT / "reverse.csv", index=False)
    print("rows", len(out))
