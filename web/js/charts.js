// Panel grafikleri: elle yazılmış SVG. Tek ölçek, tek renk tonu (kor), nötr mürekkep.
import { RAMP } from './mapstyle.js';

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const M1 = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A'];
export const fmt = (n) => Math.round(n).toLocaleString('tr-TR');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function quantile(arr, q) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return a[lo] + (a[hi] - a[lo]) * (p - lo);
}

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

// Seçili yılın 12 ayı.
export function monthBars(row, year) {
  const h = 190, max = niceMax(Math.max(...row));
  const { g, y, bw, base } = frame(h, 18, max);
  const peak = row.indexOf(Math.max(...row));
  let s = g;
  row.forEach((v, i) => {
    const x = PAD_L + bw * i + 2, w = bw - 4;
    s += bar(x, w, y(v), base, 'bar' + (i === peak ? ' peak' : ''));
    if (i === peak && v > 0) s += `<text x="${x + w / 2}" y="${y(v) - 5}" class="val" text-anchor="middle">${fmt(v)}</text>`;
    s += `<rect x="${PAD_L + bw * i}" y="0" width="${bw}" height="${h - 18}" class="hit" data-tip="${esc(`<b>${MONTHS[i]} ${year}</b>${fmt(v)} tespit`)}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${year} yılı aylık ateş tespitleri">${s}</svg>`;
}

// Yıllar × aylar takvimi. Hücreye tıklamak o yılı seçer.
export function calendar(years, selYear) {
  const ys = Object.keys(years).map(Number).sort((a, b) => b - a);
  const max = Math.max(1, ...ys.flatMap((yy) => years[yy]));
  const cw = (W - PAD_L - PAD_R) / 12, ch = 17, top = 16;
  const h = top + ys.length * ch + 4;
  let s = '';
  M1.forEach((m, i) => { s += `<text x="${PAD_L + cw * (i + 0.5)}" y="10" class="tick" text-anchor="middle">${m}</text>`; });
  ys.forEach((yy, r) => {
    const y0 = top + r * ch;
    s += `<text x="${PAD_L - 6}" y="${y0 + 11.5}" class="tick${yy === selYear ? ' on' : ''}" text-anchor="end">${yy}</text>`;
    years[yy].forEach((v, i) => {
      const fill = v === 0 ? 'rgba(255,255,255,0.05)' : rampColor(Math.sqrt(v / max));
      s += `<rect x="${PAD_L + cw * i + 1}" y="${y0 + 1}" width="${cw - 2}" height="${ch - 2}" rx="2.5" fill="${fill}" class="cell" data-year="${yy}" data-tip="${esc(`<b>${MONTHS[i]} ${yy}</b>${fmt(v)} tespit`)}"/>`;
    });
    if (yy === selYear) s += `<rect x="${PAD_L - 1}" y="${y0 - 0.5}" width="${W - PAD_L - PAD_R + 2}" height="${ch + 1}" rx="4" class="rowsel"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Yıllara ve aylara göre ateş tespitleri takvimi">${s}</svg>`;
}

// Seçili yıl ile tüm yılların medyanı ve çeyrekler arası bandı.
export function compare(years, selYear) {
  const all = Object.values(years), row = years[selYear];
  const med = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.5));
  const q1 = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.25));
  const q3 = M1.map((_, i) => quantile(all.map((r) => r[i]), 0.75));
  const h = 190, max = niceMax(Math.max(...row, ...q3));
  const { g, y, bw, base } = frame(h, 12, max);
  let s = g;
  row.forEach((v, i) => {
    const x0 = PAD_L + bw * i;
    s += `<rect x="${x0 + 1}" y="${y(q3[i])}" width="${bw - 2}" height="${Math.max(1, y(q1[i]) - y(q3[i]))}" rx="2" class="band"/>`;
    s += bar(x0 + bw * 0.3, bw * 0.4, y(v), base, 'bar');
    s += `<line x1="${x0 + 1}" x2="${x0 + bw - 1}" y1="${y(med[i])}" y2="${y(med[i])}" class="median"/>`;
    const ratio = med[i] > 0 ? ` · medyanın ${(v / med[i]).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} katı` : '';
    s += `<rect x="${x0}" y="0" width="${bw}" height="${h - 18}" class="hit" data-tip="${esc(`<b>${MONTHS[i]}</b>${selYear}: ${fmt(v)}${ratio}<br>Medyan: ${fmt(med[i])} · Orta %50: ${fmt(q1[i])}–${fmt(q3[i])}`)}"/>`;
  });
  return { svg: `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${selYear} yılı ile tüm yılların medyanının karşılaştırması">${s}</svg>`, med };
}
