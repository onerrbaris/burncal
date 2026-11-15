import { t as msg, lang, locale, displayText, percent } from './i18n.js?v=20261115-tri-marks';
/* global maplibregl */
import { regionGeometry } from './regions.js?v=20261115a';
import { buildStyle, LAYER_GROUPS, RAMP, waterName } from './mapstyle.js?v=20261115-tri-marks';
import { MONTHS, MON3, LEVELS, fmt, quantile, inRange, reading, sentence, peaks, sourceOf, csvRows, hotspotRows,
  calendar, calendarKey, compare, stepChart, setChartWidth, vsTypical, rampColor } from './charts.js?v=20261115-tri-marks';
import { DrawTool, drawnArea } from './draw.js?v=20261115-tri-marks';

const $ = (s) => document.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
// MVP: hafif mod varsayılan; uzun kamera uçuşları ve sürekli animasyonlar için adrese ?sinematik ekleyin.
const FAST = REDUCED || !new URLSearchParams(location.search).has('sinematik');
const TR_BOUNDS = [[25.6, 35.7], [44.9, 42.2]];
// Yer adının özgün değeri seçim ve harita kimliğidir.
const displayName = (name) => geographic?.regions[name] || name === DRAWN ? displayText(name) : name;
const low = (s) => s.toLocaleLowerCase('tr');
// Seriler: varsayılan uyumlaştırılmış seri; ham MODIS ve VIIRS, kaynağı doğrudan incelemek isteyenler için.
const SENSORS = [
  { key: 'merged', label: 'Birleşik', sub: 'MODIS + VIIRS' },
  { key: 'modis', label: 'MODIS', sub: 'ham' },
  { key: 'viirs', label: 'VIIRS', sub: 'ham' },
];

const TABS = [['calendar', 'Takvim'], ['compare', 'Karşılaştırma'], ['peaks', 'Zirveler'], ['step', 'Uydu uyumu'], ['ogm', 'OGM verisi']];

// month: okunan ay (0–11); from/to: dönem yılları; win: sezon penceresi [ilk ay, son ay]; custom: dönemi kullanıcı mı seçti.
const state = { scope: 'province', sensor: 'merged', year: null, month: 11, from: null, to: null, win: [0, 11], custom: false, sel: null, tab: 'calendar' };
let geographic, regionGeo, country, drawn = null, drawTool, lcGroup = [];
const provinceRegion = {};
// Alan birimleri: il, coğrafi bölge, Türkiye (81 il toplamı) ve kullanıcının çizdiği alan.
const COUNTRY = 'Türkiye', DRAWN = 'Çizilen alan';
const SCOPE_LABEL = { province: 'İl', region: 'Bölge', country: 'Ülke', draw: 'Çizilen alan' };
const EMPTY = { type: 'FeatureCollection', features: [] };
const regional = () => state.scope === 'region';
const multi = () => state.scope !== 'province';     // birden çok ilin serisinden kurulan alan
const scopeLabel = () => displayText(SCOPE_LABEL[state.scope]);
// Ülke görünümünde harita yedi coğrafi bölgeyi boyar (Türkiye seçili kalır); bölgeye tıklamak
// bölge görünümüne geçirir.
const regionMap = () => state.scope === 'region' || state.scope === 'country';
const mapNames = () => (state.scope === 'country' ? Object.keys(geographic.regions) : areaNames());
const mapData = (name) => (state.scope === 'country' ? geographic.regions[name]?.series : areaData(name));
function mapTotal(name, year = state.year) {
  const row = mapData(name)?.[state.sensor]?.[year];
  if (!row) return null;
  const months = row.slice(state.win[0], state.win[1] + 1);
  return months.some((v) => v != null) ? sum(months) : null;
}
function pickArea(name) {
  if (state.scope === 'country' && name !== COUNTRY) setScope(geographic.regions[name] ? 'region' : 'province');
  select(name);
}
const activeGeo = () => ({ province: geo, region: regionGeo, country: regionGeo, draw: drawn?.geo || EMPTY })[state.scope];
function areaData(name) {
  if (state.scope === 'region') return geographic.regions[name]?.series;
  if (state.scope === 'country') return name === COUNTRY ? country.series : null;
  if (state.scope === 'draw') return name === DRAWN ? drawn?.series : null;
  return data.provinces[name];
}
function areaNames() {
  if (state.scope === 'region') return Object.keys(geographic.regions);
  if (state.scope === 'country') return [COUNTRY];
  if (state.scope === 'draw') return drawn ? [DRAWN] : [];
  return Object.keys(data.provinces);
}
const areaName = (name) => ({ region: provinceRegion[name] || name, country: COUNTRY, draw: DRAWN })[state.scope] || name;
function membersOf(name) {
  if (state.scope === 'country') return Object.keys(data.provinces);
  if (state.scope === 'draw') return drawn ? drawn.byProv.map(([n]) => n) : [];
  return geographic.regions[name]?.members || [name];
}
function partialValues(key, name) {
  if (state.scope === 'region') return geographic.partial[key]?.[name];
  if (state.scope === 'country') return country.partial[key];
  if (state.scope === 'draw') return drawn?.partial[key];
  return data.partial[key]?.[name];
}
let data, geo, ogm, lc, map, ready = false, hovered = null, orbitOK = false, orbitRaf = 0;
let RANGE, LY, LM, LD, PARTIAL, READ_M;   // etkin serinin yıl aralığı; son veri yılı, ayı (0–11), günü; son yıl bitmemiş mi
const bboxes = {}, provIdx = {}, ranges = {};

// ── Veri ────────────────────────────────────────────────
const sum = (a) => a.reduce((x, y) => x + (y ?? 0), 0);
const series = (name, sensor = state.sensor) => areaData(name)?.[sensor] || null;
const sensorOf = () => SENSORS.find((s) => s.key === state.sensor);
const mtdKey = () => (state.sensor === 'merged' ? 'mtd' : `mtd_${state.sensor}`);
const fullWin = () => state.win[0] === 0 && state.win[1] === 11;
const inWin = (m) => m >= state.win[0] && m <= state.win[1];
const winLabel = () => (fullWin() ? '' : `${MON3[state.win[0]]}–${MON3[state.win[1]]}`);
const isPartial = (y, m) => PARTIAL && y === LY && m === LM;
const throughLabel = () => new Date(Date.UTC(LY, LM, LD)).toLocaleDateString(locale(), {
  year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
});

// Seçili yılın sezon penceresindeki toplamı (harita, sıralama, KPI).
function total(name, year = state.year) {
  const row = series(name)?.[year];
  return row ? sum(row.filter((_, m) => inWin(m))) : null;
}

// Bitmemiş yılla adil kıyas: her yılın aynı takvim penceresi (pencerede, son veri gününe kadar).
function likeTotal(name, y) {
  const row = series(name)?.[y];
  if (!row) return null;
  let t = 0;
  for (let m = state.win[0]; m <= Math.min(state.win[1], LM - 1); m++) t += row[m] ?? 0;
  if (inWin(LM)) {
    const i = data.partial.years.indexOf(y);
    t += y === LY ? row[LM] ?? 0 : partialValues(mtdKey(), name)?.[i] ?? 0;
  }
  return t;
}

// Süren ay için bütün yılların aynı günleri yerleştirilmiş seri: yarım ay, yarım aylarla kıyaslanır.
const cmpCache = {};
function cmpYears(name) {
  if (!PARTIAL) return series(name);
  const ck = state.scope + state.sensor + name;
  if (cmpCache[ck]) return cmpCache[ck];
  const out = {}, mtd = partialValues(mtdKey(), name) || [];
  for (const [y, row] of Object.entries(series(name) || {})) {
    const i = data.partial.years.indexOf(+y), r = row.slice();
    if (+y !== LY && i >= 0) r[LM] = mtd[i];
    out[y] = r;
  }
  return (cmpCache[ck] = out);
}
// Ay okuması: süren ay için cmpYears, diğer aylar için tam seri.
const rdFor = (name) => (y, m) => reading(isPartial(y, m) ? cmpYears(name) : series(name), y, m, state.from, state.to);

function indexData() {
  for (const { key } of SENSORS) {
    let lo = Infinity, hi = -Infinity;
    for (const p of Object.values(data.provinces)) for (const y of Object.keys(p[key] || {})) { lo = Math.min(lo, +y); hi = Math.max(hi, +y); }
    if (hi >= lo) ranges[key] = [lo, hi];
  }
  RANGE = ranges.merged;
  const t = (data.meta.data_through || `${RANGE[1]}-12-31`).split('-').map(Number);
  [LY, LM, LD] = [t[0], t[1] - 1, t[2]];
  PARTIAL = !!data.partial && !(LM === 11 && LD === 31);
  // Süren ayın ilk birkaç günü okunacak kadar değil: açılışta son tam ay okunur.
  READ_M = PARTIAL && LD < 7 && LM > 0 ? LM - 1 : LM;
  state.month = READ_M;
}

// Aranabilir adlar: ülke görünümünde yalnızca Türkiye (diğer ülkeler ileride), diğerlerinde haritadaki alanlar.
const COUNTRY_SOON = 'Diğer ülkeler yakında eklenecek';
const searchNames = () => (state.scope === 'country' ? [COUNTRY] : mapNames());
function renderAreaSearch(clear = true) {
  const names = searchNames().sort((a, b) => displayName(a).localeCompare(displayName(b), locale()));
  $('#provList').innerHTML = names.map((n) => `<option value="${displayName(n)}">`).join('');
  const ph = state.scope === 'country' ? msg("search.countries") : regionMap() ? msg("search.regions") : msg("search.provinces");
  $('#search').placeholder = matchMedia('(max-width: 1280px)').matches ? msg('search.short') : ph;
  $('#search').setAttribute('aria-label', ph);
  if (clear) $('#search').value = '';
  // Çizim görünümünde aranacak bir ad yok.
  $('.topbar .search').hidden = state.scope === 'draw';
}
function setScope(scope, fly = true) {
  if (!ready) return;
  if (scope === state.scope) { if (scope === 'draw') startDraw(); return; }
  closePointPopup(); hideTip(); stopOrbit();
  const previous = state.scope === 'province' ? state.sel : null;
  if (state.scope === 'draw') { drawTool.stop(); $('#drawBar').hidden = true; }
  if (hovered) map.setFeatureState({ source: 'provinces', id: hovered }, { hover: false });
  hovered = null;
  map.getCanvas().style.cursor = '';
  state.scope = scope;
  state.sel = null;
  for (const button of document.querySelectorAll('[data-scope]')) button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
  setAreaGeo();
  renderAreaSearch();
  // İl/bölge geçişinde yoğunluk katmanının açık/kapalı tercihi korunur.
  if (scope === 'country') select(COUNTRY, fly);
  else if (scope === 'draw') { select(drawn ? DRAWN : null, false); startDraw(); }
  else select(regional() && previous ? areaName(previous) : null, false);
  renderLegend();
}
function setAreaGeo() {
  map.removeFeatureState({ source: 'provinces' });
  map.getSource('provinces').setData(activeGeo());
  map.getSource('provLabels').setData(geometry(activeGeo(), false));
}

// ── Çizim ───────────────────────────────────────────────
// Çizilen alan için bütün yılların noktaları gerekir (~5 MB sıkıştırılmış). İndirme "Çiz"e basılınca
// başlar; kullanıcı çizerken arka planda biter.
let allYears = null;
function loadAllYears(progress) {
  const lo = Math.min(...Object.values(ranges).map((r) => r[0])), hi = Math.max(...Object.values(ranges).map((r) => r[1]));
  const ys = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  if (!allYears) {
    let done = 0;
    allYears = Promise.all(ys.map((y) => loadYear(y).then((d) => { done++; allYears.progress?.(done, ys.length); return [y, d]; })))
      .then((rows) => {
        if (rows.some(([, d]) => !d.modis && !d.viirs)) { allYears = null; throw new Error(msg("could.not.download.detection.files")); }
        return Object.fromEntries(rows);
      });
  }
  allYears.progress = progress;
  return allYears;
}
const drawHint = (t) => { $('#drawHint').textContent = t; };
function startDraw(mode) {
  closePointPopup(); hideTip(); stopOrbit();
  $('#drawBar').hidden = false;
  if (mode) for (const b of document.querySelectorAll('[data-draw]')) b.setAttribute('aria-pressed', String(b.dataset.draw === mode));
  drawTool.start(mode || $('[data-draw][aria-pressed=true]')?.dataset.draw || 'free');
  loadAllYears().catch(() => {});
}
const SHAPE = { free: 'Serbest çizim', circle: 'Elips', poly: 'Çokgen' };
async function finishDraw(shape) {
  drawTool.stop();
  drawHint(msg("loading.data"));
  let byYear;
  try {
    byYear = await loadAllYears((k, n) => drawHint(msg("loading.data2", [k, n])));
  } catch (e) {
    console.error(e);
    drawHint(msg("could.not.download.the.data"));
    return drawTool.start();
  }
  if (state.scope !== 'draw') return;
  const r = drawnArea(shape.ring, byYear, { data, names: geo.features.map((f) => f.properties.name),
    viirsFrom: data.meta.viirs_from, LM, LD, lcGroup });
  drawn = { ...r, ...shape, label: SHAPE[shape.mode] || msg("area"),
    geo: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: DRAWN }, geometry: { type: 'Polygon', coordinates: [shape.ring] } }] } };
  for (const k of Object.keys(cmpCache)) delete cmpCache[k];
  $('#drawBar').hidden = true;
  setAreaGeo();
  state.sel = null;
  select(DRAWN);
}

function geometry(collection = geo, index = true) {
  const labels = [];
  collection.features.forEach((f, idx) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let b = [180, 90, -180, -90], best = null, bestArea = -1;
    for (const poly of polys) {
      const ring = poly[0];
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j], [x2, y2] = ring[i], k = x1 * y2 - x2 * y1;
        a += k; cx += (x1 + x2) * k; cy += (y1 + y2) * k;
        b = [Math.min(b[0], x2), Math.min(b[1], y2), Math.max(b[2], x2), Math.max(b[3], y2)];
      }
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
    }
    const name = f.properties.name;
    bboxes[name] = [[b[0], b[1]], [b[2], b[3]]];
    if (index) provIdx[name] = idx;
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: best },
      properties: { name, label: displayName(name), hasData: !!mapData(name) } });
  });
  return { type: 'FeatureCollection', features: labels };
}

// ── Harita ──────────────────────────────────────────────
function pads() {
  if (innerWidth <= 760) return { top: 120, bottom: state.sel ? innerHeight * 0.6 + 100 : 110, left: 20, right: 20 };
  // Grafik paneli her seçimde kapalı başlar; kamera yalnızca sol özete yer bırakır.
  return { top: 100, bottom: 130, left: state.sel ? 390 : 260, right: 60 };
}

// Sınırları görünür alana sığdıran kamera (Mercator hesabı; eğim ve küre görünümünden bağımsız).
function fit(bounds, pad) {
  const mx = (lng) => (lng + 180) / 360;
  const my = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  const [[w, s], [e, n]] = bounds;
  const W = Math.max(120, innerWidth - pad.left - pad.right), H = Math.max(120, innerHeight - pad.top - pad.bottom);
  const zoom = Math.log2(Math.min(W / ((mx(e) - mx(w)) * 512), H / ((my(s) - my(n)) * 512)));
  const cy = (my(s) + my(n)) / 2;
  return { center: [(w + e) / 2, (Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180) / Math.PI], zoom };
}

function goHome(duration = 2600) {
  const cam = fit(TR_BOUNDS, pads());
  cam.zoom -= 0.3;   // Türkiye kıyıları ve komşu denizler de görünsün
  move({ ...cam, pitch: 38, bearing: 0, padding: pads() }, duration);
}

// Kamera geçişi. Hafif modda (varsayılan) kısa, yumuşak bir süzülme: yavaş başlar, yavaş durur.
// "essential": işletim sisteminde animasyonlar kapalı olsa da (Windows "animasyon efektleri") bu kısa
// geçiş oynar; sürekli dönen kamera ve akan sınır çizgisi o durumda kapalı kalır.
function move(cam, duration) {
  if (!FAST) return map.flyTo({ ...cam, duration, curve: 1.5, essential: true });
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  map.flyTo({ ...cam, pitch: Math.min(cam.pitch ?? 0, 30), bearing: 0, duration: 1400, curve: 1.2, easing: ease, essential: true });
}

// Ateş noktaları: seçili yılın tespitleri (5'li gruplar: x, y, gün, frp, il). 2012'den önce yalnızca MODIS vardır.
const ptCache = {};
let ptKey = '', ptStyle = '', ptTimer = 0;
let ptDrawn = null, ptPopup = null, ptHoverRaf = 0, ptMouse = null;
const ptCurrentKey = () => `${state.year}${ptSensor()}${state.win}`;
const pointsVisible = () => ready && map.getZoom() >= 5.8 && map.getLayoutProperty('pts', 'visibility') !== 'none';
let popupHit = null;
function closePointPopup() { popupHit = null; ptPopup?.remove(); ptPopup = null; }
// Çizime verilen diziyi paylaşır; yeni istek ya da ayrı nokta feature'ları oluşturmaz.
function pointHits(point) {
  if (!pointsVisible() || !ptDrawn || ptDrawn.key !== ptCurrentKey()) return null;
  const { a, y, s, st } = ptDrawn;
  let nearest = -1, distance = Infinity, count = 0, first = 367, last = 0;
  // Ön eleme: imlecin ±8 piksellik kutusunu enlem/boylama çevir, yalnızca içindeki noktaları ekrana izdüşür.
  // Böylece fare hareketinde 35 bin map.project yerine birkaç tanesi çalışır.
  const c = [[-9, -9], [9, -9], [-9, 9], [9, 9]].map(([dx, dy]) => map.unproject([point.x + dx, point.y + dy]));
  const x0 = Math.min(...c.map((q) => q.lng)) * 1000, x1 = Math.max(...c.map((q) => q.lng)) * 1000;
  const y0 = Math.min(...c.map((q) => q.lat)) * 1000, y1 = Math.max(...c.map((q) => q.lat)) * 1000;
  for (let i = 0; i < a.length; i += st) {
    if (a[i] < x0 || a[i] > x1 || a[i + 1] < y0 || a[i + 1] > y1) continue;
    if (!fullWin() && !inWin(new Date(Date.UTC(y, 0, a[i + 2])).getUTCMonth())) continue;
    const p = map.project([a[i] / 1000, a[i + 1] / 1000]);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d > 64) continue;
    count++; first = Math.min(first, a[i + 2]); last = Math.max(last, a[i + 2]);
    if (d < distance) { distance = d; nearest = i; }
  }
  return nearest < 0 ? null : { a, y, s, st, i: nearest, count, first, last };
}
function openPointPopup(hit) {
  closePointPopup(); hideTip(); stopOrbit();
  popupHit = hit;
  const { a, y, s, st, i, count, first, last } = hit;
  const dt = new Date(Date.UTC(y, 0, a[i + 2])), m = dt.getUTCMonth();
  const name = geo.features[a[i + 4]]?.properties.name;
  const date = (d) => d.toLocaleDateString(locale(), { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const start = new Date(Date.UTC(y, 0, first)), end = new Date(Date.UTC(y, 0, last));
  const span = first === last ? date(start) : start.getUTCMonth() === end.getUTCMonth()
    ? (lang() === 'en' ? `${date(start)}–${end.getUTCDate()}` : `${start.getUTCDate()}–${date(end)}`) : `${date(start)}–${date(end)}`;
  const nrt = data.meta.nrt_from?.[s] && dt.toISOString().slice(0, 7) >= data.meta.nrt_from[s];
  const body = document.createElement('div');
  const line = (tag, text) => { const el = document.createElement(tag); el.textContent = text; body.append(el); };
  line('b', msg("nearest.fire.detection", [date(dt), y]));
  line('p', `${s === 'viirs' ? 'VIIRS S-NPP' : 'MODIS'} · ${a[i + 3].toLocaleString(locale())} MW FRP`);
  line('p', `${name || msg("unknown.province")} · ${nrt ? msg("near.real.time.nrt") : msg("archive.sp")}`);
  const lcName = st > 5 && lc ? lc.classes.find((c) => c.i === a[i + 5])?.label : null;
  if (lcName) line('p', msg("land.cover", [displayText(lcName)]));
  if (count > 1) line('p', msg("fire.detections.here", [count, span]));
  line('small', msg("location.centre.of.the.sensor", [s === 'viirs' ? '±375 m (VIIRS)' : '±1 km (MODIS)']));
  if (name) {
    const link = document.createElement('a');
    link.href = '#panel'; link.className = 'link'; link.textContent = msg("open.this.month.in.the");
    link.onclick = (e) => {
      e.preventDefault(); closePointPopup();
      state.month = m; state.tab = 'calendar';
      state.from = Math.min(state.from, y); state.to = Math.max(state.to, y);
      setYear(y); pickArea(name);
    };
    body.append(link);
  }
  ptPopup = new maplibregl.Popup({ className: 'point-popup', maxWidth: '290px', closeOnClick: false, offset: 10 })
    .setLngLat([a[i] / 1000, a[i + 1] / 1000]).setDOMContent(body).addTo(map);
  ptPopup.getElement().querySelector('.maplibregl-popup-close-button')?.setAttribute('aria-label', msg("close.popup"));
}
const PT_MINZOOM = 5.4; // katman 5.8'de görünür olur; biraz önce hazırlanır
const ptSensor = () => (state.sensor !== 'merged' ? state.sensor : state.year < 2012 ? 'modis' : 'viirs');
const loadYear = (y) => ptCache[y] || (ptCache[y] = fetch(`data/points/${y}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => { delete ptCache[y]; return {}; }));
// Bir yılın noktaları on binlerce tespittir. Yalnızca noktalar görünürken ve yıl değişimi durulunca
// yüklenir; böylece yıl kaydırıcısı ve oynatma, uzak görünümde haritayı yeniden kurmaz.
function updatePoints() {
  if (!pointsVisible() || (ptDrawn && ptDrawn.key !== ptCurrentKey())) closePointPopup();
  clearTimeout(ptTimer);
  ptTimer = setTimeout(loadPoints, 160);
}
async function loadPoints() {
  const src = map && map.getSource('pts');
  if (!src || !state.year || map.getZoom() < PT_MINZOOM) return;
  if (map.getLayoutProperty('pts', 'visibility') === 'none') return;
  const s = ptSensor(), y = state.year, key = `${y}${s}${state.win}`;
  if (key === ptKey) return;
  ptKey = key;
  try {
    const d = await loadYear(y);
    if (ptKey !== key) return;
    const a = d[s] || [], st = d.stride || 5, coordinates = [];
    for (let i = 0; i < a.length; i += st) {
      if (fullWin() || inWin(new Date(Date.UTC(y, 0, a[i + 2])).getUTCMonth())) coordinates.push([a[i] / 1000, a[i + 1] / 1000]);
    }
    // Tek çok-noktalı geometri: on binlerce ayrı nesne kurmaktan çok daha hafif.
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates } });
    ptDrawn = { a, y, s, key, st };
    if (ptStyle === s) return;
    ptStyle = s;
    // Nokta, yakın görünümde sensörün piksel ayak izi kadar yer kaplar (VIIRS ~375 m, MODIS ~1 km):
    // ateş bu dairenin içinde bir yerdedir. 38° enlemde z12'de 1 piksel ~30 m.
    const m = s === 'modis';
    map.setPaintProperty('pts', 'circle-radius',
      ['interpolate', ['exponential', 2], ['zoom'], 5.8, 2.2, 8, 3.8, 10, m ? 5.2 : 4.4, 12, m ? 17 : 7.5]);
    map.setPaintProperty('pts', 'circle-opacity',
      ['interpolate', ['linear'], ['zoom'], 5.8, 0, 6.2, 1, 10, m ? 0.8 : 0.95, 12, m ? 0.55 : 0.85]);
  } catch (e) { ptKey = ''; }
}

// Renkler, seçili yıl ve ay penceresindeki tespit sırasına göre yayılır.
let legendAreas = [];
function paintMap() {
  legendAreas = [];
  for (const { properties: { name } } of activeGeo().features) {
    const total = mapTotal(name);
    map.setFeatureState({ source: 'provinces', id: name }, { sel: name === state.sel });
    if (total != null) legendAreas.push({ name, total });
  }
  legendAreas.sort((a, b) => a.total - b.total);
  const last = Math.max(1, legendAreas.length - 1);
  let rank = 0;
  legendAreas.forEach((area, i) => {
    if (i && area.total !== legendAreas[i - 1].total) rank = i;
    area.color = rampColor(rank / last);
    area.bucket = Math.round(rank / last * (RAMP.length - 1));
  });
  // Dolgu stilini güncellemek, kamera sabitken de 3B arazinin renk dokularını yeniler.
  const colors = legendAreas.flatMap(({ name, color }) => [name, color]);
  const empty = 'rgba(0,0,0,0)';
  map.setPaintProperty('prov-fill', 'fill-color', colors.length ? ['match', ['get', 'name'], ...colors, empty] : empty);
  renderLegend();
  updatePoints();
}

function startOrbit() {
  if (FAST || !orbitOK) return;
  let last = performance.now();
  const step = (now) => {
    if (!orbitOK) return;
    map.setBearing(map.getBearing() + (now - last) * 0.0014);
    last = now;
    orbitRaf = requestAnimationFrame(step);
  };
  orbitRaf = requestAnimationFrame(step);
}
function stopOrbit() { orbitOK = false; cancelAnimationFrame(orbitRaf); }

function initMap() {
  map = new maplibregl.Map({
    container: 'map', style: buildStyle(geo, geometry()),
    center: [35.2, 39], zoom: 5.2, pitch: 0, minZoom: 4.6, maxZoom: 12, maxPitch: 60,
    maxBounds: [[19, 31], [51, 46]], pixelRatio: 1,
    attributionControl: false, fadeDuration: 200,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  window.__map = map;

  map.on('load', () => {
    addLandcover();
    // Çizilen alanın dolgusu ve çizim sırasındaki taslak.
    map.addLayer({ id: 'area-fill', type: 'fill', source: 'provinces', filter: ['==', ['get', 'name'], DRAWN],
      paint: { 'fill-color': '#ff8a3d', 'fill-opacity': 0.12 } }, 'sel-glow');
    map.addSource('draft', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['get', 'k'], 'a'],
      paint: { 'fill-color': '#ff8a3d', 'fill-opacity': 0.16 } });
    map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['get', 'k'], 'l'],
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffd2ad', 'line-width': 2.4 } });
    map.addLayer({ id: 'draft-pt', type: 'circle', source: 'draft', filter: ['==', ['get', 'k'], 'v'],
      paint: { 'circle-radius': 4.5, 'circle-color': '#ff8a3d', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    drawTool = new DrawTool(map, { onDone: finishDraw, onStatus: drawHint });
    ready = true;
    for (const button of document.querySelectorAll('[data-scope]')) button.disabled = false;
    // Açılış: Türkiye toplamı; grafik paneli kapalı, "Yangın takvimini aç" ile açılır.
    setScope('country', false);
    document.body.classList.remove('booting');
    $('#intro').classList.add('out');
    setTimeout(() => $('#intro').remove(), 2400);
    goHome(5200);
  });

  map.on('mousemove', 'prov-hover', (e) => {
    if (drawTool?.active) return hideTip();
    const name = e.features[0]?.properties.name;
    if (name !== hovered) {
      if (hovered) map.setFeatureState({ source: 'provinces', id: hovered }, { hover: false });
      hovered = name;
      map.setFeatureState({ source: 'provinces', id: name }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
    }
    const t = mapTotal(name);
    showTip(`<b>${displayName(name)}</b>${t == null ? msg("no.data") : msg("fire.detections", [fmt(t), periodLabel()])}`, e.originalEvent.clientX, e.originalEvent.clientY);
  });
  map.on('mouseleave', 'prov-hover', () => {
    if (hovered) map.setFeatureState({ source: 'provinces', id: hovered }, { hover: false });
    hovered = null; map.getCanvas().style.cursor = ''; hideTip();
  });
  // Tek tıklama yolu: nokta önceliklidir, boş yerde mevcut il seçimi sürer.
  map.on('click', (e) => {
    if (drawTool?.active) return;
    const hit = pointHits(e.point);
    if (hit) return openPointPopup(hit);
    closePointPopup();
    const f = map.queryRenderedFeatures(e.point, { layers: ['prov-hover'] })[0];
    if (f) pickArea(f.properties.name);
  });
  map.on('mousemove', (e) => {
    ptMouse = e.point;
    if (ptHoverRaf) return;
    ptHoverRaf = requestAnimationFrame(() => {
      ptHoverRaf = 0;
      const hit = ptMouse && pointHits(ptMouse);
      map.getCanvas().style.cursor = hit || hovered ? 'pointer' : '';
      if (hit) hideTip();
    });
  });
  map.getCanvas().addEventListener('mouseleave', () => {
    ptMouse = null; cancelAnimationFrame(ptHoverRaf); ptHoverRaf = 0;
    map.getCanvas().style.cursor = '';
  });

  for (const ev of ['mousedown', 'touchstart', 'wheel']) map.on(ev, stopOrbit);
  map.on('zoom', () => {
    if (!pointsVisible()) closePointPopup();
    if (map.getZoom() >= PT_MINZOOM) updatePoints();
  });

  // Seçili il sınırında akan çizgi (yalnızca sinematik modda).
  const dash = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
    [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  let di = 0;
  if (!FAST) setInterval(() => {
    if (!state.sel || !map.getLayer('sel-line')) return;
    di = (di + 1) % dash.length;
    map.setPaintProperty('sel-line', 'line-dasharray', dash[di]);
  }, 70);
}

// "2026 (13 Kas itibarıyla)", "2021 · Haz–Eki" gibi kısa dönem etiketi.
function periodLabel(y = state.year) {
  const w = winLabel();
  const part = PARTIAL && y === LY && inWin(LM) ? ` ${msg("as.of", [LD, MON3[LM]])}` : '';
  return `${y}${w ? ' · ' + w : ''}${part}`;
}

// Arazi türü katmanı: her 3°x3° parça için ~270 m'lik renkli görüntü (scripts/build_landcover.py).
const lcLayers = [];
let landLegend = [];
function renderLandLegend() {
  $('#lcLegend').innerHTML = landLegend.map((l) => `<li><i style="background:${l.color}"></i>${displayText(l.label)}</li>`).join('');
}
async function addLandcover() {
  try {
    const idx = await fetch('data/landcover/index.json').then((r) => (r.ok ? r.json() : null));
    if (!idx) return;
    const on = $('#layersMenu [data-layer=landcover]')?.checked;
    for (const t of idx.tiles) {
      const id = `lc-${t.tile}`;
      map.addSource(id, { type: 'image', url: t.file, coordinates: t.coordinates });
      map.addLayer({ id, type: 'raster', source: id, layout: { visibility: on ? 'visible' : 'none' },
        paint: { 'raster-opacity': 0.72, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, 'pts-glow');
      lcLayers.push(id);
    }
    landLegend = idx.legend;
    renderLandLegend();
    $('#lcRow').hidden = false;
  } catch (e) { console.warn(msg("could.not.load.land.cover"), e); }
}

// ── Seçim ───────────────────────────────────────────────
function select(name, fly = true) {
  if (name) name = areaName(name);
  stopOrbit();
  const changed = name !== state.sel;
  state.sel = name;
  document.body.classList.toggle('has-panel', !!name);
  // Türkiye seçiliyken 81 ilin iç sınırları parlatılmaz; ülke sınırı altlıkta zaten çizili.
  const f = ['==', ['get', 'name'], state.scope === 'country' ? '' : name || ''];
  map.setFilter('sel-glow', f); map.setFilter('sel-line', f);
  paintMap(); renderPanel(); renderRank();
  // Yeni seçim panellerin başından okunur (panel görünür olduktan sonra; gizliyken sıfırlama tutmaz).
  if (changed && name) for (const id of ['#sideBody', '#panelBody']) $(id).scrollTop = 0;
  if (!fly) return;
  if (!name || state.scope === 'country') return goHome(2200);
  const cam = fit(bboxes[name], pads());
  const bearing = ((name.length * 37) % 50) - 25;
  move({ center: cam.center, zoom: Math.min(cam.zoom - 0.25, 10), pitch: 54, bearing, padding: pads() }, 2600);
  orbitOK = true;
  map.once('moveend', startOrbit);
}

// ── Yıl ─────────────────────────────────────────────────
function sensorText(b, s, r) {
  b.title = s.key === 'merged' ? msg("modis.and.viirs.on.a") : msg("raw.fire.detections.without.adjustment", [s.label]);
  b.innerHTML = `<b>${displayText(s.label)}</b><small class="${s.key === 'merged' ? '' : 'raw'}">${displayText(s.sub)} · ${r[0]}–${r[1]}</small>`;
}
function renderSensors() {
  const nav = $('#sensorTabs');
  for (const s of SENSORS) {
    const r = ranges[s.key];
    if (!r) continue;
    const b = document.createElement('button');
    b.role = 'tab'; b.dataset.key = s.key;
    sensorText(b, s, r);
    b.onclick = () => setSensor(s.key);
    nav.append(b);
  }
  nav.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    const keys = SENSORS.map((s) => s.key).filter((k) => ranges[k]);
    const next = keys[(keys.indexOf(state.sensor) + d + keys.length) % keys.length];
    setSensor(next); nav.querySelector(`[data-key=${next}]`).focus(); e.stopPropagation();
  });
  addEventListener('resize', moveIndicator);
  document.fonts?.ready.then(moveIndicator);
}
function moveIndicator() {
  const b = $(`#sensorTabs [data-key=${state.sensor}]`), ind = $('.seg-ind');
  if (!b) return;
  ind.style.width = b.offsetWidth + 'px';
  ind.style.transform = `translateX(${b.offsetLeft}px)`;
}
function setSensor(key) {
  closePointPopup();
  state.sensor = key;
  for (const b of document.querySelectorAll('#sensorTabs button')) {
    const on = b.dataset.key === key;
    b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
  }
  moveIndicator();
  RANGE = ranges[key];
  const [lo, hi] = RANGE, slider = $('#year');
  slider.min = lo; slider.max = hi;
  clampRange();
  $('#yearTicks').innerHTML = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    .map((y) => `<span>${y === lo || y === hi || (y % 5 === 0 && y - lo > 1 && hi - y > 1) ? y : ''}</span>`).join('');
  ptKey = '';
  setYear(Math.min(hi, Math.max(lo, state.year ?? hi)));
}
function setYear(y) {
  if (+y !== state.year) closePointPopup();
  state.year = +y;
  const [lo, hi] = RANGE, slider = $('#year');
  slider.value = y;
  slider.style.setProperty('--p', ((y - lo) / (hi - lo)) * 100 + '%');
  $('#yearOut').textContent = y;
  // Bitmemiş yılda okunacak ay, henüz verisi olmayan bir ay kalmasın.
  if (PARTIAL && state.year === LY && state.month > LM) state.month = LM;
  if (ready) paintMap();
  renderPanel(); renderRank();
}

// Renk ölçeği: her rengin hangi tespit aralığına karşılık geldiği (katman menüsünde, arazi türü gibi).
// Açıklama ve harita aynı normalize edilmiş tespit değerini kullanır.
function renderLegend() {
  const el = $('#legend'), on = $('#layersMenu [data-layer=fill]')?.checked;
  el.hidden = !on || legendAreas.length < 2 || state.scope === 'draw';
  if (el.hidden) return;
  let rows;
  if (regionMap()) {
    rows = legendAreas.slice().reverse().map(({ name, total, color }) =>
      `<li><i style="background:${color}"></i><span>${fmt(total)}</span><small>${displayName(name)}</small></li>`).join('');
  } else {
    const buckets = RAMP.map(() => []);
    for (const { total, bucket } of legendAreas) buckets[bucket].push(total);
    rows = buckets.map((values, i) => {
      if (!values.length) return '';
      const low = values[0], high = values.at(-1);
      const range = low === high ? fmt(low) : `${fmt(low)}–${fmt(high)}`;
      return `<li><i style="background:${RAMP[i]}"></i><span>${range}</span></li>`;
    }).reverse().join('');
  }
  el.innerHTML = `<li class="lg-title">${msg("fire.detections.per", [regionMap() ? msg("region") : msg("province"), fullWin() ? msg("annual") : winLabel(), state.year])}</li>${rows}
    <li class="lg-dot"><i></i><span>${msg("zoom.in.to.see.individual")}</span></li>`;
}

function renderRank() {
  const rows = mapNames().map((n) => [n, mapTotal(n)]).filter((r) => r[1] != null)
    .sort((a, b) => b[1] - a[1]).slice(0, regionMap() ? 7 : 6);
  $('#rank').hidden = !rows.length || state.scope === 'draw';
  if (!rows.length || state.scope === 'draw') return;
  $('#rankTitle').textContent = msg("most.fire.detections", [regionMap() ? ` ${msg("regions")}` : '', state.year, fullWin() ? '' : ' · ' + winLabel()]);
  $('#rankList').innerHTML = rows.map(([n, t], i) =>
    `<li><button data-name="${n}" class="${n === state.sel ? 'on' : ''}"><i>${i + 1}</i><span>${displayName(n)}</span><em>${fmt(t)}</em>
     <u style="width:calc((100% - 34px) * ${rows[0][1] ? t / rows[0][1] : 0})"></u></button></li>`).join('');
}

// ── Panel ───────────────────────────────────────────────
const head = (eyebrow, title) => `<div class="p-head"><div><span class="eyebrow">${eyebrow}</span><h2>${displayName(title)}</h2></div>
  <button class="close" aria-label="${msg("close.panel")}" title="${msg("close.esc")}">×</button></div>`;
const dec = (n, d = 1) => n.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
const viirsYear = () => +(data.meta.viirs_from || '2012-02').slice(0, 4);

// Dönem: kullanıcı seçmediyse bütün yıllar; seçtiyse seri aralığına kırpılır.
function clampRange() {
  const r = RANGE;
  let f = state.custom ? Math.max(r[0], state.from) : r[0], t = state.custom ? Math.min(r[1], state.to) : r[1];
  if (!(f <= t)) { f = r[0]; t = r[1]; state.custom = false; }
  state.from = f; state.to = t;
}

function rangeRow() {
  const r = RANGE, n = state.to - state.from + 1, full = state.from === r[0] && state.to === r[1];
  const opt = (sel, lo, hi, lab = (v) => v) => {
    let o = '';
    for (let v = lo; v <= hi; v++) o += `<option value="${v}"${v === sel ? ' selected' : ''}>${lab(v)}</option>`;
    return o;
  };
  const season = state.win[0] === 5 && state.win[1] === 9;
  return `<div class="filters"><div class="range" role="group" aria-label="${msg("year.range")}">
      <span class="lbl">${msg("years")}</span>
      <select id="rFrom" aria-label="${msg("start.year")}">${opt(state.from, r[0], state.to)}</select>
      <span aria-hidden="true">–</span>
      <select id="rTo" aria-label="${msg("end.year")}">${opt(state.to, state.from, r[1])}</select>
      <small>${msg("years2", [n])}</small>
      ${full ? '' : `<button class="link" id="rAll">${msg("all.years")}</button>`}
    </div>
    <div class="range" role="group" aria-label="${msg("month.range")}">
      <span class="lbl">${msg("months")}</span>
      <select id="wFrom" aria-label="${msg("first.month")}">${opt(state.win[0], 0, state.win[1], (m) => MON3[m])}</select>
      <span aria-hidden="true">–</span>
      <select id="wTo" aria-label="${msg("last.month")}">${opt(state.win[1], state.win[0], 11, (m) => MON3[m])}</select>
      ${season ? '' : `<button class="link" id="wSeason" title="${msg("june.october")}">${msg("fire.season")}</button>`}
      ${fullWin() ? '' : `<button class="link" id="wAll">${msg("full.year")}</button>`}
    </div>
    <p class="range-note">${msg("this.range.applies.to.the")}</p></div>`;
}

// "Bu ay tarihsel medyana göre nerede?" kartı: seçili ay (varsayılan: son veri ayı).
function readCard(name, val) {
  const y = state.year, m = state.month;
  const r = rdFor(name)(y, m);
  if (!r) return '';
  const latest = y === LY && m === READ_M, part = isPartial(y, m), lv = r.level ? LEVELS[r.level] : null;
  const reg = val && data.regions?.[val.region];
  const src = state.sensor !== 'merged' ? msg("raw.count", [sensorOf().label])
    : sourceOf(y, m, data.meta.viirs_from) === 'viirs' ? msg("viirs.observation") : `MODIS × ${reg ? dec(reg.factors[m], 2) : msg("factor")}`;
  const lastM = y === LY ? LM : 11;
  const months = MONTHS.map((n, i) => (i > lastM ? '' : `<option value="${i}"${i === m ? ' selected' : ''}>${n}</option>`)).join('');
  const label = part ? `1–${LD} ${MONTHS[m]} ${y}` : null;
  return `<section class="read${r.level ? ' lv-' + r.level : ''}" aria-label="${msg("selected.month.compared.with.the")}">
      <div class="read-top">
        <select id="mSel" aria-label="${msg("select.month")}">${months}</select>
        <input id="detailYear" type="number" inputmode="numeric" aria-label="${msg('slider.year')}"
          min="${RANGE[0]}" max="${RANGE[1]}" step="1" required value="${y}">
        ${latest ? `<span class="pill">${part ? msg("month.in.progress") : READ_M === LM ? msg("latest.observation") : msg("last.complete.month")}</span>` : `<button class="link" id="latest">${msg("back.to.latest.month")}</button>`}
        ${lv ? `<span class="lvl" title="${msg("compared.with.the.same.month")}">${lv.mark ? lv.mark + ' ' : ''}${displayText(lv.label)}</span>` : ''}
      </div>
      <p class="say">${sentence(r, label)}</p>
      <dl class="nums">
        <div><dt>${msg("this.month")}</dt><dd>${fmt(r.v)}</dd></div>
        <div><dt title="${msg("median.for.this.month.across")}">${msg("typical.value")}</dt><dd>${fmt(r.med)}</dd></div>
        <div><dt title="${msg("percentage.of.comparison.years.with")}">${msg("years.exceeded")}</dt><dd>${r.pct == null ? '—' : percent(Math.round(r.pct))}</dd></div>
        <div><dt>${msg("source")}</dt><dd>${src}</dd></div>
      </dl>
      <p class="fine">${msg("select.a.calendar.cell.to", [part ? `${msg("partial.month.days.of.are", [LD, MONTHS[m]])} ` : ''])}</p>
    </section>`;
}

// "Ateşler nerede yanıyor?": seçili yıllar ve aylardaki tespitlerin arazi türüne göre payı (ESA WorldCover 2021).
const LC_COLORS = ['#ecba52', '#2e7d4f', '#a8a85a', '#7d8792'];
function landCard(name) {
  if (!lc?.provinces) return '';
  const g = [0, 0, 0, 0];
  // Bölge payları il yüzdelerinin ortalaması değil, tespit sayılarının toplamıdır.
  // Çizilen alanda il toplamı değil, alanın içindeki noktaların arazi sınıfı sayılır.
  const sources = state.scope === 'draw' ? [drawn?.lc] : membersOf(name).map((m) => lc.provinces[m]);
  for (const p of sources) {
    if (!p) continue;
    for (let y = state.from; y <= state.to; y++) {
      const r = p[y];
      if (!r) continue;
      for (let m = state.win[0]; m <= state.win[1]; m++) for (let k = 0; k < 4; k++) g[k] += r[m * 4 + k];
    }
  }
  const tot = g[0] + g[1] + g[2] + g[3];
  if (tot < 20) return '';
  const pct = g.map((v) => (100 * v) / tot);
  const rows = lc.groups.map((lab, k) => `<li><i style="background:${LC_COLORS[k]}"></i><span>${displayText(lab)}</span><b>${percent(Math.round(pct[k]))}</b></li>`).join('');
  return `<section class="land" aria-label="${msg("fire.detections.by.land.cover")}">
      <h3>${msg("where.do.fires.occur")}</h3>
      <div class="land-bar">${pct.map((v, k) => `<span style="width:${v}%;background:${LC_COLORS[k]}"></span>`).join('')}</div>
      <ul>${rows}</ul>
      <p class="fine" title="${msg("pixel.locations.have.an.uncertainty")}">${msg("land.cover.beneath.fire.detections", [fmt(tot)])}</p>
    </section>`;
}

function caution(val) {
  if (val?.confidence !== 'low') return '';
  const why = val.mean_annual < 100
    ? msg("this.province.averages.detections.a", [fmt(val.mean_annual)])
    : msg("validation.error.is.high.in", [Math.round(val.annual_wape * 100)]);
  return `<div class="caution" role="note"><b>${msg("note")}</b> ${msg("use.annual.totals.and.long", [why])}</div>`;
}
// Çizilen alan için hata ölçülemez; az tespitli ya da küçük alanda okuyucu uyarılır.
function drawCaution() {
  if (!drawn) return '';
  const full = Object.entries(drawn.series.merged).filter(([y]) => !(PARTIAL && +y === LY));
  const mean = sum(full.map(([, r]) => sum(r))) / Math.max(1, full.length);
  const why = mean < 100 ? msg("this.area.averages.detections.a", [fmt(mean)])
    : drawn.km2 < 2500 ? msg("this.area.is.small.km", [fmt(drawn.km2)]) : '';
  return why ? `<div class="caution" role="note"><b>${msg("note")}</b> ${msg("use.annual.totals.and.long", [why])}</div>` : '';
}
function methodNote(name) {
  if (state.scope === 'region') return `<p>${msg("total.for.provinces", [membersOf(name).length, membersOf(name).join(', ')])}</p><p>${displayText(geographic.meta.note)}</p><p>${displayText(geographic.meta.validation_note)}</p>`;
  if (state.scope === 'country') return `<p>${msg("sum.of.the.combined.series")}</p><p>${msg("a.separate.national.error.estimate")}</p>`;
  if (!drawn) return '';
  const tot = sum(drawn.byProv.map(([, v]) => v));
  const provs = drawn.byProv.slice(0, 6).map(([n, v]) => `${n} ${percent(Math.max(1, Math.round((100 * v) / (tot || 1))))}`).join(', ');
  return `<p>${displayText(drawn.label)}${drawn.w ? `, ${dec(drawn.w)} × ${dec(drawn.h)} km` : ''} · ${fmt(drawn.km2)} km².${tot ? ` ${msg("detections.by.province", [provs, drawn.byProv.length > 6 ? ` ${msg("and.more.provinces", [drawn.byProv.length - 6])}` : ''])}` : ''}</p>
    <p>${msg("raw.modis.and.viirs.counts")}</p>
    <p>${msg("error.was.not.measured.for")}</p>`;
}

function peaksView(name, years) {
  const { topYears, topMonths } = peaks(years, state.from, state.to, state.win, (y) => total(name, y));
  const list = (rows, attrs, label, on) => `<ol class="top">${rows.map((r, i) => `<li><button ${attrs(r)} class="${on(r) ? 'on' : ''}">
      <i>${i + 1}</i><span>${label(r)}</span><em>${fmt(r.at(-1))}</em><u style="width:calc((100% - 34px) * ${rows[0].at(-1) ? r.at(-1) / rows[0].at(-1) : 0})"></u></button></li>`).join('')}</ol>`;
  const w = winLabel();
  return `<h4>${msg("peak.years", [state.from, state.to, w ? ' · ' + w : ''])}</h4><p>${msg("select.a.year.to.explore", [w ? msg("total.for", [w]) : msg("annual.total")])}</p>
    ${list(topYears, ([y]) => `data-year="${y}"`, ([y]) => (PARTIAL && y === LY ? `${y} <small>${msg("as.of", [LD, MON3[LM]])}</small>` : y), ([y]) => y === state.year)}
    <h4 class="gap">${msg("peak.months")}</h4><p>${msg("individual.monthly.totals.select.a")}</p>
    ${list(topMonths, ([y, m]) => `data-year="${y}" data-month="${m}"`, ([y, m]) => `${MONTHS[m]} ${y}${isPartial(y, m) ? ` <small>(1–${LD})</small>` : ''}`, ([y, m]) => y === state.year && m === state.month)}`;
}

function stepView(p, val) {
  const vy = viirsYear(), reg = val && data.regions?.[val.region];
  const fac = reg ? `<p class="fine">${msg("monthly.adjustment.factors.before.for", [vy, val.region, reg.name])}</p>
    <div class="fac">${reg.factors.map((f, i) => `<span><i>${MON3[i]}</i>${dec(f)}</span>`).join('')}</div>` : '';
  const step = val?.step_raw != null ? `<p class="say">${msg("change.in.annual.means.from", [dec(val.step_raw, 2), dec(val.step_harmonized, 2), dec(val.step_modis, 2)])}</p>` : '';
  const lastFull = PARTIAL ? LY - 1 : LY;
  return `<h4>${msg("raw.and.combined.series")}</h4>
    <p>${msg("annual.totals.the.raw.series", [{ region: `${msg("sum.of.provincial.series.within")} `,
    country: `${msg("sum.of.provincial.series.across")} `,
    draw: `${msg("provincial.series.are.weighted.by")} ` }[state.scope] || '', vy, vy, vy, PARTIAL ? ` ${msg("the.incomplete.year.is.omitted", [LY])}` : ''])}</p>
    <div class="key"><span><i class="raw"></i>${msg("raw.modis.viirs")}</span><span><i class="harm"></i>${msg("combined")}</span>
      <span><i class="dot o"></i>${msg("modis.factor")}</span><span><i class="dot"></i>${msg("viirs.observation")}</span></div>
    ${stepChart(p, vy, state.year, lastFull)}${step}${fac}`;
}

// OGM'nin bildirdiği orman yangınları ile uydu tespitleri (Türkiye geneli, yıllık).
function ogmView(name) {
  if (!ogm) return `<p>${msg("could.not.load.ogm.data")}</p>`;
  const lastFull = PARTIAL ? LY - 1 : LY;
  const ys = Object.keys(ogm.national).map(Number).filter((y) => y >= ranges.merged[0] && y <= lastFull).sort((a, b) => a - b);
  const sat = ys.map((y) => sum(Object.values(data.provinces).map((p) => sum(p.merged?.[y] || []))));
  const fires = ys.map((y) => ogm.national[y].fires), ha = ys.map((y) => ogm.national[y].ha);
  // Spearman sıra korelasyonu: hangi yıllar yüksek, iki kaynak aynı sırayı veriyor mu?
  const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = []; o.forEach(([, i], k) => { r[i] = k; }); return r; };
  const rho = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length; return 1 - (6 * ra.reduce((s, v, i) => s + (v - rb[i]) ** 2, 0)) / (n * (n * n - 1)); };
  const W = innerWidth > 760 ? 500 : 340, H = innerWidth > 760 ? 260 : 200, L = 34, R = 34, T = 14, B = 22, ih = H - T - B;
  const x = (i) => L + 4 + (i / (ys.length - 1)) * (W - L - R - 8);
  const mS = Math.max(...sat) * 1.05, mF = Math.max(...fires) * 1.05;
  const yS = (v) => T + ih - (v / mS) * ih, yF = (v) => T + ih - (v / mF) * ih;
  let s = `<line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="grid base"/>`;
  s += `<text x="${L - 6}" y="${T + 4}" class="tick" text-anchor="end">${fmt(mS / 1000)}${lang() === "en" ? "k" : "b"}</text><text x="${W - R + 6}" y="${T + 4}" class="tick">${fmt(mF)}</text>`;
  ys.forEach((y, i) => {
    const bw = Math.max(3, (W - L - R) / ys.length - 3);
    s += `<rect x="${x(i) - bw / 2}" y="${yF(fires[i])}" width="${bw}" height="${T + ih - yF(fires[i])}" rx="1.5" class="band"/>`;
    if (y === ys[0] || y === ys.at(-1) || y % 5 === 0) s += `<text x="${x(i)}" y="${H - 6}" class="tick${y === state.year ? ' on' : ''}" text-anchor="middle">${y}</text>`;
  });
  s += `<path d="${sat.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${yS(v)}`).join('')}" class="ln-harm"/>`;
  ys.forEach((y, i) => {
    s += `<circle cx="${x(i)}" cy="${yS(sat[i])}" r="${y === state.year ? 4 : 2.6}" class="pt-harm${y === state.year ? ' on' : ''}"/>`;
    s += `<rect x="${x(i) - 6}" y="0" width="12" height="${H - 16}" class="hit" data-year="${y}" data-tip="<b>${y}</b>${msg("satellite.combined.fire.detections", [fmt(sat[i])])}<br>OGM: ${fmt(fires[i])} ${msg("ogm.fires")} · ${fmt(ha[i])} ha"/>`;
  });
  const key = name.toLocaleUpperCase('tr');
  const obm = Object.entries(ogm.obm2025).find(([u]) => u.toLocaleUpperCase('tr') === key);
  const p25 = series(name, 'merged')?.[2025];
  const local = obm
    ? `<h4 class="gap">${msg("regional.forestry.directorate", [name])}</h4><p class="say">OGM: <b>${fmt(obm[1].fires)}</b> ${msg("forest.fires.and.ha.burned", [fmt(obm[1].ha), name, p25 ? fmt(sum(p25)) : '—'])}</p>
       <p class="fine">${msg("a.regional.directorate.usually.covers")}</p>`
    : state.scope === 'country' ? ''
    : `<p class="fine">${multi() ? msg("boundaries.differ.between.the.selected", [regional() ? msg("geographic.region") : msg("drawn.area")]) : msg("no.forestry.directorate.bears.the", [name])}</p>`;
  return `<h4>${msg("t.rkiye.satellite.fire.detections")}</h4>
    <p>${msg("line.combined.satellite.detections.across")}</p>
    <div class="key"><span><i class="harm"></i>${msg("satellite.detections")}</span><span><i class="b"></i>${msg("ogm.forest.fires")}</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${msg("annual.satellite.detections.and.ogm")}">${s}</svg>
    <p class="say">${msg("spearman.rank.correlation.across.years", [dec(rho(sat, fires), 2), dec(rho(sat, ha), 2)])}</p>
    <p class="fine">${msg("the.two.records.count.different", [displayText(ogm.note)])}</p>
    ${local}
    <p class="fine">${msg("sources", [Object.values(ogm.sources).map(displayText).join(' · ')])}</p>`;
}

function renderPanel() {
  const panel = $('#panel'), body = $('#panelBody'), side = $('#side'), sideBody = $('#sideBody');
  panel.dataset.sel = state.sel || '';
  if (!state.sel) { panel.hidden = true; side.hidden = true; return; }
  panel.hidden = false; side.hidden = false;
  const name = state.sel, years = series(name);
  if (!years || !years[state.year]) {
    sideBody.innerHTML = head(scopeLabel(), name) + `<div class="empty"><h4>${msg("no.data.for.this.area")}</h4><p>${msg("choose.another.year.using.the")}</p></div>`;
    body.innerHTML = '';
    return;
  }
  const { from, to } = state;
  const vAll = regional() ? geographic.regions[name]?.validation : multi() ? null : data.validation?.[name];
  const merged = state.sensor === 'merged', val = merged ? vAll : null, sen = sensorOf();
  const row = years[state.year], n = total(name);
  const wm = row.map((v, m) => (inWin(m) && v != null ? v : -1)), peak = wm.indexOf(Math.max(...wm));
  // Medyana göre: bitmemiş yılda her yılın aynı penceresiyle (likeTotal), diğer yıllarda pencere toplamıyla.
  const like = PARTIAL && state.year === LY;
  const refYears = Object.keys(inRange(years, from, to)).map(Number).filter((y) => !(PARTIAL && y === LY) || like);
  const med = quantile(refYears.map((y) => (like ? likeTotal(name, y) : total(name, y))), 0.5);
  const ratio = med > 0 ? n / med : 0;
  const level = val ? { low: 1, medium: 2, high: 3 }[val.confidence] || 1 : n >= 200 ? 3 : n >= 50 ? 2 : 1;
  const confTitle = regional() && merged ? displayText(geographic.meta.validation_note)
    : state.scope === 'country' && merged ? msg("the.national.series.sums.the")
    : state.scope === 'draw' && merged ? msg("error.has.not.been.measured")
    : val
    ? msg("leave.one.year.out.validation")
    : msg("raw.series.by.detection.count");
  const sel = { year: state.year, month: state.month };
  const w = winLabel();
  // Durum etiketi: seçili yılın toplamı, geçmiş yılların orta değerine (medyan) göre.
  const status = !med ? null : ratio < 0.67 ? ['low', msg("below.normal")] : ratio <= 1.5 ? ['normal', 'Normal']
    : ratio <= 2.5 ? ['high', msg("above.normal")] : ['extreme', msg("very.high")];
  const span = like ? msg("summary.partialPeriod", [w ? MON3[state.win[0]] : msg("jan"), LD, MON3[LM]]) : w ? msg("summary.season", [w]) : msg("summary.annual");
  const sumText = med
    ? msg('summary.comparison', { from, to, period: span, median: fmt(med), year: state.year,
      partial: like ? ' ' + msg('so.far') : '', cmp: vsTypical(ratio) })
    : msg("too.few.detections.for.a", [multi() ? msg("area2") : msg("province2")]);

  let view = '';
  if (state.tab === 'calendar') {
    view = `<h4>${msg("fire.calendar", [from, to, w ? ' · ' + w : ''])}</h4><p>${msg("each.row.is.a.year")}</p>
      ${calendarKey()}${calendar(years, from, to, sel, { win: state.win, rd: rdFor(name), partial: isPartial, through: LD })}`;
  } else if (state.tab === 'compare') {
    const ref = inRange(like ? cmpYears(name) : years, from, to);
    if (!like && PARTIAL) delete ref[LY];   // bitmemiş yılın boş ayları başka bir yılın medyanını bozmasın
    const c = compare(ref, row, state.year, state.month, like ? LM : -1);
    view = `<h4>${msg("compared.with.past.years.month", [state.year])}</h4><p>${msg("orange.bars.show.the.white", [state.year, from, to])}</p>
      <div class="key"><span><i></i>${state.year}</span><span><i class="m"></i>${msg("typical.value")}</span><span><i class="b"></i>${msg("normal.range")}</span></div>
      ${c.svg}`;
  } else if (state.tab === 'peaks') {
    view = peaksView(name, years);
  } else if (state.tab === 'step') {
    view = stepView(areaData(name), vAll);
  } else {
    view = ogmView(name);
  }

  const sel_ = `${from}–${to}${w ? ' · ' + w : ''}`;
  // Sağ panel: seçimler üstte, seçili sekmenin grafiği altta.
  body.innerHTML = `<div class="p-head charts-head"><div><span class="eyebrow">${displayText(sen.label)}${merged ? ` ${msg("series")}` : ` ${msg("raw.data")}`} · ${sel_}</span>
      <h2>${msg("charts", [displayName(name)])}</h2></div></div>
    <section class="pblock month-block" aria-label="${msg("month.detail")}">
      <header class="pblock-head"><span class="pblock-num" aria-hidden="true">1</span><div><h3>${msg("month.detail")}</h3>
        <p>${msg("compare.the.selected.month.with")}</p></div></header>
      ${readCard(name, vAll)}
    </section>
    <section class="pblock charts-block" aria-label="${msg("charts2")}">
      <header class="pblock-head"><span class="pblock-num" aria-hidden="true">2</span><div><h3>${msg("charts2")}</h3>
        <p>${msg("select.a.year.and.month")}</p></div></header>
      ${rangeRow()}
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === state.tab}">${displayText(l)}</button>`).join('')}</div>
      <div class="view" role="tabpanel">${view}</div>
    </section>`;
  // Sol panel: genel özet, güven, arazi türü ve indirme.
  sideBody.innerHTML = head(`${displayText(sen.label)}${merged ? ` ${msg("series")}` : ` ${msg("raw.data")}`} · ${periodLabel()}`, name) + `
    <section class="summary" aria-label="${msg("summary")}">
      <div class="sum-top"><b>${fmt(n)}</b><span>${msg("satellite.fire.detections")}</span>${status ? `<span class="status ${status[0]}">${status[1]}</span>` : ''}</div>
      <p>${sumText}</p>
    </section>
    <div class="kpis">
      <div class="kpi"><span>${msg("peak.month")}</span><b>${peak >= 0 ? MONTHS[peak] : '—'}</b><small>${peak >= 0 ? fmt(row[peak]) + ` ${msg("detections")}` : ''}</small></div>
      <div class="kpi" title="${msg("median.for.the.selected.years")}"><span>${msg("typical.value")}</span><b>${fmt(med)}</b><small>${from}–${to}</small></div>
      <div class="kpi conf" title="${confTitle}"><span>${multi() && merged ? msg("accuracy") : msg("reliability")}</span><b>${multi() && merged && !val ? msg("not.measured") : [msg("low"), msg("medium"), msg("high")][level - 1]}</b><small>${multi() && merged ? (val ? `${msg("annual.error", [dec(val.annual_wape * 100)])}<br>${msg("monthly.error", [dec(val.monthly_wape * 100)])}` : msg("error.not.measured")) : `<span class="dots">${[1, 2, 3].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>${val?.annual_wape != null ? msg("error", [Math.round(val.annual_wape * 100)]) : merged ? '' : msg("based.on.count")}`}</small></div>
    </div>
    ${state.scope === 'province' ? caution(val) : state.scope === 'draw' ? drawCaution() : ''}
    ${landCard(name)}
    ${multi() ? `<details class="region-method"${state.scope === 'draw' ? ' open' : ''}><summary>${msg("data.and.methods")}</summary>${methodNote(name)}</details>` : ''}
    <div class="p-foot">
      <details class="dl-menu">
        <summary class="btn"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16.5h12"/></svg>${msg("download")}</summary>
        <div class="dl-list">
          <button id="csv"><b>${msg("monthly.table.csv")}</b><small>${msg("calendar.values", [sel_])}</small></button>
          <button id="hcsv"><b>${msg("fire.detection.list.csv")}</b><small>${msg("individual.detections.with.date.coordinates")}</small></button>
          <button id="png"><b>${msg("chart.png")}</b><small>${msg("current.chart.for.presentations")}</small></button>
          <button id="svg"><b>${msg("chart.svg")}</b><small>${msg("scalable.vector.graphic")}</small></button>
        </div>
      </details>
      <span title="${displayText(data.meta.notes?.[state.sensor]) || ''}">${displayText(data.meta.notes?.[state.sensor]) || ''}</span>
    </div>`;
}

// ── İndirmeler ──────────────────────────────────────────
function save(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvBlob = (lines) => new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
const fileTag = () => `${low(state.sel).replace(/\s+/g, '-')}_${state.from}-${state.to}${fullWin() ? '' : `_ay${state.win[0] + 1}-${state.win[1] + 1}`}`;

function downloadCsv() {
  const name = state.sel;
  const region = { region: name, country: 'TR', draw: '' }[state.scope] ?? data.validation?.[name]?.region ?? '';
  const lines = csvRows(name, region, areaData(name), state.from, state.to,
    data.meta.viirs_from, state.win, rdFor(name), isPartial, state.sensor);
  save(csvBlob(lines), `burncal_aylik_${fileTag()}.csv`);
}

async function downloadHotspots(btn) {
  const name = state.sel, lab = btn.querySelector('small') || btn, label = lab.textContent;
  const members = membersOf(name);
  btn.disabled = true; lab.textContent = msg("preparing");
  try {
    // Çizilen alanda yalnızca alanın içine düşen noktalar (hesap sırasında ayrıldı).
    const byYear = {};
    for (let y = state.from; y <= state.to; y++) byYear[y] = state.scope === 'draw' ? drawn.hits[y] : await loadYear(y);
    const lcLabels = [];
    for (const c of lc?.classes || []) lcLabels[c.i] = displayText(c.label);
    let lines = [];
    for (const member of members) {
      const rows = hotspotRows(byYear, provIdx[member], member, state.from, state.to, state.win, data.meta.nrt_from || {}, lcLabels);
      lines.push(...(lines.length ? rows.slice(1) : rows));
    }
    save(csvBlob(lines), `burncal_tespitler_${fileTag()}.csv`);
    lab.textContent = msg("downloaded.detections", [fmt(lines.length - 1)]);
    setTimeout(() => { lab.textContent = label; }, 2500);
  } catch (e) {
    console.error(e); lab.textContent = msg("download.failed");
  } finally { btn.disabled = false; }
}

// Açık sekmedeki grafiği bağımsız bir SVG'ye çevirir: CSS sınıfları satır içi stile yazılır,
// başlık ve kaynak satırı eklenir. PNG, aynı SVG'den 3 kat çözünürlükte üretilir.
const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity', 'fill-opacity',
  'font-family', 'font-size', 'font-weight'];
function exportSvg() {
  const src = $('#panel .view svg[role=img]');   // açıklamadaki küçük simgeler değil, grafiğin kendisi
  if (!src) return null;
  const clone = src.cloneNode(true);
  const a = [src, ...src.querySelectorAll('*')], b = [clone, ...clone.querySelectorAll('*')];
  a.forEach((el, i) => {
    const cs = getComputedStyle(el);
    b[i].setAttribute('style', STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    b[i].removeAttribute('data-tip');
  });
  clone.querySelectorAll('.hit').forEach((el) => el.remove());
  const [, , w, h] = src.getAttribute('viewBox').split(' ').map(Number);
  const pad = 16, top = 44, bottom = 30, W = w + 2 * pad, H = h + top + bottom;
  const title = `${displayName(state.sel)} · ${$('#panel .view h4')?.textContent || ''}`;
  const font = getComputedStyle(document.body).fontFamily.replace(/"/g, "'");
  clone.setAttribute('x', pad); clone.setAttribute('y', top); clone.setAttribute('width', w); clone.setAttribute('height', h);
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#18181a"/>
    <text x="${pad}" y="22" fill="#f2ede4" style="font: 700 13px ${font}">${esc(title)}</text>
    <text x="${pad}" y="36" fill="#b9c0c9" style="font: 10px ${font}">${msg("viirs.equivalent.fire.detections.combined", [throughLabel()])}</text>
    ${new XMLSerializer().serializeToString(clone)}
    <text x="${pad}" y="${H - 10}" fill="#7d8792" style="font: 9.5px ${font}">BurnCal · NASA FIRMS (MODIS C6.1, VIIRS S-NPP 375 m) · NASA Space Apps 2026</text>
  </svg>`;
}
function downloadChart(kind) {
  const svg = exportSvg();
  if (!svg) return;
  const name = `burncal_${state.tab}_${fileTag()}`;
  if (kind === 'svg') return save(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
  const img = new Image(), k = 3;
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width * k; c.height = img.height * k;
    const g = c.getContext('2d'); g.scale(k, k); g.drawImage(img, 0, 0);
    c.toBlob((b) => save(b, `${name}.png`), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ── İpucu ───────────────────────────────────────────────
function showTip(html, x, y) {
  const t = $('#tip');
  t.innerHTML = html; t.hidden = false;
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(innerWidth - w - 8, x + 14) + 'px';
  t.style.top = (y + h + 22 > innerHeight ? y - h - 12 : y + 16) + 'px';
}
function hideTip() { $('#tip').hidden = true; }

// Ay penceresi ya da dönem değişince harita, sıralama ve panel birlikte yenilenir.
function refreshAll(focusId) {
  if (ready) paintMap();
  renderPanel(); renderRank();
  if (focusId) document.getElementById(focusId)?.focus();
}

// ── Olaylar ─────────────────────────────────────────────
function bind() {
  for (const panel of [$('#panel'), $('#side')]) bindPanel(panel);
  bindRest();
}
function bindPanel(panel) {
  panel.addEventListener('input', ({ target }) => {
    if (target.id !== 'detailYear' || !target.validity.valid || target.valueAsNumber === state.year) return;
    setYear(target.valueAsNumber);
    $('#detailYear')?.focus({ preventScroll: true });
  });
  panel.addEventListener('keydown', (e) => {
    if (e.target.id !== 'detailYear' || e.key !== 'Enter') return;
    if (e.target.reportValidity()) e.target.blur();
  });
  panel.addEventListener('focusout', ({ target }) => {
    if (target.id === 'detailYear' && !target.validity.valid) target.value = state.year;
  });
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('button, .cell, [data-year], [data-month]');
    if (!t) return;
    if (t.classList.contains('close')) return select(null);
    // İndirme menüsü seçimden sonra kapanır (tespit listesi hazırlanırken açık kalır).
    if (['csv', 'hcsv', 'png', 'svg'].includes(t.id)) setTimeout(() => t.closest('.dl-menu')?.removeAttribute('open'), t.id === 'hcsv' ? 2600 : 150);
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderPanel(); $(`#panel [data-tab=${state.tab}]`)?.focus(); }
    else if (t.dataset.name) select(t.dataset.name);
    else if (t.id === 'csv') downloadCsv();
    else if (t.id === 'hcsv') downloadHotspots(t);
    else if (t.id === 'png' || t.id === 'svg') downloadChart(t.id);
    else if (t.id === 'latest') { state.month = READ_M; setYear(Math.min(LY, RANGE[1])); }
    else if (t.id === 'rAll') { state.custom = false; clampRange(); refreshAll('rFrom'); }
    else if (t.id === 'wSeason') { state.win = [5, 9]; refreshAll('wFrom'); }
    else if (t.id === 'wAll') { state.win = [0, 11]; refreshAll('wFrom'); }
    else if (t.dataset.year || t.dataset.month) {
      if (t.dataset.month) state.month = +t.dataset.month;
      if (t.dataset.year) setYear(t.dataset.year); else renderPanel();
    }
  });
  panel.addEventListener('change', (e) => {
    const id = e.target.id, v = +e.target.value;
    if (id === 'mSel') { state.month = v; renderPanel(); }
    else if (id === 'rFrom' || id === 'rTo') { state[id === 'rFrom' ? 'from' : 'to'] = v; state.custom = true; clampRange(); refreshAll(id); }
    else if (id === 'wFrom' || id === 'wTo') { state.win[id === 'wFrom' ? 0 : 1] = v; refreshAll(id); }
    else return;
    document.getElementById(id)?.focus();
  });
  panel.addEventListener('pointermove', (e) => {
    const t = e.target.closest('[data-tip]');
    t ? showTip(t.dataset.tip, e.clientX, e.clientY) : hideTip();
  });
  panel.addEventListener('pointerleave', hideTip);
}
function bindRest() {

  $('#rankList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pickArea(b.dataset.name); });
  $('#rankToggle').onclick = (e) => {
    const closed = $('#rank').classList.toggle('closed');
    e.target.textContent = closed ? '+' : '–'; e.target.setAttribute('aria-expanded', !closed);
  };
  $('#year').addEventListener('input', (e) => { setYear(e.target.value); });
  $('#home').onclick = () => select(null);

  renderAreaSearch();
  matchMedia('(max-width: 1280px)').addEventListener('change', () => renderAreaSearch(false));
  for (const button of document.querySelectorAll('[data-scope]')) button.onclick = () => setScope(button.dataset.scope);
  for (const button of document.querySelectorAll('[data-draw]')) button.onclick = () => startDraw(button.dataset.draw);
  $('#drawCancel').onclick = () => { drawTool.stop(); $('#drawBar').hidden = true; if (!drawn) setScope('province'); };
  const search = $('#search');
  const pick = () => {
    const names = searchNames();
    const fold = (value) => value.toLocaleLowerCase(locale());
    const q = fold(search.value.trim());
    if (!q) return;
    const hit = names.find((n) => fold(displayName(n)) === q || fold(n) === q) || names.find((n) => fold(displayName(n)).startsWith(q) || fold(n).startsWith(q));
    if (hit) { pickArea(hit); search.value = ''; search.blur(); return; }
    // Ülke görünümünde Türkiye dışında bir ad yazılırsa kısa bir not gösterilir.
    if (state.scope === 'country') {
      const r = search.getBoundingClientRect();
      showTip(`<b>${msg("currently.available.for.t.rkiye")}</b>${displayText(COUNTRY_SOON)}.`, r.left - 14, r.bottom - 8);
      clearTimeout(pick.t); pick.t = setTimeout(hideTip, 6000);
      search.addEventListener('input', () => { clearTimeout(pick.t); hideTip(); }, { once: true });
    }
  };
  search.addEventListener('change', pick);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });

  const lm = $('#layersMenu');
  const menus = [[$('#layersBtn'), lm], [$('#helpBtn'), $('#helpMenu')]];
  for (const [b, m] of menus) {
    b.onclick = () => {
      for (const [b2, m2] of menus) if (m2 !== m) { m2.hidden = true; b2.setAttribute('aria-expanded', false); }
      m.hidden = !m.hidden; b.setAttribute('aria-expanded', !m.hidden);
    };
  }
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.pop, .language')) for (const [b, m] of menus) { m.hidden = true; b.setAttribute('aria-expanded', false); }
    if (!e.target.closest('.dl-menu')) document.querySelectorAll('.dl-menu[open]').forEach((d) => d.removeAttribute('open'));
  });
  lm.addEventListener('change', (e) => {
    const g = e.target.dataset.layer, on = e.target.checked;
    if (g === 'terrain') return map.setTerrain(on ? { source: 'dem', exaggeration: 1.35 } : null);
    if (g === 'landcover') {
      for (const id of lcLayers) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      $('#lcLegend').hidden = !on;
      // İki renk düzeni üst üste okunmaz: arazi türü açılınca il renkleri kapanır.
      const fill = lm.querySelector('[data-layer=fill]');
      if (on && fill.checked) { fill.checked = false; for (const id of LAYER_GROUPS.fill) map.setLayoutProperty(id, 'visibility', 'none'); renderLegend(); }
      return;
    }
    for (const id of LAYER_GROUPS[g]) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    if (g === 'fill') renderLegend();
    if (g === 'points' && !on) closePointPopup();
    if (g === 'points' && on) updatePoints();
  });

  // Klavye kısayolları: Esc kapat, H Türkiye görünümü, +/− yakınlaş.
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.target.blur?.(); if (state.sel) select(null); return; }
    if (e.target.closest('input, select, [role=tablist]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'h') select(null);
    else if (k === '+' || k === '=') map.zoomIn();
    else if (k === '-') map.zoomOut();
  });
}

// ── Başlat ──────────────────────────────────────────────
function renderDataBadge() {
  $('#dataBadge').textContent = msg("latest.data", [throughLabel()]);
  $('#dataBadge').title = PARTIAL ? msg("is.in.progress.observations.through", [LY, throughLabel()]) : msg("observations.through", [throughLabel()]);
}

window.addEventListener('burncal:language', () => {
  if (!RANGE) return;
  renderDataBadge();
  for (const sensor of SENSORS) {
    const button = $('#sensorTabs [data-key=' + sensor.key + ']');
    if (button) sensorText(button, sensor, ranges[sensor.key]);
  }
  moveIndicator();
  renderAreaSearch(false);
  if (!ready) return;
  hideTip();
  if (ptPopup?.isOpen() && popupHit) openPointPopup(popupHit);
  map.getSource('provLabels').setData(geometry(activeGeo(), false));
  map.setLayoutProperty('water-name', 'text-field', waterName());
  renderPanel();
  renderRank();
  renderLegend();
  renderLandLegend();
  drawTool.refreshHint();
});
async function main() {
  document.body.classList.add('booting');
  [data, geo, geographic] = await Promise.all(['data/atlas.json', 'data/tr-provinces.json', 'data/geographic-regions.json'].map((u) => fetch(u).then((r) => {
    if (!r.ok) throw new Error(msg("could.not.load.data", [u]));
    return r.json();
  })));
  regionGeo = regionGeometry(geo, geographic.regions);
  const allNames = Object.keys(data.provinces);
  country = { series: {}, partial: {} };
  // Türkiye: 81 il serisinin ay ay toplamı (bölge görünümündeki gibi, yeni katsayı yok).
  for (const key of ['modis', 'viirs', 'merged']) {
    const out = (country.series[key] = {});
    for (const n of allNames) for (const [y, row] of Object.entries(data.provinces[n][key] || {})) {
      const o = (out[y] ||= row.map(() => 0));
      row.forEach((v, m) => { o[m] = v == null || o[m] == null ? null : o[m] + v; });
    }
  }
  for (const key of ['mtd', 'mtd_modis', 'mtd_viirs', 'ytd']) {
    if (data.partial?.[key]) country.partial[key] = data.partial.years.map((_, i) => allNames.reduce((s, n) => s + (data.partial[key][n]?.[i] || 0), 0));
  }
  for (const [name, region] of Object.entries(geographic.regions)) for (const p of region.members) provinceRegion[p] = name;
  ogm = await fetch('data/ogm.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  lc = await fetch('data/landcover.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  for (const c of lc?.classes || []) lcGroup[c.i] = c.group;
  indexData();
  setChartWidth(innerWidth > 760 ? 500 : 340);
  renderDataBadge();
  $('#intro span').textContent = `MODIS · VIIRS · ${RANGE[0]}–${RANGE[1]}`;
  renderSensors();
  initMap();
  bind();
  setSensor('merged');
}
main().catch((err) => {
  console.error(err);
  document.body.classList.remove('booting');
  $('#intro').innerHTML = `<div><h1>${msg("could.not.load.atlas")}</h1><span>${err.message}</span></div>`;
});
