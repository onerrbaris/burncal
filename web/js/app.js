/* global maplibregl */
import { buildStyle, LAYER_GROUPS, RAMP } from './mapstyle.js';
import { MONTHS, LEVELS, fmt, quantile, inRange, reading, sentence, peaks, sourceOf, csvRows,
  monthBars, calendar, calendarKey, compare, stepChart } from './charts.js';

const $ = (s) => document.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
// MVP: hafif mod varsayılan; kamera uçuşları ve animasyonlar için adrese ?sinematik ekleyin.
const FAST = REDUCED || !new URLSearchParams(location.search).has('sinematik');
const TR_BOUNDS = [[25.6, 35.7], [44.9, 42.2]];
const up = (s) => s.toLocaleUpperCase('tr');
const low = (s) => s.toLocaleLowerCase('tr');

// Sekmeler. "merged" verisi atlas.json'a eklendiğinde sekme kendiliğinden dolar.
const SENSORS = [
  { key: 'modis', label: 'MODIS' },
  { key: 'viirs', label: 'VIIRS' },
  { key: 'merged', label: 'Birleşmiş' },
];
const TABS = [['months', 'Aylar'], ['calendar', 'Takvim'], ['compare', 'Kıyas'], ['peaks', 'Zirveler'], ['step', 'Uyum']];

// month: okunan ay (0–11, varsayılan son veri ayı Aralık); from/to: dönem; custom: dönemi kullanıcı mı seçti.
const state = { sensor: 'merged', year: null, month: 11, from: null, to: null, custom: false, sel: null, tab: 'months', playing: false };
let data, geo, map, timer, ready = false, hovered = null, orbitOK = false, orbitRaf = 0;
const bboxes = {}, maxTotal = {}, ranges = {};

// ── Veri ────────────────────────────────────────────────
const sum = (a) => a.reduce((x, y) => x + y, 0);
const series = (name, sensor = state.sensor) => data.provinces[name]?.[sensor] || null;
const total = (name, year = state.year, sensor = state.sensor) => {
  const row = series(name, sensor)?.[year];
  return row ? sum(row) : null;
};

function indexData() {
  for (const { key } of SENSORS) {
    let lo = Infinity, hi = -Infinity, mx = 0;
    for (const p of Object.values(data.provinces)) {
      for (const [y, row] of Object.entries(p[key] || {})) {
        lo = Math.min(lo, +y); hi = Math.max(hi, +y); mx = Math.max(mx, sum(row));
      }
    }
    if (hi >= lo) { ranges[key] = [lo, hi]; maxTotal[key] = mx || 1; }
  }
}

function geometry() {
  const labels = [];
  for (const f of geo.features) {
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
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: best },
      properties: { name, label: up(name), hasData: !!data.provinces[name] } });
  }
  return { type: 'FeatureCollection', features: labels };
}

// ── Harita ──────────────────────────────────────────────
function pads() {
  if (innerWidth <= 760) return { top: 120, bottom: state.sel ? innerHeight * 0.6 + 100 : 110, left: 20, right: 20 };
  return { top: 100, bottom: 130, left: 260, right: state.sel ? 460 : 40 };
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
  move({ ...cam, pitch: 38, bearing: 0, padding: pads() }, duration);
}

function move(cam, duration) {
  if (REDUCED) return map.jumpTo(cam);
  if (!FAST) return map.flyTo({ ...cam, duration, curve: 1.5, essential: true });
  // Hafif mod: kısa, yumuşak bir süzülme (yavaş başlar, yavaş durur); eğim az tutulur.
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  map.flyTo({ ...cam, pitch: Math.min(cam.pitch ?? 0, 30), bearing: 0, duration: 1500, curve: 1.15, easing: ease, essential: true });
}

// Ateş noktaları: seçili yılın tespitleri. Birleşmiş görünümde 2012'den önce yalnızca MODIS vardır.
const ptCache = {};
let ptKey = '', ptStyle = '', ptTimer = 0;
const PT_MINZOOM = 5.8; // katman 6.2'de görünür olur; biraz önce hazırlanır
const ptSensor = () => (state.sensor === 'modis' || (state.sensor === 'merged' && state.year < 2012) ? 'modis' : 'viirs');
// Bir yılın noktaları on binlerce tespittir. Yalnızca noktalar görünürken ve yıl değişimi durulunca
// yüklenir; böylece yıl kaydırıcısı ve oynatma, uzak görünümde haritayı yeniden kurmaz.
function updatePoints() {
  clearTimeout(ptTimer);
  ptTimer = setTimeout(loadPoints, 160);
}
async function loadPoints() {
  const src = map && map.getSource('pts');
  if (!src || !state.year || map.getZoom() < PT_MINZOOM) return;
  if (map.getLayoutProperty('pts', 'visibility') === 'none') return;
  const s = ptSensor(), y = state.year, key = y + s;
  if (key === ptKey) return;
  ptKey = key;
  try {
    const d = ptCache[y] || (ptCache[y] = await fetch(`data/points/${y}.json`).then((r) => (r.ok ? r.json() : {})));
    if (ptKey !== key) return;
    const a = d[s] || [], coordinates = new Array(a.length / 3);
    for (let i = 0, j = 0; i < a.length; i += 3, j++) coordinates[j] = [a[i] / 1000, a[i + 1] / 1000];
    // Tek çok-noktalı geometri: on binlerce ayrı nesne kurmaktan çok daha hafif.
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates } });
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
  const mx = maxTotal[state.sensor];
  const tot = {};
  for (const f of geo.features) { const n = f.properties.name; tot[n] = mx ? total(n) : null; }
  legendVals = Object.values(tot).filter((t) => t != null).sort((a, b) => a - b);
  const last = Math.max(1, legendVals.length - 1);
  for (const f of geo.features) {
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
  map.keyboard.disable(); // kendi WASD/ok tuşu döngümüz var
  window.__map = map;

  map.on('load', () => {
    ready = true; paintMap();
    document.body.classList.remove('booting');
    $('#intro').classList.add('out');
    setTimeout(() => $('#intro').remove(), 2400);
    goHome(5200);
  });

  map.on('mousemove', 'prov-hover', (e) => {
    const name = e.features[0]?.properties.name;
    if (name !== hovered) {
      if (hovered) map.setFeatureState({ source: 'provinces', id: hovered }, { hover: false });
      hovered = name;
      map.setFeatureState({ source: 'provinces', id: name }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
    }
    const t = total(name);
    showTip(`<b>${name}</b>${t == null ? 'Veri yok' : `${fmt(t)} tespit · ${state.year}`}`, e.originalEvent.clientX, e.originalEvent.clientY);
  });
  map.on('mouseleave', 'prov-hover', () => {
    if (hovered) map.setFeatureState({ source: 'provinces', id: hovered }, { hover: false });
    hovered = null; map.getCanvas().style.cursor = ''; hideTip();
  });
  map.on('click', 'prov-hover', (e) => select(e.features[0].properties.name));

  for (const ev of ['mousedown', 'touchstart', 'wheel']) map.on(ev, stopOrbit);
  map.on('move', readout);
  map.on('zoom', () => { if (map.getZoom() >= PT_MINZOOM) updatePoints(); });
  readout();

  // Seçili il sınırında akan çizgi.
  const dash = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
    [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  let di = 0;
  if (!FAST) setInterval(() => {
    if (!state.sel || !map.getLayer('sel-line')) return;
    di = (di + 1) % dash.length;
    map.setPaintProperty('sel-line', 'line-dasharray', dash[di]);
  }, 70);
}

function readout() {
  const c = map.getCenter();
  $('#readout').innerHTML = [['Enlem', c.lat.toFixed(3) + '°'], ['Boylam', c.lng.toFixed(3) + '°'], ['Yakınlık', map.getZoom().toFixed(1)]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('#needle').style.transform = `rotate(${-map.getBearing()}deg)`;
}

// ── Seçim ───────────────────────────────────────────────
function select(name, fly = true) {
  stopOrbit();
  state.sel = name;
  document.body.classList.toggle('has-panel', !!name || !ranges[state.sensor]);
  const f = ['==', ['get', 'name'], name || ''];
  map.setFilter('sel-glow', f); map.setFilter('sel-line', f);
  paintMap(); renderPanel(); renderRank();
  if (!fly) return;
  if (!name) return goHome(2200);
  const cam = fit(bboxes[name], pads());
  const bearing = ((name.length * 37) % 50) - 25;
  move({ center: cam.center, zoom: Math.min(cam.zoom - 0.25, 10), pitch: 54, bearing, padding: pads() }, 2600);
  orbitOK = true;
  map.once('moveend', startOrbit);
}

// ── Sensör sekmeleri ────────────────────────────────────
function renderSensors() {
  const nav = $('#sensorTabs');
  for (const s of SENSORS) {
    const r = ranges[s.key];
    const b = document.createElement('button');
    b.role = 'tab'; b.dataset.key = s.key;
    b.innerHTML = `<b>${s.label}</b><small>${r ? `${r[0]}–${r[1]}` : 'yakında'}</small>`;
    b.onclick = () => setSensor(s.key);
    nav.append(b);
  }
  nav.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    const i = SENSORS.findIndex((s) => s.key === state.sensor);
    const next = SENSORS[(i + d + SENSORS.length) % SENSORS.length].key;
    setSensor(next); nav.querySelector(`[data-key=${next}]`).focus(); e.stopPropagation();
  });
  addEventListener('resize', moveIndicator);
  document.fonts?.ready.then(moveIndicator);
}
function moveIndicator() {
  const b = $(`#sensorTabs [data-key=${state.sensor}]`), ind = $('.seg-ind');
  ind.style.width = b.offsetWidth + 'px';
  ind.style.transform = `translateX(${b.offsetLeft}px)`;
}
function setSensor(key) {
  state.sensor = key;
  for (const b of document.querySelectorAll('#sensorTabs button')) {
    const on = b.dataset.key === key;
    b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
  }
  moveIndicator();
  const r = ranges[key], slider = $('#year');
  slider.disabled = !r; $('#play').disabled = !r;
  if (r) {
    slider.min = r[0]; slider.max = r[1];
    state.year = Math.min(r[1], Math.max(r[0], state.year ?? r[1]));
    clampRange();
    $('#yearTicks').innerHTML = Array.from({ length: r[1] - r[0] + 1 }, (_, i) => r[0] + i)
      .map((y) => `<span>${y === r[0] || y === r[1] || (y % 5 === 0 && y - r[0] > 1 && r[1] - y > 1) ? y : ''}</span>`).join('');
  } else stopPlay();
  renderLegend();
  setYear(state.year);
}

// ── Yıl ─────────────────────────────────────────────────
function setYear(y) {
  state.year = +y;
  const r = ranges[state.sensor], slider = $('#year');
  if (r) {
    slider.value = y;
    slider.style.setProperty('--p', ((y - r[0]) / (r[1] - r[0])) * 100 + '%');
  }
  $('#yearOut').textContent = r ? y : '—';
  document.body.classList.toggle('has-panel', !!state.sel || !r);
  if (ready) paintMap();
  renderPanel(); renderRank();
}
function stopPlay() { state.playing = false; clearInterval(timer); $('#play').classList.remove('on'); }
function togglePlay() {
  if (state.playing || !ranges[state.sensor]) return stopPlay();
  state.playing = true; $('#play').classList.add('on');
  const [lo, hi] = ranges[state.sensor];
  if (state.year >= hi) setYear(lo);
  timer = setInterval(() => (state.year >= hi ? stopPlay() : setYear(state.year + 1)), 1100);
}

function renderLegend() {
  const mx = maxTotal[state.sensor];
  const lv = legendVals, n = lv.length;
  $('#legend').innerHTML = mx && n ? `<b>Yıllık tespit · iller sıralı</b><div class="bar" style="background:linear-gradient(90deg,${RAMP.join(',')})"></div>
    <div class="ends"><span>${fmt(lv[0])}</span><span>${fmt(lv[n >> 1])}</span><span>${fmt(lv[n - 1])}</span></div>
    <div class="ends"><span>Kırmızı noktalar: ${ptSensor() === 'modis' ? 'MODIS' : 'VIIRS'} tespitleri (yakınlaşınca)</span></div>` : '';
}

function renderRank() {
  const rows = Object.keys(data.provinces).map((n) => [n, total(n)]).filter((r) => r[1] != null)
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('#rank').hidden = !rows.length;
  if (!rows.length) return;
  $('#rankTitle').textContent = `En yoğun iller · ${state.year}`;
  $('#rankList').innerHTML = rows.map(([n, t], i) =>
    `<li><button data-name="${n}" class="${n === state.sel ? 'on' : ''}"><i>${i + 1}</i><span>${n}</span><em>${fmt(t)}</em>
     <u style="width:calc((100% - 34px) * ${t / rows[0][1]})"></u></button></li>`).join('');
}

// ── Panel ───────────────────────────────────────────────
const chips = () => `<div class="chips">${Object.keys(data.provinces).sort((a, b) => a.localeCompare(b, 'tr'))
  .map((n) => `<button data-name="${n}">${n}</button>`).join('')}</div>`;
const head = (eyebrow, title) => `<div class="p-head"><span class="eyebrow">${eyebrow}</span><h2>${title}</h2>
  <button class="close" aria-label="Paneli kapat" title="Kapat (Esc)">×</button></div>`;
const dec = (n, d = 1) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const viirsYear = () => +(data.meta.viirs_from || '2012-02').slice(0, 4);

// Dönem: kullanıcı seçmediyse etkin sensörün tüm yılları; seçtiyse sensör aralığına kırpılır.
function clampRange() {
  const r = ranges[state.sensor];
  if (!r) return;
  let f = state.custom ? Math.max(r[0], state.from) : r[0], t = state.custom ? Math.min(r[1], state.to) : r[1];
  if (!(f <= t)) { f = r[0]; t = r[1]; state.custom = false; }
  state.from = f; state.to = t;
}

function rangeRow() {
  const r = ranges[state.sensor], n = state.to - state.from + 1, full = state.from === r[0] && state.to === r[1];
  const opt = (sel, lo, hi) => {
    let o = '';
    for (let y = lo; y <= hi; y++) o += `<option${y === sel ? ' selected' : ''}>${y}</option>`;
    return o;
  };
  return `<div class="range" role="group" aria-label="Dönem seçimi">
      <span class="lbl">Dönem</span>
      <select id="rFrom" aria-label="Dönem başlangıç yılı">${opt(state.from, r[0], state.to)}</select>
      <span aria-hidden="true">–</span>
      <select id="rTo" aria-label="Dönem bitiş yılı">${opt(state.to, state.from, r[1])}</select>
      <small>${n} yıl</small>
      ${full ? '' : '<button class="link" id="rAll">Tüm yıllar</button>'}
    </div>
    <p class="range-note">Takvim, medyan, yüzdelik, zirveler ve CSV bu döneme göre hesaplanır.</p>`;
}

// "Bu ay tarihsel medyana göre nerede?" kartı: seçili ay (varsayılan: son veri ayı).
function readCard(years, val, label) {
  const y = state.year, m = state.month, rng = ranges[state.sensor];
  const r = reading(years, y, m, state.from, state.to);
  if (!r) return '';
  const latest = y === rng[1] && m === 11, lv = r.level ? LEVELS[r.level] : null;
  let src = `${label} ham sayı`;
  if (state.sensor === 'merged') {
    const reg = val && data.regions?.[val.region];
    src = sourceOf(y, m, data.meta.viirs_from) === 'viirs' ? 'VIIRS gözlemi' : `MODIS × ${reg ? dec(reg.factors[m], 2) : 'çarpan'}`;
  }
  const months = MONTHS.map((n, i) => `<option value="${i}"${i === m ? ' selected' : ''}>${n}</option>`).join('');
  return `<section class="read${r.level ? ' lv-' + r.level : ''}" aria-label="Seçili ayın dönem medyanına göre yeri">
      <div class="read-top">
        <select id="mSel" aria-label="Okunacak ay">${months}</select><b>${y}</b>
        ${latest ? '<span class="pill">son veri</span>' : '<button class="link" id="latest">Son aya dön</button>'}
        ${lv ? `<span class="lvl" title="Aynı takvim ayının dönemdeki diğer yıllarına göre: 25. yüzdeliğin altı düşük, 25–75 normal, 75–95 yüksek, 95 üstü olağanüstü.">${lv.mark ? lv.mark + ' ' : ''}${lv.label}</span>` : ''}
      </div>
      <p class="say">${sentence(r)}</p>
      <dl class="nums">
        <div><dt>Değer</dt><dd>${fmt(r.v)}</dd></div>
        <div><dt>Medyan ${state.from}–${state.to}</dt><dd>${fmt(r.med)}</dd></div>
        <div><dt>Yüzdelik</dt><dd>${r.pct == null ? '—' : '%' + Math.round(r.pct)}</dd></div>
        <div><dt>Kaynak</dt><dd>${src}</dd></div>
      </dl>
      <p class="fine">Veri ${MONTHS[11]} ${rng[1]} ile bitiyor. Takvimde bir hücreye ya da aylık sütuna tıklayarak başka bir ayı okuyun.</p>
    </section>`;
}

function caution(val) {
  if (state.sensor !== 'merged' || val?.confidence !== 'low') return '';
  const why = val.mean_annual < 100
    ? `Bu ilde yılda ortalama ${fmt(val.mean_annual)} tespit var; aylık sayılar güvenilir bir okuma için çok az.`
    : `Bu ilde doğrulama hatası yüksek (yıllık %${Math.round(val.annual_wape * 100)}); aylık okumalar güvenilir değil.`;
  return `<div class="caution" role="note"><b>Dikkat:</b> ${why} Yıllık toplamlara ve uzun dönem örüntüsüne bakın.</div>`;
}

function peaksView(years) {
  const { topYears, topMonths } = peaks(years, state.from, state.to);
  const list = (rows, attrs, name, on) => `<ol class="top">${rows.map((r, i) => `<li><button ${attrs(r)} class="${on(r) ? 'on' : ''}">
      <i>${i + 1}</i><span>${name(r)}</span><em>${fmt(r.at(-1))}</em><u style="width:calc((100% - 34px) * ${rows[0].at(-1) ? r.at(-1) / rows[0].at(-1) : 0})"></u></button></li>`).join('')}</ol>`;
  return `<h4>En yüksek yıllar · ${state.from}–${state.to}</h4><p>Yıllık toplam; tıklayınca o yıl seçilir.</p>
    ${list(topYears, ([y]) => `data-year="${y}"`, ([y]) => y, ([y]) => y === state.year)}
    <h4 class="gap">En yüksek aylar</h4><p>Tek tek ayların değeri; tıklayınca o ay okunur.</p>
    ${list(topMonths, ([y, m]) => `data-year="${y}" data-month="${m}"`, ([y, m]) => `${MONTHS[m]} ${y}`, ([y, m]) => y === state.year && m === state.month)}`;
}

function stepView(p, val) {
  const vy = viirsYear(), reg = val && data.regions?.[val.region];
  const fac = reg ? `<p class="fine">${vy} öncesi çarpan, ${val.region} bölgesi (${reg.name}), ay ay:</p>
    <div class="fac">${reg.factors.map((f, i) => `<span><i>${MONTHS[i].slice(0, 3)}</i>${dec(f)}</span>`).join('')}</div>` : '';
  const step = val?.step_raw != null ? `<p class="say">2009–2011'den 2012–2014'e ortalama yıllık değişim: ham seride ×${dec(val.step_raw, 2)},
    birleşmiş seride ×${dec(val.step_harmonized, 2)}. MODIS tek başına ×${dec(val.step_modis, 2)} gösteriyor; birleşmiş seri buna yakın olmalı.</p>` : '';
  return `<h4>Ham seri ve birleşmiş seri</h4>
    <p>Yıllık toplam. Ham seri ${vy}'ye kadar MODIS, sonra VIIRS sayar; VIIRS daha küçük ateşleri de gördüğü için ${vy}'de yapay bir sıçrama oluşur.
    Birleşmiş seri ${vy} öncesini MODIS × bölgesel aylık çarpanla VIIRS ölçeğine taşır.</p>
    <div class="key"><span><i class="raw"></i>Ham (MODIS → VIIRS)</span><span><i class="harm"></i>Birleşmiş</span>
      <span><i class="dot o"></i>MODIS × çarpan</span><span><i class="dot"></i>VIIRS gözlemi</span></div>
    ${stepChart(p, vy, state.year)}${step}${fac}`;
}

function renderPanel() {
  const panel = $('#panel'), body = $('#panelBody');
  const sensor = SENSORS.find((s) => s.key === state.sensor);
  if (!ranges[state.sensor]) {
    panel.hidden = false;
    body.innerHTML = head('Sensör', `${sensor.label} seri`) + `<div class="empty"><h4>Bu seri henüz eklenmedi</h4>
      <p>MODIS ve VIIRS'in uyumlaştırılmış tek serisi burada gösterilecek. Veri <code>atlas.json</code> içine
      <code>${sensor.key}</code> anahtarıyla eklendiğinde harita, takvim ve kıyas bu sekmede kendiliğinden dolar.</p>
      <div class="chips"><button data-sensor="modis">MODIS'e dön</button><button data-sensor="viirs">VIIRS'e dön</button></div></div>`;
    return;
  }
  if (!state.sel) { panel.hidden = true; return; }
  panel.hidden = false;
  const years = series(state.sel);
  if (!years || !years[state.year]) {
    body.innerHTML = head('İl', state.sel) + `<div class="empty"><h4>Bu il için henüz veri yok</h4>
      <p>Atlas şu an ${Object.keys(data.provinces).length} ili kapsıyor. Verisi olan illerden birine geçebilirsiniz:</p>${chips()}</div>`;
    return;
  }
  const { from, to } = state, ref = inRange(years, from, to);
  const row = years[state.year], n = sum(row), peak = row.indexOf(Math.max(...row));
  const totals = Object.values(ref).map(sum), med = quantile(totals, 0.5);
  const ratio = med > 0 ? n / med : 0;
  // Birleşmiş seride güven, bir yıl dışarıda bırakılarak ölçülen doğrulama hatasından gelir.
  const vAll = data.validation?.[state.sel];
  const val = state.sensor === 'merged' ? vAll : null;
  const level = val ? { low: 1, medium: 2, high: 3 }[val.confidence] : n >= 200 ? 3 : n >= 50 ? 2 : 1;
  const confTitle = val
    ? 'Bir yıl dışarıda bırakılarak ölçüldü (2012–2025). Yüksek: yıllık hata %15 ve altı, yılda ortalama 300 ve üzeri tespit. Düşük: hata %30 üzeri ya da yılda 100 altı tespit.'
    : "Yıllık tespit sayısına göre: 200 ve üzeri yüksek, 50–199 orta, 50'nin altı düşük.";
  const confText = `${val ? 'Doğrulama' : 'Örneklem'} güveni: <b>${['düşük', 'orta', 'yüksek'][level - 1]}</b>`
    + (val?.annual_wape != null ? ` · yıllık hata %${Math.round(val.annual_wape * 100)}` : '');
  const unit = state.sensor === 'merged' ? 'VIIRS-eşdeğeri tespit' : 'tespit sayısı';
  const sel = { year: state.year, month: state.month };

  let view = '';
  if (state.tab === 'months') {
    view = `<h4>${state.year} yılında aylara göre ateş tespiti</h4><p>${sensor.label} · ${unit} · sütuna tıklayınca o ay okunur</p>${monthBars(row, state.year, state.month)}`;
  } else if (state.tab === 'calendar') {
    view = `<h4>${from}–${to} takvimi</h4><p>Satır yıl, sütun ay; açık sarıdan koyu kırmızıya tespit artar. İşaretler ayın, dönemdeki aynı aya göre yerini gösterir. Hücreye tıklayınca o ay okunur.</p>
      ${calendarKey()}<p class="say small">${sentence(reading(years, state.year, state.month, from, to))}</p>${calendar(years, from, to, sel)}`;
  } else if (state.tab === 'compare') {
    const c = compare(ref, row, state.year);
    view = `<h4>${state.year}, ${from}–${to} medyanına göre</h4>
      <div class="key"><span><i></i>${state.year}</span><span><i class="m"></i>Medyan</span><span><i class="b"></i>Orta %50 aralığı</span></div>
      ${c.svg}<p class="say">${sentence(reading(years, state.year, peak, from, to))}</p>`;
  } else if (state.tab === 'peaks') {
    view = peaksView(years);
  } else {
    view = stepView(data.provinces[state.sel], vAll);
  }

  body.innerHTML = head(`İl · ${sensor.label} · ${state.year}`, state.sel) + `
    <div class="kpis">
      <div class="kpi hero"><span>Yıllık tespit</span><b>${fmt(n)}</b></div>
      <div class="kpi"><span>Zirve ay</span><b>${MONTHS[peak]}</b><small>${fmt(row[peak])} tespit</small></div>
      <div class="kpi"><span>Medyana göre</span><b>${ratio ? '×' + dec(ratio) : '—'}</b><small>medyan ${fmt(med)} · ${from}–${to}</small></div>
    </div>
    <div class="conf" title="${confTitle}">
      <span class="dots">${[1, 2, 3].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>
      <span>${confText}</span>
    </div>
    ${caution(val)}
    ${rangeRow()}
    ${readCard(years, val, sensor.label)}
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === state.tab}">${l}</button>`).join('')}</div>
    <div class="view" role="tabpanel">${view}</div>
    <div class="p-foot"><button class="btn" id="csv" title="Birleşmiş seri, ham MODIS ve VIIRS sayıları, ay medyanı, yüzdelik ve düzey · ${from}–${to}">CSV indir</button>${((note) => `<span title="${note}">${note}</span>`)(data.meta.sample ? 'Örnek veri: gerçek FIRMS sayıları değildir.' : (data.meta.notes?.[state.sensor] || data.meta.note || ''))}</div>`;
}

// CSV her zaman birleşmiş seriyi (ham sayılarla birlikte) seçili dönem için verir.
function downloadCsv() {
  const mr = ranges.merged, f = Math.max(state.from, mr[0]), t = Math.min(state.to, mr[1]);
  const lines = csvRows(state.sel, data.validation?.[state.sel]?.region || '', data.provinces[state.sel], f, t, data.meta.viirs_from);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `burncal_${low(state.sel)}_${f}-${t}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

// ── Olaylar ─────────────────────────────────────────────
function bind() {
  const panel = $('#panel');
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('button, .cell, [data-year], [data-month]');
    if (!t) return;
    if (t.classList.contains('close')) return ranges[state.sensor] ? select(null) : setSensor('modis');
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderPanel(); panel.querySelector(`[data-tab=${state.tab}]`).focus(); }
    else if (t.dataset.name) select(t.dataset.name);
    else if (t.dataset.sensor) setSensor(t.dataset.sensor);
    else if (t.id === 'csv') downloadCsv();
    else if (t.id === 'latest') { stopPlay(); state.month = 11; setYear(ranges[state.sensor][1]); }
    else if (t.id === 'rAll') { state.custom = false; clampRange(); renderPanel(); panel.querySelector('#rFrom')?.focus(); }
    else if (t.dataset.year || t.dataset.month) {
      stopPlay();
      if (t.dataset.month) state.month = +t.dataset.month;
      if (t.dataset.year) setYear(t.dataset.year); else renderPanel();
    }
  });
  panel.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'mSel') state.month = +e.target.value;
    else if (id === 'rFrom' || id === 'rTo') { state[id === 'rFrom' ? 'from' : 'to'] = +e.target.value; state.custom = true; clampRange(); }
    else return;
    renderPanel(); panel.querySelector('#' + id)?.focus();
  });
  panel.addEventListener('pointermove', (e) => {
    const t = e.target.closest('[data-tip]');
    t ? showTip(t.dataset.tip, e.clientX, e.clientY) : hideTip();
  });
  panel.addEventListener('pointerleave', hideTip);

  $('#rankList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) select(b.dataset.name); });
  $('#rankToggle').onclick = (e) => {
    const closed = $('#rank').classList.toggle('closed');
    e.target.textContent = closed ? '+' : '–'; e.target.setAttribute('aria-expanded', !closed);
  };
  $('#year').addEventListener('input', (e) => { stopPlay(); setYear(e.target.value); });
  $('#play').onclick = togglePlay;
  $('#zoomIn').onclick = () => map.zoomIn(); $('#zoomOut').onclick = () => map.zoomOut();
  $('#north').onclick = () => { stopOrbit(); map.easeTo({ bearing: 0, pitch: 0 }); };
  $('#home').onclick = () => select(null);

  const names = geo.features.map((f) => f.properties.name).sort((a, b) => a.localeCompare(b, 'tr'));
  $('#provList').innerHTML = names.map((n) => `<option value="${n}">`).join('');
  const search = $('#search');
  const pick = () => {
    const q = low(search.value.trim());
    if (!q) return;
    const hit = names.find((n) => low(n) === q) || names.find((n) => low(n).startsWith(q));
    if (hit) { select(hit); search.value = ''; search.blur(); }
  };
  search.addEventListener('change', pick);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });

  const lb = $('#layersBtn'), lm = $('#layersMenu');
  lb.onclick = () => { lm.hidden = !lm.hidden; lb.setAttribute('aria-expanded', !lm.hidden); };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.pop')) { lm.hidden = true; lb.setAttribute('aria-expanded', false); } });
  lm.addEventListener('change', (e) => {
    const g = e.target.dataset.layer, on = e.target.checked;
    if (g === 'terrain') return map.setTerrain(on ? { source: 'dem', exaggeration: 1.35 } : null);
    for (const id of LAYER_GROUPS[g]) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    if (g === 'points' && on) updatePoints();
  });

  // Oyun tarzı klavye: basılı tutulduğu sürece akıcı hareket.
  const held = new Set();
  let raf = 0, last = 0;
  const loop = (now) => {
    const dt = Math.min(50, now - last); last = now;
    const has = (...k) => k.some((x) => held.has(x));
    const dx = (has('d', 'arrowright') - has('a', 'arrowleft')) * dt * 0.7;
    const dy = (has('s', 'arrowdown') - has('w', 'arrowup')) * dt * 0.7;
    if (dx || dy) map.panBy([dx, dy], { animate: false });
    const rot = has('e') - has('q'), tilt = has('r') - has('f');
    if (rot) map.setBearing(map.getBearing() + rot * dt * 0.06);
    if (tilt) map.setPitch(Math.max(0, Math.min(78, map.getPitch() + tilt * dt * 0.05)));
    raf = held.size ? requestAnimationFrame(loop) : 0;
  };
  const MOVE = ['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.target.blur?.(); if (state.sel) select(null); return; }
    if (e.target.closest('input, select, [role=tablist]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (MOVE.includes(k)) {
      e.preventDefault(); stopOrbit(); held.add(k);
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    } else if (k === ' ' && !e.target.closest('button')) { e.preventDefault(); togglePlay(); }
    else if (k === 'h') select(null);
    else if (k === '+' || k === '=') map.zoomIn();
    else if (k === '-') map.zoomOut();
  });
  addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  addEventListener('blur', () => held.clear());
}

// ── Başlat ──────────────────────────────────────────────
async function main() {
  document.body.classList.add('booting');
  [data, geo] = await Promise.all(['data/atlas.json', 'data/tr-provinces.json'].map((u) => fetch(u).then((r) => r.json())));
  indexData();
  $('#sampleBadge').hidden = !data.meta.sample;
  const all = Object.values(ranges);
  $('#intro span').textContent = `MODIS · VIIRS · ${Math.min(...all.map((r) => r[0]))}–${Math.max(...all.map((r) => r[1]))}`;
  renderSensors();
  initMap();
  bind();
  setSensor(ranges.merged ? 'merged' : 'modis');
}
main().catch((err) => {
  console.error(err);
  document.body.classList.remove('booting');
  $('#intro').innerHTML = `<div><h1>Yüklenemedi</h1><span>${err.message}</span></div>`;
});
