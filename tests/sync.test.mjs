import test from 'node:test';
import assert from 'node:assert/strict';
import { Sync } from '../js/sync.js';
import { parseInbox } from '../js/inbox.js';
import { canonLog, defaultMeta } from '../js/merge.js';

const API = 'https://api.github.com/repos/o/r';
const T = Date.parse('2026-10-19T20:15:00');
const INBOX = 'inbox/20261019-201500.json';
const ID = 'ib-20261019-201500';
const ENTRY = JSON.stringify({ a: 'immersion', m: 20, t: T, src: 'siri' });

/** Just enough GitHub for Sync: listings with ETag, blobs, PUT/DELETE with sha checks. */
class FakeGitHub {
  constructor() {
    this.files = new Map(); // path -> { sha, text }
    this.blobs = new Map(); // sha -> text
    this.n = 0;
    this.calls = [];
    this.failDelete = 0;
    this.hook = null; // async (method, path, token), runs before the request is answered
    globalThis.fetch = (url, opts) => this.handle(url, opts);
  }

  write(path, text) {
    const sha = `b${++this.n}`;
    this.blobs.set(sha, text);
    this.files.set(path, { sha, text });
    return sha;
  }

  json(path) { return JSON.parse(this.files.get(path).text); }

  /** Direct children of `dir` ('' = root); a directory's sha changes with anything inside it. */
  list(dir) {
    const out = new Map();
    for (const [p, f] of this.files) {
      if (dir && !p.startsWith(`${dir}/`)) continue;
      const [head, ...rest] = (dir ? p.slice(dir.length + 1) : p).split('/');
      const path = dir ? `${dir}/${head}` : head;
      if (!rest.length) { out.set(path, { name: head, path, type: 'file', sha: f.sha }); continue; }
      const d = out.get(path) || { name: head, path, type: 'dir', parts: [] };
      d.parts.push(`${p}:${f.sha}`);
      out.set(path, d);
    }
    return [...out.values()].map(({ parts, ...e }) => (parts ? { ...e, sha: `t(${parts.sort().join(',')})` } : e));
  }

  async handle(url, { method = 'GET', headers = {}, body } = {}) {
    const path = url.slice(API.length + 1);
    const token = headers.Authorization.replace('Bearer ', '');
    this.calls.push(`${token} ${method} ${path}`);
    if (this.hook) await this.hook(method, path, token);
    const res = (status, data, h = {}) => new Response(
      data === undefined ? null : typeof data === 'string' ? data : JSON.stringify(data), { status, headers: h });

    if (method === 'GET' && path.startsWith('git/blobs/')) {
      const text = this.blobs.get(path.slice('git/blobs/'.length));
      return text === undefined ? res(404, {}) : res(200, text);
    }
    if (method === 'GET') {
      const dir = path === 'contents' ? '' : path.slice('contents/'.length);
      const items = this.list(dir);
      if (!items.length) return res(404, { message: dir ? 'Not Found' : 'This repository is empty.' });
      const etag = `"${items.map((i) => `${i.path}=${i.sha}`).join('|')}"`;
      if (headers['If-None-Match'] === etag) return res(304);
      return res(200, items, { ETag: etag });
    }
    const file = path.slice('contents/'.length);
    const b = JSON.parse(body);
    const cur = this.files.get(file);
    if (method === 'PUT') {
      if (cur ? b.sha !== cur.sha : b.sha) return res(cur ? 409 : 422, { message: 'sha mismatch' });
      const sha = this.write(file, Buffer.from(b.content, 'base64').toString('utf8'));
      return res(cur ? 200 : 201, { content: { sha } });
    }
    if (method === 'DELETE') {
      if (this.failDelete > 0) { this.failDelete--; return res(500, {}); }
      if (!cur) return res(404, {});
      if (b.sha !== cur.sha) return res(409, {});
      this.files.delete(file);
      return res(200, {});
    }
    return res(400, {});
  }
}

/** One device: its own logs, meta and Sync (init() is skipped, so devices share no stored state). */
function device(token) {
  const logs = new Map(), inbox = [];
  let meta = defaultMeta();
  const sync = new Sync({
    logsOfYear: (y) => [...logs.values()].filter((l) => l.d.startsWith(y)),
    localYears: () => [...new Set([...logs.values()].map((l) => l.d.slice(0, 4)))],
    applyLogs: async (list) => list.forEach((l) => logs.set(l.id, canonLog(l))),
    getMeta: () => meta,
    applyMeta: async (m) => { meta = m; },
    fromInbox: (name, data) => parseInbox(name, data, { actNames: ['Immersion'] }),
    onInbox: (l, bad) => inbox.push({ logs: l, bad }),
  });
  sync.configure({ token, owner: 'o', repo: 'r', device: token }, false);
  return { sync, logs, inbox };
}

const yearIds = (fake) => fake.json('logs/2026.json').logs.map((l) => l.id).sort();

test('an inbox file becomes a log in the year file, then the file is deleted', async () => {
  const fake = new FakeGitHub();
  fake.write(INBOX, ENTRY);
  const a = device('A');
  await a.sync.run();
  assert.equal(a.sync.status.kind, 'ok', a.sync.status.detail);
  assert.equal(a.logs.get(ID).a, 'Immersion');
  assert.equal(a.logs.get(ID).src, 'siri');
  assert.deepEqual(yearIds(fake), [ID]);
  assert.deepEqual(fake.list('inbox'), []);
  assert.equal(a.inbox.length, 1);

  fake.calls = [];
  await a.sync.run();
  assert.deepEqual(fake.calls.filter((c) => !c.includes(' GET ')), [], 'second sync writes nothing');

  const b = device('B');
  await b.sync.run();
  assert.deepEqual([...b.logs.keys()], [ID]);
  assert.equal(b.inbox.length, 0);
});

test('a failed delete is retried on the next sync, without duplicates', async () => {
  const fake = new FakeGitHub();
  fake.write(INBOX, ENTRY);
  fake.failDelete = 1;
  const a = device('A');
  await a.sync.run();
  assert.equal(a.sync.status.kind, 'error');
  assert.deepEqual(yearIds(fake), [ID], 'the log is safe before the inbox file goes');
  assert.equal(fake.list('inbox').length, 1);
  await a.sync.run();
  assert.equal(a.sync.status.kind, 'ok', a.sync.status.detail);
  assert.deepEqual(fake.list('inbox'), []);
  assert.deepEqual(yearIds(fake), [ID]);
  assert.equal(a.inbox.length, 1, 'reported once');
});

test('a log deleted in the app does not come back from a leftover inbox file', async () => {
  const fake = new FakeGitHub();
  fake.write(INBOX, ENTRY);
  fake.failDelete = 2;
  const a = device('A');
  await a.sync.run();
  const l = a.logs.get(ID);
  a.logs.set(ID, { ...l, x: 1, u: l.u + 60_000 });
  a.sync.markYear('2026');
  await a.sync.run();
  assert.equal(fake.list('inbox').length, 1, 'still there after two failed deletes');

  const b = device('B');
  await b.sync.run();
  assert.equal(b.sync.status.kind, 'ok', b.sync.status.detail);
  assert.equal(b.logs.get(ID).x, 1);
  assert.equal(b.inbox.length, 0, 'nothing imported');
  assert.deepEqual(fake.list('inbox'), []);
  assert.equal(fake.json('logs/2026.json').logs[0].x, 1);
});

test('unreadable inbox files stay put and are reported once', async () => {
  const fake = new FakeGitHub();
  fake.write('inbox/kaputt.json', '{"a":"Immersion","m":"viel"}');
  fake.write('inbox/kein-json.json', 'Immersion 20');
  const a = device('A');
  await a.sync.run();
  assert.equal(a.sync.status.kind, 'ok', a.sync.status.detail);
  assert.equal(a.sync.inboxBad(), 2);
  assert.equal(a.inbox.length, 1);
  assert.equal(a.inbox[0].bad.length, 2);

  fake.write(INBOX, ENTRY); // a new file changes the folder, the bad ones are not reported again
  await a.sync.run();
  assert.equal(a.inbox.length, 2);
  assert.deepEqual(a.inbox[1].bad, []);
  assert.deepEqual(a.inbox[1].logs.map((l) => l.id), [ID]);
  assert.deepEqual(fake.list('inbox').map((f) => f.name).sort(), ['kaputt.json', 'kein-json.json']);
  assert.equal(a.sync.inboxBad(), 2);
});

test('two devices handling the same inbox file at once end with one log', async () => {
  const fake = new FakeGitHub();
  fake.write(INBOX, ENTRY);
  const a = device('A'), b = device('B');
  let fired = false;
  fake.hook = async (method, path, token) => {
    if (!fired && token === 'A' && method === 'PUT' && path === 'contents/logs/2026.json') {
      fired = true;
      await b.sync.run(); // B imports, pushes and deletes while A is mid-push
    }
  };
  await a.sync.run();
  assert.ok(fired);
  assert.equal(fake.calls.filter((c) => c === 'A PUT contents/logs/2026.json').length, 2, 'conflict, then retry');
  assert.equal(a.sync.status.kind, 'ok', a.sync.status.detail);
  assert.equal(b.sync.status.kind, 'ok', b.sync.status.detail);
  assert.deepEqual(yearIds(fake), [ID]);
  assert.deepEqual(fake.list('inbox'), []);
  assert.deepEqual([...a.logs.keys()], [ID]);
});

test('a push conflict pulls, merges both sides and retries', async () => {
  const fake = new FakeGitHub();
  const a = device('A'), b = device('B');
  await a.sync.run();
  await b.sync.run();
  const mk = (id, act) => canonLog({ id, d: '2026-10-19', t: T, a: act, m: 10, u: T });
  a.logs.set('la', mk('la', 'Anki'));
  a.sync.markYear('2026');
  b.logs.set('lb', mk('lb', 'Immersion'));
  b.sync.markYear('2026');
  let fired = false;
  fake.hook = async (method, path, token) => {
    if (!fired && token === 'A' && method === 'PUT') { fired = true; await b.sync.run(); }
  };
  await a.sync.run();
  assert.ok(fired);
  assert.equal(fake.calls.filter((c) => c === 'A PUT contents/logs/2026.json').length, 2, 'conflict, then retry');
  assert.equal(a.sync.status.kind, 'ok', a.sync.status.detail);
  assert.deepEqual(yearIds(fake), ['la', 'lb']);
  assert.deepEqual([...a.logs.keys()].sort(), ['la', 'lb']);
});

test('the PC uploads newer Anki picks as picks.json, other devices take them over once', async () => {
  const fake = new FakeGitHub();
  const pc = device('PC'), phone = device('P');
  let local = { updated: '2026-10-29T05:09:57', picks: [{ id: 'yt:1' }] };
  pc.sync.host.localPicks = () => local;
  const got = [];
  phone.sync.host.applyPicks = async (d) => got.push(d);

  await pc.sync.run();
  assert.equal(pc.sync.status.kind, 'ok', pc.sync.status.detail);
  assert.deepEqual(fake.json('picks.json'), local);
  fake.calls = [];
  await pc.sync.run();
  assert.ok(!fake.calls.some((c) => c.includes('PUT contents/picks.json')), 'unchanged picks are not uploaded again');

  await phone.sync.run();
  assert.deepEqual(got, [local]);
  local = { updated: '2026-10-30T05:10:00', picks: [{ id: 'yt:2' }] };
  await pc.sync.run();
  await phone.sync.run();
  await phone.sync.run();
  assert.deepEqual(got.map((d) => d.updated), ['2026-10-29T05:09:57', '2026-10-30T05:10:00'], 'each new file is applied once');
  // a pick marked as seen on the PC: same run, one pick fewer
  local = { updated: '2026-10-30T05:10:00', picks: [] };
  await pc.sync.run();
  await phone.sync.run();
  assert.deepEqual(got.at(-1).picks, []);
  assert.equal(got.length, 3);
  assert.ok(!fake.calls.some((c) => c.startsWith('P PUT contents/picks.json')), 'only the PC writes picks.json');
});
