// Date strings are local calendar days "YYYY-MM-DD"; arithmetic on them runs in UTC
// so DST never shifts a day.

export const pad = (n) => String(n).padStart(2, '0');

export function ymdLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Calendar day a moment belongs to, honouring a custom day end (hours after midnight). */
export function dayOf(ms, dayEnd = 0) {
  return ymdLocal(new Date(ms - dayEnd * 3600e3));
}

export const todayStr = (dayEnd = 0) => dayOf(Date.now(), dayEnd);

export function parseD(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const fmtUTC = (dt) => dt.toISOString().slice(0, 10);

export function addDays(s, n) {
  const d = parseD(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtUTC(d);
}

/** b - a in days */
export const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);

/** 0 = Sunday … 6 = Saturday */
export const weekday = (s) => parseD(s).getUTCDay();

export function startOfWeek(s, ws = 1) {
  return addDays(s, -((weekday(s) - ws + 7) % 7));
}

export const startOfMonth = (s) => s.slice(0, 8) + '01';

export function addMonths(s, n) {
  const d = parseD(startOfMonth(s));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fmtUTC(d);
}

export const endOfMonth = (s) => addDays(addMonths(s, 1), -1);

export function* eachDay(a, b) {
  for (let d = a; d <= b; d = addDays(d, 1)) yield d;
}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function fmtDate(s, { weekday: wd = false, year = true } = {}) {
  const [y, m, d] = s.split('-').map(Number);
  return `${wd ? WD_SHORT[weekday(s)] + ', ' : ''}${d}. ${MONTHS_SHORT[m - 1]}${year ? ' ' + y : ''}`;
}

const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export const fmtNum = (n) => nf0.format(n);

/** minutes -> "2.598,9 h" */
export const fmtH = (min) => nf1.format(min / 60) + ' h';

/** minutes -> "1 h 9 min" / "45 min" */
export function fmtMin(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "45", "1:30", "1h30", "1 h 30 min", "1,5h" -> minutes (or NaN) */
export function parseDuration(text) {
  const t = String(text).trim().toLowerCase().replace(',', '.');
  if (!t) return NaN;
  let m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return +m[1] * 60 + +m[2];
  m = t.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*(?:m|min)?)?$/);
  if (m) return Math.round(+m[1] * 60 + (m[2] ? +m[2] : 0));
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:m|min)?$/);
  if (m) return +m[1];
  return NaN;
}

export const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
