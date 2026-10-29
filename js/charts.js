// Dependency-free SVG charts. Colors for text/grid come from CSS classes so both themes work.

import {
  addDays, eachDay, esc, fmtDate, fmtH, fmtMin, fmtMinShort, MONTHS_SHORT, startOfWeek, WD_SHORT, weekday,
} from './util.js?v=2.6.0';

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/**
 * The last seven days as small shimmering bars; the best finished day glows and carries its time.
 * `avg` (minutes a day) adds a dashed reference line, and today, still running, gets a dashed
 * outline up to that line, so the gap shows what is missing to an average day.
 */
export function weekBars(dm, today, { avg = 0 } = {}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const mins = days.map((d) => dm.get(d)?.total || 0);
  const max = Math.max(1, avg, ...mins);
  const pctOf = (m) => Math.round((m / max) * 100);
  const past = Math.max(...mins.slice(0, 6));
  const best = past > 0 ? mins.indexOf(past) : -1;
  const bars = days.map((d, i) => {
    const isToday = i === 6;
    const cls = [isToday && 'today', i === best && 'best', !mins[i] && 'empty'].filter(Boolean).join(' ');
    const ghost = isToday && avg > mins[i] ? `<span class="wb-ghost" style="height:${pctOf(avg)}%"></span>` : '';
    return `<div class="wb">${ghost}<i class="${cls}" style="height:${Math.max(6, pctOf(mins[i]))}%"
      title="${fmtDate(d, { weekday: true })} · ${fmtMin(mins[i])}">${i === best ? `<b>${fmtMinShort(mins[i])}</b>` : ''}</i></div>`;
  });
  const line = avg > 0 ? `<span class="wb-avg" style="bottom:${pctOf(avg)}%"><span>Ø ${fmtH(avg)}</span></span>` : '';
  return `<div class="wbars">${bars.join('')}${line}</div>
    <div class="wbars-days">${days.map((d, i) => `<span${i === 6 ? ' class="today"' : ''}>${WD_SHORT[weekday(d)]}</span>`).join('')}</div>`;
}

const GLOW_MIN = 360; // heatmap days from 6 h on shine

/**
 * Year heatmap, Monday-first rows, one column per week. Days from 6 h on shine: their cells are
 * copied into one blurred layer underneath, a single filter instead of one per cell.
 */
export function heatmap(dm, year, { today, max = 480 } = {}) {
  const step = 15, cell = 12, left = 26, top = 4;
  const first = `${year}-01-01`, last = `${year}-12-31`;
  const start = startOfWeek(first, 1);
  const cols = Math.ceil((Math.round((Date.parse(last) - Date.parse(start)) / 864e5) + 1) / 7);
  const width = left + cols * step, height = top + 7 * step + 18;
  const parts = [], glow = [];
  let col = 0, row = 0;
  const monthX = {};
  for (const d of eachDay(start, addDays(start, cols * 7 - 1))) {
    if (d >= first && d <= last) {
      const x = left + col * step, y = top + row * step;
      const mins = dm.get(d)?.total || 0;
      const m = +d.slice(5, 7) - 1;
      if (d.slice(8) === '01') monthX[m] = x;
      let cls = 'hm', style = '', label = mins ? fmtMin(mins) : 'nichts geloggt';
      if (mins >= GLOW_MIN) cls += ' hm-hi';
      else if (mins > 0) style = ` style="fill-opacity:${(0.22 + 0.78 * Math.min(1, mins / max)).toFixed(2)}"`;
      else cls += ' hm-empty';
      if (d > today) cls += ' hm-future';
      if (d === today) cls += ' hm-today';
      if (mins >= GLOW_MIN || d === today) {
        glow.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" opacity="${mins >= max || d === today ? 0.9 : 0.5}"/>`);
      }
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
  const defs = `<defs><filter id="hmGlow"><feGaussianBlur stdDeviation="2.6"/></filter>
    <linearGradient id="hmHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hm-hi0"/><stop offset="1" class="hm-hi1"/></linearGradient></defs>`;
  return `<svg class="heatmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Heatmap ${year}">${defs}
    <g class="hm-glow" filter="url(#hmGlow)">${glow.join('')}</g>${parts.join('')}</svg>`;
}

export const DRAW_MS = 800; // how long the ring takes to close when it animates; it pulses for exactly this long (.donut in styles.css)
/** Time (0..1) at which an ease-out sweep (fast start, soft close) around the ring has covered the share p. */
const sweepAt = (p) => 1 - Math.sqrt(1 - Math.min(1, p));
/** The inverse: share of the ring covered at time t (0..1), so a number can grow in step with the ring. */
export const sweptAt = (t) => 1 - (1 - Math.min(1, t)) ** 2;

/**
 * Donut with one ring segment per entry. segs: [{label, value, color}]
 * Each segment carries the delay and duration of its part of one continuous sweep, so the
 * ring closes clockwise from the top when the page animates it; the ring pulses while it closes.
 * `count: {to, fmt}` marks the centre number, so the page can count it up while the ring closes.
 */
export function donut(segs, { size = 190, stroke = 26, center = '', sub = '', count = null } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, total = segs.reduce((s, x) => s + x.value, 0);
  let off = 0;
  const arcs = total ? segs.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * c;
    const gap = segs.length > 1 ? Math.min(2, len / 3) : 0;
    const t0 = sweepAt(off / c), t1 = sweepAt((off + len) / c);
    const timing = `animation-delay:${Math.round(t0 * DRAW_MS)}ms;animation-duration:${Math.max(1, Math.round((t1 - t0) * DRAW_MS))}ms`;
    const el = `<circle class="seg" style="${timing}" r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${s.color}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}" stroke-dashoffset="${-off}"
      transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(s.label)} · ${fmtMin(s.value)} (${Math.round((s.value / total) * 100)} %)</title></circle>`;
    off += len;
    return el;
  }) : [`<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" class="grid-stroke" stroke-width="${stroke}"/>`];
  // the ring glows in its own colours: a blurred, fainter copy underneath (dark theme only, see styles.css)
  const glow = `<defs><filter id="dnGlow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="6" result="b"/>
    <feComponentTransfer in="b" result="f"><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
    <feMerge><feMergeNode in="f"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  return `<svg class="donut" style="--draw:${DRAW_MS}ms" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${glow}
    <g class="${total ? 'ring' : ''}">${arcs.join('')}</g>
    <g class="mid"><text class="donut-big" x="50%" y="48%" text-anchor="middle"${count ? ` data-count="${count.to}" data-fmt="${esc(count.fmt)}"` : ''}>${esc(center)}</text>
    <text class="ax" x="50%" y="61%" text-anchor="middle">${esc(sub)}</text></g></svg>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * Stacked bars (hours per bucket and activity) that fade towards the baseline, the best bucket
 * glowing, and the cumulative total as a glowing line over a soft area on a second axis. The line
 * stops at the bucket holding `until` (today), so it does not run flat through the future.
 * `trend` ([{d, avg}], minutes a day) adds a dashed line on the bars' axis: per day in day buckets,
 * scaled to the month in month buckets, so it runs along the tops of even months.
 */
export function historyBars(agg, acts, { width = 700, height = 270, until = null, trend = null } = {}) {
  const L = 36, R = 44, T = 12, B = 28, w = width - L - R, h = height - T - B;
  const n = agg.buckets.length;
  const slot = w / n, bw = Math.max(2, Math.min(38, slot * 0.68));
  const daily = agg.buckets[0]?.start === agg.buckets[0]?.end;
  const idx = new Map(agg.buckets.map((b, i) => [b.key, i]));
  const tPts = (trend || []).flatMap(({ d, avg }) => {
    const i = idx.get(daily ? d : d.slice(0, 8) + '01');
    if (i == null) return [];
    const len = daily ? 1 : +agg.buckets[i].end.slice(8);
    return [[L + (i + (daily ? 0.5 : (+d.slice(8) - 0.5) / len)) * slot, (avg * len) / 60]];
  });
  const maxH = niceMax(Math.max(...agg.buckets.map((b) => b.total / 60), ...tPts.map((p) => p[1]), 0.1));
  const maxC = niceMax(Math.max(agg.buckets.at(-1)?.cum / 60 || 0, 0.1));
  const top = Math.max(...agg.buckets.map((b) => b.total));
  const best = top > 0 ? agg.buckets.findIndex((b) => b.total === top) : -1;
  const pts = agg.buckets.filter((b) => !until || b.start <= until)
    .map((b, i) => `${(L + i * slot + slot / 2).toFixed(1)},${(T + h - (b.cum / 60 / maxC) * h).toFixed(1)}`);
  const out = [`<defs><linearGradient id="hbFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hb-f0"/><stop offset="1" class="hb-f1"/></linearGradient>
    <linearGradient id="hbArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hb-a0"/><stop offset="1" class="hb-a1"/></linearGradient></defs>`];
  for (let i = 0; i <= 4; i++) {
    const y = T + h - (i / 4) * h;
    out.push(`<line class="gridline" x1="${L}" x2="${L + w}" y1="${y}" y2="${y}"/>`);
    out.push(`<text class="ax" x="${L - 6}" y="${y + 4}" text-anchor="end">${nf.format((maxH * i) / 4)}</text>`);
    out.push(`<text class="ax" x="${L + w + 6}" y="${y + 4}">${nf.format((maxC * i) / 4)}</text>`);
  }
  const every = Math.ceil(n / Math.min(16, Math.max(4, Math.floor(w / 40)))); // labels need about 40 px each
  if (pts.length > 1) {
    const x0 = pts[0].split(',')[0], x1 = pts.at(-1).split(',')[0];
    out.push(`<path class="cum-area" d="M${x0},${T + h} L${pts.join(' L')} L${x1},${T + h} Z"/>`);
  }
  agg.buckets.forEach((b, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    let y = T + h;
    // one group per column, so a column can grow from the baseline as a whole (--i staggers it)
    out.push(`<g class="col${i === best ? ' best' : ''}" style="--i:${i}">`);
    for (const a of acts) {
      const m = b.by[a.name];
      if (!m) continue;
      const bh = (m / 60 / maxH) * h;
      y -= bh;
      out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" fill="${a.color}" rx="${bw > 8 ? 2 : 0}"><title>${esc(b.title)} · ${esc(a.name)}: ${fmtMin(m)}</title></rect>`);
    }
    // one shade over the whole column: bright on top, sinking into the background at the baseline
    if (b.total > 0) out.push(`<rect class="fade" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + h - y).toFixed(1)}"/>`);
    out.push('</g>');
    if (b.total > 0) out.push(`<rect class="hit" x="${x}" y="${T}" width="${bw}" height="${h}"><title>${esc(b.title)} · ${fmtMin(b.total)}</title></rect>`);
    if (i % every === 0) out.push(`<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(b.label)}</text>`);
  });
  if (pts.length) out.push(`<polyline class="cum" points="${pts.join(' ')}"/>`);
  if (tPts.length > 1) {
    out.push(`<polyline class="trend" points="${tPts.map(([x, v]) => `${x.toFixed(1)},${(T + h - (v / maxH) * h).toFixed(1)}`).join(' ')}"/>`);
  }
  out.push(`<text class="ax" x="4" y="${T + 2}" transform="rotate(-90 4 ${T + 2})" text-anchor="end">Stunden</text>`);
  return `<svg class="bars" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${out.join('')}</svg>`;
}

const WD_ROWS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Minutes per weekday (rows, Monday first) and clock hour as cells in the heatmap's colours. */
export function hourGrid(g, { width = 420 } = {}) {
  const left = 24, top = 2, step = Math.max(10, Math.min(32, (width - left) / 24)), cell = step - Math.max(2, step * 0.18);
  const w = left + 24 * step, height = top + 7 * step + 16;
  const max = Math.max(1, ...g.grid.flat());
  const parts = [];
  g.grid.forEach((row, wd) => {
    parts.push(`<text class="ax" x="0" y="${(top + wd * step + cell / 2 + 3.5).toFixed(1)}">${WD_ROWS[wd]}</text>`);
    row.forEach((min, hr) => {
      const style = min > 0 ? ` style="fill-opacity:${(0.14 + 0.86 * (min / max)).toFixed(2)}"` : '';
      parts.push(`<rect class="hg${min > 0 ? '' : ' hg-empty'}" x="${(left + hr * step).toFixed(1)}" y="${(top + wd * step).toFixed(1)}" width="${cell.toFixed(1)}"
        height="${cell.toFixed(1)}" rx="2.5"${style}><title>${WD_LONG[wd]}, ${hr}–${hr + 1} Uhr · ${min > 0 ? fmtMin(Math.round(min)) : 'nichts'}</title></rect>`);
    });
  });
  for (let hr = 0; hr < 24; hr += 3) {
    parts.push(`<text class="ax" x="${(left + hr * step + cell / 2).toFixed(1)}" y="${height - 3}" text-anchor="middle">${hr}</text>`);
  }
  return `<svg class="hgrid" viewBox="0 0 ${w.toFixed(0)} ${height}" width="${w.toFixed(0)}" height="${height}" role="img" aria-label="Lernzeit nach Wochentag und Uhrzeit">${parts.join('')}</svg>`;
}

/** Every bucket as one column of 100 %, split by activity, so a shift in the mix shows over time. */
export function shareBars(agg, acts, { width = 700, height = 200 } = {}) {
  const L = 36, R = 8, T = 8, B = 26, w = width - L - R, h = height - T - B;
  const n = agg.buckets.length, slot = w / n, bw = Math.max(2, Math.min(38, slot * 0.68));
  const out = [];
  [0, 0.5, 1].forEach((f) => {
    const y = T + h - f * h;
    out.push(`<line class="gridline" x1="${L}" x2="${L + w}" y1="${y}" y2="${y}"/>`);
    out.push(`<text class="ax" x="${L - 6}" y="${y + 4}" text-anchor="end">${f * 100} %</text>`);
  });
  const every = Math.ceil(n / Math.min(16, Math.max(4, Math.floor(w / 40)))); // labels need about 40 px each
  agg.buckets.forEach((b, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    if (b.total > 0) {
      let y = T + h;
      out.push(`<g class="col" style="--i:${i}">`);
      for (const a of acts) {
        const m = b.by[a.name];
        if (!m) continue;
        const bh = (m / b.total) * h;
        y -= bh;
        out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${a.color}"><title>${esc(b.title)} · ${esc(a.name)}: ${Math.round((m / b.total) * 100)} % (${fmtH(m)})</title></rect>`);
      }
      out.push('</g>');
    }
    if (i % every === 0) out.push(`<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(b.label)}</text>`);
  });
  return `<svg class="bars share" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Anteile pro Monat">${out.join('')}</svg>`;
}
