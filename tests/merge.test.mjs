import test from 'node:test';
import assert from 'node:assert/strict';
import { canonLog, cmp, defaultMeta, mergeLists, mergeMeta, serializeLogs } from '../js/merge.js';

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
