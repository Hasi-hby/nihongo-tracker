import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregate, avgPerDay, chorusInfo, dayMap, nextMilestone, periodRange, questHistory, questPace, questProgress, recap, streakInfo,
  totals,
} from '../js/stats.js';
import { addDays, dayOf, fmtMinShort, parseDuration } from '../js/util.js';

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

test('daily average leaves out the running day', () => {
  const dm = dayMap([...logsOn(range('2026-09-21', 30), 240), ...logsOn(['2026-10-21'], 10)]);
  assert.equal(avgPerDay(dm, '2026-10-21'), 240);
});

test('next milestone is the next full hundred hours, with a date at the current pace', () => {
  const m = nextMilestone(2612 * 60, 240, '2026-10-21');
  assert.equal(m.hours, 2700);
  assert.equal(m.leftMin, 88 * 60);
  assert.equal(m.date, '2026-11-12'); // 88 h at 4 h a day = 22 days
  assert.equal(nextMilestone(2700 * 60, 0, '2026-10-21').hours, 2800);
  assert.equal(nextMilestone(100, 0, '2026-10-21').date, null);
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

// ---- goal pace (2026-10-19 is a Monday) ----
const weekGoal = { id: 'w', scope: 'week', a: 'Immersion', m: 1680 }; // 28 h a week = 4 h a day

test('pace: a Monday without logs is on plan, today still open', () => {
  const p = questPace(weekGoal, dayMap([]), '2026-10-19');
  assert.equal(p.expected, 0);
  assert.equal(p.ahead, 0);
  assert.equal(p.expectedPct, 0);
  assert.equal(p.left, 1680);
  assert.equal(p.daysLeft, 7);
  assert.equal(p.perDay, 240);
  assert.equal(p.end, '2026-10-25');
  assert.equal(questPace({ ...weekGoal, scope: 'day' }, dayMap([]), '2026-10-19'), null);
});

test('pace: mid-week ahead and behind plan, other activities do not count', () => {
  const mtw = range('2026-10-19', 3);
  const ahead = questPace(weekGoal, dayMap([...logsOn(mtw, 300), ...logsOn(mtw, 60, 'Anki')]), '2026-10-22');
  assert.equal(ahead.expected, 720); // three of seven days
  assert.equal(ahead.done, 900);
  assert.equal(ahead.ahead, 180);
  assert.equal(ahead.daysLeft, 4);
  assert.equal(ahead.perDay, 780 / 4);
  const behind = questPace(weekGoal, dayMap(logsOn(mtw, 150)), '2026-10-22');
  assert.equal(behind.ahead, -270);
  assert.equal(behind.left, 1230);
  assert.equal(behind.perDay, 1230 / 4);
  assert.equal(behind.complete, false);
});

test('pace: the last day of the week needs the rest today', () => {
  const p = questPace(weekGoal, dayMap(logsOn(range('2026-10-19', 6), 200)), '2026-10-25');
  assert.equal(p.daysLeft, 1);
  assert.equal(p.expected, 1440);
  assert.equal(p.ahead, -240);
  assert.equal(p.perDay, p.left);
  assert.equal(p.left, 480);
});

test('pace: a reached goal has nothing left', () => {
  const p = questPace(weekGoal, dayMap(logsOn(range('2026-10-19', 4), 450)), '2026-10-22');
  assert.equal(p.complete, true);
  assert.equal(p.left, 0);
  assert.equal(p.perDay, 0);
  assert.equal(p.ahead, 1800 - 720);
});

test('pace: month goals spread over 31 and 30 days', () => {
  const oct = questPace({ ...weekGoal, scope: 'month', m: 3100 }, dayMap(logsOn(range('2026-10-01', 10), 80)), '2026-10-11');
  assert.equal(oct.expected, 1000); // ten of 31 days
  assert.equal(oct.ahead, -200);
  assert.equal(oct.daysLeft, 21);
  assert.equal(oct.end, '2026-10-31');
  const nov = questPace({ ...weekGoal, scope: 'month', m: 3000 }, dayMap(logsOn(range('2026-11-01', 15), 100)), '2026-11-16');
  assert.equal(nov.expected, 1500); // 15 of 30 days
  assert.equal(nov.expectedPct, 0.5);
  assert.equal(nov.ahead, 0);
  assert.equal(nov.daysLeft, 15);
  assert.equal(nov.perDay, 100);
  assert.equal(nov.end, '2026-11-30');
});

test('pace: a week starting on Sunday', () => {
  const dm = dayMap(logsOn(['2026-10-18'], 240));
  const p = questPace(weekGoal, dm, '2026-10-19', 0);
  assert.equal(p.expected, 240); // Sunday is already past
  assert.equal(p.done, 240);
  assert.equal(p.ahead, 0);
  assert.equal(p.daysLeft, 6);
  assert.equal(p.end, '2026-10-24');
  assert.equal(questPace(weekGoal, dm, '2026-10-19', 1).done, 0); // with Monday weeks that Sunday was last week
});

// ---- chorus streak + penalty quest ----
const chorusDays = (spec) => dayMap(Object.entries(spec).map(([d, m], i) => ({ id: `c${i}`, d, t: 0, a: 'phonetic training', m, u: 0 })));

test('chorus: consecutive days build the streak, today stays open', () => {
  const c = chorusInfo(chorusDays({ '2026-10-01': 5, '2026-10-02': 8, '2026-10-03': 10 }), '2026-10-04');
  assert.equal(c.current, 3);
  assert.equal(c.state, 'open');
  assert.equal(c.need, 5);
  assert.equal(chorusInfo(chorusDays({ '2026-10-01': 4 }), '2026-10-02').current, 0); // under the minimum
});

test('chorus: a missed day turns today into a penalty quest with double time', () => {
  const c = chorusInfo(chorusDays({ '2026-10-01': 5, '2026-10-02': 5, '2026-10-04': 6 }), '2026-10-04');
  assert.equal(c.state, 'penalty');
  assert.equal(c.need, 10);
  assert.equal(c.penaltyFor, '2026-10-03');
  assert.equal(c.current, 2); // still alive, at stake
});

test('chorus: meeting the penalty redeems the missed day', () => {
  const c = chorusInfo(chorusDays({ '2026-10-01': 5, '2026-10-02': 5, '2026-10-04': 10, '2026-10-05': 5 }), '2026-10-05');
  assert.equal(c.current, 4);
  assert.equal(c.marks.get('2026-10-03'), 'redeemed');
  assert.equal(c.redeemedCount, 1);
  assert.deepEqual(c.redeemedOn, ['2026-10-04']);
  assert.equal(c.state, 'done');
});

test('chorus: failing the penalty breaks the streak (restart at 1 if the minimum was met)', () => {
  const restart = chorusInfo(chorusDays({ '2026-10-01': 5, '2026-10-02': 5, '2026-10-04': 6 }), '2026-10-05');
  assert.equal(restart.current, 1);
  assert.equal(restart.longest, 2);
  assert.equal(restart.marks.get('2026-10-03'), 'missed');
  const broken = chorusInfo(chorusDays({ '2026-10-01': 5, '2026-10-02': 5 }), '2026-10-05');
  assert.equal(broken.current, 0); // two missed days in a row
  assert.equal(broken.state, 'open');
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

test('short duration for tiles and chart labels', () => {
  assert.equal(fmtMinShort(45), '45 min');
  assert.equal(fmtMinShort(319), '5 h 19');
  assert.equal(fmtMinShort(304.4), '5 h 04');
  assert.equal(fmtMinShort(120), '2 h');
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
  const s = streakInfo(dm, c.today);
  assert.equal(s.current, c.streak);
  assert.equal(s.longest, c.longest);
  assert.equal(s.daysLogged, c.daysLogged);
});
