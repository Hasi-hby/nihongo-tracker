import {
  addDays, addMonths, eachDay, endOfMonth, fmtDate, MONTHS, MONTHS_SHORT, startOfMonth,
  startOfWeek, WD_SHORT, weekday,
} from './util.js?v=2.2.0';

/** date -> { total, count, by: { activity: minutes } } for live (non-deleted) logs */
export function dayMap(logs) {
  const m = new Map();
  for (const l of logs) {
    if (l.x) continue;
    let e = m.get(l.d);
    if (!e) m.set(l.d, (e = { total: 0, count: 0, by: {} }));
    e.total += l.m;
    e.count++;
    e.by[l.a] = (e.by[l.a] || 0) + l.m;
  }
  return m;
}

export function totals(dm) {
  let total = 0, count = 0;
  const by = {};
  for (const e of dm.values()) {
    total += e.total;
    count += e.count;
    for (const [a, m] of Object.entries(e.by)) by[a] = (by[a] || 0) + m;
  }
  return { total, count, by, days: [...dm.values()].filter((e) => e.total > 0).length };
}

export function sumRange(dm, a, b, activity = null) {
  let s = 0;
  for (const d of eachDay(a, b)) {
    const e = dm.get(d);
    if (e) s += activity ? e.by[activity] || 0 : e.total;
  }
  return s;
}

/**
 * Streak: a day counts when something was logged, a missed day breaks it. Today without
 * a log keeps the streak alive (still open). Fully derived from the logs, so every device agrees.
 */
export function streakInfo(dm, today) {
  const days = [...dm.keys()].filter((d) => dm.get(d).total > 0).sort();
  const res = {
    current: 0, longest: 0, daysLogged: days.length, todayDone: (dm.get(today)?.total || 0) > 0, atRisk: false,
  };
  if (!days.length) return res;
  let streak = 0;
  for (const d of eachDay(days[0], today)) {
    if ((dm.get(d)?.total || 0) > 0) {
      streak++;
      res.longest = Math.max(res.longest, streak);
    } else if (d !== today) {
      streak = 0;
    }
  }
  res.current = streak;
  res.atRisk = !res.todayDone && streak > 0;
  return res;
}

/**
 * Chorus streak with a catch-up day. A day counts when `activity` reaches `min` minutes.
 * A missed day does not break a running streak at once: the next day becomes a catch-up
 * day (state 'penalty') that needs `min * factor`. Meet it and the missed day is redeemed (streak goes on);
 * miss it and the streak breaks (restarting at 1 if that day still reached `min`).
 * Two missed days in a row always break. Derived from the logs only.
 */
export function chorusInfo(dm, today, { activity = 'phonetic training', min = 5, factor = 2 } = {}) {
  const amount = (d) => dm.get(d)?.by[activity] || 0;
  const penaltyNeed = Math.ceil(min * factor);
  const res = {
    current: 0, longest: 0, perDay: new Map(), marks: new Map(), state: 'open', need: min,
    doneToday: amount(today), redeemedCount: 0, redeemedOn: [], daysDone: 0, totalMin: 0, penaltyFor: null, first: null,
  };
  const days = [...dm.keys()].filter((d) => amount(d) > 0).sort();
  for (const d of days) res.totalMin += amount(d);
  if (!days.length) return res;
  res.first = days[0];
  let streak = 0, pending = null;
  const done = (d) => {
    streak++;
    res.daysDone++;
    res.marks.set(d, 'done');
    res.perDay.set(d, streak);
  };
  for (const d of eachDay(days[0], today)) {
    const m = amount(d), isToday = d === today;
    if (pending) {
      if (m >= penaltyNeed) {
        res.marks.set(pending, 'redeemed');
        res.redeemedCount++;
        res.redeemedOn.push(d);
        pending = null;
        done(d);
      } else if (isToday) {
        res.state = 'penalty';
        res.penaltyFor = pending;
        res.need = penaltyNeed;
      } else {
        res.marks.set(pending, 'missed');
        pending = null;
        streak = 0;
        if (m >= min) done(d); else res.marks.set(d, 'missed');
      }
    } else if (m >= min) {
      done(d);
    } else if (!isToday) {
      if (streak > 0) pending = d; else res.marks.set(d, 'missed');
    }
    res.longest = Math.max(res.longest, streak);
  }
  res.current = streak;
  if (res.marks.get(today) === 'done') res.state = 'done';
  return res;
}

export const PERIODS = [
  { id: 'week', label: 'Woche' }, { id: 'month', label: 'Monat' },
  { id: 'year', label: 'Jahr' }, { id: 'all', label: 'All-time' },
];

/** Buckets for the history chart. anchor = any day inside the period. */
export function periodRange(kind, anchor, { ws = 1, firstDay = null, today } = {}) {
  const day = (d) => ({ key: d, start: d, end: d });
  if (kind === 'week') {
    const s = startOfWeek(anchor, ws), e = addDays(s, 6);
    const buckets = [...eachDay(s, e)].map((d) => ({ ...day(d), label: WD_SHORT[weekday(d)], title: fmtDate(d, { weekday: true }) }));
    return { kind, start: s, end: e, label: `${fmtDate(s, { year: false })} – ${fmtDate(e)}`, buckets };
  }
  if (kind === 'month') {
    const s = startOfMonth(anchor), e = endOfMonth(anchor);
    const buckets = [...eachDay(s, e)].map((d) => ({ ...day(d), label: String(+d.slice(8)), title: fmtDate(d, { weekday: true }) }));
    return { kind, start: s, end: e, label: `${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`, buckets };
  }
  const months = (s, e) => {
    const out = [];
    for (let m = s; m <= e; m = addMonths(m, 1)) {
      out.push({ key: m, start: m, end: endOfMonth(m), label: MONTHS_SHORT[+m.slice(5, 7) - 1], title: `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` });
    }
    return out;
  };
  if (kind === 'year') {
    const y = anchor.slice(0, 4), s = `${y}-01-01`, e = `${y}-12-31`;
    return { kind, start: s, end: e, label: y, buckets: months(s, `${y}-12-01`) };
  }
  const end = today || anchor;
  const s = startOfMonth(firstDay || end);
  const buckets = months(s, startOfMonth(end)).map((b, i) => (
    i === 0 || b.label === 'Jan' ? { ...b, label: `${b.label} ${b.key.slice(2, 4)}` } : b));
  return { kind, start: s, end, label: 'Gesamter Zeitraum', buckets };
}

export function shiftAnchor(kind, anchor, dir) {
  if (kind === 'week') return addDays(anchor, 7 * dir);
  if (kind === 'month') return addMonths(anchor, dir);
  if (kind === 'year') return addMonths(anchor, 12 * dir);
  return anchor;
}

/** Fill buckets with per-activity minutes and a running cumulative total. */
export function aggregate(dm, range) {
  const sum = { total: 0, by: {}, days: 0, count: 0 };
  let cum = 0;
  const buckets = range.buckets.map((b) => {
    const out = { ...b, total: 0, by: {} };
    for (const d of eachDay(b.start, b.end)) {
      const e = dm.get(d);
      if (!e) continue;
      out.total += e.total;
      sum.count += e.count;
      if (e.total > 0) sum.days++;
      for (const [a, m] of Object.entries(e.by)) {
        out.by[a] = (out.by[a] || 0) + m;
        sum.by[a] = (sum.by[a] || 0) + m;
      }
    }
    sum.total += out.total;
    cum += out.total;
    out.cum = cum;
    return out;
  });
  return { buckets, ...sum };
}

/** Recap for a period: best day, average per elapsed day, top activity, change vs previous period. */
export function recap(dm, range, today, ws = 1) {
  const end = range.end < today ? range.end : today;
  let best = null, total = 0, active = 0, elapsed = 0;
  const by = {};
  if (range.start <= end) {
    for (const d of eachDay(range.start, end)) {
      elapsed++;
      const e = dm.get(d);
      if (!e || e.total <= 0) continue;
      active++;
      total += e.total;
      if (!best || e.total > best.total) best = { d, total: e.total };
      for (const [a, m] of Object.entries(e.by)) by[a] = (by[a] || 0) + m;
    }
  }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0] || null;
  let prev = null;
  if (range.kind !== 'all') {
    const p = periodRange(range.kind, shiftAnchor(range.kind, range.start, -1), { ws });
    // compare the same number of elapsed days, so a running week is not compared to a full one
    const pEnd = range.end <= today ? p.end : addDays(p.start, Math.max(0, elapsed - 1));
    prev = sumRange(dm, p.start, pEnd < p.end ? pEnd : p.end);
  }
  return {
    total, active, elapsed, best, top, avg: elapsed ? total / elapsed : 0, prev,
    pct: prev ? Math.round((total / prev - 1) * 100) : null,
  };
}

/** Average minutes per day over the `n` days before today (the running day would pull it down). */
export function avgPerDay(dm, today, n = 30) {
  return sumRange(dm, addDays(today, -n), addDays(today, -1)) / n;
}

/** The next full hundred hours above `totalMin`, minutes left, and the expected day at `perDay` minutes a day. */
export function nextMilestone(totalMin, perDay, today) {
  const hours = (Math.floor(totalMin / 6000) + 1) * 100;
  const leftMin = hours * 60 - totalMin;
  return { hours, leftMin, date: perDay > 0 ? addDays(today, Math.ceil(leftMin / perDay)) : null };
}

// ---- Quests (goals) -------------------------------------------------------

const questAmount = (q, e) => (e ? (q.a ? e.by[q.a] || 0 : e.total) : 0);

export const QUEST_SCOPES = [
  { id: 'day', label: 'Täglich', per: '' },
  { id: 'week', label: 'Wöchentlich', per: ' / Woche' },
  { id: 'month', label: 'Monatlich', per: ' / Monat' },
];

export function questProgress(q, dm, today, ws = 1) {
  const s = q.scope === 'week' ? startOfWeek(today, ws) : q.scope === 'month' ? startOfMonth(today) : today;
  let done = 0;
  for (const d of eachDay(s, today)) done += questAmount(q, dm.get(d));
  return { done, target: q.m, pct: Math.min(1, done / q.m), complete: done >= q.m };
}

/** Daily quest history: a day is cleared when every daily quest active that day was met. */
export function questHistory(quests, dm, today) {
  const daily = quests.filter((q) => !q.x && q.scope === 'day');
  const hist = new Map();
  if (!daily.length) return { hist, streak: 0, best: 0 };
  const first = daily.map((q) => q.since || today).sort()[0];
  let run = 0, best = 0;
  for (const d of eachDay(first, today)) {
    const active = daily.filter((q) => (q.since || today) <= d);
    if (!active.length) continue;
    const ok = active.every((q) => questAmount(q, dm.get(d)) >= q.m);
    hist.set(d, ok);
    if (ok) best = Math.max(best, ++run);
    else if (d !== today) run = 0;
  }
  return { hist, streak: run, best };
}
