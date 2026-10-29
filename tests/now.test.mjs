import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePick, slimPicks } from '../js/now.js';

const NOW = Date.parse('2026-10-29T18:00:00Z');
const pick = (id, source, minutes, coverage, extra = {}) => ({
  id, source, series: `S-${id}`, title: `T-${id}`, url: `https://x/${id}`, minutes, coverage, until: null, ...extra,
});

test('picks.json keeps playable picks only, with a few fields each', () => {
  const data = {
    updated: '2026-10-29T05:09:57',
    picks: [
      { ...pick('a', 'youtube', 40, 0.8), words: [['対応', 'akut', 15]], acute: 5, hidden: false },
      { ...pick('b', 'local', 30, 0.9), url: 'file:///C:/x.srt' },
      { ...pick('c', 'tver', 45, 0.85), hidden: true },
      pick('d', 'tver', 45, 0.85, { until: NOW / 1000 - 60 }), // expired a minute ago
      pick('e', 'netflix', 52, 0.82, { until: NOW / 1000 + 3600 }),
      { ...pick('f', 'youtube', 10, 0.9), url: '' },
    ],
  };
  const s = slimPicks(data, NOW);
  assert.equal(s.updated, '2026-10-29T05:09:57');
  assert.deepEqual(s.picks.map((p) => p.id), ['a', 'e']);
  assert.deepEqual(Object.keys(s.picks[0]).sort(), ['coverage', 'id', 'minutes', 'series', 'source', 'title', 'until', 'url']);
  assert.deepEqual(slimPicks(null), { updated: '', picks: [] });
});

const PICKS = [
  pick('long', 'tver', 52, 0.8),
  pick('yt-hard', 'youtube', 44, 0.74),
  pick('short', 'netflix', 20, 0.78),
  pick('yt-easy', 'youtube', 191, 0.91),
  { ...pick('same-series', 'tver', 45, 0.85), series: 'S-long' },
  pick('tiny', 'youtube', 7, 0.8),
];

test('without a reason the best pick comes first, skipping started and turned down ones', () => {
  assert.equal(choosePick(PICKS, { now: NOW }).id, 'long');
  assert.equal(choosePick(PICKS, { skip: ['long', 'yt-hard'], now: NOW }).id, 'short');
  assert.equal(choosePick(PICKS, { skip: PICKS.map((p) => p.id), now: NOW }), null);
  assert.equal(choosePick([], { now: NOW }), null);
});

test('no time: the best short pick, else the shortest', () => {
  assert.equal(choosePick(PICKS, { reason: 'time', now: NOW }).id, 'short');
  assert.equal(choosePick(PICKS, { reason: 'time', skip: ['short', 'tiny'], now: NOW }).id, 'yt-hard');
});

test('something else first: the easiest YouTube video, any source when there is none', () => {
  assert.equal(choosePick(PICKS, { reason: 'else', now: NOW }).id, 'yt-easy');
  assert.equal(choosePick(PICKS, { reason: 'else', skip: ['yt-easy'], now: NOW }).id, 'tiny');
  const noYt = PICKS.filter((p) => p.source !== 'youtube');
  assert.equal(choosePick(noYt, { reason: 'else', now: NOW }).id, 'same-series');
});

test('do not know what: another series than the one shown', () => {
  const shown = PICKS[0];
  assert.equal(choosePick(PICKS, { reason: 'what', shown, skip: ['long'], now: NOW }).id, 'yt-hard');
  const two = [PICKS[0], PICKS[4]];
  assert.equal(choosePick(two, { reason: 'what', shown, skip: ['long'], now: NOW }).id, 'same-series', 'falls back to the same series');
});

test('expired TVer picks are never chosen', () => {
  const list = [pick('old', 'tver', 20, 0.9, { until: NOW / 1000 - 1 }), pick('ok', 'youtube', 30, 0.8)];
  assert.equal(choosePick(list, { now: NOW }).id, 'ok');
  assert.equal(choosePick(list, { reason: 'time', now: NOW }).id, 'ok');
});
