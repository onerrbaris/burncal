# ARCHITECTURE

Working name: **BurnCal** (change freely). Event: NASA Space Apps 2026, Nov 14–15. Submission closes **Sun Nov 15 23:59 local**.

## Challenge & demo story

Challenge: *Harmonization of MODIS and VIIRS Hot Spots* – harmonize the two hotspot records into a burning-activity calendar for a user-selected area (responders, scientists, land managers).

One line: **pick an area → get one 25-year burning calendar on a single scale, where this year stands against it, and which weeks ahead are critical.**

60-second story:
1. Draw Manavgat (Antalya). Raw hotspot counts show a fake "explosion" in 2012 – that is the sensor switch, not more fire.
2. Toggle **Harmonize**. The step disappears; 2021 stands out alone as the real anomaly.
3. The validation panel shows why to trust it: held-out-year error, raw vs harmonized.
4. The calendar marks the critical periods and says it in words ("62% of annual burning happens in the next 6 periods").
5. Jump to Çukurova: a completely different, two-peak crop-residue calendar.
6. Closing line: MODIS is being shut down in 2027, S-NPP already ended on 2 Nov 2026 – the 25-year record survives only if it is bridged.

Judging (1–5 each): Impact, Creativity, Validity, Relevance, Presentation. Demo = 7 slides max or a very short video. Must describe AI tool use, cite all sources, include a license.

## Real data findings

Verified by download on Nov 14 (Turkey 2021):

- **Archive, no key, no login:** `https://firms.modaps.eosdis.nasa.gov/data/country/{modis|viirs-snpp}/{Y}/{modis|viirs-snpp}_{Y}_{Country}.csv`. MODIS 2000–2025 (first record 2000-11-01), VIIRS S-NPP 2012–2025. Country name is `Turkey`. No 2026, no NOAA-20/21 there.
- **Size:** Turkey MODIS ≈ 0.8 MB / 10k rows per year, VIIRS ≈ 3.4 MB / 43k rows. All years ≈ 70 MB, < 1M rows → raw points fit in memory; arbitrary polygons are cheap.
- **Columns:** same order in both; cols 3 and 12 differ in name (`brightness,bright_t31` vs `bright_ti4,bright_ti5`). `confidence` is 0–100 in MODIS, `l/n/h` in VIIRS. `acq_time` is zero-padded HHMM UTC text. `satellite` = `Terra|Aqua|N`. `type`: 0 vegetation, 1 volcano, 2 static land source, 3 offshore (meanings from FIRMS docs, not re-verified).
- **Ratio is not constant:** VIIRS/MODIS count ratio 2.9–10.2 by month (4.28 for the year); distinct (0.1° cell, day) ratio 2.5–7.4. Highest in low-activity months (small fires only VIIRS sees).
- **FRP is not a shortcut:** in Jul–Aug MODIS summed FRP is up to 2.4× VIIRS; other months the reverse.
- **Static sources:** `type` 2 is 30.5% of VIIRS rows, 6.7% of MODIS → filter on `type` before comparing.
- **Current year:** only via FIRMS API – needs a free MAP_KEY (sent by email), max 5 days per call, 5000 calls / 10 min. Sources incl. `MODIS_NRT`, `VIIRS_NOAA20_NRT/SP`, `VIIRS_NOAA21_NRT`.
- **No CORS** on FIRMS CSVs → always through the backend or pre-baked files.
- **MODIS guide** warns of sampling bias for intervals shorter than ~8 days → our time unit is the 8-day period.
- **Competition:** FIRMS map (no merge, no calendar), Global Forest Watch (VIIRS only, 2012+), GWIS (country level, method opaque). Other teams on this challenge exist; we win on method clarity, validation and decision-oriented UX.
- **Local machine:** network is flaky (DNS drops). spaceappschallenge.org fails TLS from here.

## Harmonization method (v1)

Goal: a sensor-independent series in **VIIRS-equivalent units**, with honest uncertainty.

1. Clean: keep `type == 0`; drop low confidence (MODIS < 30, VIIRS `l`). Static sources kept aside as an optional category.
2. Common support: 0.1° cell × 8-day period (46 per year; period = `min((doy-1)//8, 45) + 1`). Measure = hotspot count and active cell-days per sensor.
3. Calibrate on the overlap 2012–2025: map MODIS → VIIRS-equivalent with a model that depends on fire regime (at least season, ideally land cover and activity level). Worker picks the model by evidence; start from a stratified ratio / log-log fit.
4. Validate: leave-one-year-out over the overlap years. Report error vs the naive options (raw MODIS, single global factor). Report the 2011→2012 step before/after.
5. Assemble: 2000–2011 = MODIS scaled (with lo/hi band); 2012–2025 = VIIRS S-NPP observed; 2026 = MODIS NRT scaled (stretch: NOAA-20).
6. Everything shown to users is derived from this one series: percentiles, anomalies, season, critical periods.

Category split (stretch, high value): cropland vs wildland using ESA WorldCover (class 40 = cropland), sampled once per 0.1° cell offline.

## Components & data flow

```
FIRMS country archive ──► scripts/fetch_firms.py ──► data/raw/*.csv        (not in git)
FIRMS API (2026, key) ──┘
data/raw ──► scripts/build_dataset.py ──► data/processed/points.parquet     (clean, typed, one table)
                                     └──► data/processed/calibration.json   (factors + validation)
backend (FastAPI, pandas) loads both at start
   ├── polygon / preset ─► filter points ─► 8-day aggregate ─► harmonize ─► stats
   └── serves shared/mock/*.json when MOCK=1 or data missing
frontend (React + Vite + TS, MapLibre, SVG charts)
   ├── map + draw AOI + presets
   ├── calendar heatmap (years × 46 periods), raw/harmonized toggle
   ├── climatology band + current year, insights in plain words
   ├── validation panel
   └── static fallback: frontend/public/fallback/*.json for the preset areas
```

Stack: Python 3.12 (FastAPI, pandas, shapely), Node 26 (Vite, React, TS, MapLibre GL). No database.

## Contract

All under `/api`. JSON. Periods are 1–46. Units are VIIRS-equivalent hotspot counts unless stated. Field names are frozen once frontend work starts; changes go to BACKLOG → Decisions.

| Endpoint | Input | Output | Mock |
| --- | --- | --- | --- |
| `GET /api/health` | – | `{status, mode: "mock"\|"live", data_range: [y0, y1], countries: []}` | `health.json` |
| `GET /api/regions` | – | `{regions: [{id, name, country, kind: "preset"\|"province", bbox: [w,s,e,n], geometry: GeoJSON, blurb}]}` | `regions.json` |
| `POST /api/calendar` | `{region_id? , geometry?: GeoJSON Polygon, start_year?, end_year?, category?: "all"\|"cropland"\|"wildland"}` | see below | `calendar.json` |
| `POST /api/harmonization` | same area fields | see below | `harmonization.json` |
| `POST /api/hotspots.csv` | same area fields + `start_date, end_date` | CSV of cleaned hotspots (`latitude,longitude,acq_date,acq_time,sensor,satellite,confidence_class,frp,daynight,type`) | `hotspots.csv` |

`/api/calendar` response:

```jsonc
{
  "meta": { "region_id": "manavgat", "name": "...", "area_km2": 1234.5, "category": "all",
            "years": [2000, 2026], "periods_per_year": 46, "unit": "VIIRS-equivalent hotspots",
            "method_version": "v1", "generated_at": "ISO" },
  "cells": [ { "year": 2021, "period": 27, "start_date": "2021-07-28",
               "value": 812.0, "lo": 812.0, "hi": 812.0,       // band; lo=hi when observed
               "raw_modis": 190, "raw_viirs": 812,              // null when sensor absent
               "source": "viirs",                               // "modis_scaled" | "viirs" | "modis_nrt_scaled"
               "percentile": 99.6,                              // vs same period in all other years
               "level": "extreme" } ],                         // "none"|"low"|"normal"|"high"|"extreme"
  "climatology": [ { "period": 27, "p10": 0, "p25": 2, "median": 9, "p75": 31, "p90": 77, "mean": 48.2 } ],
  "annual": [ { "year": 2021, "total": 5321.0, "lo": 5321.0, "hi": 5321.0, "source": "viirs", "rank": 1 } ],
  "season": { "start_period": 24, "peak_period": 29, "end_period": 36,
              "critical_periods": [26,27,28,29,30,31], "critical_share": 0.62,
              "onset_trend_days_per_decade": -3.1 },
  "current": { "year": 2026, "period": 40, "value": 12.0, "median": 7.0, "percentile": 71.0,
               "level": "normal", "ytd_total": 640.0, "ytd_median": 510.0,
               "next_periods_share": 0.08 },                   // typical share of annual burning in next 6 periods
  "insights": [ { "kind": "critical_window"|"anomaly"|"trend"|"record"|"category", "severity": "info"|"watch"|"warning",
                  "text": "62% of annual burning here falls between Jul 20 and Sep 5." } ]
}
```

`/api/harmonization` response:

```jsonc
{
  "meta": { "region_id": "...", "method_version": "v1", "overlap_years": [2012, 2025] },
  "monthly": [ { "month": "2015-07", "raw_modis": 120, "raw_viirs": 455, "harmonized": 455.0, "lo": 455.0, "hi": 455.0 } ],
  "annual":  [ { "year": 2008, "raw_modis": 800, "raw_viirs": null, "harmonized": 3310.0, "lo": 2700.0, "hi": 4000.0 } ],
  "factors": [ { "stratum": "summer / wildland", "factor": 3.7, "lo": 3.2, "hi": 4.3, "n_years": 14 } ],
  "validation": { "method": "leave-one-year-out", "years_tested": 14,
                  "harmonized": { "mape": 0.18, "r2": 0.93, "bias": 0.02 },
                  "single_factor": { "mape": 0.41, "r2": 0.80, "bias": 0.10 },
                  "raw_modis": { "mape": 0.77, "r2": 0.80, "bias": -0.77 },
                  "step_2012": { "raw": 4.3, "harmonized": 1.05 } },   // ratio of 2012–14 mean to 2009–11 mean
  "notes": [ "type 0 only", "confidence: MODIS ≥ 30, VIIRS n/h" ]
}
```

Numbers in the blocks above are illustrative.

## Deploy

- Backend: Render free web service (Docker or native Python), repo-connected; processed data committed under `backend/data/` if < 100 MB, else built at deploy. Fallback host: Hugging Face Spaces (Docker).
- Frontend: Vercel (static Vite build), `VITE_API_URL` env; falls back to `public/fallback/*.json` if the API is unreachable.
- Needs from the team: a GitHub repo (remote), Render + Vercel accounts, a FIRMS MAP_KEY.
- Target: deployed hello-world (mock mode) by hour 6.

## Tasks

| # | Task | Notes |
| --- | --- | --- |
| T1 | `scripts/fetch_firms.py`: download country archive, all years, resumable | Sonnet. Turkey first; any country by name |
| T2 | Mock generator + backend skeleton serving the contract | Sonnet. `backend/`, `shared/mock/` |
| T3 | Frontend scaffold: map, presets, calendar heatmap, from mocks | Sonnet. `frontend/` |
| T4 | `scripts/build_dataset.py`: clean + typed parquet | Sonnet |
| T5 | Harmonization model + validation → `calibration.json` | **Opus**. The scientific core |
| T6 | Live `/api/calendar` (aggregate, percentiles, season, insights) | Opus |
| T7 | Live `/api/harmonization` + `/api/hotspots.csv` | Sonnet |
| T8 | Frontend: validation panel, insights, raw/harmonized toggle, CSV download | Sonnet |
| T9 | Draw-your-own AOI (polygon/rectangle) | Sonnet |
| T10 | Deploy backend + frontend, static fallback JSONs | Sonnet + lead |
| T11 | 2026 current year via FIRMS API (needs MAP_KEY) | Sonnet |
| T12 | Cropland vs wildland split (WorldCover) | Opus, stretch |
| T13 | More countries (Greece, Portugal, …), province presets | Sonnet, stretch |
| T14 | Integration review ("find what breaks") before deploy and before submission | Opus, fresh agent |
| T15 | Slides (7), README with sources, license, AI-use statement | final mode |

## Rejected alternatives

- **Single global scaling factor** – real data shows the ratio moves 2.9–10.2 within one year.
- **FRP as the common unit** – sign of the MODIS/VIIRS difference flips between seasons.
- **Live FIRMS API for history** – 5 days per call, key required; 25 years is thousands of calls per area.
- **Global coverage on day one** – 360 MB per VIIRS year; not on this network. Country-by-country instead.
- **Database / PostGIS** – < 1M rows per country; pandas in memory is enough.
- **Daily calendar cells** – orbital sampling bias below ~8 days; also unreadable at 25 years.
- **LLM-written insights at runtime** – unverifiable in front of a science jury; templated sentences from computed numbers instead.
- **MCD12Q1 land cover** – needs Earthdata login.

## Anti-goals

- No fire prediction / ML forecasting. "Critical periods" are climatology, and we say so.
- No user accounts, no alert emails, no mobile app.
- No real-time fire map (FIRMS already does it).
- No burned-area or emissions estimates.
