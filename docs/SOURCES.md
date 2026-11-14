# Sources and attributions

Where a licence is not stated below, the entry says "see provider terms". The BurnCal code itself is MIT-licensed (see `LICENSE`); the data and services listed here remain under their providers' terms.

## FIRMS acknowledgement

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS).

## Data sets

| Source | URL | What we use it for | Licence / terms |
|---|---|---|---|
| NASA FIRMS country archive, MODIS Collection 6.1 (Terra, Aqua), 2000-2025, Türkiye | `https://firms.modaps.eosdis.nasa.gov/data/country/modis/{Y}/modis_{Y}_Turkey.csv` | Active-fire detections; the long record (2000 onward) that is harmonized to the VIIRS scale. Downloaded with `scripts/fetch_firms.py`. | See provider terms (NASA FIRMS) |
| NASA FIRMS country archive, VIIRS S-NPP 375 m, 2012-2025, Türkiye | `https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/{Y}/viirs-snpp_{Y}_Turkey.csv` | Active-fire detections used as the reference scale; also used to derive the static-source location mask. | See provider terms (NASA FIRMS) |
| geoBoundaries gbOpen, TUR ADM1 (81 provinces) | https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM1/ (pinned file fetched by `scripts/build_harmonized.py`) | Province polygons: assignment of each hotspot to a province. | See provider terms (geoBoundaries) |
| ESA WorldCover 2021, 10 m | https://esa-worldcover.org | Land-cover class at each hotspot centre, used only in the cropland analyses (`analysis/agri/`, `analysis/agri_trend/`). | See provider terms (ESA WorldCover) |

## Map services used by the web app (`web/js/mapstyle.js`)

| Source | URL | What we use it for | Licence / terms |
|---|---|---|---|
| Esri World Imagery (Esri, Maxar, Earthstar Geographics) | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Satellite base map | See provider terms (Esri) |
| OpenFreeMap vector tiles (OpenMapTiles schema, OpenStreetMap data) | `https://tiles.openfreemap.org/planet` | Roads, buildings, place names, water, forest land cover | See provider terms (OpenFreeMap, OpenMapTiles, OpenStreetMap contributors) |
| OpenFreeMap glyphs (Noto Sans) | `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` | Map label fonts | See provider terms (OpenFreeMap) |
| Mapzen / AWS Terrain Tiles (Terrarium) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Elevation for hillshade and 3D terrain | See provider terms (Mapzen / AWS Terrain Tiles) |

## Software libraries

| Library | URL | What we use it for | Licence |
|---|---|---|---|
| MapLibre GL JS | https://maplibre.org | Map rendering in `web/` (vendored in `web/vendor/`) | BSD 3-Clause; text in `web/vendor/maplibre-LICENSE.txt` |
| three.js | https://threejs.org | Only the earlier prototype in `frontend/` | MIT; text in `frontend/three-LICENSE.txt` |
| pandas, numpy, shapely | https://pandas.pydata.org, https://numpy.org, https://shapely.readthedocs.io | Data processing in `scripts/build_harmonized.py` | See provider terms |
| scipy, scikit-learn | https://scipy.org, https://scikit-learn.org | Statistical analysis in `analysis/` | See provider terms |

## Literature and background material

Links are given as in `docs/REPORT.md` section 7. Entries without a link have none in the report.

| Reference | Link | How it is used |
|---|---|---|
| Boschetti, Roy, Giglio: NASA MODIS/VIIRS harmonization project (2023 science team presentation) | https://modis.gsfc.nasa.gov/sci_team/meetings/202305/presentations/boschetti.pdf | Related work; burned-area based approach |
| Chen et al. 2026, GFED5NRT, Earth System Science Data 18:7535 | https://essd.copernicus.org/articles/18/7535/2026/ | Closest method in the literature: region and land-cover coefficients, static-source mask |
| Zheng et al. 2026, Remote Sensing 18:1650 | https://www.mdpi.com/2072-4292/18/10/1650 | Related work on merging Aqua and VIIRS FRP (abstract only was read) |
| Sofiev and Kouznetsov 2026, Geoscientific Model Development 19:10123 | https://gmd.copernicus.org/articles/19/10123/2026/ | Detection thresholds of MODIS and VIIRS |
| Li et al. 2018, Journal of Geophysical Research: Atmospheres 123:4545 | https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2017jd027823 | View-angle dependence of MODIS FRP; VIIRS vs MODIS FRP in large fires |
| Schroeder et al. 2014, Remote Sensing of Environment 143:85 | none given in report | Introduction of the VIIRS 375 m active-fire product |
| Giglio et al. 2016, MODIS Collection 6 active-fire product; MODIS C6 user guide | none given in report | MODIS product description; sampling bias for periods under 8 days |
| Coskuner 2022, iForest 15:85 | https://iforest.sisef.org/contents/?id=ifor3754-015 | VIIRS/MODIS count ratio in Türkiye; cropland share of detections |
| Vadrevu 2018 (Punjab) | https://pmc.ncbi.nlm.nih.gov/articles/PMC6108185/ | VIIRS/MODIS count ratio elsewhere |
| NASA Earthdata: transitioning from S-NPP VIIRS | https://www.earthdata.nasa.gov/news/blog/transitioning-from-s-npp-viirs-omps-what-nasa-firms-users-need-know | End of the S-NPP record |
| CAMS: Drifting away, MODIS and CAMS GFAS | https://atmosphere.copernicus.eu/drifting-away-modis-cams-global-fire-assimilation-system | Planned MODIS end of life |
| Turkish General Directorate of Forestry, forest-fire document (2008-2018 statistics) | https://cdniys.tarimorman.gov.tr/api/File/GetFile/330/Sayfa/1416/1778/DosyaGaleri/20._orman_yanginlariyla_mucadelede_yenilikci_yaklasimlar.pdf | Official statistics on stubble as a cause of forest fires |
| Türkiye National Inventory Document 2024 (UNFCCC) | https://unfccc.int/sites/default/files/resource/TUR_NID_2024.pdf | Treatment of agricultural burning in the national inventory |
| Baldassarre et al. 2020 (MODIS, 2003-2019) | https://medfor.eu/node/975 | Share of active fires on cropland |
| NASA Space Apps 2026 challenge page | https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/ | Challenge definition |
