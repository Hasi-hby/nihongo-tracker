import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregate, dayMap, periodRange, questHistory, questProgress, recap, streakInfo, totals, weekCompare,
} from '../js/stats.js';
import { levelFor, rankFor } from '../js/hunter.js';
import { addDays, dayOf, parseDuration } from '../js/util.js';

const logsOn = (days, m = 30, a = 'Immersion') => days.map((d, i) => ({ id: d + i, d, t: 0, a, m, u: 0 }));
const range = (start, n) => Array.from({ length: n }, (_, i) => addDays(start, i));

test('streak counts consecutive days and an open today keeps it alive', () => {
  const dm = dayMap(logsOn(range('2026-10-01', 10)));
  const s = streakInfo(dm, '2026-10-11');
  assert.equal(s.current, 10);
  assert.equal(s.atRisk, true);
  assert.equal(streakInfo(dm, '2026-10-12').current, 0);
});

test('a gap breaks the streak but the longest one is kept', () => {
  const dm = dayMap(logsOn([...range('2026-09-01', 5), ...range('2026-09-08', 3)]));
  const s = streakInfo(dm, '2026-09-10');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 5);
  assert.equal(s.daysLogged, 8);
});

test('freezes only apply from freezeStart and bridge a missed day', () => {
  // gap on 09-06 before freezeStart breaks; gap on 09-20 after it is frozen
  const days = [...range('2026-09-01', 5), ...range('2026-09-07', 13), ...range('2026-09-21', 3)];
  const dm = dayMap(logsOn(days));
  const s = streakInfo(dm, '2026-09-23', { freezeStart: '2026-09-07', starterFreezes: 0 });
  assert.ok(s.frozen.has('2026-09-20'));
  assert.ok(!s.frozen.has('2026-09-06'));
  assert.equal(s.current, 16); // 13 + 3, frozen day does not add
});

test('no freeze left -> the streak breaks; freezes cap at 2', () => {
  const dm = dayMap(logsOn(range('2026-01-01', 40)));
  assert.equal(streakInfo(dm, '2026-02-09', { freezeStart: '2026-01-01' }).freezes, 2);
  const gap = dayMap(logsOn([...range('2026-01-01', 3), ...range('2026-01-05', 2)]));
  const s = streakInfo(gap, '2026-01-06', { freezeStart: '2026-01-01', starterFreezes: 0 });
  assert.equal(s.current, 2);
});

test('week comparison uses the full previous week (like LingoTrack)', () => {
  const dm = dayMap([...logsOn(range('2026-10-05', 7), 60), ...logsOn(range('2026-10-12', 2), 210)]);
  const w = weekCompare(dm, '2026-10-13');
  assert.equal(w.cur, 420);
  assert.equal(w.last, 420);
  assert.equal(w.pct, 0);
});

test('week buckets start on Monday and aggregate per activity', () => {
  const r = periodRange('week', '2026-10-18');
  assert.equal(r.start, '2026-10-12');
  assert.equal(r.buckets.length, 7);
  const dm = dayMap([...logsOn(['2026-10-12'], 20, 'Anki'), ...logsOn(['2026-10-12', '2026-10-13'], 40)]);
  const agg = aggregate(dm, r);
  assert.equal(agg.buckets[0].by.Anki, 20);
  assert.equal(agg.buckets[1].cum, 100);
  assert.equal(recap(dm, r, '2026-10-18').best.d, '2026-10-12');
});

test('quests: daily progress and cleared-day history', () => {
  const q = { id: 'q', scope: 'day', a: 'Anki', m: 15, since: '2026-10-10' };
  const dm = dayMap([...logsOn(['2026-10-10', '2026-10-11'], 15, 'Anki'), ...logsOn(['2026-10-12'], 60)]);
  assert.equal(questProgress(q, dm, '2026-10-11').complete, true);
  const month = { id: 'm', scope: 'month', a: '', m: 120, since: '2026-10-01' };
  assert.equal(questProgress(month, dm, '2026-10-12').done, 90);
  assert.equal(questProgress({ ...month, scope: 'week' }, dm, '2026-10-12').done, 60);
  const h = questHistory([q], dm, '2026-10-12');
  assert.equal(h.best, 2);
  assert.equal(h.hist.get('2026-10-12'), false);
});

test('custom day end moves a 2 am session to the previous day', () => {
  const t = new Date(2026, 9, 18, 2, 30).getTime();
  assert.equal(dayOf(t, 0), '2026-10-18');
  assert.equal(dayOf(t, 4), '2026-10-17');
});

test('duration parsing', () => {
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('1h30'), 90);
  assert.equal(parseDuration('1,5 h'), 90);
  assert.ok(Number.isNaN(parseDuration('abc')));
});

test('level and rank at the imported total', () => {
  assert.equal(levelFor(2598.87).level, 71);
  assert.equal(rankFor(2598.87).rank.id, 'A');
  assert.equal(rankFor(4000).rank.id, 'S');
});

// Compares the imported data with the values the LingoTrack dashboard showed at import time.
// Runs only next to the private data clone, which holds those values in checks.json.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'nihongo-tracker-data');
test('imported data matches the LingoTrack dashboard', { skip: !existsSync(join(dataDir, 'checks.json')) }, () => {
  const c = JSON.parse(readFileSync(join(dataDir, 'checks.json'), 'utf8'));
  const logs = ['2025', '2026'].flatMap((y) => JSON.parse(readFileSync(join(dataDir, 'logs', `${y}.json`), 'utf8')).logs)
    .filter((l) => l.src === 'lt');
  const dm = dayMap(logs);
  const t = totals(dm);
  assert.equal(t.count, c.logs);
  assert.equal((t.total / 60).toFixed(1), c.hours);
  const s = streakInfo(dm, c.today, { freezeStart: c.freezeStart, starterFreezes: 1 });
  assert.equal(s.current, c.streak);
  assert.equal(s.longest, c.longest);
  assert.equal(s.daysLogged, c.daysLogged);
  assert.equal(weekCompare(dm, c.today).pct, c.weekPct);
});
