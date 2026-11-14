from pathlib import Path
import json
import pandas as pd
import shapely
from shapely.geometry import shape

root = Path(__file__).resolve().parents[1]
raw = root / "data/raw"
features = json.loads((raw / "boundaries/TUR-ADM1.geojson").read_text(encoding="utf8"))["features"]
codes = {35,45,48,9,7,15,33,70,42,32,3,20,64}
paths, groups = [], {}
for feature in features:
    name = feature["properties"]["shapeName"]
    geom = shape(feature["geometry"])
    if int(feature["properties"]["shapeISO"][-2:]) in codes:
        groups[name] = geom
    draw = geom.simplify(.012, preserve_topology=True)
    polygons = draw.geoms if draw.geom_type == "MultiPolygon" else [draw]
    rings = [ring for poly in polygons for ring in [poly.exterior, *poly.interiors]]
    path = "".join("M" + "L".join(f"{(x-24)*100:.1f},{(44-y)*100:.1f}" for x,y in ring.coords) + "Z" for ring in rings)
    paths.append([name, path])
series = {}
for sensor, prefix in [("MODIS","modis"),("VIIRS","viirs-snpp")]:
    series[sensor] = {name:{} for name in groups}
    for file in sorted(raw.glob(f"{prefix}_*_Turkey.csv")):
        data = pd.read_csv(file,usecols=["latitude","longitude","acq_date","type"])
        data = data[data.type.eq(0)]
        for name, geom in groups.items():
            inside = shapely.contains_xy(geom,data.longitude,data.latitude)
            months = pd.to_datetime(data.loc[inside,"acq_date"]).dt.month
            series[sensor][name][file.name.split("_")[1]] = months.value_counts().reindex(range(1,13),fill_value=0).tolist()
assert len(paths)==81 and len(groups)==13 and sum(series["VIIRS"]["İzmir"]["2025"])==1910
(root/"frontend/atlas-data.js").write_text("const atlas="+json.dumps(dict(paths=paths,series=series),ensure_ascii=False),encoding="utf8")
