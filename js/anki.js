// Anki's study time logs itself (on the PC): the helper reads it from Anki's review log
// (pc.js → /anki-time), and this turns it into one "Anki" log per day.

const autoId = (d) => `anki-${d}`;

/**
 * The logs to write so that each day from `from` on holds Anki's study time: one log `anki-<day>`
 * with what the day's hand-made Anki logs don't cover yet. Only new or changed ones come back.
 * When hand-made logs cover the whole day, its log goes (tombstone with src 'anki-none', it may
 * come back later). A log deleted by hand (src still 'anki') or edited by hand (src 'edit') is left alone.
 * `days`: { 'YYYY-MM-DD': { min, last } } from the helper, `last` the day's last review (ms).
 */
export function ankiAutoLogs(days, logs, { from, activity = 'Anki', now = Date.now() } = {}) {
  const byId = new Map(logs.map((l) => [l.id, l]));
  const byHand = {};
  for (const l of logs) {
    if (!l.x && l.a === activity && l.id !== autoId(l.d)) byHand[l.d] = (byHand[l.d] || 0) + l.m;
  }
  const out = [];
  for (const [d, { min, last }] of Object.entries(days || {})) {
    if (!from || d < from) continue;
    const id = autoId(d), cur = byId.get(id);
    if (cur && !['anki', 'anki-none'].includes(cur.src)) continue; // edited by hand
    if (cur?.x && cur.src === 'anki') continue; // deleted by hand
    const m = Math.round(min - (byHand[d] || 0));
    if (m >= 1) {
      if (!cur || cur.x || cur.m !== m || cur.a !== activity) out.push({ id, d, t: last || now, a: activity, m, src: 'anki', u: now });
    } else if (cur && !cur.x) {
      out.push({ ...cur, x: 1, src: 'anki-none', u: now });
    }
  }
  return out;
}
