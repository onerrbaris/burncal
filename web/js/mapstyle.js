import { lang } from './i18n.js?v=20261115-perf-merge';
// Harita stili: uydu tabanı + 3B arazi + yakınlaştıkça açılan vektör detay + il katmanları.
// Karo kaynakları anahtarsızdır; değiştirmek için yalnızca SOURCES bloğunu düzenleyin.

// Açık sarıdan koyu kırmızıya (az -> çok); parlaklık tek yönde azalır.
export const RAMP = ['#fffbe0', '#ffe9a0', '#fec45c', '#fd8d3c', '#ec4a25', '#b10026'];

const FONT = ['Noto Sans Bold'];
const CITY_FONT = ['Noto Sans Regular'];
const FONT_IT = ['Noto Sans Italic'];
export const waterName = () => ['coalesce', ['get', 'name:' + lang()], ['get', 'name']];
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
    'text-field': NAME, 'text-font': CITY_FONT,
    'text-size': ['interpolate', ['linear'], ['zoom'], minzoom, size0, 15, size1],
    'text-letter-spacing': 0.015, 'text-max-width': 8,
    'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
  },
  paint: { 'text-color': color, 'text-halo-color': 'rgba(4,8,14,0.9)', 'text-halo-width': 1.3,
    'text-halo-blur': 0.4,
    'text-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0, minzoom + 0.6, 1] },
});

export function buildStyle(provinces, labels) {
  const style = {
    version: 8,
    projection: { type: 'mercator' },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    terrain: { source: 'dem', exaggeration: 1.35 },
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
      // Deniz: uydu batimetrisi hafif bir soğuk tonun altından görünür.
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
          'fill-color': 'rgba(0,0,0,0)',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'],
            6, ['case', ['boolean', ['feature-state', 'sel'], false], 0.34, 0.56],
            9, ['case', ['boolean', ['feature-state', 'sel'], false], 0.14, 0.34],
            12, 0.08],
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
        // Sınır çizgisinin altındaki koyu gölge: açık renkli alanların üzerinde de seçilsin.
        id: 'prov-casing', type: 'line', source: 'provinces', layout: { 'line-join': 'round' },
        paint: {
          'line-color': 'rgba(10,12,16,0.55)', 'line-blur': 1,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 6, 3.4, 10, 5.5],
        },
      },
      {
        id: 'prov-line', type: 'line', source: 'provinces', layout: { 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', 'rgba(255,255,255,0.8)'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 6, 1.6, 10, 2.8],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 5, 0.95],
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
        paint: { 'line-color': '#ff8a3d', 'line-width': 12, 'line-blur': 10, 'line-opacity': 0.55 },
      },
      {
        id: 'sel-line', type: 'line', source: 'provinces', filter: ['==', ['get', 'name'], ''],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#ffd2ad', 'line-width': 2.2 },
      },
      // Nokta katmanları araziye giydirilmez; dolgu ve çizgi katmanlarının arasında dururlarsa 3B arazi
      // her karede iki kez dokuya çizilir. Bu yüzden hepsinin üstünde, yazıların altında dururlar.
      { // Tek tek uydu tespitleri (seçili yıl); yalnızca yakınlaşınca görünür.
        // Ateş noktalarının altındaki parıltı: kırmızı yoğunluk zemininde de noktalar öne çıksın.
        id: 'pts-glow', type: 'circle', source: 'pts', minzoom: 5.8,
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 5.8, 4.5, 8, 8, 10, 11, 12, 18],
          'circle-color': '#ff7a1a', 'circle-blur': 1,
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5.8, 0, 6.2, 0.45, 12, 0.3],
        },
      },
      {
        id: 'pts', type: 'circle', source: 'pts', minzoom: 5.8,
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 5.8, 2.2, 8, 3.8, 10, 4.4, 12, 7.5],
          'circle-color': '#ff3b1a', 'circle-stroke-color': '#ffe7c4',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5.8, 0.4, 9, 1],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5.8, 0, 6.2, 1],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 5.8, 0, 6.2, 0.85],
        },
      },
      {
        id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
        layout: { 'text-field': waterName(), 'text-font': FONT_IT, 'text-letter-spacing': 0.22,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 10, 15], 'text-max-width': 6 },
        paint: { 'text-color': '#9cc6e6', 'text-halo-color': 'rgba(2,14,26,0.8)', 'text-halo-width': 1.2 },
      },
      {
        // Uzakta harita sade kalır; il adları yaklaşınca belirir, yerleşim adlarına devreder.
        id: 'prov-label', type: 'symbol', source: 'provLabels', minzoom: 6.4, maxzoom: 8.2,
        layout: {
          'text-field': ['get', 'label'], 'text-font': CITY_FONT, 'text-letter-spacing': 0.015,
          'text-size': ['interpolate', ['linear'], ['zoom'], 6.4, 12, 8.2, 15],
          'symbol-sort-key': ['case', ['get', 'hasData'], 0, 1],
        },
        paint: {
          'text-color': ['case', ['get', 'hasData'], '#f2ede4', 'rgba(242,237,228,0.62)'],
          'text-halo-color': 'rgba(4,8,14,0.9)', 'text-halo-width': 1.3, 'text-halo-blur': 0.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 6.4, 0, 7, 1, 7.6, 1, 8.2, 0],
        },
      },
      place('place-city', ['city', 'town'], 7.6, 12, 19, '#f2ede4'),
      place('place-village', ['village', 'suburb'], 10.5, 10, 15, '#e3e8ee'),
      place('place-small', ['hamlet', 'neighbourhood', 'quarter'], 13, 10, 13, '#cdd5de'),
      {
        id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT, 'text-size': 11 },
        paint: { 'text-color': '#f3ead9', 'text-halo-color': 'rgba(4,8,14,0.9)', 'text-halo-width': 1.4 },
      },
    ],
  };
  // Açılışta tespit yoğunluğu, ateş noktaları ve 3B arazi açık; yer adları ve yollar kapalı.
  const optional = new Set([...LAYER_GROUPS.labels, ...LAYER_GROUPS.roads]);
  for (const layer of style.layers) {
    if (optional.has(layer.id)) layer.layout = { ...layer.layout, visibility: 'none' };
  }
  return style;
}

export const LAYER_GROUPS = {
  fill: ['prov-fill'],
  points: ['pts-glow', 'pts'],
  labels: ['prov-label', 'place-city', 'place-village', 'place-small', 'water-name', 'road-name'],
  roads: ['road-minor', 'road-mid', 'road-major', 'buildings'],
};
