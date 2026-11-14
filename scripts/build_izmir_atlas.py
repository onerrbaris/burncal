from pathlib import Path
import json
import pandas as pd
import shapely
from shapely.geometry import shape
from shapely.ops import transform

root = Path(__file__).resolve().parents[1]
raw = root / "data/raw"
features = json.loads((raw / "boundaries/TUR-ADM1.geojson").read_text(encoding="utf8"))["features"]
paths = []
for feature in features:
    name = feature["properties"]["shapeName"]
    geom = shape(feature["geometry"])
    if feature["properties"]["shapeISO"] == "TR-35":
        izmir = geom
    draw = geom.simplify(.025, preserve_topology=True)
    polygons = draw.geoms if draw.geom_type == "MultiPolygon" else [draw]
    rings = [ring for poly in polygons for ring in [poly.exterior, *poly.interiors]]
    path = "".join("M" + "L".join(f"{(x-25)*48:.1f},{(43-y)*61:.1f}" for x,y in ring.coords) + "Z" for ring in rings)
    paths.append([name, path])
years = {}
for file in sorted(raw.glob("viirs-snpp_*_Turkey.csv")):
    data = pd.read_csv(file, usecols=["latitude","longitude","acq_date","type"])
    inside = shapely.contains_xy(izmir, data.longitude, data.latitude)
    months = pd.to_datetime(data.loc[inside & data.type.eq(0), "acq_date"]).dt.month
    years[file.name.split("_")[1]] = months.value_counts().reindex(range(1,13),fill_value=0).tolist()
assert len(paths)==81 and len(years)==14 and sum(years["2021"])>0
(root/"frontend/atlas-data.js").write_text("const atlas="+json.dumps(dict(paths=paths,years=years),ensure_ascii=False),encoding="utf8")
