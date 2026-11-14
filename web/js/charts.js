// Panel grafikleri: elle yazılmış SVG. Tek ölçek, tek renk tonu (kor), nötr mürekkep.
// Bu dosyadaki istatistik işlevleri (inRange, reading, sentence, peaks, csvRows, hotspotRows) saf işlevlerdir;
// tarayıcı dışında Node ile de sınanabilir.
import { RAMP } from './mapstyle.js?v=20261115c';

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const MON3 = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const M1 = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A'];
export const fmt = (n) => Math.round(n).toLocaleString('tr-TR');
const dec = (n, d = 1) => n.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
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
  low: { label: 'düşük', mark: '▽' },
  normal: { label: 'normal', mark: '' },
  high: { label: 'yüksek', mark: '●' },
  extreme: { label: 'olağanüstü', mark: '◆' },
  sparse: { label: 'az tespit', mark: '' },
};
const SPARSE = 5;   // bu sayının altındaki değerler, dönemin çoğu da böyleyse, yüzdelikle okunmaz
const MIN_REF = 3;  // karşılaştırma için en az bu kadar başka yıl

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
  const level = sparse ? 'sparse' : pct < 25 ? 'low' : pct <= 75 ? 'normal' : pct <= 95 ? 'high' : 'extreme';
  return { ...base, pct: sparse ? null : pct, level, rank: 1 + ref.filter((x) => x > v).length, below, eq };
}

// Tek cümlelik Türkçe okuma, ör. "Ağustos 2021: 25 yılın en yükseği, medyanın 14 katı."
// `label` verilirse ay adı yerine o kullanılır (ör. "1–13 Kasım 2026").
export function sentence(r, label) {
  if (!r) return '';
  const M = MONTHS[r.m], head = `${label || `${M} ${r.y}`}: `;
  if (r.short) return `${head}${fmt(r.v)} tespit. Karşılaştırma için dönem çok kısa; en az ${MIN_REF + 1} yıl seçin.`;
  if (r.level === 'sparse') return `${head}${fmt(r.v)} tespit. Bu ilde ${M} ayında yıllar boyunca neredeyse hiç tespit yok; yüzdelik anlamlı değil.`;
  let place;
  const per = `${r.from}–${r.to}`;
  if (r.inRange) {
    const N = r.n + 1;
    if (r.rank === 1 && !r.eq) place = `${N} yılın en yükseği`;
    else if (r.rank === 1) place = `${N} yılın en yükseğiyle eşit`;
    else if (!r.below && !r.eq) place = `${N} yılın en düşüğü`;
    else place = `${N} yıl içinde ${r.rank}. sırada`;
  } else {
    if (r.rank === 1 && !r.eq) place = `${per} dönemindeki bütün ${M} aylarından yüksek`;
    else if (!r.below && !r.eq) place = `${per} dönemindeki bütün ${M} aylarından düşük`;
    else place = `${per} dönemindeki ${r.n} ${M} ayının ${r.below} tanesinden yüksek`;
  }
  let k;
  if (r.med < 3) k = `orta değer ${fmt(r.med)}`;   // küçük medyana oran ("∞ katı") verilmez
  else {
    const q = r.v / r.med;
    k = Math.abs(q - 1) < 0.05 ? 'olağan düzeyde'
      : q > 1 ? `orta değerin ${q < 10 ? dec(q) : fmt(q)} katı` : `orta değerin altında (orta değer ${fmt(r.med)})`;
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

const CSV_HEAD = 'province,region,year,month,value,source,complete,raw_modis,raw_viirs,median,percentile,level';
// Birleşmiş seri + ham sayılar; dönem yılları ve sezon penceresindeki aylar. Medyan/yüzdelik/düzey
// seçili döneme göre (rd ile: süren ay bütün yılların aynı günleriyle). complete=0: ay henüz bitmedi.
export function csvRows(name, region, p, from, to, viirsFrom, win, rd, partial) {
  const lines = [CSV_HEAD];
  for (const [y, row] of Object.entries(inRange(p.merged, from, to))) {
    row.forEach((v, m) => {
      if (v == null || m < win[0] || m > win[1]) return;
      const r = rd(+y, m) || {};
      lines.push([csvq(name), region, y, m + 1, num(v), sourceOf(+y, m, viirsFrom), partial(+y, m) ? 0 : 1,
        num(p.modis?.[y]?.[m]), num(p.viirs?.[y]?.[m]), num(r.med),
        r.pct == null ? '' : Math.round(r.pct), r.level || ''].join(','));
    });
  }
  return lines;
}

// Ham tespit listesi: points/{yıl}.json dosyalarındaki 5'li gruplar (x, y, gün, frp, il).
const HS_HEAD = 'date,latitude,longitude,sensor,frp_mw,province,processing';
const SENSOR = { modis: 'MODIS (Terra/Aqua)', viirs: 'VIIRS S-NPP' };
// nrtFrom: {modis: '2026-09', viirs: '2026-08'} -> o aydan itibaren NRT (yakın gerçek zamanlı), öncesi SP (arşiv).
export function hotspotRows(byYear, provIdx, name, from, to, win, nrtFrom = {}) {
  const lines = [HS_HEAD], q = csvq(name);
  for (let y = from; y <= to; y++) {
    const d = byYear[y];
    if (!d) continue;
    const rows = [];
    for (const s of ['viirs', 'modis']) {
      const a = d[s] || [];
      for (let i = 0; i < a.length; i += 5) {
        if (a[i + 4] !== provIdx) continue;
        const dt = new Date(Date.UTC(y, 0, a[i + 2])), m = dt.getUTCMonth();
        if (m < win[0] || m > win[1]) continue;
        const iso = dt.toISOString().slice(0, 10), nrt = nrtFrom[s] && iso.slice(0, 7) >= nrtFrom[s];
        rows.push([iso, (a[i + 1] / 1000).toFixed(3), (a[i] / 1000).toFixed(3), SENSOR[s], a[i + 3], q, nrt ? 'NRT' : 'SP']);
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

const W = 340, PAD_L = 34, PAD_R = 6;

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
  const max = Math.max(1, ...ys.flatMap((yy) => (years[yy] || []).filter((v) => v != null)));
  const cw = (W - PAD_L - PAD_R) / 12, ch = 17, top = 16;
  const h = top + ys.length * ch + 4;
  let s = '', marks = '';
  M1.forEach((m, i) => { s += `<text x="${PAD_L + cw * (i + 0.5)}" y="10" class="tick${i >= win[0] && i <= win[1] ? '' : ' off'}" text-anchor="middle">${m}</text>`; });
  ys.forEach((yy, r) => {
    const y0 = top + r * ch;
    s += `<text x="${PAD_L - 6}" y="${y0 + 11.5}" class="tick${yy === sel.year ? ' on' : ''}" text-anchor="end">${yy}</text>`;
    const row = years[yy];
    for (let i = 0; i < 12; i++) {
      const x = PAD_L + cw * i + 1, v = row?.[i], out = i < win[0] || i > win[1];
      if (v == null) {
        s += `<rect x="${x + 0.5}" y="${y0 + 1.5}" width="${cw - 3}" height="${ch - 3}" rx="2.5" class="nodata" data-tip="${esc(`<b>${MONTHS[i]} ${yy}</b>${row ? 'Henüz veri yok' : 'Veri yok'}`)}"/>`;
        continue;
      }
      const rdg = rd(yy, i), lv = rdg?.level, part = partial(yy, i);
      const fill = v === 0 ? 'rgba(255,255,255,0.06)' : rampColor(Math.sqrt(v / max));
      const tipLv = lv && lv !== 'normal' ? ` · ${LEVELS[lv].label}` : '';
      const tipPct = rdg?.pct != null ? `<br>%${Math.round(rdg.pct)}. yüzdelik · orta değer ${fmt(rdg.med)}` : '';
      const tipPart = part ? `<br>Ay sürüyor: 1–${through} ${MONTHS[i]}; diğer yılların aynı günleriyle kıyaslandı` : '';
      s += `<rect x="${x}" y="${y0 + 1}" width="${cw - 2}" height="${ch - 2}" rx="2.5" fill="${fill}" class="cell${out ? ' out' : ''}${part ? ' part' : ''}" data-year="${yy}" data-month="${i}" data-tip="${esc(`<b>${MONTHS[i]} ${yy}</b>${fmt(v)} tespit${tipLv}${tipPct}${tipPart}`)}"/>`;
      const cx = x + (cw - 2) / 2, cy = y0 + ch / 2;
      if (!out && lv === 'high') marks += `<circle cx="${cx}" cy="${cy}" r="2.4" class="flag"/>`;
      else if (!out && lv === 'extreme') marks += `<path d="M${cx},${cy - 4.2}l4.2,4.2l-4.2,4.2l-4.2,-4.2z" class="flag"/>`;
      if (yy === sel.year && i === sel.month) marks += `<rect x="${x - 1}" y="${y0 - 0.5}" width="${cw}" height="${ch + 1}" rx="3.5" class="cellsel"/>`;
    }
    if (yy === sel.year) s += `<rect x="${PAD_L - 1}" y="${y0 - 0.5}" width="${W - PAD_L - PAD_R + 2}" height="${ch + 1}" rx="4" class="rowsel"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${from}–${to} yılları ve aylara göre ateş tespitleri takvimi; yüksek aylar daire, olağanüstü aylar karo ile işaretli">${s}${marks}</svg>`;
}

// Takvim açıklaması: renk + şekil, sıfır ve veri yok ayrımı.
export function calendarKey() {
  return `<div class="key cal-key">
    <span><i class="z"></i>0</span>
    <span><i class="ramp" style="background:linear-gradient(90deg,${RAMP.join(',')})"></i>az → çok</span>
    <span><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="2.6" class="flag"/></svg>yüksek (75–95. yüzdelik)</span>
    <span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6,1.6l4.4,4.4l-4.4,4.4l-4.4,-4.4z" class="flag"/></svg>olağanüstü (&gt;95)</span>
  </div>`;
}

// Seçili yıl ile dönemin medyanı ve çeyrekler arası bandı. Sütuna tıklamak o ayı okur.
// `ref` satırlarında süren ay, bütün yılların aynı günleri olabilir; null aylar (henüz gelmedi) çizilmez.
export function compare(ref, row, selYear, selMonth, partialMonth) {
  const all = Object.values(ref);
  const med = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.5));
  const q1 = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.25));
  const q3 = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.75));
  const h = 190, max = niceMax(Math.max(1, ...row.filter((v) => v != null), ...q3));
  const { g, y, bw, base } = frame(h, 12, max);
  let s = g;
  row.forEach((v, i) => {
    const x0 = PAD_L + bw * i;
    s += `<rect x="${x0 + 1}" y="${y(q3[i])}" width="${bw - 2}" height="${Math.max(1, y(q1[i]) - y(q3[i]))}" rx="2" class="band"/>`;
    if (v != null) s += bar(x0 + bw * 0.3, bw * 0.4, y(v), base, 'bar' + (i === partialMonth ? ' part' : ''));
    s += `<line x1="${x0 + 1}" x2="${x0 + bw - 1}" y1="${y(med[i])}" y2="${y(med[i])}" class="median"/>`;
    if (i === selMonth) s += `<rect x="${x0 + 0.5}" y="${base + 2}" width="${bw - 1}" height="3" rx="1.5" class="msel"/>`;
    const ratio = v != null && med[i] >= 3 ? ` · orta değerin ${(v / med[i]).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} katı` : '';
    const val = v == null ? 'henüz veri yok' : fmt(v) + (i === partialMonth ? ' (ay sürüyor; orta değer aynı günlerden)' : '');
    s += `<rect x="${x0}" y="0" width="${bw}" height="${h - 18}" class="hit"${v == null ? '' : ` data-year="${selYear}" data-month="${i}"`} data-tip="${esc(`<b>${MONTHS[i]}</b>${selYear}: ${val}${ratio}<br>Orta değer: ${fmt(med[i])} · Olağan aralık: ${fmt(q1[i])}–${fmt(q3[i])}`)}"/>`;
  });
  return { svg: `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${selYear} yılı ile dönemin medyanının karşılaştırması">${s}</svg>`, med };
}

// Yıllık toplam: ham seri (2012'ye kadar MODIS, sonra VIIRS — yapay basamak) ve birleşmiş seri.
// Bitmemiş yıl (lastFull sonrası) çizilmez: yarım yıl, yapay bir düşüş gibi görünürdü.
export function stepChart(p, viirsYear, selYear, lastFull) {
  const ys = Object.keys(p.merged).map(Number).filter((y) => y <= lastFull).sort((a, b) => a - b);
  const rawOf = (y) => (y < viirsYear ? p.modis?.[y] : p.viirs?.[y]);
  const raw = ys.map((y) => (rawOf(y) ? sum(rawOf(y)) : null)), harm = ys.map((y) => sum(p.merged[y]));
  const h = 200, top = 14, ih = h - top - 22, max = niceMax(Math.max(1, ...harm, ...raw.filter((v) => v != null)));
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
    const src = y < viirsYear ? `ham: MODIS ${raw[i] == null ? '—' : fmt(raw[i])}<br>birleşmiş: ${fmt(harm[i])} (MODIS × bölge çarpanı)`
      : `ham: VIIRS ${raw[i] == null ? '—' : fmt(raw[i])}<br>birleşmiş: ${fmt(harm[i])} (VIIRS gözlemi${y === viirsYear ? ', Ocak MODIS × çarpan' : ''})`;
    s += `<rect x="${x(y) - bw / 2}" y="0" width="${bw}" height="${h - 16}" class="hit" data-year="${y}" data-tip="${esc(`<b>${y}</b>${src}`)}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Yıllık toplam: ham seri ile birleşmiş seri, ${viirsYear} VIIRS başlangıcı işaretli">${s}</svg>`;
}
