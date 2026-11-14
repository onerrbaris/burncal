"""Single entry point: reproduces every number in REPORT.md.

    .venv\\Scripts\\python.exe analysis\\run_all.py            (all steps)
    .venv\\Scripts\\python.exe analysis\\run_all.py --eval     (only the LOYO evaluation jobs)

Steps: diagnostics -> build tables -> era/homogeneity -> LOYO evaluation jobs (parallel)
       -> extra analyses (extras.py) -> report tables (tables.py).
"""
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
PY = sys.executable
OUTD = HERE / "out" / "jobs"
OUTD.mkdir(parents=True, exist_ok=True)


def job(spec):
    import numpy as np
    from build import build
    from harmonize import Ctx, run, make_models, YEARS_ALL
    tag = spec["tag"]
    f = OUTD / f"{tag}.csv"
    if f.exists():
        return tag, "cached", 0.0
    t0 = time.time()
    B = build(spec["filter"])
    years = np.arange(*spec.get("years", (2012, 2026)))
    ctx = Ctx(B, spec["dir"], spec["meas"], spec["res"], years=years)
    rows, preds = run(ctx, make_models(spec["models"]), intervals=spec.get("intervals", True),
                      keep=spec.get("keep", ()), log=lambda *a: None)
    df = pd.DataFrame(rows)
    df.insert(0, "filter", spec["filter"]); df.insert(1, "years", f"{years[0]}-{years[-1]}"); df.insert(0, "tag", tag)
    df.to_csv(f, index=False)
    if preds:
        pd.to_pickle(preds, OUTD / f"{tag}_preds.pkl")
    return tag, "done", time.time() - t0


def specs():
    S = []
    keep = ("none", "global", "seasonal", "qm", "glm", "loglog")
    # A. main: default filter, cd05, both directions, all resolutions, all candidates
    for d in ["m2v", "v2m"]:
        for r in ["p8", "month", "year"]:
            S.append(dict(tag=f"A_{d}_cd05_{r}", filter="nostatic", dir=d, meas="cd05", res=r, models="full", keep=keep))
    # B. other measures, core candidates
    for m in ["n", "cd25", "frp"]:
        for d in ["m2v", "v2m"]:
            for r in ["p8", "month", "year"]:
                S.append(dict(tag=f"B_{d}_{m}_{r}", filter="nostatic", dir=d, meas=m, res=r, models="core"))
    # C. nominal-orbit years only (2012-2020): train and test inside
    for d in ["m2v", "v2m"]:
        for r in ["p8", "month", "year"]:
            S.append(dict(tag=f"C_{d}_cd05_{r}_nominal", filter="nostatic", dir=d, meas="cd05", res=r, models="core",
                          years=(2012, 2021), keep=("seasonal",)))
    # D. filter sensitivity
    for flt in ["nostatic_nolow", "nostatic_day", "nostatic_night", "t0", "all"]:
        for d in ["m2v", "v2m"]:
            for r in ["p8", "month"]:
                S.append(dict(tag=f"D_{d}_cd05_{r}_{flt}", filter=flt, dir=d, meas="cd05", res=r,
                              models=["none", "global", "seasonal", "qm"], intervals=False))
    # E. extra additive candidates motivated by the diagnostics (spatial factor, scan angle)
    for m in ["cd05", "n"]:
        for d in ["m2v", "v2m"]:
            for r in ["p8", "month", "year"]:
                S.append(dict(tag=f"E_{d}_{m}_{r}", filter="nostatic", dir=d, meas=m, res=r,
                              models=["seasonal", "seasonal_box", "seasonal_scan"]))
    return S


def main():
    os.chdir(HERE)
    only_eval = "--eval" in sys.argv
    if not only_eval:
        for s in ["diagnostics.py", "build.py", "era.py"]:
            print("==", s, flush=True)
            subprocess.run([PY, s], check=True, cwd=HERE)
    S = specs()
    # longest first
    order = {"p8": 0, "month": 1, "year": 2}
    S.sort(key=lambda s: (order[s["res"]], s["models"] != "full"))
    nw = int(os.environ.get("NWORKERS", "5"))
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=nw) as ex:
        futs = {ex.submit(job, s): s["tag"] for s in S}
        for f in as_completed(futs):
            try:
                tag, st, dt = f.result()
                print(f"[{time.time() - t0:7.0f}s] {tag}: {st} {dt:.0f}s", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"FAILED {futs[f]}: {e!r}", flush=True)
    allr = pd.concat([pd.read_csv(p) for p in sorted(OUTD.glob("*.csv"))], ignore_index=True)
    allr.to_csv(HERE / "out" / "results_all.csv", index=False)
    print("results:", len(allr), "rows")
    if not only_eval:
        for s in ["extras.py", "tables.py"]:
            print("==", s, flush=True)
            subprocess.run([PY, s], check=True, cwd=HERE)


if __name__ == "__main__":
    main()
