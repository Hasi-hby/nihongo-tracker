// Solo-Leveling-style progression: XP = minutes, level L needs L(L+1)/2 hours in total.

import { startOfWeek } from './util.js?v=1.1.1';

export const RANKS = [
  { id: 'E', name: 'E-Rang', h: 0, color: '#9ca3af' },
  { id: 'D', name: 'D-Rang', h: 250, color: '#a3e635' },
  { id: 'C', name: 'C-Rang', h: 750, color: '#34d399' },
  { id: 'B', name: 'B-Rang', h: 1500, color: '#38bdf8' },
  { id: 'A', name: 'A-Rang', h: 2500, color: '#818cf8' },
  { id: 'S', name: 'S-Rang', h: 4000, color: '#f472b6' },
  { id: 'N', name: 'National Level', h: 6000, color: '#fbbf24' },
  { id: 'M', name: 'Shadow Monarch', h: 10000, color: '#c084fc' },
];

export const levelHours = (L) => (L * (L + 1)) / 2;

export function levelFor(hours) {
  const L = Math.max(0, Math.floor((Math.sqrt(8 * hours + 1) - 1) / 2));
  const cur = levelHours(L), next = levelHours(L + 1);
  return { level: L, cur, next, toNext: next - hours, progress: (hours - cur) / (next - cur) };
}

export function rankFor(hours) {
  let idx = 0;
  RANKS.forEach((r, i) => { if (hours >= r.h) idx = i; });
  const rank = RANKS[idx], next = RANKS[idx + 1] || null;
  return {
    rank, idx, next,
    toNext: next ? next.h - hours : 0,
    progress: next ? (hours - rank.h) / (next.h - rank.h) : 1,
  };
}

export const ATTRS = [
  { id: 'listen', name: 'Hören', short: 'HÖR' },
  { id: 'memory', name: 'Gedächtnis', short: 'GED' },
  { id: 'output', name: 'Output', short: 'OUT' },
  { id: 'pron', name: 'Aussprache', short: 'AUS' },
  { id: 'read', name: 'Lesen', short: 'LES' },
];

/** Hours per attribute and a stat value (10·√h) so small skills still show up on the radar. */
export function attributes(byActivity, activities) {
  const attrOf = new Map(activities.filter((a) => !a.x).map((a) => [a.name, a.attr]));
  const hours = Object.fromEntries(ATTRS.map((a) => [a.id, 0]));
  for (const [name, min] of Object.entries(byActivity)) {
    const attr = attrOf.get(name) || 'listen';
    if (attr in hours) hours[attr] += min / 60;
  }
  return ATTRS.map((a) => ({ ...a, hours: hours[a.id], stat: Math.round(10 * Math.sqrt(hours[a.id])) }));
}

const H = 60;
export const ACHIEVEMENTS = [
  { id: 'first', icon: '⚔', name: 'Erwachen', desc: 'Erster Log' },
  { id: 'h100', icon: '◆', name: '100 Stunden', desc: '100 h gesamt', min: 100 * H },
  { id: 'h1000', icon: '◆', name: 'Tausend-Stunden-Hunter', desc: '1.000 h gesamt', min: 1000 * H },
  { id: 'h2500', icon: '◆', name: 'Elite-Hunter', desc: '2.500 h gesamt', min: 2500 * H },
  { id: 'h5000', icon: '◆', name: 'Unaufhaltsam', desc: '5.000 h gesamt', min: 5000 * H },
  { id: 'h10000', icon: '♛', name: 'Shadow Monarch', desc: '10.000 h gesamt', min: 10000 * H },
  { id: 's7', icon: '🔥', name: 'Wochen-Krieger', desc: '7 Tage Streak', streak: 7 },
  { id: 's100', icon: '🔥', name: 'Hundert Tage', desc: '100 Tage Streak', streak: 100 },
  { id: 's365', icon: '🔥', name: 'Ein Jahr ohne Pause', desc: '365 Tage Streak', streak: 365 },
  { id: 's500', icon: '🔥', name: 'Eiserner Wille', desc: '500 Tage Streak', streak: 500 },
  { id: 's1000', icon: '🔥', name: 'Legende', desc: '1.000 Tage Streak', streak: 1000 },
  { id: 'day10', icon: '⚡', name: 'Marathon', desc: '10 h an einem Tag', day: 10 * H },
  { id: 'week40', icon: '⚡', name: 'Wochenmonster', desc: '40 h in einer Kalenderwoche', week: 40 * H },
  { id: 'versatile', icon: '✦', name: 'Vielseitig', desc: '4 verschiedene Aktivitäten an einem Tag' },
  { id: 'night', icon: '☾', name: 'Nachtschicht', desc: 'Log zwischen 0 und 4 Uhr' },
  { id: 'quest7', icon: '✔', name: 'Quest-Meister', desc: '7 Tage alle Daily Quests erfüllt' },
];

/** Unlock date for each achievement, replayed over the whole history. */
export function achievements(dm, streak, logs, questHist, ws = 1) {
  const got = {};
  const hit = (id, d) => { if (!got[id]) got[id] = d; };
  const week = new Map();
  let cum = 0;
  for (const d of [...dm.keys()].sort()) {
    const e = dm.get(d);
    if (e.total <= 0) continue;
    cum += e.total;
    hit('first', d);
    const s = streak.perDay.get(d) || 0;
    const wk = startOfWeek(d, ws);
    const w = (week.get(wk) || 0) + e.total;
    week.set(wk, w);
    for (const a of ACHIEVEMENTS) {
      if (a.min && cum >= a.min) hit(a.id, d);
      if (a.streak && s >= a.streak) hit(a.id, d);
      if (a.day && e.total >= a.day) hit(a.id, d);
      if (a.week && w >= a.week) hit(a.id, d);
    }
    if (Object.keys(e.by).length >= 4) hit('versatile', d);
  }
  let night = null;
  for (const l of logs) {
    if (l.x) continue;
    const h = new Date(l.t).getHours();
    if (h < 4 && (!night || l.d < night)) night = l.d;
  }
  if (night) hit('night', night);
  let run = 0;
  for (const [d, ok] of questHist) {
    run = ok ? run + 1 : 0;
    if (run >= 7) hit('quest7', d);
  }
  return ACHIEVEMENTS.map((a) => ({ ...a, date: got[a.id] || null }));
}
