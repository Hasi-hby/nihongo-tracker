import test from 'node:test';
import assert from 'node:assert/strict';
import { canonLog, cmp, defaultMeta, mergeLists, mergeMeta, renameActivity, serializeLogs } from '../js/merge.js';

const log = (id, u, extra = {}) => ({ id, d: '2026-10-18', t: 1000 + u, a: 'Anki', m: 15, src: 'manual', u, ...extra });

test('newer remote record replaces local and is reported for local apply', () => {
  const r = mergeLists([log('a', 1)], [log('a', 2, { m: 30 })]);
  assert.equal(r.items[0].m, 30);
  assert.equal(r.toLocal.length, 1);
  assert.equal(r.remoteBehind, false);
});

test('newer local record wins and marks the remote as behind', () => {
  const r = mergeLists([log('a', 5, { m: 40 })], [log('a', 2)]);
  assert.equal(r.items[0].m, 40);
  assert.equal(r.toLocal.length, 0);
  assert.equal(r.remoteBehind, true);
});

test('identical records produce no work, regardless of key order', () => {
  const a = log('a', 3);
  const b = Object.fromEntries(Object.entries(a).reverse());
  const r = mergeLists([a], [b]);
  assert.equal(r.toLocal.length, 0);
  assert.equal(r.remoteBehind, false);
  assert.equal(cmp(a, b), 0);
});

test('union of both sides; local-only records need a push', () => {
  const r = mergeLists([log('a', 1), log('b', 1)], [log('a', 1), log('c', 1)]);
  assert.deepEqual(r.items.map((x) => x.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(r.toLocal.map((x) => x.id), ['c']);
  assert.equal(r.remoteBehind, true);
});

test('a newer tombstone deletes on the other device', () => {
  const r = mergeLists([log('a', 1)], [log('a', 9, { x: 1 })]);
  assert.equal(r.items[0].x, 1);
  assert.equal(r.toLocal.length, 1);
});

test('fresh-device defaults (u=0) never overwrite synced meta', () => {
  const remote = defaultMeta();
  remote.shortcuts = [{ id: 's1', a: 'Anki', m: 25, o: 0, u: 100 }];
  remote.settings = { ...remote.settings, dayEnd: 4, u: 100 };
  const m = mergeMeta(defaultMeta(), remote);
  assert.equal(m.meta.shortcuts.find((s) => s.id === 's1').m, 25);
  assert.equal(m.meta.settings.dayEnd, 4);
  assert.equal(m.localChanged, true);
});

test('serialized log files are canonical and round-trip', () => {
  const l = { u: 2, x: 0, n: '', id: 'z', a: 'Anki', m: 5, d: '2026-01-01', t: 5, src: 'timer' };
  assert.deepEqual(Object.keys(canonLog(l)), ['id', 'd', 't', 'a', 'm', 'src', 'u']);
  const text = serializeLogs([log('b', 2), log('a', 1)]);
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.logs.map((x) => x.id), ['a', 'b']);
  assert.equal(serializeLogs(parsed.logs), text);
});

const act = (meta, id) => meta.activities.find((a) => a.id === id);
const entry = (id, a, extra = {}) => ({ id, d: '2026-10-19', t: 1, a, m: 5, u: 1, ...extra });

test('renaming an activity moves its live logs, shortcuts, quests and the chorus quest', () => {
  const meta = defaultMeta();
  meta.quests = [{ id: 'q', scope: 'day', a: 'phonetic training', m: 10, u: 1 }];
  const logs = [entry('1', 'phonetic training'), entry('2', 'Anki'), entry('3', 'phonetic training', { x: 1 })];
  const r = renameActivity(logs, meta, 'phonetic training', 'Chorusing', 99, { chorusDefault: 'phonetic training' });
  assert.equal(r.merged, false);
  assert.deepEqual(r.logs.map((l) => [l.id, l.a, l.u]), [['1', 'Chorusing', 99]]);
  assert.equal(act(r.meta, 'phonetic training').name, 'Chorusing');
  assert.equal(act(r.meta, 'phonetic training').u, 99);
  assert.equal(r.meta.shortcuts.find((s) => s.id === 's5').a, 'Chorusing');
  assert.equal(r.meta.quests[0].a, 'Chorusing');
  assert.equal(r.meta.settings.chorus.a, 'Chorusing');
  assert.equal(act(meta, 'phonetic training').name, 'phonetic training', 'input untouched');
});

test('renaming onto an existing activity merges and hides the old one', () => {
  const meta = defaultMeta();
  meta.activities.push({ id: 'Anki/immersion', name: 'Anki/immersion', color: '#fff', attr: 'listen', o: 9, u: 1 });
  const r = renameActivity([entry('1', 'Anki/immersion')], meta, 'Anki/immersion', 'Immersion', 99);
  assert.equal(r.merged, true);
  assert.equal(r.logs[0].a, 'Immersion');
  assert.equal(act(r.meta, 'Anki/immersion').x, 1);
  assert.equal(act(r.meta, 'Immersion').u, 0, 'target untouched');
  assert.equal(r.meta.settings, meta.settings, 'chorus not involved');
});

test('merging into a hidden activity brings it back', () => {
  const meta = defaultMeta();
  meta.activities = meta.activities.map((a) => (a.id === 'Anki' ? { ...a, x: 1 } : a));
  const r = renameActivity([], meta, 'Output', 'Anki', 7);
  assert.equal(r.merged, true);
  assert.equal(act(r.meta, 'Anki').x, 0);
  assert.equal(act(r.meta, 'Output').x, 1);
});
