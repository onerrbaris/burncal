# BurnCal

Pick a province in Türkiye and get one harmonized 25-year monthly burning calendar (MODIS 2000 onward and VIIRS S-NPP 2012 onward on a single scale), with how each month and year compares to the historical median, and a CSV download.

Built for NASA Space Apps 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots".

## Live demo

https://onerrbaris.github.io/burncal/

Run locally (the app cannot be opened from `file://`):

```
cd web
python -m http.server 8000
```

then open http://localhost:8000.

## The problem

NASA FIRMS offers MODIS (2000 onward) and VIIRS (2012 onward) hotspots as separate products. VIIRS has a finer pixel (375 m) and detects several times more fires than MODIS, so putting the two in one chart creates an artificial jump in 2012 when the sensor changes. Counts also depend on filters and on which satellites were flying.

Example, Adana (from `docs/DEMO_ILLER.md`): the raw series shows a 2.6x rise at 2012; the harmonized series shows a decline (ratio 0.72), about -79% over 20 years.

## What the app does

- Province selection by clicking the map (short, smooth camera glide) or by search.
- Series tabs: harmonized (default, VIIRS-equivalent) plus raw MODIS and raw VIIRS for anyone who wants to inspect the source counts directly; every view, the period and month window, and the running-month comparison work on all three. The "Uyum" and OGM views always use the harmonized series.
- Year timeline (slider and play) that recolours provinces by detections.
- Period selection: start and end year, plus a month window (for example the June-October fire season). Totals, calendar, medians, rankings, the map and all downloads follow it.
- Year x month calendar for the selected period, with high and extreme months flagged by shape, not colour alone.
- Comparison of the selected year with the period median and inter-quartile band, month by month.
- "Where does this month sit" card for any month (default: the latest data month): value, median, percentile and level (low / normal / high / extreme).
- Running month and year: when the data ends mid-month (current year from the FIRMS API), the partial month is compared with the same days of that month in every other year, and the partial year with the same January-to-date window. Nothing partial is compared with full months.
- Top years and top months; raw versus harmonized annual chart with the 2012 sensor change and the regional monthly factors.
- Validation confidence badge (leave-one-year-out error) and an inline caution for low-confidence provinces.
- OGM view: national satellite totals next to the forest fires reported by the General Directorate of Forestry (2001-2025), with the rank correlation and why the two differ, plus the 2025 regional directorate figures where the province has one (`web/data/ogm.json`, sources inside).
- Downloads: monthly CSV (harmonized value, source, complete flag, raw MODIS and VIIRS, median, percentile, level), hotspot list CSV (every detection in the province and period: date, coordinates, sensor, FRP), and the open chart as PNG or SVG.
- Hotspot points layer: individual detections for the selected year, drawn at the sensor footprint when zoomed in.

## Updating the data

```
python scripts/fetch_firms.py              # yearly archive files (complete years)
python scripts/fetch_firms_recent.py       # current year via the FIRMS API; needs FIRMS_MAP_KEY in .env
.venv\Scripts\python.exe scripts/build_harmonized.py --force
.venv\Scripts\python.exe scripts/build_points.py
python scripts/build_atlas_json.py
```

Factors and validation always use the complete 2012-2025 overlap; adding the current year does not change the method.

## Method

Full description in `docs/REPORT.md` (sections 3, 4, 10) and the docstring of `scripts/build_harmonized.py`.

1. Drop FIRMS `type` 1 (volcano) and 3 (offshore) records.
2. Remove static sources (industry) with a location mask: every 0.01 degree cell with any VIIRS `type` 2 detection in 2012-2025, widened by one cell, removed from both sensors. MODIS is not filtered by its own `type` label because that label changes behaviour in 2018 (a version break would create an artificial step).
3. Exclude satellite outage days, detected statistically.
4. Assign every hotspot to one of 81 provinces (geoBoundaries ADM1, point in polygon).
5. Unit: monthly count. From February 2012 the observed S-NPP count; before that MODIS (Terra + Aqua) multiplied by a monthly VIIRS/MODIS factor, giving a VIIRS-equivalent count.
6. Factors are computed per NUTS-2 region on the 2012-2025 overlap, with a national factor as fallback where a region-month has too few MODIS detections.
7. Terra-only period (before 4 July 2002, or when Aqua is out): Terra is scaled by a national (Terra+Aqua)/Terra monthly factor fitted on 2003-2020.
8. Validation: leave one year out, 2012-2025, per province and region.

## Accuracy

Error is WAPE (sum of absolute errors divided by the sum of true values), measured leave-one-year-out on 2012-2025 (monthly factor, MODIS to VIIRS, cell-day measure, fixed boxes, `docs/REPORT.md` section 5). WAPE is an error measure, not an accuracy percentage.

| Area | Annual | Monthly | 8-day |
|---|---|---|---|
| Türkiye | 6% | 12% | 19% |
| ~200 km | 17% | 32% | 43% |
| ~100 km | 24% | 43% | 59% |
| ~50 km | 33% | 57% | 77% |
| ~25 km | 45% | 74% | 96% |

Uncorrected MODIS has 60-80% error at every scale. Province confidence badges (from `frontend/harmonized-data.js`): 10 high, 37 medium, 34 low. Low-confidence provinces have very few detections.

## Limitations

- Türkiye only. Factors and the static-source mask would have to be rebuilt for another country.
- Data ends in December 2025. There is no 2026 data and no NOAA-20/21 bridge; the S-NPP record at FIRMS ended on 2 November 2026.
- Accuracy for 2000-2011 is not measured directly: the factors are assumed to carry back from the 2012-2025 overlap.
- VIIRS is treated as the truth. There is no independent burned-area or ground-record validation.
- 34 of 81 provinces are low confidence.
- Very large fire months are over-estimated (for example 2021-08 in the Mediterranean, +38%).
- Hotspots on cropland are not proven to be stubble burning.
- Tests used fixed boxes, not user-drawn polygons.

## Findings worth knowing

- The MODIS `type` label breaks in 2018 (the `type` 2 share jumps from 0.4-2.2% to 6.7-10.8%); filtering on `type == 0` creates a 6-8% artificial step.
- Before 4 July 2002 only Terra flew; uncorrected this gives a -45% step.
- The MODIS to VIIRS conversion is as good as converting between the two identical MODIS instruments (Terra to Aqua): monthly error 12% vs 12% at country scale.
- Cropland (Çukurova): detections on cropland fell by about 70% between 2003-07 and 2021-25 (VIIRS alone: -64% from 2012-16 to 2021-25), while the Southeast wheat belt shows no decline. The cause cannot be separated (enforcement, crop pattern, land use) and a cropland hotspot is not proven to be stubble burning (`docs/REPORT.md` section 12).
- Cropland, not forest, dominates the Mediterranean hotspot totals; the biggest fire months there are largely agricultural burning on the Adana plain, and the Mediterranean total should not be called forest fire.

## Reproduce

```
python scripts/fetch_firms.py          # downloads the FIRMS country archive into data/raw (resumable)
python scripts/build_harmonized.py     # needs pandas, numpy, shapely
python scripts/build_atlas_json.py     # writes web/data/atlas.json
```

`data/raw` and `data/processed` are not in git; run the first script to recreate them. The analysis behind the method and the accuracy numbers is in `analysis/` (see `docs/REPORT.md` section 8; the full run takes about two hours).

## Repository layout

```
web/        MapLibre web app (published to GitHub Pages)
scripts/    data download and build scripts
analysis/   accuracy and method analysis, regional and cropland studies
docs/       REPORT.md (research report), DEMO_ILLER.md, SOURCES.md
frontend/   earlier prototype (three.js) and the data files the build reads
```

## Data sources and acknowledgements

All sources, services, libraries and papers are listed in [docs/SOURCES.md](docs/SOURCES.md).

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS).

## Use of AI

AI-assisted coding tools were used for data exploration, analysis code, front-end code and drafting of documentation. Method decisions were made by the team; all numbers come from code run on real FIRMS data and are reproducible with the scripts in this repository.

## Licence

MIT for the code (see [LICENSE](LICENSE)). Data remain under their providers' terms.
