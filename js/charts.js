// Dependency-free SVG charts. Colors for text/grid come from CSS classes so both themes work.

import { addDays, eachDay, esc, fmtDate, fmtMin, MONTHS_SHORT, startOfWeek, WD_SHORT, weekday } from './util.js?v=2.2.0';

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** The last seven days as small bars; today is still running, so it is drawn lighter. */
export function weekBars(dm, today) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const mins = days.map((d) => dm.get(d)?.total || 0);
  const max = Math.max(1, ...mins);
  const bars = days.map((d, i) => `<i class="${d === today ? 'today' : ''}${mins[i] ? '' : ' empty'}"
    style="height:${Math.max(6, Math.round((mins[i] / max) * 100))}%" title="${fmtDate(d, { weekday: true })} · ${fmtMin(mins[i])}"></i>`);
  return `<div class="wbars">${bars.join('')}</div>
    <div class="wbars-days">${days.map((d) => `<span>${WD_SHORT[weekday(d)]}</span>`).join('')}</div>`;
}

/** Year heatmap, Monday-first rows, one column per week. */
export function heatmap(dm, year, { today, max = 480 } = {}) {
  const step = 15, cell = 12, left = 26, top = 4;
  const first = `${year}-01-01`, last = `${year}-12-31`;
  const start = startOfWeek(first, 1);
  const cols = Math.ceil((Math.round((Date.parse(last) - Date.parse(start)) / 864e5) + 1) / 7);
  const width = left + cols * step, height = top + 7 * step + 18;
  const parts = [];
  let col = 0, row = 0;
  const monthX = {};
  for (const d of eachDay(start, addDays(start, cols * 7 - 1))) {
    if (d >= first && d <= last) {
      const x = left + col * step, y = top + row * step;
      const mins = dm.get(d)?.total || 0;
      const m = +d.slice(5, 7) - 1;
      if (d.slice(8) === '01') monthX[m] = x;
      let cls = 'hm', style = '', label = mins ? fmtMin(mins) : 'nichts geloggt';
      if (mins > 0) style = ` style="fill-opacity:${(0.22 + 0.78 * Math.min(1, mins / max)).toFixed(2)}"`;
      else cls += ' hm-empty';
      if (d > today) cls += ' hm-future';
      if (d === today) cls += ' hm-today';
      parts.push(`<rect class="${cls}" data-day="${d}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5"${style}><title>${fmtDate(d, { weekday: true })} · ${label}</title></rect>`);
    }
    if (++row === 7) { row = 0; col++; }
  }
  for (const [m, x] of Object.entries(monthX)) {
    parts.push(`<text class="ax" x="${x}" y="${height - 4}">${MONTHS_SHORT[m]}</text>`);
  }
  ['Mo', '', 'Mi', '', 'Fr', '', ''].forEach((t, i) => {
    if (t) parts.push(`<text class="ax" x="0" y="${top + i * step + 10}">${t}</text>`);
  });
  return `<svg class="heatmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Heatmap ${year}">${parts.join('')}</svg>`;
}

/** Donut with one ring segment per entry. segs: [{label, value, color}] */
export function donut(segs, { size = 190, stroke = 26, center = '', sub = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, total = segs.reduce((s, x) => s + x.value, 0);
  let off = 0;
  const arcs = total ? segs.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * c;
    const gap = segs.length > 1 ? Math.min(2, len / 3) : 0;
    const el = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${s.color}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}" stroke-dashoffset="${-off}"
      transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(s.label)} · ${fmtMin(s.value)} (${Math.round((s.value / total) * 100)} %)</title></circle>`;
    off += len;
    return el;
  }) : [`<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" class="grid-stroke" stroke-width="${stroke}"/>`];
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${arcs.join('')}
    <text class="donut-big" x="50%" y="48%" text-anchor="middle">${esc(center)}</text>
    <text class="ax" x="50%" y="61%" text-anchor="middle">${esc(sub)}</text></svg>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Stacked bars (hours per bucket and activity) with a dashed cumulative line on a second axis. */
export function historyBars(agg, acts, { width = 700, height = 270 } = {}) {
  const L = 36, R = 44, T = 12, B = 28, w = width - L - R, h = height - T - B;
  const n = agg.buckets.length;
  const maxH = niceMax(Math.max(...agg.buckets.map((b) => b.total / 60), 0.1));
  const maxC = niceMax(Math.max(agg.buckets.at(-1)?.cum / 60 || 0, 0.1));
  const slot = w / n, bw = Math.max(2, Math.min(38, slot * 0.68));
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const y = T + h - (i / 4) * h;
    out.push(`<line class="gridline" x1="${L}" x2="${L + w}" y1="${y}" y2="${y}"/>`);
    out.push(`<text class="ax" x="${L - 6}" y="${y + 4}" text-anchor="end">${nf.format((maxH * i) / 4)}</text>`);
    out.push(`<text class="ax" x="${L + w + 6}" y="${y + 4}">${nf.format((maxC * i) / 4)}</text>`);
  }
  const every = Math.ceil(n / 16);
  const pts = [];
  agg.buckets.forEach((b, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    let y = T + h;
    for (const a of acts) {
      const m = b.by[a.name];
      if (!m) continue;
      const bh = (m / 60 / maxH) * h;
      y -= bh;
      out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" fill="${a.color}" rx="${bw > 8 ? 2 : 0}"><title>${esc(b.title)} · ${esc(a.name)}: ${fmtMin(m)}</title></rect>`);
    }
    if (b.total > 0) out.push(`<rect class="hit" x="${x}" y="${T}" width="${bw}" height="${h}"><title>${esc(b.title)} · ${fmtMin(b.total)}</title></rect>`);
    if (i % every === 0) out.push(`<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(b.label)}</text>`);
    pts.push(`${(x + bw / 2).toFixed(1)},${(T + h - (b.cum / 60 / maxC) * h).toFixed(1)}`);
  });
  out.push(`<polyline class="cum" points="${pts.join(' ')}"/>`);
  out.push(`<text class="ax" x="4" y="${T + 2}" transform="rotate(-90 4 ${T + 2})" text-anchor="end">Stunden</text>`);
  return `<svg class="bars" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${out.join('')}</svg>`;
}
