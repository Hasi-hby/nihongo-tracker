import test from 'node:test';
import assert from 'node:assert/strict';
import { ankiAutoLogs } from '../js/anki.js';

const NOW = 1793430000000;
const days = { '2026-10-30': { min: 10.0, last: 1793332324275 }, '2026-10-31': { min: 12.4, last: 1793421995386 } };
const byHand = (id, d, m, extra = {}) => ({ id, d, t: NOW, a: 'Anki', m, src: 'shortcut', u: NOW, ...extra });
const run = (logs, from = '2026-10-30') => ankiAutoLogs(days, logs, { from, now: NOW });

test('one log per day with Anki\'s study time, from the day it was switched on', () => {
  const out = run([], '2026-10-31');
  assert.deepEqual(out, [{ id: 'anki-2026-10-31', d: '2026-10-31', t: 1793421995386, a: 'Anki', m: 12, src: 'anki', u: NOW }]);
  assert.deepEqual(ankiAutoLogs(days, [], { now: NOW }), [], 'nothing without a start day');
});

test('what was logged by hand is subtracted, so nothing counts twice', () => {
  const out = run([byHand('h1', '2026-10-31', 9), byHand('h2', '2026-10-30', 4), { ...byHand('h3', '2026-10-30', 6), a: 'Immersion' }]);
  assert.deepEqual(out.map((l) => [l.d, l.m]), [['2026-10-30', 6], ['2026-10-31', 3]]);
  const gone = run([byHand('h1', '2026-10-31', 9, { x: 1 })]);
  assert.equal(gone.find((l) => l.d === '2026-10-31').m, 12, 'a deleted hand log no longer counts');
});

test('unchanged days write nothing; a new review updates the same log', () => {
  const logs = run([]);
  assert.deepEqual(run(logs), []);
  const later = ankiAutoLogs({ ...days, '2026-10-31': { min: 15.2, last: NOW } }, logs, { from: '2026-10-30', now: NOW });
  assert.deepEqual(later.map((l) => [l.id, l.m]), [['anki-2026-10-31', 15]]);
});

test('a day fully logged by hand loses its log, which may come back later', () => {
  const auto = run([]);
  const out = run([...auto, byHand('h1', '2026-10-31', 13)]);
  assert.deepEqual(out.map((l) => [l.id, l.x, l.src]), [['anki-2026-10-31', 1, 'anki-none']]);
  const tomb = [auto[0], out[0]];
  const back = ankiAutoLogs({ ...days, '2026-10-31': { min: 20, last: NOW } }, [...tomb, byHand('h1', '2026-10-31', 13)], { from: '2026-10-30', now: NOW });
  assert.deepEqual(back.map((l) => [l.id, l.m, l.x]), [['anki-2026-10-31', 7, undefined]]);
  assert.deepEqual(run([byHand('h1', '2026-10-31', 12.3)]).map((l) => l.d), ['2026-10-30'], 'under a minute left: no log');
});

test('a log deleted or edited by hand is left alone', () => {
  const [, today] = run([]);
  assert.deepEqual(run([{ ...today, x: 1 }]).map((l) => l.d), ['2026-10-30'], 'deleted');
  assert.deepEqual(run([{ ...today, m: 30, src: 'edit' }]).map((l) => l.d), ['2026-10-30'], 'edited');
});
