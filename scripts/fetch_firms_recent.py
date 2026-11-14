#!/usr/bin/env python3
"""Download the current year's FIRMS hotspots for Turkey through the FIRMS area API (stdlib only).

The per-country yearly archive files (scripts/fetch_firms.py) appear only after a year ends, so the
running year has to come from the API, which needs a free MAP_KEY:
    https://firms.modaps.eosdis.nasa.gov/api/map_key/
Put it in .env at the repo root as  FIRMS_MAP_KEY=...  (never commit it), then run

    python scripts/fetch_firms_recent.py            # current year, Jan 1 .. today
    python scripts/fetch_firms_recent.py --year 2026

Writes data/raw/viirs-snpp_{year}_Turkey.csv and data/raw/modis_{year}_Turkey.csv with the same
columns as the archive files. Standard-processing (SP) data is used where it exists, near-real-time
(NRT) data after that. Chunks are cached in data/raw/recent_cache/, so a re-run resumes and only
re-downloads the NRT tail. The query box covers Turkey; points outside the provinces are dropped
later by the province assignment in scripts/build_harmonized.py.
"""
import argparse
import csv
import io
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = RAW / "recent_cache"
API = "https://firms.modaps.eosdis.nasa.gov/api"
BBOX = "25.5,35.7,45.0,42.2"        # west,south,east,north
CHUNK = 5                            # days per request (API limit)
COLS = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time", "satellite",
        "instrument", "confidence", "version", "bright_t31", "frp", "daynight", "type"]
VCOLS = ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time", "satellite",
         "instrument", "confidence", "version", "bright_ti5", "frp", "daynight", "type"]
SENSORS = {  # output name -> (SP source, NRT source, columns)
    "viirs-snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT", VCOLS),
    "modis": ("MODIS_SP", "MODIS_NRT", COLS),
    # NOAA-20 / NOAA-21 are stored for later evaluation only; the pipeline reads modis_* and viirs-snpp_*.
    "viirs-noaa20": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT", VCOLS),
    "viirs-noaa21": ("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT", VCOLS),
}
EXTRA = ["data_source"]   # SP (standard processing, archive quality) or NRT (near real time)
SAT = {"T": "Terra", "A": "Aqua", "Terra": "Terra", "Aqua": "Aqua", "N": "N"}


def map_key():
    k = os.environ.get("FIRMS_MAP_KEY", "").strip()
    env = ROOT / ".env"
    if not k and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("FIRMS_MAP_KEY="):
                k = line.split("=", 1)[1].strip().strip('"').strip("'")
    return k


def get(url, tries=8):
    """GET text with retries; falls back to curl (TLS revocation problems on some Windows machines)."""
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "burncal/1.0"}),
                                        timeout=120) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001 - flaky network, retry everything
            last = e
            if isinstance(getattr(e, "reason", None), ssl.SSLError) or "CERTIFICATE" in str(e).upper():
                p = subprocess.run(["curl.exe", "-sS", "-L", "--ssl-no-revoke", "--retry", "5", "--retry-all-errors",
                                    "-m", "180", url], capture_output=True, text=True, encoding="utf-8")
                if p.returncode == 0:
                    return p.stdout
                last = p.stderr
            time.sleep(min(30, 2 + 3 * i))
    raise OSError(f"failed after {tries} tries: {url.split('/api/')[0]}/api/... ({last})")


def availability(key):
    out = {}
    for row in csv.DictReader(io.StringIO(get(f"{API}/data_availability/csv/{key}/ALL"))):
        out[row["data_id"]] = (date.fromisoformat(row["min_date"]), date.fromisoformat(row["max_date"]))
    return out


def chunk(key, source, start, days):
    """One API call -> list of dict rows (cached; NRT chunks touching the last 3 days are refetched)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{source}_{start.isoformat()}_{days}.csv"
    fresh = source.endswith("NRT") and start + timedelta(days=days) >= date.today() - timedelta(days=3)
    if f.exists() and not fresh:
        text = f.read_text(encoding="utf-8")
    else:
        text = get(f"{API}/area/csv/{key}/{source}/{BBOX}/{days}/{start.isoformat()}")
        if not text.startswith("latitude"):
            raise RuntimeError(f"unexpected API answer for {source} {start}: {text[:200]!r}")
        f.write_text(text, encoding="utf-8")
    return list(csv.DictReader(io.StringIO(text)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=date.today().year)
    a = ap.parse_args()
    key = map_key()
    if not key:
        sys.exit("FIRMS_MAP_KEY bulunamadi. https://firms.modaps.eosdis.nasa.gov/api/map_key/ adresinden alip "
                 ".env dosyasina FIRMS_MAP_KEY=... olarak ekleyin.")
    avail = availability(key)
    end = min(date.today(), date(a.year, 12, 31))
    manifest = {"created": date.today().isoformat(), "year": a.year, "bbox": BBOX,
                "endpoint": f"{API}/area/csv/<MAP_KEY>/<SOURCE>/{BBOX}/<days>/<start>",
                "availability": {k: [str(v[0]), str(v[1])] for k, v in avail.items()
                                 if k.startswith(("MODIS", "VIIRS"))}, "files": {}}
    for name, (sp, nrt, cols) in SENSORS.items():
        sp_max = avail.get(sp, (None, date(1900, 1, 1)))[1]
        nrt_max = avail.get(nrt, (None, date(1900, 1, 1)))[1]
        rows, d, used = [], date(a.year, 1, 1), {}
        while d <= end:
            n = min(CHUNK, (end - d).days + 1)
            last = d + timedelta(days=n - 1)
            src = sp if last <= sp_max else nrt
            if src == nrt and d > nrt_max:
                break
            got = chunk(key, src, d, n)
            used[src] = used.get(src, 0) + n
            for r in got:
                if date.fromisoformat(r["acq_date"]).year != a.year:
                    continue
                r["satellite"] = SAT.get(r.get("satellite", ""), r.get("satellite", ""))
                r.setdefault("type", "")
                r["data_source"] = "SP" if src == sp else "NRT"
                rows.append({c: r.get(c, "") for c in cols + EXTRA})
            print(f"{name} {src} {d}..{last}: {len(got)}", flush=True)
            d = last + timedelta(days=1)
        rows.sort(key=lambda r: (r["acq_date"], r["acq_time"]))
        # the same detection can appear in two adjacent chunks: drop exact duplicates
        seen, uniq = set(), []
        for r in rows:
            k = (r["latitude"], r["longitude"], r["acq_date"], r["acq_time"], r["satellite"])
            if k not in seen:
                seen.add(k)
                uniq.append(r)
        out = RAW / f"{name}_{a.year}_Turkey.csv"
        with open(out, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols + EXTRA)
            w.writeheader()
            w.writerows(uniq)
        lastd = uniq[-1]["acq_date"] if uniq else "-"
        print(f"=> {out.name}: {len(uniq)} rows, last date {lastd}, days by source {used}")
        by = {}
        for r in uniq:
            k = (r["acq_date"][:7], r["data_source"])
            by[k] = by.get(k, 0) + 1
        manifest["files"][out.name] = {
            "rows": len(uniq), "first_date": uniq[0]["acq_date"] if uniq else None, "last_date": lastd,
            "sources": {"SP": sp, "NRT": nrt}, "days_requested": used,
            "rows_by_month_source": {f"{m} {s}": n for (m, s), n in sorted(by.items())},
            "type_missing": sum(1 for r in uniq if r["type"] == ""),
            "satellites": sorted({r["satellite"] for r in uniq})}
    (RAW / f"recent_manifest_{a.year}.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
