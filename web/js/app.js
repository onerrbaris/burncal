/* global maplibregl */
import { buildStyle, LAYER_GROUPS, RAMP } from './mapstyle.js';
import { MONTHS, fmt, quantile, monthBars, calendar, compare } from './charts.js';

const $ = (s) => document.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FAST = REDUCED || new URLSearchParams(location.search).has('hizli');
const TR_BOUNDS = [[25.6, 35.7], [44.9, 42.2]];
const up = (s) => s.toLocaleUpperCase('tr');
const low = (s) => s.toLocaleLowerCase('tr');

// Sekmeler. "merged" verisi atlas.json'a eklendiğinde sekme kendiliğinden dolar.
const SENSORS = [
  { key: 'modis', label: 'MODIS' },
  { key: 'viirs', label: 'VIIRS' },
  { key: 'merged', label: 'Birleşmiş' },
];
const TABS = [['months', 'Aylar'], ['calendar', 'Takvim'], ['compare', 'Kıyas']];

const state = { sensor: 'merged', year: null, sel: null, tab: 'months', playing: false };
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
  if (FAST) map.jumpTo(cam);
  else map.flyTo({ ...cam, duration, curve: 1.5, essential: true });
}

function paintMap() {
  const mx = maxTotal[state.sensor];
  for (const f of geo.features) {
    const name = f.properties.name, t = mx ? total(name) : null;
    map.setFeatureState({ source: 'provinces', id: name },
      { v: t == null ? -1 : Math.sqrt(t / mx), sel: name === state.sel });
  }
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
    center: [24, 28], zoom: 1.5, pitch: 0, minZoom: 1.2, maxZoom: 17, maxPitch: 78,
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
  $('#legend').innerHTML = mx ? `<b>Yıllık tespit · il</b><div class="bar" style="background:linear-gradient(90deg,${RAMP.join(',')})"></div>
    <div class="ends"><span>0</span><span>${fmt(mx / 4)}</span><span>${fmt(mx)}</span></div>` : '';
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
  if (!years) {
    body.innerHTML = head('İl', state.sel) + `<div class="empty"><h4>Bu il için henüz veri yok</h4>
      <p>Atlas şu an ${Object.keys(data.provinces).length} ili kapsıyor. Verisi olan illerden birine geçebilirsiniz:</p>${chips()}</div>`;
    return;
  }
  const row = years[state.year], n = sum(row), peak = row.indexOf(Math.max(...row));
  const totals = Object.values(years).map(sum), med = quantile(totals, 0.5);
  const ratio = med > 0 ? n / med : 0;
  // Birleşmiş seride güven, bir yıl dışarıda bırakılarak ölçülen doğrulama hatasından gelir.
  const val = state.sensor === 'merged' ? data.validation?.[state.sel] : null;
  const level = val ? { low: 1, medium: 2, high: 3 }[val.confidence] : n >= 200 ? 3 : n >= 50 ? 2 : 1;
  const confTitle = val
    ? 'Bir yıl dışarıda bırakılarak ölçüldü (2012–2025). Yüksek: yıllık hata %15 ve altı, yılda ortalama 300 ve üzeri tespit. Düşük: hata %30 üzeri ya da yılda 100 altı tespit.'
    : "Yıllık tespit sayısına göre: 200 ve üzeri yüksek, 50–199 orta, 50'nin altı düşük.";
  const confText = `${val ? 'Doğrulama' : 'Örneklem'} güveni: <b>${['düşük', 'orta', 'yüksek'][level - 1]}</b>`
    + (val?.annual_wape != null ? ` · yıllık hata %${Math.round(val.annual_wape * 100)}` : '');
  const unit = state.sensor === 'merged' ? 'VIIRS-eşdeğeri tespit' : 'tespit sayısı';
  const nYears = totals.length;

  let view = '';
  if (state.tab === 'months') {
    view = `<h4>${state.year} yılında aylara göre ateş tespiti</h4><p>${sensor.label} · ${unit}</p>${monthBars(row, state.year)}`;
  } else if (state.tab === 'calendar') {
    view = `<h4>${nYears} yılın takvimi</h4><p>Satır yıl, sütun ay; koyudan açığa tespit artar. Hücreye tıklayarak yılı seçin.</p>${calendar(years, state.year)}`;
  } else {
    const c = compare(years, state.year);
    const col = Object.values(years).map((r) => r[peak]).sort((a, b) => b - a);
    const place = col.indexOf(row[peak]) + 1;
    const r = c.med[peak] > 0 ? row[peak] / c.med[peak] : 0;
    const k = !r ? '' : Math.abs(r - 1) < 0.05 ? ', medyan düzeyinde' : `, medyanın ${r.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} katı`;
    view = `<h4>${state.year}, ${nYears} yılın medyanına göre</h4>
      <div class="key"><span><i></i>${state.year}</span><span><i class="m"></i>Medyan</span><span><i class="b"></i>Orta %50 aralığı</span></div>
      ${c.svg}<p class="say">${MONTHS[peak]} ${state.year}: ${nYears} yıl içindeki ${place}. en yüksek ${MONTHS[peak]}${k}.</p>`;
  }

  body.innerHTML = head(`İl · ${sensor.label} · ${state.year}`, state.sel) + `
    <div class="kpis">
      <div class="kpi hero"><span>Yıllık tespit</span><b>${fmt(n)}</b></div>
      <div class="kpi"><span>Zirve ay</span><b>${MONTHS[peak]}</b><small>${fmt(row[peak])} tespit</small></div>
      <div class="kpi"><span>Medyana göre</span><b>${ratio ? '×' + ratio.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}</b><small>medyan ${fmt(med)}</small></div>
    </div>
    <div class="conf" title="${confTitle}">
      <span class="dots">${[1, 2, 3].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>
      <span>${confText}</span>
    </div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === state.tab}">${l}</button>`).join('')}</div>
    <div class="view" role="tabpanel">${view}</div>
    <div class="p-foot"><button class="btn" id="csv">CSV indir</button><span>${data.meta.sample ? 'Örnek veri: gerçek FIRMS sayıları değildir.' : (data.meta.notes?.[state.sensor] || data.meta.note || '')}</span></div>`;
}

function downloadCsv() {
  const years = series(state.sel);
  const lines = ['il,sensor,yil,ay,tespit'];
  for (const [y, row] of Object.entries(years)) row.forEach((v, i) => lines.push(`${state.sel},${state.sensor},${y},${i + 1},${v}`));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `ates-atlasi_${low(state.sel)}_${state.sensor}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
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
    const t = e.target.closest('button, .cell');
    if (!t) return;
    if (t.classList.contains('close')) return ranges[state.sensor] ? select(null) : setSensor('modis');
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderPanel(); panel.querySelector(`[data-tab=${state.tab}]`).focus(); }
    else if (t.dataset.name) select(t.dataset.name);
    else if (t.dataset.sensor) setSensor(t.dataset.sensor);
    else if (t.dataset.year) { stopPlay(); setYear(t.dataset.year); }
    else if (t.id === 'csv') downloadCsv();
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
    if (e.target.closest('input, [role=tablist]') || e.ctrlKey || e.metaKey || e.altKey) return;
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
