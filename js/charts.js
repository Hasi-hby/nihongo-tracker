// Dependency-free SVG charts. Colors for text/grid come from CSS classes so both themes work.

import { addDays, eachDay, esc, fmtDate, fmtMin, MONTHS_SHORT, startOfWeek } from './util.js?v=1.1.1';

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** Year heatmap, Monday-first rows, one column per week. */
export function heatmap(dm, year, { today, frozen = new Set(), max = 480 } = {}) {
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
      if (frozen.has(d)) { cls = 'hm hm-frozen'; style = ''; label = 'Streak-Freeze ❄'; }
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

/** Radar for the hunter status window. attrs: [{short, stat}] */
export function radar(attrs, { size = 260 } = {}) {
  const cx = size / 2, cy = size / 2 + 6, r = size / 2 - 38, n = attrs.length;
  const max = niceMax(Math.max(100, ...attrs.map((a) => a.stat)));
  const pt = (i, v) => {
    const ang = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return [cx + Math.cos(ang) * r * v, cy + Math.sin(ang) * r * v];
  };
  const out = [];
  for (let k = 1; k <= 4; k++) {
    out.push(`<polygon class="radar-grid" points="${attrs.map((_, i) => pt(i, k / 4).map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`);
  }
  attrs.forEach((a, i) => {
    const [x, y] = pt(i, 1);
    out.push(`<line class="radar-grid" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    const [lx, ly] = pt(i, 1.2);
    out.push(`<text class="radar-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${esc(a.short)}</text>`);
    out.push(`<text class="radar-val" x="${lx.toFixed(1)}" y="${(ly + 13).toFixed(1)}" text-anchor="middle">${a.stat}</text>`);
  });
  out.push(`<polygon class="radar-shape" points="${attrs.map((a, i) => pt(i, Math.max(0.02, a.stat / max)).map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`);
  return `<svg class="radar" viewBox="0 0 ${size} ${size + 12}" width="${size}" height="${size + 12}" role="img">${out.join('')}</svg>`;
}
