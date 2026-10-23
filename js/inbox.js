// Inbox: logs written from outside the app (iOS shortcut, tools/log.py) as single files
// inbox/<name>.json in the data repo. Sync turns them into normal logs and deletes the file.
//   {"a":"Immersion","m":20,"md":"Solo Leveling S1E03","t":"2026-10-19T20:15:00+02:00","src":"siri"}
// or several at once as {"logs":[...]}. Only `a` and `m` are required. Everything derived
// here is deterministic, so two devices handling the same file produce identical logs.

import { canonLog } from './merge.js?v=2.3.0';
import { dayOf, parseDuration } from './util.js?v=2.3.0';

const MAX_TEXT = 500;

/** ms from a number (seconds or ms) or a date string; undefined when missing, NaN when unreadable. */
function parseTime(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e11 ? Math.round(v * 1000) : Math.round(v)) : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseTime(+s);
  return Date.parse(s);
}

const text = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : typeof v === 'number' ? String(v) : '');

/**
 * name: file name (e.g. "1792345678901-a1b2c3.json"), data: its parsed JSON.
 * Returns { logs, errors }: errors are readable messages; a file with errors should not be imported.
 */
export function parseInbox(name, data, { dayEnd = 0, actNames = [], now = Date.now() } = {}) {
  const base = String(name).split('/').pop().replace(/\.json$/i, '');
  const entries = Array.isArray(data?.logs) ? data.logs : Array.isArray(data) ? data : [data];
  const logs = [], errors = [];
  if (!entries.length) errors.push('keine Einträge');
  const byLower = new Map(actNames.map((n) => [n.toLowerCase(), n]));
  const fileTime = base.match(/^(\d{10,13})(?!\d)/);

  entries.forEach((e, i) => {
    const where = entries.length > 1 ? `Eintrag ${i + 1}: ` : '';
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`${where}kein Objekt`); return; }
    const a0 = text(e.a);
    if (!a0) { errors.push(`${where}Aktivität (a) fehlt`); return; }
    const a = byLower.get(a0.toLowerCase()) || a0.slice(0, 60);
    const m0 = typeof e.m === 'number' ? e.m : parseDuration(e.m ?? '');
    if (!(m0 > 0 && m0 <= 1440)) { errors.push(`${where}Dauer (m) ungültig: ${JSON.stringify(e.m ?? null)}`); return; }
    let t = parseTime(e.t);
    if (Number.isNaN(t)) { errors.push(`${where}Zeit (t) unlesbar: ${JSON.stringify(e.t)}`); return; }
    if (t === undefined) t = fileTime ? parseTime(+fileTime[1]) : now;
    const d = typeof e.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.d) ? e.d : dayOf(t, dayEnd);
    const src = typeof e.src === 'string' && /^[\w-]{1,20}$/.test(e.src) ? e.src : 'inbox';
    const u = Number.isFinite(e.u) && e.u > 0 ? e.u : t;
    logs.push(canonLog({
      id: e.id ? String(e.id).slice(0, 80) : entries.length > 1 ? `ib-${base}-${i}` : `ib-${base}`,
      d, t, a, m: Math.round(m0 * 100) / 100, n: text(e.n), md: text(e.md), src, u,
    }));
  });
  return { logs, errors };
}
