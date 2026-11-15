import { t as msg, displayText, locale } from './i18n.js?v=20261115-i18n';
// Haritada alan çizme (serbest el, daire, çokgen) ve çizilen alanın serisini nokta dosyalarından kurma.
const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
// Web Mercator y: harita kenarları bu düzlemde düz çizer; içinde mi testi de aynı düzlemde yapılır.
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));

export function haversine([lo1, la1], [lo2, la2]) {
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Küresel çokgen alanı (km²). Kendini kesen serbest çizimde yaklaşık değerdir.
export function areaKm2(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    s += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((s * R * R) / 2);
}

const close = (ring) => {
  const a = ring[0], b = ring.at(-1);
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

const MODES = {
  free: 'Basılı tutup alanın çevresini çizin, bırakınca alan kapanır.',
  circle: 'Şeklin bir ucuna basın ve çapraz sürükleyin; bırakınca elips kapanır. Tam daire için Shift’e basılı tutun.',
  poly: 'Köşeleri tek tek tıklayın. Bitirmek için ilk noktaya tıklayın, çift tıklayın ya da Enter’a basın.',
};

// Çizim aracı. Etkinken harita kaydırma/döndürme kapalıdır; bitince eski haline döner.
export class DrawTool {
  refreshHint() { if (this.active) this.onStatus(displayText(MODES[this.mode])); }
  constructor(map, { onDone, onStatus }) {
    this.map = map; this.onDone = onDone; this.onStatus = onStatus;
    this.active = false; this.mode = 'free'; this.reset();
    const el = map.getCanvasContainer();
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => { if (this.active) { this.reset(); this.render(); } });
    el.addEventListener('dblclick', (e) => { if (this.active && this.mode === 'poly') { e.preventDefault(); this.finishPoly(); } });
    addEventListener('keydown', (e) => this.key(e), true);
  }
  reset() { this.pts = []; this.drag = false; this.center = null; this.hover = null; this.downAt = null; }
  busy() { return this.active && (this.pts.length > 0 || this.drag); }
  start(mode = this.mode) {
    this.mode = mode; this.reset();
    if (!this.active) {
      this.active = true;
      const m = this.map;
      this.saved = ['dragPan', 'dragRotate', 'doubleClickZoom', 'touchZoomRotate', 'boxZoom'].filter((h) => m[h].isEnabled());
      for (const h of this.saved) m[h].disable();
      m.getCanvasContainer().classList.add('drawing');
    }
    this.render(); this.onStatus(displayText(MODES[mode]));
  }
  stop() {
    if (!this.active) return;
    this.active = false; this.reset(); this.render();
    for (const h of this.saved || []) this.map[h].enable();
    this.map.getCanvasContainer().classList.remove('drawing');
  }
  pos(e) {
    const r = this.map.getCanvasContainer().getBoundingClientRect(), p = [e.clientX - r.left, e.clientY - r.top];
    const ll = this.map.unproject(p);
    return { p, ll: [ll.lng, ll.lat] };
  }
  down(e) {
    if (!this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const q = this.pos(e);
    this.downAt = q.p;
    if (this.mode === 'free') { this.pts = [q]; this.drag = true; }
    else if (this.mode === 'circle') { this.center = q; this.edge = q; this.shift = e.shiftKey; this.drag = true; }
    e.target.setPointerCapture?.(e.pointerId);
  }
  move(e) {
    if (!this.active) return;
    const q = this.pos(e);
    if (this.mode === 'free' && this.drag) {
      const l = this.pts.at(-1).p;
      if ((q.p[0] - l[0]) ** 2 + (q.p[1] - l[1]) ** 2 >= 16) { this.pts.push(q); this.render(); }
    } else if (this.mode === 'circle' && this.drag) {
      this.edge = q; this.shift = e.shiftKey; this.render();
      const { w, h } = this.ellipseSize();
      const km = (v) => v.toLocaleString(locale(), { maximumFractionDigits: 1 });
      this.onStatus(msg("width.km.height.km", [km(w), km(h)]));
    } else if (this.mode === 'poly' && this.pts.length) { this.hover = q; this.render(); }
  }
  up(e) {
    if (!this.active) return;
    const q = this.pos(e);
    if (this.mode === 'free' && this.drag) {
      this.drag = false;
      if (this.pts.length < 6) { this.reset(); this.render(); return this.onStatus(`${msg("drawing.too.short")} ` + displayText(MODES.free)); }
      // Uzun serbest çizimler seyreltilir: birkaç yüz köşe yeterli, hesap hızlı kalır.
      const k = Math.ceil(this.pts.length / 400);
      return this.finish(this.pts.filter((_, i) => i % k === 0).map((v) => v.ll));
    }
    if (this.mode === 'circle' && this.drag) {
      this.drag = false;
      this.edge = q; this.shift = e.shiftKey;
      const ring = this.ellipseRing(), { w, h } = this.ellipseSize();
      if (!ring || w < 1 || h < 1) { this.reset(); this.render(); return this.onStatus(`${msg("shape.too.small")} ` + displayText(MODES.circle)); }
      return this.finish(ring, { w, h });
    }
    if (this.mode === 'poly') {
      const d = this.downAt;
      if (!d || (q.p[0] - d[0]) ** 2 + (q.p[1] - d[1]) ** 2 > 36) return;   // sürükleme köşe eklemez
      const first = this.pts[0]?.p, last = this.pts.at(-1)?.p;
      if (this.pts.length >= 3 && (q.p[0] - first[0]) ** 2 + (q.p[1] - first[1]) ** 2 <= 144) return this.finishPoly();
      if (last && (q.p[0] - last[0]) ** 2 + (q.p[1] - last[1]) ** 2 <= 16) return;   // çift tıklamanın ikinci tıklaması
      this.pts.push(q); this.render();
      this.onStatus(this.pts.length < 3 ? displayText(MODES.poly) : msg("vertices.click.the.first.vertex", [this.pts.length]));
    }
  }
  // İlk basılan nokta ile imleç, elipsin çevrelendiği kutunun karşılıklı köşeleridir (ekran düzleminde).
  ellipseBox() {
    const [x0, y0] = this.center.p, [x1, y1] = this.edge.p;
    let rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    if (this.shift) rx = ry = Math.max(rx, ry);
    const sx = x1 >= x0 ? 1 : -1, sy = y1 >= y0 ? 1 : -1;
    return { cx: x0 + sx * rx, cy: y0 + sy * ry, rx, ry };
  }
  ellipseRing(n = 96) {
    const { cx, cy, rx, ry } = this.ellipseBox();
    if (rx < 3 || ry < 3) return null;
    const ring = [];
    for (let i = 0; i <= n; i++) {
      const a = (2 * Math.PI * i) / n, ll = this.map.unproject([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      ring.push([ll.lng, ll.lat]);
    }
    return ring;
  }
  ellipseSize() {
    const { cx, cy, rx, ry } = this.ellipseBox(), u = (x, y) => { const l = this.map.unproject([x, y]); return [l.lng, l.lat]; };
    return { w: haversine(u(cx - rx, cy), u(cx + rx, cy)), h: haversine(u(cx, cy - ry), u(cx, cy + ry)) };
  }
  finishPoly() {
    if (this.pts.length < 3) return this.onStatus(msg("a.polygon.needs.at.least"));
    this.finish(this.pts.map((v) => v.ll));
  }
  finish(ring, extra = {}) {
    ring = close(ring);
    this.reset(); this.render();
    this.onDone({ ring, km2: areaKm2(ring), mode: this.mode, ...extra });
  }
  key(e) {
    if (!this.active || e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'Escape' && this.busy()) { e.stopImmediatePropagation(); this.reset(); this.render(); this.onStatus(displayText(MODES[this.mode])); }
    else if (e.key === 'Enter' && this.mode === 'poly') { e.stopImmediatePropagation(); this.finishPoly(); }
    else if (e.key === 'Backspace' && this.mode === 'poly' && this.pts.length) { e.preventDefault(); e.stopImmediatePropagation(); this.pts.pop(); this.render(); }
  }
  render() {
    const src = this.map.getSource('draft');
    if (!src) return;
    const f = [];
    let line = [];
    if (this.mode === 'circle' && this.center && this.edge) {
      line = this.ellipseRing() || [];
    } else {
      line = this.pts.map((v) => v.ll);
      if (this.mode === 'poly') {
        for (const v of this.pts) f.push({ type: 'Feature', properties: { k: 'v' }, geometry: { type: 'Point', coordinates: v.ll } });
        if (this.hover && line.length) line = [...line, this.hover.ll];
      }
    }
    if (line.length >= 3) f.push({ type: 'Feature', properties: { k: 'a' }, geometry: { type: 'Polygon', coordinates: [close(line)] } });
    if (line.length >= 2) f.push({ type: 'Feature', properties: { k: 'l' }, geometry: { type: 'LineString', coordinates: line } });
    src.setData({ type: 'FeatureCollection', features: f });
  }
}

// ── Çizilen alanın serisi ───────────────────────────────
// Ham sayılar (MODIS, VIIRS) doğrudan alandaki noktaların sayımıdır. Birleşmiş değer için yeni bir
// çarpan hesaplanmaz: her ilin birleşmiş aylık değeri, o ilin o ayki ham tespitlerinden alana düşen pay
// kadar alınıp toplanır. Böylece bir ilin tamamı çizilirse il serisi birebir çıkar; Terra-tek dönem ve
// uydu kesintisi düzeltmeleri de illerdeki gibi korunur.
const CUM = [[0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]];
const monthOf = (y, doy) => {
  const c = CUM[+(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))];
  let m = 11;
  while (m > 0 && doy <= c[m]) m--;
  return [m, doy - c[m]];
};

export function drawnArea(ring, byYear, ctx) {
  const { data, names, viirsFrom, LM, LD, lcGroup } = ctx;
  const xs = ring.map((p) => p[0] * 1000), ys = ring.map((p) => mercY(p[1]));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  [x0, x1, y0, y1] = [x0 * 1000, x1 * 1000, y0 * 1000, y1 * 1000];
  const n = xs.length;
  const inside = (x, yl) => {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if ((ys[i] > yl) !== (ys[j] > yl) && x < ((xs[j] - xs[i]) * (yl - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c;
    }
    return c;
  };
  // cnt[s][il][yıl] = 12 aylık sayım; mtd[s][il][yıl] = süren ayın ilk LD günü.
  const cnt = { modis: {}, viirs: {} }, mtd = { modis: {}, viirs: {} }, lc = {}, hits = {};
  for (const [yk, d] of Object.entries(byYear)) {
    const y = +yk, st = d.stride || 5;
    hits[y] = { stride: st };
    lc[y] = new Array(48).fill(0);
    for (const s of ['modis', 'viirs']) {
      const a = d[s] || [], kept = [];
      for (let i = 0; i < a.length; i += st) {
        const x = a[i], yy = a[i + 1];
        if (x < x0 || x > x1 || yy < y0 || yy > y1 || !inside(x, mercY(yy / 1000))) continue;
        for (let k = 0; k < st; k++) kept.push(a[i + k]);
        const p = a[i + 4], [m, dom] = monthOf(y, a[i + 2]);
        ((cnt[s][p] ||= {})[y] ||= new Array(12).fill(0))[m]++;
        if (m === LM && dom <= LD) (mtd[s][p] ||= {})[y] = ((mtd[s][p] ||= {})[y] || 0) + 1;
        if (st > 5 && lcGroup[a[i + 5]] != null) lc[y][m * 4 + lcGroup[a[i + 5]]]++;
      }
      hits[y][s] = kept;
    }
  }
  const touched = [...new Set([...Object.keys(cnt.modis), ...Object.keys(cnt.viirs)].map(Number))];
  const [vy, vm] = viirsFrom.split('-').map(Number);
  const srcOf = (y, m) => (y * 12 + m >= vy * 12 + vm - 1 ? 'viirs' : 'modis');
  const tmpl = Object.values(data.provinces)[0];
  const share = (p, s, y, m) => {
    const tot = data.provinces[names[p]]?.[s]?.[y]?.[m];
    return tot > 0 ? (cnt[s][p]?.[y]?.[m] || 0) / tot : null;
  };
  const out = { modis: {}, viirs: {}, merged: {} };
  for (const key of ['modis', 'viirs', 'merged']) {
    for (const [yk, trow] of Object.entries(tmpl[key] || {})) {
      const y = +yk;
      out[key][y] = trow.map((t, m) => {
        if (t == null) return null;
        if (key !== 'merged') { let v = 0; for (const p of touched) v += cnt[key][p]?.[y]?.[m] || 0; return v; }
        const s = srcOf(y, m), o = s === 'viirs' ? 'modis' : 'viirs';
        let v = 0;
        for (const p of touched) {
          const h = data.provinces[names[p]]?.merged?.[y]?.[m];
          if (!h) continue;
          v += h * (share(p, s, y, m) ?? share(p, o, y, m) ?? 0);
        }
        return Math.round(v * 10) / 10;
      });
    }
  }
  // Süren ayın kıyası (her yılın 1–LD günleri), il paneliyle aynı biçimde.
  const P = data.partial, partial = { mtd: [], mtd_modis: [], mtd_viirs: [] };
  P.years.forEach((y, i) => {
    let a = 0, b = 0, h = 0;
    for (const p of touched) {
      const cm = mtd.modis[p]?.[y] || 0, cv = mtd.viirs[p]?.[y] || 0;
      a += cm; b += cv;
      const tot = (s) => P[`mtd_${s}`]?.[names[p]]?.[i];
      const s = srcOf(y, LM), mine = s === 'viirs' ? cv : cm, alt = s === 'viirs' ? cm : cv;
      const hm = P.mtd?.[names[p]]?.[i] || 0, t = tot(s), ta = tot(s === 'viirs' ? 'modis' : 'viirs');
      if (hm) h += hm * (t > 0 ? mine / t : ta > 0 ? alt / ta : 0);
    }
    partial.mtd_modis.push(a); partial.mtd_viirs.push(b); partial.mtd.push(Math.round(h * 10) / 10);
  });
  // İllere göre dağılım (VIIRS yılları; yoksa MODIS): yöntem notunda gösterilir.
  const byProv = touched.map((p) => {
    let v = 0;
    for (const s of ['viirs', 'modis']) for (const row of Object.values(cnt[s][p] || {})) v += row.reduce((x, y) => x + y, 0);
    return [names[p], v];
  }).sort((a, b) => b[1] - a[1]);
  return { series: out, partial, lc, hits, touched, byProv };
}
