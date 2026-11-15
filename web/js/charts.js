import { t as msg, displayText, locale, ordinal } from './i18n.js?v=20261115-land-year';
// Panel grafikleri: elle yazılmış SVG. Tek ölçek, tek renk tonu (kor), nötr mürekkep.
// Bu dosyadaki istatistik işlevleri (inRange, reading, sentence, peaks, csvRows, hotspotRows) saf işlevlerdir;
// tarayıcı dışında Node ile de sınanabilir.
import { RAMP } from './mapstyle.js?v=20261115-land-year';

// Ay dizileri canlı dışa aktarımdır; dil değişiminde mevcut seçim aynı ay indeksinde kalır.
export let MONTHS, MON3;
let M1;
function localizeMonths() {
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 1)));
  const format = (width) => new Intl.DateTimeFormat(locale(), { month: width, timeZone: 'UTC' });
  MONTHS = months.map(format('long').format);
  MON3 = months.map(format('short').format);
  M1 = MONTHS.map((month) => month[0]);
}
localizeMonths();
globalThis.addEventListener?.('burncal:language', localizeMonths);
export const fmt = (n) => Math.round(n).toLocaleString(locale());
const dec = (n, d = 1) => n.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sum = (a) => a.reduce((x, y) => x + (y ?? 0), 0);

export function quantile(arr, q) {
  const a = arr.filter((v) => v != null).sort((x, y) => x - y);
  if (!a.length) return 0;
  const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return a[lo] + (a[hi] - a[lo]) * (p - lo);
}

// ── Dönem ve ay okuması ─────────────────────────────────
// Düzey eşikleri: aynı takvim ayının dönemdeki diğer yıllarına göre yüzdelik.
export const LEVELS = {
  verylow: { label: 'çok düşük', mark: '▼' },
  low: { label: 'düşük', mark: '▾' },
  normal: { label: 'normal', mark: '' },
  high: { label: 'yüksek', mark: '▴' },
  extreme: { label: 'olağanüstü', mark: '▲' },
  sparse: { label: 'az tespit', mark: '' },
};
const SPARSE = 5;   // bu sayının altındaki değerler, dönemin çoğu da böyleyse, yüzdelikle okunmaz
const MIN_REF = 3;  // karşılaştırma için en az bu kadar başka yıl
export const LOW_MIN = 20;
// Takvim rengi: ayın aynı takvim ayının diğer yıllarına göre yüzdeliği, yumuşak ve sürekli bir geçişle
// (mavi az, bej tipik, kırmızı fazla). İşaretler (üçgenler) yüzdelikten değil kat sayısından gelir: bkz. MARK.
export const CAL_STOPS = [[0, '#3f73d6'], [25, '#8fb1e6'], [50, '#e2dac8'], [75, '#f0a16e'], [100, '#cf4a2f']];
export function calColor(pct) {
  const p = Math.max(0, Math.min(100, pct));
  for (let i = 0; i < CAL_STOPS.length - 1; i++) {
    const [p0, c0] = CAL_STOPS[i], [p1, c1] = CAL_STOPS[i + 1];
    if (p <= p1) return mix(c0, c1, (p - p0) / (p1 - p0));
  }
  return CAL_STOPS[CAL_STOPS.length - 1][1];
}
export const CAL_CLASSES = [
  { max: 5 },          // çok düşük  büyük ▼
  { max: 25 },         // düşük      küçük ▼
  { max: 45 },         // biraz düşük
  { max: 55 },         // tipik
  { max: 75 },         // biraz yüksek
  { max: 95 },         // yüksek     küçük ▲
  { max: Infinity },   // olağanüstü büyük ▲
];
// Az tespit ya da kıyas yok: nötr, çok soluk (yüksek/düşük denmez).
export const CAL_SPARSE = '#e2dac8';
export function calClass(pct) {
  // Sınırlar düzeylerle aynı: <5, <25, <45, <=55, <=75, <=95, >95.
  if (pct < 5) return 0;
  if (pct < 25) return 1;
  if (pct < 45) return 2;
  if (pct <= 55) return 3;
  if (pct <= 75) return 4;
  if (pct <= 95) return 5;
  return 6;
}

// Takvim işareti büyüklükten: kat = ay ÷ tipik (medyan). Yüzdelik %95'te tavan yapar (3 kat da 83 kat da
// "olağanüstü"); kat sayısının tavanı yok. Yalnızca fazlası işaretlenir: düşüş en çok %100'dür, olay sayılmaz.
// Küçük sayılarda sahte kat çıkmasın diye mutlak alt sınırlar var.
export const MARK = {
  minMed: 3,          // tipik değer bunun altındaysa kat hesaplanmaz (sentence ile aynı)
  minV: LOW_MIN,      // işaret için en az bu kadar tespit
  tiers: [2, 5, 20],  // ×2 küçük, ×5 orta, ×20 büyük üçgen
  topN: 5,            // en büyük bu kadar ay hücre içinde "×83" ile yazılır
  topMinQ: 5,         // ...ama en az ×5
  topMinV: 100,       // ...ve en az bu kadar tespit
};
export function markTier(r) {
  if (!r || r.pct == null || r.small || r.level === 'sparse' || r.med < MARK.minMed || r.v < MARK.minV) return 0;
  const q = r.v / r.med;
  return q >= MARK.tiers[2] ? 3 : q >= MARK.tiers[1] ? 2 : q >= MARK.tiers[0] ? 1 : 0;
}
const fmtQ = (q) => `×${q < 10 ? dec(q) : fmt(q)}`;

export function inRange(years, from, to) {
  const out = {};
  for (const [y, row] of Object.entries(years || {})) if (+y >= from && +y <= to) out[y] = row;
  return out;
}

// Bir ayın (y, m: 0–11) dönemdeki aynı takvim ayına göre yeri. `years` içinde süren ay için
// bütün yılların aynı günleri bulunabilir (app.js: cmpYears), böylece yarım ay yarım aylarla kıyaslanır.
export function reading(years, y, m, from, to) {
  const v = years?.[y]?.[m];
  if (v == null) return null;
  const inR = +y >= from && +y <= to;
  const rows = Object.entries(inRange(years, from, to)).filter(([, r]) => r[m] != null);
  const all = rows.map(([, r]) => r[m]);
  const ref = rows.filter(([yy]) => +yy !== +y).map(([, r]) => r[m]);
  const n = ref.length, med = quantile(all.length ? all : ref, 0.5);
  const base = { v, y: +y, m, from, to, n, med, inRange: inR };
  if (n < MIN_REF) return { ...base, level: null, pct: null, short: true };
  const below = ref.filter((x) => x < v).length, eq = ref.filter((x) => x === v).length;
  const pct = (100 * (below + eq / 2)) / n;
  const sparse = v < SPARSE && quantile(ref, 0.75) < SPARSE;
  // Küçük ay: ay da tipik değeri de LOW_MIN altında. Yüzdelik tutulur (takvimde yarım güç renk), ama
  // gürültü olduğu için yüksek/düşük denmez (il ölçeğinde aylık hata ~%38).
  const small = !sparse && v < LOW_MIN && med < LOW_MIN;
  const level = sparse || small ? 'sparse' : pct < 5 ? 'verylow' : pct < 25 ? 'low' : pct <= 75 ? 'normal' : pct <= 95 ? 'high' : 'extreme';
  return { ...base, pct: sparse ? null : pct, level, small, rank: 1 + ref.filter((x) => x > v).length, below, eq };
}

// Tipik değere (medyan) göre kısa ifade: 2 kat ve üstü "X katı", altı "%X yüksek/düşük",
// ±%5 içinde "normal düzeyde". Çağıran, medyan çok küçükken (<3) bunu kullanmaz.
export function vsTypical(q) {
  if (Math.abs(q - 1) < 0.05) return msg("within.the.normal.range");
  if (q >= 2) return msg("times.the.typical.value", [q < 10 ? dec(q) : fmt(q)]);
  return msg(q > 1 ? "pct.above.typical" : "pct.below.typical", [Math.round(Math.abs(q - 1) * 100)]);
}

// Tek cümlelik Türkçe okuma, ör. "Ağustos 2021: 25 yılın en yükseği, tipik değerin 14 katı."
// `label` verilirse ay adı yerine o kullanılır (ör. "1–13 Kasım 2026").
// bare: başlıksız (takvim şeridinde başlık ayrı yazılır).
export function sentence(r, label, bare = false) {
  if (!r) return '';
  const M = MONTHS[r.m], head = bare ? '' : `${label || `${M} ${r.y}`}: `;
  if (r.short) return msg("detections.select.at.least.years", [head, fmt(r.v), MIN_REF + 1]);
  if (r.small) return msg("few.detections.both.below", [head, fmt(r.v), fmt(r.med), LOW_MIN]);
  if (r.level === 'sparse') return msg("detections.too.few.detections.in", [head, fmt(r.v), M]);
  let place;
  const per = `${r.from}–${r.to}`;
  if (r.inRange) {
    const N = r.n + 1;
    if (r.rank === 1 && !r.eq) place = msg("highest.in.years", [N]);
    else if (r.rank === 1) place = msg("tied.for.highest.in.years", [N]);
    else if (!r.below && !r.eq) place = msg("lowest.in.years", [N]);
    else place = msg("ranks.out.of.years", [N, ordinal(r.rank)]);
  } else {
    if (r.rank === 1 && !r.eq) place = msg("higher.than.every.in", [per, M]);
    else if (!r.below && !r.eq) place = msg("lower.than.every.in", [per, M]);
    else place = msg("exceeded.of.values.for.during", [per, r.n, M, r.below]);
  }
  let k;
  if (r.med < 3) k = msg("typical.value2", [fmt(r.med)]);   // küçük medyana oran ("∞ katı") verilmez
  else {
    const q = r.v / r.med;
    k = vsTypical(q) + (q < 0.95 ? ` (${msg("typical.value2", [fmt(r.med)])})` : '');
  }
  return `${head}${place}, ${k}.`;
}

// Dönemin en yüksek yılları (totalOf ile, sezon penceresine göre) ve ayları (yalnızca penceredeki aylar).
export function peaks(years, from, to, win, totalOf, n = 5) {
  const ys = Object.entries(inRange(years, from, to));
  const topYears = ys.map(([y]) => [+y, totalOf(+y)]).sort((a, b) => b[1] - a[1]).slice(0, n);
  const topMonths = ys.flatMap(([y, r]) => r.map((v, m) => [+y, m, v]))
    .filter(([, m, v]) => v != null && m >= win[0] && m <= win[1]).sort((a, b) => b[2] - a[2]).slice(0, n);
  return { topYears, topMonths };
}

// Ay kaynağı: viirsFrom ("2012-02") ve sonrası VIIRS gözlemi, öncesi MODIS × çarpan.
export const sourceOf = (y, m, viirsFrom) => {
  const [vy, vm] = viirsFrom.split('-').map(Number);
  return y * 12 + m >= vy * 12 + vm - 1 ? 'viirs' : 'modis_scaled';
};

const csvq = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);
const num = (v) => (v == null ? '' : Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

const CSV_HEAD = 'province,region,selected_series,year,month,value,source,complete,raw_modis,raw_viirs,median,percentile,level';
// Seçili seri (sensor: merged | modis | viirs) + ham sayılar; dönem yılları ve sezon penceresindeki aylar.
// value, median, percentile ve level aynı seriden gelir (rd seçili seriyle okur; süren ay bütün yılların
// aynı günleriyle). complete=0: ay henüz bitmedi.
export function csvRows(name, region, p, from, to, viirsFrom, win, rd, partial, sensor = 'merged') {
  const lines = [CSV_HEAD];
  for (const [y, row] of Object.entries(inRange(p[sensor] || {}, from, to))) {
    row.forEach((v, m) => {
      if (v == null || m < win[0] || m > win[1]) return;
      const r = rd(+y, m) || {};
      const src = sensor === 'merged' ? sourceOf(+y, m, viirsFrom) : `${sensor}_raw`;
      lines.push([csvq(name), region, sensor, y, m + 1, num(v), src, partial(+y, m) ? 0 : 1,
        num(p.modis?.[y]?.[m]), num(p.viirs?.[y]?.[m]), num(r.med),
        r.pct == null ? '' : Math.round(r.pct), r.level || ''].join(','));
    });
  }
  return lines;
}

// Ham tespit listesi: points/{yıl}.json dosyalarındaki 5'li gruplar (x, y, gün, frp, il).
const HS_HEAD = 'date,latitude,longitude,sensor,frp_mw,province,processing,land_cover';
const SENSOR = { modis: 'MODIS (Terra/Aqua)', viirs: 'VIIRS S-NPP' };
// nrtFrom: {modis: '2026-09', viirs: '2026-08'} -> o aydan itibaren NRT (yakın gerçek zamanlı), öncesi SP (arşiv).
// lcLabels: arazi sınıfı adları (landcover.json); nokta dosyası 6'lı ise 6. değer sınıf numarasıdır.
export function hotspotRows(byYear, provIdx, name, from, to, win, nrtFrom = {}, lcLabels = []) {
  const lines = [HS_HEAD], q = csvq(name);
  for (let y = from; y <= to; y++) {
    const d = byYear[y];
    if (!d) continue;
    const rows = [];
    for (const s of ['viirs', 'modis']) {
      const a = d[s] || [], st = d.stride || 5;
      for (let i = 0; i < a.length; i += st) {
        if (a[i + 4] !== provIdx) continue;
        const dt = new Date(Date.UTC(y, 0, a[i + 2])), m = dt.getUTCMonth();
        if (m < win[0] || m > win[1]) continue;
        const iso = dt.toISOString().slice(0, 10), nrt = nrtFrom[s] && iso.slice(0, 7) >= nrtFrom[s];
        rows.push([iso, (a[i + 1] / 1000).toFixed(3), (a[i] / 1000).toFixed(3), SENSOR[s], a[i + 3], q, nrt ? 'NRT' : 'SP',
          st > 5 ? csvq(lcLabels[a[i + 5]] || '') : '']);
      }
    }
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const r of rows) lines.push(r.join(','));
  }
  return lines;
}

// ── Renk ────────────────────────────────────────────────
function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
export function rampColor(t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x));
  return mix(RAMP[i], RAMP[i + 1], x - i);
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// Grafik genişliği (viewBox birimi). Geniş sağ panelde 500, dar ekranda 340.
let W = 340;
const PAD_L = 34, PAD_R = 6;
export const setChartWidth = (w) => { W = w; };

function frame(h, top, max) {
  const ih = h - top - 20;
  const y = (v) => top + ih - (v / max) * ih;
  let g = '';
  for (const f of [0, 0.5, 1]) {
    const yy = y(max * f);
    g += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${yy}" y2="${yy}" class="grid${f === 0 ? ' base' : ''}"/>`;
    g += `<text x="${PAD_L - 6}" y="${yy + 3.5}" class="tick" text-anchor="end">${fmt(max * f)}</text>`;
  }
  const bw = (W - PAD_L - PAD_R) / 12;
  M1.forEach((m, i) => { g += `<text x="${PAD_L + bw * (i + 0.5)}" y="${h - 5}" class="tick" text-anchor="middle">${m}</text>`; });
  return { g, y, bw, base: top + ih };
}

function bar(x, w, yTop, base, cls, extra = '') {
  const r = Math.min(3, w / 2, Math.max(0, base - yTop));
  const d = `M${x},${base}V${yTop + r}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}V${base}z`;
  return `<path d="${d}" class="${cls}" ${extra}/>`;
}

// Yıllar × aylar takvimi (seçili dönem). Yüksek ve olağanüstü aylar şekille işaretlenir.
// opt: win [m0, m1] sezon penceresi (dışındaki aylar soluk), rd(y, m) okuma, partial(y, m) süren ay mı.
export function calendar(years, from, to, sel, opt) {
  const { win, rd, partial, through } = opt;
  const ys = [];
  for (let yy = to; yy >= from; yy--) ys.push(yy);
  const cw = (W - PAD_L - PAD_R) / 12, ch = W > 400 ? 19 : 17, top = 16;
  const h = top + ys.length * ch + 4;
  let s = '', marks = '';
  // Takvimin en büyük olayları: pencere içindeki aylardan kat sayısı en yüksek topN (eşikleri geçenler).
  const hot = new Map();
  ys.flatMap((yy) => (years[yy] || []).map((v, i) => [yy, i, v]))
    .filter(([, i, v]) => v != null && i >= win[0] && i <= win[1])
    .map(([yy, i]) => [yy, i, rd(yy, i)])
    .filter(([, , r]) => markTier(r) && r.v >= MARK.topMinV && r.v / r.med >= MARK.topMinQ)
    .sort((a, b) => b[2].v / b[2].med - a[2].v / a[2].med).slice(0, MARK.topN)
    .forEach(([yy, i, r]) => hot.set(`${yy}-${i}`, r.v / r.med));
  let labels = '';
  M1.forEach((m, i) => { s += `<text x="${PAD_L + cw * (i + 0.5)}" y="10" class="tick${i >= win[0] && i <= win[1] ? '' : ' off'}" text-anchor="middle">${m}</text>`; });
  ys.forEach((yy, r) => {
    const y0 = top + r * ch;
    s += `<text x="${PAD_L - 6}" y="${y0 + 11.5}" class="tick${yy === sel.year ? ' on' : ''}" text-anchor="end">${yy}</text>`;
    const row = years[yy];
    for (let i = 0; i < 12; i++) {
      const x = PAD_L + cw * i + 1, v = row?.[i], out = i < win[0] || i > win[1];
      if (v == null) {
        s += `<rect x="${x + 0.5}" y="${y0 + 1.5}" width="${cw - 3}" height="${ch - 3}" rx="2.5" class="nodata" data-tip="${esc(`<b>${MONTHS[i]} ${yy}</b>${row ? msg("no.data.yet") : msg("no.data")}`)}"/>`;
        continue;
      }
      const rdg = rd(yy, i), lv = rdg?.level, part = partial(yy, i);
      // Renk: ayın kendi geçmişine göre yeri (yüzdelik). Kıyas yoksa ya da az tespitse nötr.
      // Renk yüzdelikten; küçük aylarda (düzey 'sparse' ama yüzdelik var) yarım güç, tipiğe doğru.
      const pc = rdg?.pct, small = pc != null && lv === 'sparse', hq = out ? null : hot.get(`${yy}-${i}`);
      // En büyük olaylar koyu kırmızı dolgu + beyaz "×83": takvimde ilk göze çarpan şey.
      const fill = hq ? HOT_FILL : pc != null ? calColor(small ? 50 + (pc - 50) * 0.45 : pc) : v === 0 ? 'rgba(255,255,255,0.06)' : CAL_SPARSE;
      const op = pc != null || v === 0 ? 1 : 0.35;
      // İşaret kat sayısından (markTier): yalnızca fazla, büyüklüğe göre üç boy.
      const tier = out || hq ? 0 : markTier(rdg);
      // Şerit içeriği (takvimin üstü): her kare için aynı üç satır, böylece şerit boyu oynamaz.
      const title = part ? `1–${through} ${MONTHS[i]} ${yy}` : `${MONTHS[i]} ${yy}`;
      const L = lv && lv !== 'normal' ? LEVELS[lv] : null;
      const badge = L ? `<span class="lvl lv-${lv}">${L.mark ? L.mark + ' ' : ''}${displayText(L.label)}</span>` : '';
      let say = rdg ? sentence(rdg, title, true) : msg("no.data");
      say = say.charAt(0).toLocaleUpperCase(locale()) + say.slice(1);
      const nums = rdg?.pct != null ? `${msg("detections2", [fmt(v), '', '', ''])} · ${msg("years.exceeded.typical.value", [Math.round(rdg.pct), fmt(rdg.med)])}`
        : msg("detections2", [fmt(v), '', '', '']);
      const read = `<div class="cr-top"><b>${title}</b>${badge}</div><p class="cr-say">${say}</p><p class="cr-nums">${nums}</p>`;
      s += `<rect x="${x}" y="${y0 + 1}" width="${cw - 2}" height="${ch - 2}" rx="2.5" fill="${fill}" fill-opacity="${op}" class="cell${out ? ' out' : ''}${part ? ' part' : ''}" data-year="${yy}" data-month="${i}" data-read="${esc(read)}"/>`;
      const cx = x + (cw - 2) / 2, cy = y0 + ch / 2;
      if (tier) marks += upTri(cx, cy, TRI[tier - 1]);
      if (hq) {
        marks += `<rect x="${x - 0.5}" y="${y0 + 0.5}" width="${cw - 1}" height="${ch - 1}" rx="3" class="hotcell"/>`;
        labels += `<text x="${cx}" y="${cy + 3.2}" class="hotlbl" text-anchor="middle">${fmtQ(hq)}</text>`;
      }
      if (yy === sel.year && i === sel.month) marks += `<rect x="${x - 1}" y="${y0 - 0.5}" width="${cw}" height="${ch + 1}" rx="3.5" class="cellsel"/>`;
    }
    if (yy === sel.year) s += `<rect x="${PAD_L - 1}" y="${y0 - 0.5}" width="${W - PAD_L - PAD_R + 2}" height="${ch + 1}" rx="4" class="rowsel"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${msg("fire.calendar.by.year.and", [from, to])}">${s}${marks}${labels}</svg>`;
}

// Yukarı üçgen, merkez (cx, cy), yarı genişlik w (yükseklik 1.6w).
const TRI = [2.4, 3.6, 5];
const HOT_FILL = '#8f1d14';
const upTri = (cx, cy, w) => `<path d="M${cx - w},${cy + 0.8 * w}h${2 * w}l${-w},${-1.6 * w}z" class="flag"/>`;

// Takvim açıklaması: renk + şekil, sıfır ve veri yok ayrımı.
export function calendarKey() {
  const grad = `linear-gradient(90deg,${CAL_STOPS.map(([p, c]) => `${c} ${p}%`).join(',')})`;
  const tri = (k) => `<svg viewBox="0 0 12 12" aria-hidden="true">${upTri(6, 6.4, TRI[k])}</svg>`;
  const hotK = `<svg viewBox="0 0 26 14" class="wide" aria-hidden="true"><rect x="0.5" y="0.5" width="25" height="13" rx="3" fill="${HOT_FILL}" class="hotcell"/><text x="13" y="10.2" class="hotlbl" text-anchor="middle">×83</text></svg>`;
  return `<div class="key cal-key">
    <p class="cal-lead">${msg("cal.lead")}</p>
    <div class="cal-grad"><i style="background:${grad}"></i><div class="cal-ticks"><span>${msg("cal.t.low")}</span><span>${msg("cal.t.typ")}</span><span>${msg("cal.t.high")}</span></div></div>
    <div class="cal-extra">
      <span>${tri(0)}${msg("cal.m.x2")}</span><span>${tri(1)}${msg("cal.m.x5")}</span><span>${tri(2)}${msg("cal.m.x20")}</span>
      <span>${hotK}${msg("cal.m.top", [MARK.topN])}</span>
      <span><i class="fade"></i>${msg("cal.fade")}</span><span><i class="z"></i>0</span>
    </div>
  </div>`;
}

// Seçili yıl ile dönemin medyanı ve çeyrekler arası bandı. Sütuna tıklamak o ayı okur.
// `ref` satırlarında süren ay, bütün yılların aynı günleri olabilir; null aylar (henüz gelmedi) çizilmez.
export function compare(ref, row, selYear, selMonth, partialMonth) {
  const all = Object.values(ref);
  const med = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.5));
  const q1 = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.25));
  const q3 = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.75));
  const h = W > 400 ? 280 : 190, max = niceMax(Math.max(1, ...row.filter((v) => v != null), ...q3));
  const { g, y, bw, base } = frame(h, 12, max);
  let s = g;
  row.forEach((v, i) => {
    const x0 = PAD_L + bw * i;
    s += `<rect x="${x0 + 1}" y="${y(q3[i])}" width="${bw - 2}" height="${Math.max(1, y(q1[i]) - y(q3[i]))}" rx="2" class="band"/>`;
    if (v != null) s += bar(x0 + bw * 0.3, bw * 0.4, y(v), base, 'bar' + (i === partialMonth ? ' part' : ''));
    s += `<line x1="${x0 + 1}" x2="${x0 + bw - 1}" y1="${y(med[i])}" y2="${y(med[i])}" class="median"/>`;
    if (i === selMonth) s += `<rect x="${x0 + 0.5}" y="${base + 2}" width="${bw - 1}" height="3" rx="1.5" class="msel"/>`;
    const ratio = v != null && med[i] >= 3 ? ` · ${vsTypical(v / med[i])}` : '';
    const val = v == null ? msg("no.data.yet2") : fmt(v) + (i === partialMonth ? ` ${msg("partial.month.median.for.the")}` : '');
    s += `<rect x="${x0}" y="0" width="${bw}" height="${h - 18}" class="hit"${v == null ? '' : ` data-year="${selYear}" data-month="${i}"`} data-tip="${esc(`<b>${MONTHS[i]}</b>${selYear}: ${val}${ratio}<br>${msg("typical.value.normal.range", [fmt(med[i]), fmt(q1[i]), fmt(q3[i])])}`)}"/>`;
  });
  return { svg: `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${msg("compared.with.the.period.median", [selYear])}">${s}</svg>`, med };
}

// Yıllık toplam: ham seri (2012'ye kadar MODIS, sonra VIIRS — yapay basamak) ve birleşmiş seri.
// Bitmemiş yıl (lastFull sonrası) çizilmez: yarım yıl, yapay bir düşüş gibi görünürdü.
export function stepChart(p, viirsYear, selYear, lastFull) {
  const ys = Object.keys(p.merged).map(Number).filter((y) => y <= lastFull).sort((a, b) => a - b);
  const rawOf = (y) => (y < viirsYear ? p.modis?.[y] : p.viirs?.[y]);
  const raw = ys.map((y) => (rawOf(y) ? sum(rawOf(y)) : null)), harm = ys.map((y) => sum(p.merged[y]));
  const h = W > 400 ? 280 : 200, top = 14, ih = h - top - 22, max = niceMax(Math.max(1, ...harm, ...raw.filter((v) => v != null)));
  const x = (y) => PAD_L + 6 + ((y - ys[0]) / Math.max(1, ys.at(-1) - ys[0])) * (W - PAD_L - PAD_R - 12);
  const yv = (v) => top + ih - (v / max) * ih;
  let s = '';
  for (const f of [0, 0.5, 1]) {
    s += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${yv(max * f)}" y2="${yv(max * f)}" class="grid${f === 0 ? ' base' : ''}"/>`;
    s += `<text x="${PAD_L - 6}" y="${yv(max * f) + 3.5}" class="tick" text-anchor="end">${fmt(max * f)}</text>`;
  }
  const xs = x(viirsYear - 0.5);
  s += `<rect x="${xs}" y="${top}" width="${W - PAD_R - xs}" height="${ih}" class="vzone"/>`;
  s += `<line x1="${xs}" x2="${xs}" y1="${top - 4}" y2="${top + ih}" class="vline"/>`;
  s += `<text x="${xs + 4}" y="${top + 6}" class="tick on">${viirsYear} · VIIRS</text>`;
  for (const y of ys) {
    if (y === ys[0] || y === ys.at(-1) || y === viirsYear || (y % 5 === 0 && Math.abs(y - viirsYear) > 2 && ys.at(-1) - y > 2)) {
      s += `<text x="${x(y)}" y="${h - 6}" class="tick${y === selYear ? ' on' : ''}" text-anchor="middle">${y}</text>`;
    }
  }
  const path = (vals) => vals.map((v, i) => (v == null ? '' : `${i && vals[i - 1] != null ? 'L' : 'M'}${x(ys[i])},${yv(v)}`)).join('');
  s += `<path d="${path(raw)}" class="ln-raw"/><path d="${path(harm)}" class="ln-harm"/>`;
  ys.forEach((y, i) => {
    if (raw[i] != null) s += `<rect x="${x(y) - 2.2}" y="${yv(raw[i]) - 2.2}" width="4.4" height="4.4" class="pt-raw"/>`;
    s += `<circle cx="${x(y)}" cy="${yv(harm[i])}" r="${y === selYear ? 4.2 : 3}" class="pt-harm${y < viirsYear ? ' scaled' : ''}${y === selYear ? ' on' : ''}"/>`;
  });
  const bw = (W - PAD_L - PAD_R - 12) / Math.max(1, ys.length - 1);
  ys.forEach((y, i) => {
    const src = y < viirsYear ? `${msg("raw.modis", [raw[i] == null ? '—' : fmt(raw[i])])}<br>${msg("combined.modis.regional.factor", [fmt(harm[i])])}`
      : `${msg("raw.viirs", [raw[i] == null ? '—' : fmt(raw[i])])}<br>${msg("combined.viirs.observation", [fmt(harm[i]), y === viirsYear ? msg("january.modis.factor") : ''])}`;
    s += `<rect x="${x(y) - bw / 2}" y="0" width="${bw}" height="${h - 16}" class="hit" data-year="${y}" data-tip="${esc(`<b>${y}</b>${src}`)}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${msg("annual.raw.and.combined.totals", [viirsYear])}">${s}</svg>`;
}
