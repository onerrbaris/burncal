#!/usr/bin/env python3
"""Resumable downloader for the NASA FIRMS per-country hotspot archive (stdlib only)."""
import argparse
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country/{s}/{y}/{s}_{y}_{c}.csv"
RANGES = {"modis": (2000, 2025), "viirs-snpp": (2012, 2025)}
MAX_TRIES = 8
UA = {"User-Agent": "fetch_firms/1.0"}


class NotFound(Exception):
    pass


class TLSProblem(Exception):
    pass


def is_tls(e):
    r = getattr(e, "reason", e)
    return isinstance(r, ssl.SSLError) or "CERTIFICATE" in str(e).upper() or "revocation" in str(e).lower()


def head_len(url):
    req = urllib.request.Request(url, method="HEAD", headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            v = r.headers.get("Content-Length")
            return int(v) if v else None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise NotFound()
        raise
    except urllib.error.URLError as e:
        if is_tls(e):
            raise TLSProblem(str(e))
        raise


def curl_download(url, part):
    cmd = ["curl.exe", "-sS", "-L", "--ssl-no-revoke", "--retry", "5", "--retry-all-errors",
           "-C", "-", "-m", "600", "-o", part, "-w", "%{http_code}", url]
    p = subprocess.run(cmd, capture_output=True, text=True)
    code = p.stdout.strip()[-3:]
    if code == "404":
        if os.path.exists(part):
            os.remove(part)
        raise NotFound()
    if p.returncode != 0 and code != "416":
        raise OSError("curl exit %d: %s" % (p.returncode, p.stderr.strip()))


def urllib_download(url, part):
    have = os.path.getsize(part) if os.path.exists(part) else 0
    headers = dict(UA)
    if have:
        headers["Range"] = "bytes=%d-" % have
    req = urllib.request.Request(url, headers=headers)
    try:
        r = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise NotFound()
        if e.code == 416:  # range not satisfiable: restart
            os.remove(part)
            raise OSError("416, restarting")
        raise
    with r:
        mode = "ab"
        if have and r.status != 206:
            mode = "wb"  # server ignored Range: restart
        expected = r.headers.get("Content-Length")
        got = 0
        with open(part, mode) as f:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
        if expected is not None and got != int(expected):
            raise OSError("short read %d/%s" % (got, expected))


def validate(path):
    if os.path.getsize(path) == 0:
        return "empty file"
    with open(path, "rb") as f:
        first = f.readline().decode("utf-8", "replace").lstrip("﻿")
    if not first.startswith("latitude,longitude"):
        return "unexpected header: %r" % first[:60]
    return None


def fetch(sensor, year, country, out):
    url = BASE.format(s=sensor, y=year, c=country)
    name = "%s_%d_%s.csv" % (sensor, year, country)
    dest = os.path.join(out, name)
    part = dest + ".part"
    use_curl = False
    retries = 0
    last = "unknown"
    for attempt in range(1, MAX_TRIES + 1):
        try:
            size = None
            if not use_curl:
                try:
                    size = head_len(url)
                except TLSProblem as e:
                    use_curl = True
                    print("  TLS error, falling back to curl: %s" % e)
            if size is None and use_curl:
                size = -1
            if size is not None and size >= 0 and os.path.exists(dest) and os.path.getsize(dest) == size:
                err = validate(dest)
                if err is None:
                    return "skipped", "%s (%d bytes)" % (name, size), retries
            if use_curl:
                curl_download(url, part)
            else:
                urllib_download(url, part)
            if size is not None and size >= 0 and os.path.getsize(part) != size:
                raise OSError("size %d != Content-Length %d" % (os.path.getsize(part), size))
            err = validate(part)
            if err:
                os.remove(part)
                raise OSError(err)
            os.replace(part, dest)
            return "ok", "%s (%d bytes)" % (name, os.path.getsize(dest)), retries
        except NotFound:
            return "missing", "%s (404, year not available)" % name, retries
        except Exception as e:
            last = "%s: %s" % (type(e).__name__, e)
            if is_tls(e) and not use_curl:
                use_curl = True
            retries += 1
            if attempt < MAX_TRIES:
                time.sleep(min(60, 2 ** attempt))
    return "FAILED", "%s (%s)" % (name, last), retries


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--country", default="Turkey")
    ap.add_argument("--sensors", nargs="+", default=["modis", "viirs-snpp"], choices=list(RANGES))
    ap.add_argument("--start-year", type=int)
    ap.add_argument("--end-year", type=int)
    ap.add_argument("--out", default="data/raw")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    counts = {"ok": 0, "skipped": 0, "missing": 0, "FAILED": 0}
    total_retries = 0
    for s in a.sensors:
        lo, hi = RANGES[s]
        y0 = a.start_year if a.start_year is not None else lo
        y1 = a.end_year if a.end_year is not None else hi
        for y in range(y0, y1 + 1):
            st, msg, r = fetch(s, y, a.country, a.out)
            counts[st] += 1
            total_retries += r
            print("%-8s %s%s" % (st, msg, " [retries=%d]" % r if r else ""), flush=True)
    print("Summary: %d ok, %d skipped, %d missing, %d FAILED, %d retries"
          % (counts["ok"], counts["skipped"], counts["missing"], counts["FAILED"], total_retries))
    sys.exit(1 if counts["FAILED"] else 0)


if __name__ == "__main__":
    main()
