// İl verileri değişmez; bölge görünümü aynı serilerin önceden hesaplanmış toplamıdır.
export function regionGeometry(geo, regions) {
  const provinces = new Map(geo.features.map((f) => [f.properties.name, f]));
  return { type: 'FeatureCollection', features: Object.entries(regions).map(([name, region]) => ({
    type: 'Feature', properties: { name },
    geometry: { type: 'MultiPolygon', coordinates: region.members.flatMap((n) => {
      const g = provinces.get(n).geometry;
      return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    }) },
  })) };
}
