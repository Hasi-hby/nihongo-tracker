import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInbox } from '../js/inbox.js';

const opts = { dayEnd: 0, actNames: ['Immersion', 'Anki'], now: Date.parse('2026-10-19T12:00:00') };

test('a minimal entry becomes a full log with a deterministic id', () => {
  const t = Date.parse('2026-10-19T20:15:00');
  const r = parseInbox('20261019-201500.json', { a: 'Immersion', m: 20, t }, opts);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.logs, [{ id: 'ib-20261019-201500', d: '2026-10-19', t, a: 'Immersion', m: 20, src: 'inbox', u: t }]);
  assert.deepEqual(parseInbox('20261019-201500.json', { a: 'Immersion', m: 20, t }, opts).logs, r.logs);
});

test('time from ISO string, seconds, or the file name; otherwise now', () => {
  const iso = parseInbox('x.json', { a: 'Anki', m: 5, t: '2026-10-19T20:15:00+02:00' }, opts).logs[0];
  assert.equal(iso.t, Date.parse('2026-10-19T18:15:00Z'));
  const sec = parseInbox('x.json', { a: 'Anki', m: 5, t: 1792345678 }, opts).logs[0];
  assert.equal(sec.t, 1792345678000);
  const file = parseInbox('1792345678901-a1b2c3.json', { a: 'Anki', m: 5 }, opts).logs[0];
  assert.equal(file.t, 1792345678901);
  assert.equal(file.id, 'ib-1792345678901-a1b2c3');
  const none = parseInbox('20261019-201500.json', { a: 'Anki', m: 5 }, opts).logs[0];
  assert.equal(none.t, opts.now);
});

test('the day honours a custom day end, unless d is given', () => {
  const t = Date.parse('2026-10-20T01:30:00');
  assert.equal(parseInbox('x.json', { a: 'Anki', m: 5, t }, { ...opts, dayEnd: 3 }).logs[0].d, '2026-10-19');
  assert.equal(parseInbox('x.json', { a: 'Anki', m: 5, t }, opts).logs[0].d, '2026-10-20');
  assert.equal(parseInbox('x.json', { a: 'Anki', m: 5, t, d: '2026-10-18' }, opts).logs[0].d, '2026-10-18');
});

test('activity names match case-insensitively; unknown ones are kept', () => {
  assert.equal(parseInbox('x.json', { a: ' immersion ', m: 5 }, opts).logs[0].a, 'Immersion');
  assert.equal(parseInbox('x.json', { a: 'Lesen', m: 5 }, opts).logs[0].a, 'Lesen');
});

test('durations as text, optional fields, source', () => {
  const l = parseInbox('x.json', { a: 'Anki', m: '1:30', md: ' Solo Leveling ', n: 'Folge 3', src: 'siri' }, opts).logs[0];
  assert.equal(l.m, 90);
  assert.equal(l.md, 'Solo Leveling');
  assert.equal(l.n, 'Folge 3');
  assert.equal(l.src, 'siri');
  assert.equal(parseInbox('x.json', { a: 'Anki', m: '20', src: 'bad source!' }, opts).logs[0].src, 'inbox');
});

test('invalid entries are reported, not imported', () => {
  for (const e of [{ m: 5 }, { a: 'Anki' }, { a: 'Anki', m: 0 }, { a: 'Anki', m: 2000 }, { a: 'Anki', m: 'viel' },
    { a: 'Anki', m: 5, t: 'gestern' }, null, 'Immersion 20']) {
    const r = parseInbox('x.json', e, opts);
    assert.equal(r.logs.length, 0, JSON.stringify(e));
    assert.equal(r.errors.length, 1, JSON.stringify(e));
  }
  assert.equal(parseInbox('x.json', { logs: [] }, opts).errors.length, 1);
});

test('several entries in one file get stable, distinct ids', () => {
  const data = { logs: [{ a: 'Anki', m: 10 }, { a: 'Immersion', m: 30 }, { a: 'Anki', m: 5, id: 'anki-2026-10-19' }] };
  const r = parseInbox('inbox/batch.json', data, opts);
  assert.deepEqual(r.logs.map((l) => l.id), ['ib-batch-0', 'ib-batch-1', 'anki-2026-10-19']);
  assert.deepEqual(parseInbox('inbox/batch.json', data, opts).logs, r.logs);
});
