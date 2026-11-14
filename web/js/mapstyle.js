// Harita stili: uydu tabanı + 3B arazi + yakınlaştıkça açılan vektör detay + il katmanları.
// Karo kaynakları anahtarsızdır; değiştirmek için yalnızca SOURCES bloğunu düzenleyin.

// Açık sarıdan koyu kırmızıya (az -> çok); parlaklık tek yönde azalır.
export const RAMP = ['#fffbe0', '#ffe9a0', '#fec45c', '#fd8d3c', '#ec4a25', '#b10026'];
export const rampStops = RAMP.flatMap((c, i) => [i / (RAMP.length - 1), c]);

const FONT = ['Noto Sans Bold'];
const FONT_IT = ['Noto Sans Italic'];
const NAME = ['coalesce', ['get', 'name:tr'], ['get', 'name']];
const DEM = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium', tileSize: 256, maxzoom: 13,
  attribution: 'Yükseklik: Mapzen / AWS Terrain Tiles',
};

const road = (id, classes, minzoom, color, w0, w1) => ({
  id, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom,
  filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', classes]]],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': color,
    'line-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0, minzoom + 1, 0.75],
    'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], minzoom, w0, 17, w1],
  },
});

const place = (id, classes, minzoom, size0, size1, color) => ({
  id, type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom,
  filter: ['in', ['get', 'class'], ['literal', classes]],
  layout: {
    'text-field': NAME, 'text-font': FONT,
    'text-size': ['interpolate', ['linear'], ['zoom'], minzoom, size0, 15, size1],
    'text-letter-spacing': 0.04, 'text-max-width': 8,
    'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
  },
  paint: { 'text-color': color, 'text-halo-color': 'rgba(4,8,14,0.9)', 'text-halo-width': 1.6 },
});

export function buildStyle(provinces, labels) {
  return {
    version: 8,
    projection: { type: 'mercator' },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sky: {
      'sky-color': '#081425', 'horizon-color': '#6f8fb0', 'fog-color': '#0a1422',
      'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.55,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.75, 8, 0],
    },
    sources: {
      sat: {
        type: 'raster', tileSize: 256, maxzoom: 18,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Görüntü: Esri, Maxar, Earthstar Geographics',
      },
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      dem: DEM,
      demShade: DEM,
      provinces: { type: 'geojson', data: provinces, promoteId: 'name' },
      provLabels: { type: 'geojson', data: labels },
      pts: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#04070c' } },
      {
        id: 'sat', type: 'raster', source: 'sat',
        paint: {
          'raster-saturation': -0.18, 'raster-contrast': 0.18,
          'raster-brightness-max': ['interpolate', ['linear'], ['zoom'], 3, 0.72, 10, 0.9],
          'raster-fade-duration': 250,
        },
      },
      {
        id: 'shade', type: 'hillshade', source: 'demShade', minzoom: 4,
        paint: {
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 12, 0.25],
          'hillshade-shadow-color': '#02060c', 'hillshade-highlight-color': 'rgba(255,236,200,0.35)',
          'hillshade-accent-color': '#0a1420', 'hillshade-illumination-direction': 315,
        },
      },
      // Deniz: uydu batimetrisinin üzerine derinlik hissi veren soğuk bir ton.
      {
        id: 'sea-tint', type: 'fill', source: 'omt', 'source-layer': 'water',
        paint: {
          'fill-color': '#03283f',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.38, 9, 0.22, 13, 0.08],
        },
      },
      {
        id: 'prov-fill', type: 'fill', source: 'provinces',
        paint: {
          'fill-color': ['case',
            ['<', ['coalesce', ['feature-state', 'v'], -1], 0], 'rgba(0,0,0,0)',
            ['interpolate', ['linear'], ['coalesce', ['feature-state', 'v'], 0], ...rampStops]],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'],
            6, ['case', ['boolean', ['feature-state', 'sel'], false], 0.42, 0.66],
            9, ['case', ['boolean', ['feature-state', 'sel'], false], 0.16, 0.4],
            12, 0.08],
        },
      },
      { // Ormanlık alan (OpenStreetMap arazi örtüsü); yalnızca yakınlaşınca görünür.
        id: 'forest', type: 'fill', source: 'omt', 'source-layer': 'landcover', minzoom: 6,
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': '#2f7d4f', 'fill-antialias': false,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 7.5, 0.42, 12, 0.34] },
      },
      { // Tek tek uydu tespitleri (seçili yıl); yalnızca yakınlaşınca görünür.
        id: 'pts', type: 'circle', source: 'pts', minzoom: 6.2,
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 6.2, 1.6, 8, 3, 10, 3.6, 12, 6.5],
          'circle-color': '#ff2d1a', 'circle-stroke-color': '#3a0700',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 7, 0, 9, 0.6],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6.2, 0, 7, 0.85],
        },
      },
      {
        id: 'prov-hover', type: 'fill', source: 'provinces',
        paint: {
          'fill-color': '#ffffff',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.14, 0.001],
        },
      },
      road('road-minor', ['minor', 'service', 'track'], 12, '#cfd6de', 0.4, 6),
      road('road-mid', ['secondary', 'tertiary'], 9, '#e6dcc8', 0.5, 9),
      road('road-major', ['motorway', 'trunk', 'primary'], 6, '#ffd9a0', 0.6, 14),
      {
        id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14,
        paint: {
          'fill-extrusion-color': '#c9c2b6',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.75],
        },
      },
      {
        id: 'prov-line', type: 'line', source: 'provinces',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', 'rgba(255,255,255,0.55)'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.2, 6, 0.7, 10, 1.4],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.25, 5, 0.6],
        },
      },
      {
        id: 'country-line', type: 'line', source: 'omt', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#ffe9c9', 'line-opacity': 0.75,
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 2] },
      },
      {
        id: 'sel-glow', type: 'line', source: 'provinces', filter: ['==', ['get', 'name'], ''],
        paint: { 'line-color': '#ff7a1a', 'line-width': 14, 'line-blur': 12, 'line-opacity': 0.75 },
      },
      {
        id: 'sel-line', type: 'line', source: 'provinces', filter: ['==', ['get', 'name'], ''],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#ffe2b8', 'line-width': 2.4, 'line-dasharray': [2, 2] },
      },
      {
        id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
        layout: { 'text-field': NAME, 'text-font': FONT_IT, 'text-letter-spacing': 0.22,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 10, 15], 'text-max-width': 6 },
        paint: { 'text-color': '#9cc6e6', 'text-halo-color': 'rgba(2,14,26,0.8)', 'text-halo-width': 1.2 },
      },
      {
        id: 'prov-label', type: 'symbol', source: 'provLabels', minzoom: 4.4, maxzoom: 7.6,
        layout: {
          'text-field': ['get', 'label'], 'text-font': FONT, 'text-letter-spacing': 0.1,
          'text-size': ['interpolate', ['linear'], ['zoom'], 4.4, 9, 7.6, 15],
          'symbol-sort-key': ['case', ['get', 'hasData'], 0, 1],
        },
        paint: {
          'text-color': ['case', ['get', 'hasData'], '#ffe9cf', 'rgba(255,255,255,0.62)'],
          'text-halo-color': 'rgba(4,8,14,0.92)', 'text-halo-width': 1.6,
        },
      },
      place('place-city', ['city', 'town'], 7.6, 12, 22, '#ffffff'),
      place('place-village', ['village', 'suburb'], 10.5, 10, 15, '#e3e8ee'),
      place('place-small', ['hamlet', 'neighbourhood', 'quarter'], 13, 10, 13, '#cdd5de'),
      {
        id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT, 'text-size': 11 },
        paint: { 'text-color': '#f3ead9', 'text-halo-color': 'rgba(4,8,14,0.9)', 'text-halo-width': 1.4 },
      },
    ],
  };
}

export const LAYER_GROUPS = {
  fill: ['prov-fill'],
  forest: ['forest'],
  points: ['pts'],
  labels: ['prov-label', 'place-city', 'place-village', 'place-small', 'water-name', 'road-name'],
  roads: ['road-minor', 'road-mid', 'road-major', 'buildings'],
};
