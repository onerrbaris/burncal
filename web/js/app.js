/* global maplibregl */
import { regionGeometry } from './regions.js?v=20261115a';
import { buildStyle, LAYER_GROUPS, RAMP } from './mapstyle.js?v=20261115-thick-lines';
import { MONTHS, MON3, LEVELS, fmt, quantile, inRange, reading, sentence, peaks, sourceOf, csvRows, hotspotRows,
  calendar, calendarKey, compare, stepChart, setChartWidth } from './charts.js?v=20261115h';
import { DrawTool, drawnArea } from './draw.js?v=20261115-ellipse';

const $ = (s) => document.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
// MVP: hafif mod varsayılan; uzun kamera uçuşları ve sürekli animasyonlar için adrese ?sinematik ekleyin.
const FAST = REDUCED || !new URLSearchParams(location.search).has('sinematik');
const TR_BOUNDS = [[25.6, 35.7], [44.9, 42.2]];
const up = (s) => s.toLocaleUpperCase('tr');
const low = (s) => s.toLocaleLowerCase('tr');
// Seriler: varsayılan uyumlaştırılmış seri; ham MODIS ve VIIRS, kaynağı doğrudan incelemek isteyenler için.
const SENSORS = [
  { key: 'merged', label: 'Uyumlaştırılmış', sub: 'önerilen' },
  { key: 'modis', label: 'MODIS', sub: 'ham' },
  { key: 'viirs', label: 'VIIRS', sub: 'ham' },
];

const TABS = [['calendar', 'Takvim'], ['compare', 'Karşılaştır'], ['peaks', 'En yoğun'], ['step', 'Uydu uyumu'], ['ogm', 'OGM kaydı']];

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
const scopeLabel = () => SCOPE_LABEL[state.scope];
// Ülke görünümünde harita yedi coğrafi bölgeyi boyar (Türkiye seçili kalır); bölgeye tıklamak
// bölge görünümüne geçirir.
const regionMap = () => state.scope === 'region' || state.scope === 'country';
const mapNames = () => (state.scope === 'country' ? Object.keys(geographic.regions) : areaNames());
const mapData = (name) => (state.scope === 'country' ? geographic.regions[name]?.series : areaData(name));
function mapTotal(name, year = state.year) {
  if (state.scope !== 'country') return total(name, year);
  const row = geographic.regions[name]?.series?.[state.sensor]?.[year];
  return row ? sum(row.filter((_, m) => inWin(m))) : null;
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
const throughLabel = () => `${LD} ${MONTHS[LM]} ${LY}`;

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

function renderAreaSearch() {
  const names = mapNames().sort((a, b) => a.localeCompare(b, 'tr'));
  $('#provList').innerHTML = names.map((n) => `<option value="${n}">`).join('');
  $('#search').placeholder = regionMap() ? 'Bölge ara' : 'İl ara';
  $('#search').setAttribute('aria-label', regionMap() ? 'Bölge ara' : 'İl ara');
  $('#search').value = '';
  // Ülke ve çizim görünümünde aranacak bir ad yok.
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
        if (rows.some(([, d]) => !d.modis && !d.viirs)) { allYears = null; throw new Error('Nokta dosyaları indirilemedi'); }
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
  drawHint('Veriler yükleniyor…');
  let byYear;
  try {
    byYear = await loadAllYears((k, n) => drawHint(`Veriler yükleniyor… ${k}/${n}`));
  } catch (e) {
    console.error(e);
    drawHint('Veriler indirilemedi. Bağlantıyı kontrol edip yeniden çizin.');
    return drawTool.start();
  }
  if (state.scope !== 'draw') return;
  const r = drawnArea(shape.ring, byYear, { data, names: geo.features.map((f) => f.properties.name),
    viirsFrom: data.meta.viirs_from, LM, LD, lcGroup });
  drawn = { ...r, ...shape, label: SHAPE[shape.mode] || 'Alan',
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
      properties: { name, label: up(name), hasData: !!mapData(name) } });
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
const pointsVisible = () => ready && map.getZoom() >= 6.2 && map.getLayoutProperty('pts', 'visibility') !== 'none';
function closePointPopup() { ptPopup?.remove(); ptPopup = null; }
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
  const { a, y, s, st, i, count, first, last } = hit;
  const dt = new Date(Date.UTC(y, 0, a[i + 2])), m = dt.getUTCMonth();
  const name = geo.features[a[i + 4]]?.properties.name;
  const date = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const start = new Date(Date.UTC(y, 0, first)), end = new Date(Date.UTC(y, 0, last));
  const span = first === last ? date(start) : start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCDate()}–${date(end)}` : `${date(start)}–${date(end)}`;
  const nrt = data.meta.nrt_from?.[s] && dt.toISOString().slice(0, 7) >= data.meta.nrt_from[s];
  const body = document.createElement('div');
  const line = (tag, text) => { const el = document.createElement(tag); el.textContent = text; body.append(el); };
  line('b', `En yakın tespit: ${date(dt)} ${y}`);
  line('p', `${s === 'viirs' ? 'VIIRS S-NPP' : 'MODIS'} · ${a[i + 3].toLocaleString('tr-TR')} MW FRP`);
  line('p', `${name || 'İl bilinmiyor'} · ${nrt ? 'yakın gerçek zamanlı (NRT)' : 'arşiv (SP)'}`);
  const lcName = st > 5 && lc ? lc.classes.find((c) => c.i === a[i + 5])?.label : null;
  if (lcName) line('p', `Arazi: ${lcName}`);
  if (count > 1) line('p', `Bu konumda ${count} tespit: ${span}`);
  line('small', `Konum ${s === 'viirs' ? '±375 m (VIIRS)' : '±1 km (MODIS)'}: sensör pikselinin merkezi`);
  if (name) {
    const link = document.createElement('a');
    link.href = '#panel'; link.className = 'link'; link.textContent = 'Bu ayı takvimde aç';
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
  ptPopup.getElement().querySelector('.maplibregl-popup-close-button')?.setAttribute('aria-label', 'Bilgi balonunu kapat');
}
const PT_MINZOOM = 5.8; // katman 6.2'de görünür olur; biraz önce hazırlanır
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
      ['interpolate', ['exponential', 2], ['zoom'], 6.2, 1.6, 8, 3, 10, m ? 4.6 : 3.6, 12, m ? 17 : 6.5]);
    map.setPaintProperty('pts', 'circle-opacity',
      ['interpolate', ['linear'], ['zoom'], 6.2, 0, 7, 0.85, 10, m ? 0.7 : 0.85, 12, m ? 0.45 : 0.7]);
  } catch (e) { ptKey = ''; }
}

// Renk, ilin o yılki sıralamasına göre verilir (çeyreklik ölçek): birkaç çok yüksek il
// diğerlerini tek renge sıkıştırmasın.
let legendVals = [];
function paintMap() {
  const tot = {};
  for (const f of activeGeo().features) { const n = f.properties.name; tot[n] = mapTotal(n); }
  legendVals = Object.values(tot).filter((t) => t != null).sort((a, b) => a - b);
  const last = Math.max(1, legendVals.length - 1);
  for (const f of activeGeo().features) {
    const name = f.properties.name, t = tot[name];
    let v = -1;
    if (t != null) { let lo = 0; while (lo < legendVals.length && legendVals[lo] < t) lo++; v = lo / last; }
    map.setFeatureState({ source: 'provinces', id: name }, { v, sel: name === state.sel });
  }
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
    // Açılış: Türkiye toplamı; grafik paneli kapalı, "Detaylı inceleme" ile açılır.
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
    showTip(`<b>${name}</b>${t == null ? 'Veri yok' : `${fmt(t)} tespit · ${periodLabel()}`}`, e.originalEvent.clientX, e.originalEvent.clientY);
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
  map.on('rotate', () => { $('#needle').style.transform = `rotate(${-map.getBearing()}deg)`; });
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
  const part = PARTIAL && y === LY && inWin(LM) ? ` (${LD} ${MON3[LM]} itibarıyla)` : '';
  return `${y}${w ? ' · ' + w : ''}${part}`;
}

// Arazi türü katmanı: her 3°x3° parça için ~270 m'lik renkli görüntü (scripts/build_landcover.py).
const lcLayers = [];
async function addLandcover() {
  try {
    const idx = await fetch('data/landcover/index.json').then((r) => (r.ok ? r.json() : null));
    if (!idx) return;
    const on = $('#layersMenu [data-layer=landcover]')?.checked;
    for (const t of idx.tiles) {
      const id = `lc-${t.tile}`;
      map.addSource(id, { type: 'image', url: t.file, coordinates: t.coordinates });
      map.addLayer({ id, type: 'raster', source: id, layout: { visibility: on ? 'visible' : 'none' },
        paint: { 'raster-opacity': 0.72, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, 'pts');
      lcLayers.push(id);
    }
    $('#lcLegend').innerHTML = idx.legend.map((l) => `<li><i style="background:${l.color}"></i>${l.label}</li>`).join('');
    $('#lcRow').hidden = false;
  } catch (e) { console.warn('Arazi türü katmanı yüklenemedi', e); }
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
function renderSensors() {
  const nav = $('#sensorTabs');
  for (const s of SENSORS) {
    const r = ranges[s.key];
    if (!r) continue;
    const b = document.createElement('button');
    b.role = 'tab'; b.dataset.key = s.key;
    b.title = s.key === 'merged' ? 'MODIS ve VIIRS tek ölçekte (VIIRS-eşdeğeri tespit)' : `${s.label} ham tespit sayısı, uyumlaştırma uygulanmamış`;
    b.innerHTML = `<b>${s.label}</b><small class="${s.key === 'merged' ? '' : 'raw'}">${s.sub} · ${r[0]}–${r[1]}</small>`;
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

function renderLegend() {
  const lv = legendVals, n = lv.length;
  $('#legend').innerHTML = n > 1 ? `<b>${regionMap() ? 'Bölge' : 'İl'} renkleri: ${fullWin() ? 'yıllık' : winLabel()} tespit</b><div class="bar" style="background:linear-gradient(90deg,${RAMP.join(',')})"></div>
    <div class="ends"><span>az</span><span>${fmt(lv[n >> 1])}</span><span>çok</span></div>
    <div class="dotnote"><i></i><span>Tek tek tespitler, yakınlaşınca</span></div>` : '';
}

function renderRank() {
  const rows = mapNames().map((n) => [n, mapTotal(n)]).filter((r) => r[1] != null)
    .sort((a, b) => b[1] - a[1]).slice(0, regionMap() ? 7 : 6);
  $('#rank').hidden = !rows.length || state.scope === 'draw';
  if (!rows.length || state.scope === 'draw') return;
  $('#rankTitle').textContent = `En çok tespit${regionMap() ? ' · bölgeler' : ''} · ${state.year}${fullWin() ? '' : ' · ' + winLabel()}`;
  $('#rankList').innerHTML = rows.map(([n, t], i) =>
    `<li><button data-name="${n}" class="${n === state.sel ? 'on' : ''}"><i>${i + 1}</i><span>${n}</span><em>${fmt(t)}</em>
     <u style="width:calc((100% - 34px) * ${rows[0][1] ? t / rows[0][1] : 0})"></u></button></li>`).join('');
}

// ── Panel ───────────────────────────────────────────────
const head = (eyebrow, title) => `<div class="p-head"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div>
  <button class="close" aria-label="Paneli kapat" title="Kapat (Esc)">×</button></div>`;
const dec = (n, d = 1) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
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
  return `<div class="filters"><div class="range" role="group" aria-label="Yıl aralığı">
      <span class="lbl">Yıllar</span>
      <select id="rFrom" aria-label="Dönem başlangıç yılı">${opt(state.from, r[0], state.to)}</select>
      <span aria-hidden="true">–</span>
      <select id="rTo" aria-label="Dönem bitiş yılı">${opt(state.to, state.from, r[1])}</select>
      <small>${n} yıl</small>
      ${full ? '' : '<button class="link" id="rAll">Tüm yıllar</button>'}
    </div>
    <div class="range" role="group" aria-label="Ay aralığı">
      <span class="lbl">Aylar</span>
      <select id="wFrom" aria-label="İlk ay">${opt(state.win[0], 0, state.win[1], (m) => MON3[m])}</select>
      <span aria-hidden="true">–</span>
      <select id="wTo" aria-label="Son ay">${opt(state.win[1], state.win[0], 11, (m) => MON3[m])}</select>
      ${season ? '' : '<button class="link" id="wSeason" title="Haziran–Ekim">Yangın sezonu</button>'}
      ${fullWin() ? '' : '<button class="link" id="wAll">Bütün yıl</button>'}
    </div>
    <p class="range-note">Bu aralık aşağıdaki grafikleri belirler; harita, sol özet, ay ayrıntısındaki kıyas ve indirilen dosyalar da aynı aralığı kullanır.</p></div>`;
}

// "Bu ay tarihsel medyana göre nerede?" kartı: seçili ay (varsayılan: son veri ayı).
function readCard(name, val) {
  const y = state.year, m = state.month;
  const r = rdFor(name)(y, m);
  if (!r) return '';
  const latest = y === LY && m === READ_M, part = isPartial(y, m), lv = r.level ? LEVELS[r.level] : null;
  const reg = val && data.regions?.[val.region];
  const src = state.sensor !== 'merged' ? `${sensorOf().label} ham sayı`
    : sourceOf(y, m, data.meta.viirs_from) === 'viirs' ? 'VIIRS gözlemi' : `MODIS × ${reg ? dec(reg.factors[m], 2) : 'çarpan'}`;
  const lastM = y === LY ? LM : 11;
  const months = MONTHS.map((n, i) => (i > lastM ? '' : `<option value="${i}"${i === m ? ' selected' : ''}>${n}</option>`)).join('');
  const label = part ? `1–${LD} ${MONTHS[m]} ${y}` : null;
  return `<section class="read${r.level ? ' lv-' + r.level : ''}" aria-label="Seçili ayın dönem medyanına göre yeri">
      <div class="read-top">
        <select id="mSel" aria-label="Okunacak ay">${months}</select><b>${y}</b>
        ${latest ? `<span class="pill">${part ? 'ay sürüyor' : READ_M === LM ? 'son veri' : 'son tam ay'}</span>` : '<button class="link" id="latest">Son aya dön</button>'}
        ${lv ? `<span class="lvl" title="Aynı takvim ayının dönemdeki diğer yıllarına göre: 25. yüzdeliğin altı düşük, 25–75 normal, 75–95 yüksek, 95 üstü olağanüstü.">${lv.mark ? lv.mark + ' ' : ''}${lv.label}</span>` : ''}
      </div>
      <p class="say">${sentence(r, label)}</p>
      <dl class="nums">
        <div><dt>Bu ay</dt><dd>${fmt(r.v)}</dd></div>
        <div><dt>Orta değer</dt><dd>${fmt(r.med)}</dd></div>
        <div><dt>Yüzdelik</dt><dd>${r.pct == null ? '—' : '%' + Math.round(r.pct)}</dd></div>
        <div><dt>Kaynak</dt><dd>${src}</dd></div>
      </dl>
      <p class="fine">${part ? `Ay henüz bitmedi: her yılın 1–${LD} ${MONTHS[m]} değerleriyle kıyaslandı. ` : ''}Başka bir ay için takvimde bir kareye tıklayın.</p>
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
  const rows = lc.groups.map((lab, k) => `<li><i style="background:${LC_COLORS[k]}"></i><span>${lab}</span><b>%${Math.round(pct[k])}</b></li>`).join('');
  return `<section class="land" aria-label="Arazi türüne göre tespitler">
      <h3>Ateşler nerede yanıyor?</h3>
      <div class="land-bar">${pct.map((v, k) => `<span style="width:${v}%;background:${LC_COLORS[k]}"></span>`).join('')}</div>
      <ul>${rows}</ul>
      <p class="fine" title="Uydu tespitinin konumu ±375 m (VIIRS) ile ±1 km (MODIS) arasında belirsizdir; tek tek noktaların sınıfı sınırda yanlış olabilir, yüzdeler daha güvenilirdir.">${fmt(tot)} tespitin altındaki arazi (ESA WorldCover 2021, 10 m). Tarım arazisindeki ateş anız yakma olabilir ama kanıtı değildir; "ağaçlık alan" bahçeleri de içerir.</p>
    </section>`;
}

function caution(val) {
  if (val?.confidence !== 'low') return '';
  const why = val.mean_annual < 100
    ? `Bu ilde yılda ortalama ${fmt(val.mean_annual)} tespit var; aylık sayılar güvenilir bir okuma için çok az.`
    : `Bu ilde doğrulama hatası yüksek (yıllık %${Math.round(val.annual_wape * 100)}); aylık okumalar güvenilir değil.`;
  return `<div class="caution" role="note"><b>Dikkat:</b> ${why} Yıllık toplamlara ve uzun dönem örüntüsüne bakın.</div>`;
}
// Çizilen alan için hata ölçülemez; az tespitli ya da küçük alanda okuyucu uyarılır.
function drawCaution() {
  if (!drawn) return '';
  const full = Object.entries(drawn.series.merged).filter(([y]) => !(PARTIAL && +y === LY));
  const mean = sum(full.map(([, r]) => sum(r))) / Math.max(1, full.length);
  const why = mean < 100 ? `Bu alanda yılda ortalama ${fmt(mean)} tespit var; aylık sayılar güvenilir bir okuma için çok az.`
    : drawn.km2 < 2500 ? `Alan küçük (${fmt(drawn.km2)} km²); küçük alanlarda aylık sayılar oynaktır.` : '';
  return why ? `<div class="caution" role="note"><b>Dikkat:</b> ${why} Yıllık toplamlara ve uzun dönem örüntüsüne bakın.</div>` : '';
}
function methodNote(name) {
  if (state.scope === 'region') return `<p>${membersOf(name).length} il toplamı: ${membersOf(name).join(', ')}.</p><p>${geographic.meta.note}</p><p>${geographic.meta.validation_note}</p>`;
  if (state.scope === 'country') return `<p>81 ilin toplamı. Her ilin uyumlaştırılmış serisi olduğu gibi toplanır; ülke için ayrı bir katsayı hesaplanmadı.</p><p>Türkiye toplamı için ayrı bir hata ölçümü bu sürümde yapılmadı.</p>`;
  if (!drawn) return '';
  const tot = sum(drawn.byProv.map(([, v]) => v));
  const provs = drawn.byProv.slice(0, 6).map(([n, v]) => `${n} %${Math.max(1, Math.round((100 * v) / (tot || 1)))}`).join(', ');
  return `<p>${drawn.label}${drawn.w ? `, ${dec(drawn.w)} × ${dec(drawn.h)} km` : ''} · ${fmt(drawn.km2)} km².${tot ? ` Tespitlerin illere dağılımı: ${provs}${drawn.byProv.length > 6 ? ` ve ${drawn.byProv.length - 6} il daha` : ''}.` : ''}</p>
    <p>Ham MODIS ve VIIRS sayıları alanın içine düşen uydu tespitlerinin sayımıdır. Uyumlaştırılmış seri için yeni katsayı hesaplanmadı: her ilin uyumlaştırılmış aylık değeri, o ilin o ayki tespitlerinden alana düşen pay kadar alınıp toplandı. Böylece il serilerindeki 2002 öncesi tek uydu ve uydu kesintisi düzeltmeleri korunur.</p>
    <p>Hata bu alan için ölçülmedi. Ölçülen değerler (Akdeniz, bir yıl dışarıda bırakılarak): ~100 km ölçekte yıllık %23, aylık %38; ~25 km ölçekte aylık %58.</p>`;
}

function peaksView(name, years) {
  const { topYears, topMonths } = peaks(years, state.from, state.to, state.win, (y) => total(name, y));
  const list = (rows, attrs, label, on) => `<ol class="top">${rows.map((r, i) => `<li><button ${attrs(r)} class="${on(r) ? 'on' : ''}">
      <i>${i + 1}</i><span>${label(r)}</span><em>${fmt(r.at(-1))}</em><u style="width:calc((100% - 34px) * ${rows[0].at(-1) ? r.at(-1) / rows[0].at(-1) : 0})"></u></button></li>`).join('')}</ol>`;
  const w = winLabel();
  return `<h4>En yüksek yıllar · ${state.from}–${state.to}${w ? ' · ' + w : ''}</h4><p>${w ? `${w} toplamı` : 'Yıllık toplam'}; tıklayınca o yıl seçilir.</p>
    ${list(topYears, ([y]) => `data-year="${y}"`, ([y]) => (PARTIAL && y === LY ? `${y} <small>(${LD} ${MON3[LM]} itibarıyla)</small>` : y), ([y]) => y === state.year)}
    <h4 class="gap">En yüksek aylar</h4><p>Tek tek ayların değeri; tıklayınca o ay okunur.</p>
    ${list(topMonths, ([y, m]) => `data-year="${y}" data-month="${m}"`, ([y, m]) => `${MONTHS[m]} ${y}${isPartial(y, m) ? ` <small>(1–${LD})</small>` : ''}`, ([y, m]) => y === state.year && m === state.month)}`;
}

function stepView(p, val) {
  const vy = viirsYear(), reg = val && data.regions?.[val.region];
  const fac = reg ? `<p class="fine">${vy} öncesi çarpan, ${val.region} bölgesi (${reg.name}), ay ay:</p>
    <div class="fac">${reg.factors.map((f, i) => `<span><i>${MON3[i]}</i>${dec(f)}</span>`).join('')}</div>` : '';
  const step = val?.step_raw != null ? `<p class="say">2009–2011'den 2012–2014'e ortalama yıllık değişim: ham seride ×${dec(val.step_raw, 2)},
    birleşmiş seride ×${dec(val.step_harmonized, 2)}. MODIS tek başına ×${dec(val.step_modis, 2)} gösteriyor; birleşmiş seri buna yakın olmalı.</p>` : '';
  const lastFull = PARTIAL ? LY - 1 : LY;
  return `<h4>Ham seri ve birleşmiş seri</h4>
    <p>${{ region: 'İl serilerinin bölge toplamı; yeni bir bölge katsayısı hesaplanmadı. ',
    country: 'İl serilerinin Türkiye toplamı; yeni bir ülke katsayısı hesaplanmadı. ',
    draw: 'Alanın kapsadığı illerin serilerinden tespit payıyla alındı; yeni bir katsayı hesaplanmadı. ' }[state.scope] || ''}Yıllık toplam. Ham seri ${vy}'ye kadar MODIS, sonra VIIRS sayar; VIIRS daha küçük ateşleri de gördüğü için ${vy}'de yapay bir sıçrama oluşur.
    Birleşmiş seri ${vy} öncesini MODIS × bölgesel aylık çarpanla VIIRS ölçeğine taşır.${PARTIAL ? ` ${LY} bitmediği için çizilmedi.` : ''}</p>
    <div class="key"><span><i class="raw"></i>Ham (MODIS → VIIRS)</span><span><i class="harm"></i>Birleşmiş</span>
      <span><i class="dot o"></i>MODIS × çarpan</span><span><i class="dot"></i>VIIRS gözlemi</span></div>
    ${stepChart(p, vy, state.year, lastFull)}${step}${fac}`;
}

// OGM'nin bildirdiği orman yangınları ile uydu tespitleri (Türkiye geneli, yıllık).
function ogmView(name) {
  if (!ogm) return '<p>OGM verisi yüklenemedi.</p>';
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
  s += `<text x="${L - 6}" y="${T + 4}" class="tick" text-anchor="end">${fmt(mS / 1000)}b</text><text x="${W - R + 6}" y="${T + 4}" class="tick">${fmt(mF)}</text>`;
  ys.forEach((y, i) => {
    const bw = Math.max(3, (W - L - R) / ys.length - 3);
    s += `<rect x="${x(i) - bw / 2}" y="${yF(fires[i])}" width="${bw}" height="${T + ih - yF(fires[i])}" rx="1.5" class="band"/>`;
    if (y === ys[0] || y === ys.at(-1) || y % 5 === 0) s += `<text x="${x(i)}" y="${H - 6}" class="tick${y === state.year ? ' on' : ''}" text-anchor="middle">${y}</text>`;
  });
  s += `<path d="${sat.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${yS(v)}`).join('')}" class="ln-harm"/>`;
  ys.forEach((y, i) => {
    s += `<circle cx="${x(i)}" cy="${yS(sat[i])}" r="${y === state.year ? 4 : 2.6}" class="pt-harm${y === state.year ? ' on' : ''}"/>`;
    s += `<rect x="${x(i) - 6}" y="0" width="12" height="${H - 16}" class="hit" data-year="${y}" data-tip="<b>${y}</b>Uydu (birleşmiş): ${fmt(sat[i])} tespit<br>OGM: ${fmt(fires[i])} orman yangını · ${fmt(ha[i])} ha"/>`;
  });
  const key = name.toLocaleUpperCase('tr');
  const obm = Object.entries(ogm.obm2025).find(([u]) => u.toLocaleUpperCase('tr') === key);
  const p25 = series(name, 'merged')?.[2025];
  const local = obm
    ? `<h4 class="gap">${name} Orman Bölge Müdürlüğü · 2025</h4><p class="say">OGM: <b>${fmt(obm[1].fires)}</b> orman yangını, ${fmt(obm[1].ha)} ha yanan alan. Uydu, ${name} ilinde 2025'te ${p25 ? fmt(sum(p25)) : '—'} tespit görüyor.</p>
       <p class="fine">Bölge müdürlüğü genellikle birkaç ili kapsar; il sınırıyla birebir karşılaştırılamaz. İl bazında yıllık OGM verisi yalnızca 2025 için bulundu.</p>`
    : state.scope === 'country' ? ''
    : `<p class="fine">${multi() ? `${regional() ? 'Coğrafi bölge' : 'Çizilen alan'} ile Orman Bölge Müdürlüğü sınırları aynı değildir; bu görünümde Türkiye toplamı gösterilir.` : `${name} adına bir orman bölge müdürlüğü yok; 2025 bölge tablosunda bu il başka bir müdürlüğe bağlı.`}</p>`;
  return `<h4>Türkiye: uydu tespitleri ve OGM'nin bildirdiği orman yangınları</h4>
    <p>Çizgi: uydu (birleşmiş, 81 il toplamı, sol eksen). Sütun: OGM'nin müdahale ettiği orman yangını sayısı (sağ eksen).</p>
    <div class="key"><span><i class="harm"></i>Uydu tespiti</span><span><i class="b"></i>OGM yangın sayısı</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Türkiye geneli yıllık uydu tespitleri ve OGM orman yangını sayıları">${s}</svg>
    <p class="say">Yıl sıralaması benzerliği (Spearman): uydu–OGM yangın sayısı ${dec(rho(sat, fires), 2)}, uydu–OGM yanan alan ${dec(rho(sat, ha), 2)}.</p>
    <p class="fine">Benzerlik düşük, çünkü iki kaynak aynı şeyi saymıyor. OGM yalnızca orman alanında müdahale edilen yangınları sayar. Uydu tarla ve anız yakmalarını da görür; Türkiye'de tespitlerin çoğu tarımsaldır. Tarla yakmaları azaldıkça (Çukurova'da 20 yılda yaklaşık %70) uydu toplamı düşerken OGM'nin orman yangını sayıları artıyor. Uydu takvimi "orman yangını sayısı" olarak okunmamalı; yanma etkinliğinin tamamını gösterir. ${ogm.note}</p>
    ${local}
    <p class="fine">Kaynak: ${Object.values(ogm.sources).join(' · ')}</p>`;
}

function renderPanel() {
  const panel = $('#panel'), body = $('#panelBody'), side = $('#side'), sideBody = $('#sideBody');
  if (!state.sel) { panel.hidden = true; side.hidden = true; return; }
  panel.hidden = false; side.hidden = false;
  const name = state.sel, years = series(name);
  if (!years || !years[state.year]) {
    sideBody.innerHTML = head(scopeLabel(), name) + '<div class="empty"><h4>Bu alan için bu yılda veri yok</h4><p>Alttaki çubuktan başka bir yıl seçin.</p></div>';
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
  const confTitle = regional() && merged ? geographic.meta.validation_note
    : state.scope === 'country' && merged ? 'Türkiye serisi 81 ilin uyumlaştırılmış serilerinin toplamıdır; ülke ölçeğinde ayrı bir hata ölçümü bu sürümde yapılmadı.'
    : state.scope === 'draw' && merged ? 'Çizilen alan önceden bilinmediği için hatası ölçülemez. Ölçülen değerler (Akdeniz, bir yıl dışarıda): ~100 km ölçekte yıllık %23, aylık %38; ~25 km ölçekte aylık %58.'
    : val
    ? 'Bir yıl dışarıda bırakılarak ölçüldü (2012–2025). Yüksek: yıllık hata %15 ve altı, yılda ortalama 300 ve üzeri tespit. Düşük: hata %30 üzeri ya da yılda 100 altı tespit.'
    : "Ham seri: tespit sayısına göre. 200 ve üzeri yüksek, 50–199 orta, 50'nin altı düşük. Ham MODIS ve VIIRS sayıları birbiriyle doğrudan karşılaştırılamaz.";
  const sel = { year: state.year, month: state.month };
  const w = winLabel();
  // Durum etiketi: seçili yılın toplamı, geçmiş yılların orta değerine (medyan) göre.
  const status = !med ? null : ratio < 0.67 ? ['low', 'Olağandan düşük'] : ratio <= 1.5 ? ['normal', 'Olağan']
    : ratio <= 2.5 ? ['high', 'Olağandan yüksek'] : ['extreme', 'Çok yüksek'];
  const span = like ? `aynı dönemin (${w ? MON3[state.win[0]] : '1 Oca'}–${LD} ${MON3[LM]})` : w ? `${w} döneminin` : 'yıllık toplamın';
  const sumText = med
    ? `${from}–${to} yıllarında ${span} orta değeri <b>${fmt(med)}</b>. ${state.year}${like ? ' şimdiye kadar' : ''} bunun <b>${dec(ratio)} katı</b>.`
    : `Bu ${multi() ? 'alan' : 'il'} için karşılaştırma yapacak kadar tespit yok.`;

  let view = '';
  if (state.tab === 'calendar') {
    view = `<h4>${from}–${to} yanma takvimi${w ? ' · ' + w : ''}</h4><p>Her satır bir yıl, her kare bir ay. Renk koyulaştıkça tespit artar. İşaretli kareler o ay için olağan dışı yüksektir. Kareye tıklayınca o ay okunur.</p>
      ${calendarKey()}${calendar(years, from, to, sel, { win: state.win, rd: rdFor(name), partial: isPartial, through: LD })}`;
  } else if (state.tab === 'compare') {
    const ref = inRange(like ? cmpYears(name) : years, from, to);
    if (!like && PARTIAL) delete ref[LY];   // bitmemiş yılın boş ayları başka bir yılın medyanını bozmasın
    const c = compare(ref, row, state.year, state.month, like ? LM : -1);
    view = `<h4>${state.year}, geçmiş yıllarla ay ay</h4><p>Turuncu sütun ${state.year}. Beyaz çizgi ${from}–${to} yıllarında o ayın orta değeri, gri bant yılların yarısının düştüğü olağan aralık. Sütuna tıklayınca o ay okunur.</p>
      <div class="key"><span><i></i>${state.year}</span><span><i class="m"></i>Orta değer</span><span><i class="b"></i>Olağan aralık</span></div>
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
  body.innerHTML = `<div class="p-head charts-head"><div><span class="eyebrow">${sen.label}${merged ? ' seri' : ' · ham veri'} · ${sel_}</span>
      <h2>${name} grafikleri</h2></div></div>
    <section class="pblock month-block" aria-label="Ay ayrıntısı">
      <header class="pblock-head"><span class="pblock-num" aria-hidden="true">1</span><div><h3>Ay ayrıntısı</h3>
        <p>Tek bir ay: geçmiş yılların aynı ayına göre nerede?</p></div></header>
      ${readCard(name, vAll)}
    </section>
    <section class="pblock charts-block" aria-label="Grafikler">
      <header class="pblock-head"><span class="pblock-num" aria-hidden="true">2</span><div><h3>Grafikler</h3>
        <p>Önce yıl ve ay aralığını seçin, sonra grafiği.</p></div></header>
      ${rangeRow()}
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === state.tab}">${l}</button>`).join('')}</div>
      <div class="view" role="tabpanel">${view}</div>
    </section>`;
  // Sol panel: genel özet, güven, arazi türü ve indirme.
  sideBody.innerHTML = head(`${sen.label}${merged ? ' seri' : ' · ham veri'} · ${periodLabel()}`, name) + `
    <section class="summary" aria-label="Özet">
      <div class="sum-top"><b>${fmt(n)}</b><span>uydu tespiti</span>${status ? `<span class="status ${status[0]}">${status[1]}</span>` : ''}</div>
      <p>${sumText}</p>
    </section>
    <div class="kpis">
      <div class="kpi"><span>En yoğun ay</span><b>${peak >= 0 ? MONTHS[peak] : '—'}</b><small>${peak >= 0 ? fmt(row[peak]) + ' tespit' : ''}</small></div>
      <div class="kpi"><span>Orta değer</span><b>${fmt(med)}</b><small>${from}–${to}</small></div>
      <div class="kpi conf" title="${confTitle}"><span>${multi() && merged ? `${{ region: 'Bölge', country: 'Ülke', draw: 'Alan' }[state.scope]} doğrulaması` : 'Güvenilirlik'}</span><b>${multi() && merged && !val ? 'Ölçülmedi' : ['Düşük', 'Orta', 'Yüksek'][level - 1]}</b><small>${multi() && merged ? (val ? `Yıllık hata %${dec(val.annual_wape * 100)}<br>Aylık hata %${dec(val.monthly_wape * 100)}` : 'Hata yüzdesi verilmez') : `<span class="dots">${[1, 2, 3].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>${val?.annual_wape != null ? `hata %${Math.round(val.annual_wape * 100)}` : merged ? '' : 'sayıya göre'}`}</small></div>
    </div>
    ${state.scope === 'province' ? caution(val) : state.scope === 'draw' ? drawCaution() : ''}
    ${landCard(name)}
    ${multi() ? `<details class="region-method"${state.scope === 'draw' ? ' open' : ''}><summary>Veri ve yöntem</summary>${methodNote(name)}</details>` : ''}
    <div class="p-foot">
      <details class="dl-menu">
        <summary class="btn"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16.5h12"/></svg>İndir</summary>
        <div class="dl-list">
          <button id="csv"><b>Aylık tablo (CSV)</b><small>Takvimdeki sayılar · ${sel_}</small></button>
          <button id="hcsv"><b>Tespit listesi (CSV)</b><small>Her uydu tespiti: tarih, konum, FRP</small></button>
          <button id="png"><b>Grafik (PNG)</b><small>Açık sekmedeki grafik, sunum için</small></button>
          <button id="svg"><b>Grafik (SVG)</b><small>Ölçeklenebilir vektör</small></button>
        </div>
      </details>
      <span title="${data.meta.notes?.[state.sensor] || ''}">${data.meta.notes?.[state.sensor] || ''}</span>
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
    data.meta.viirs_from, state.win, rdFor(name), isPartial);
  save(csvBlob(lines), `burncal_aylik_${fileTag()}.csv`);
}

async function downloadHotspots(btn) {
  const name = state.sel, lab = btn.querySelector('small') || btn, label = lab.textContent;
  const members = membersOf(name);
  btn.disabled = true; lab.textContent = 'Hazırlanıyor…';
  try {
    // Çizilen alanda yalnızca alanın içine düşen noktalar (hesap sırasında ayrıldı).
    const byYear = {};
    for (let y = state.from; y <= state.to; y++) byYear[y] = state.scope === 'draw' ? drawn.hits[y] : await loadYear(y);
    const lcLabels = [];
    for (const c of lc?.classes || []) lcLabels[c.i] = c.label;
    let lines = [];
    for (const member of members) {
      const rows = hotspotRows(byYear, provIdx[member], member, state.from, state.to, state.win, data.meta.nrt_from || {}, lcLabels);
      lines.push(...(lines.length ? rows.slice(1) : rows));
    }
    save(csvBlob(lines), `burncal_tespitler_${fileTag()}.csv`);
    lab.textContent = `${fmt(lines.length - 1)} tespit indirildi`;
    setTimeout(() => { lab.textContent = label; }, 2500);
  } catch (e) {
    console.error(e); lab.textContent = 'İndirilemedi';
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
  const title = `${state.sel} · ${$('#panel .view h4')?.textContent || ''}`;
  const font = getComputedStyle(document.body).fontFamily.replace(/"/g, "'");
  clone.setAttribute('x', pad); clone.setAttribute('y', top); clone.setAttribute('width', w); clone.setAttribute('height', h);
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#18181a"/>
    <text x="${pad}" y="22" fill="#f2ede4" style="font: 700 13px ${font}">${esc(title)}</text>
    <text x="${pad}" y="36" fill="#b9c0c9" style="font: 10px ${font}">VIIRS-eşdeğeri uydu tespiti (MODIS + VIIRS uyumlaştırılmış) · veri ${throughLabel()} tarihine kadar</text>
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
  $('#zoomIn').onclick = () => map.zoomIn(); $('#zoomOut').onclick = () => map.zoomOut();
  $('#north').onclick = () => { stopOrbit(); map.easeTo({ bearing: 0, pitch: 0 }); };
  $('#home').onclick = () => select(null);

  renderAreaSearch();
  for (const button of document.querySelectorAll('[data-scope]')) button.onclick = () => setScope(button.dataset.scope);
  for (const button of document.querySelectorAll('[data-draw]')) button.onclick = () => startDraw(button.dataset.draw);
  $('#drawCancel').onclick = () => { drawTool.stop(); $('#drawBar').hidden = true; if (!drawn) setScope('province'); };
  const search = $('#search');
  const pick = () => {
    const names = mapNames();
    const q = low(search.value.trim());
    if (!q) return;
    const hit = names.find((n) => low(n) === q) || names.find((n) => low(n).startsWith(q));
    if (hit) { pickArea(hit); search.value = ''; search.blur(); }
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
    if (!e.target.closest('.pop')) for (const [b, m] of menus) { m.hidden = true; b.setAttribute('aria-expanded', false); }
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
      if (on && fill.checked) { fill.checked = false; for (const id of LAYER_GROUPS.fill) map.setLayoutProperty(id, 'visibility', 'none'); }
      return;
    }
    for (const id of LAYER_GROUPS[g]) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
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
async function main() {
  document.body.classList.add('booting');
  [data, geo, geographic] = await Promise.all(['data/atlas.json', 'data/tr-provinces.json', 'data/geographic-regions.json'].map((u) => fetch(u).then((r) => {
    if (!r.ok) throw new Error(`Veri yüklenemedi: ${u}`);
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
  $('#dataBadge').textContent = `Son veri: ${throughLabel()}`;
  $('#dataBadge').title = PARTIAL ? `${LY} yılı sürüyor; son veri günü ${throughLabel()}. Süren ay ve yıl, geçmiş yılların aynı günleriyle kıyaslanır.` : `Son veri günü ${throughLabel()}.`;
  $('#intro span').textContent = `MODIS · VIIRS · ${RANGE[0]}–${RANGE[1]}`;
  renderSensors();
  initMap();
  bind();
  setSensor('merged');
}
main().catch((err) => {
  console.error(err);
  document.body.classList.remove('booting');
  $('#intro').innerHTML = `<div><h1>Yüklenemedi</h1><span>${err.message}</span></div>`;
});
