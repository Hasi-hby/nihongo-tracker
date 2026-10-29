// Sync with a private GitHub repo through the REST API:
//   meta.json          activities, shortcuts, quests, settings, timer
//   logs/<year>.json   all logs of that year (tombstones included)
//   inbox/<name>.json  logs written from outside the app (see inbox.js)
//   picks.json         the PC's Anki recommendations for the "Jetzt 5 Minuten?" card (only the PC writes it)
// Pull: one conditional request on the repo root (304 when nothing changed), then only
// the blobs whose sha moved. Push: PUT with the last known sha; a conflict re-pulls,
// merges and retries. Local changes are tracked as dirty counters so edits made while
// a request is in flight are never lost. Inbox files are merged into the logs on pull and
// deleted only after the year files holding them were pushed.

import { mergeLists, mergeMeta, serializeLogs, serializeMeta } from './merge.js?v=2.7.0';
import { getKV, setKV } from './store.js?v=2.7.0';

const API = 'https://api.github.com';

export class SyncError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A run's picks: a newer run, or the same run with a pick marked as seen, changes it. */
const picksKey = (p) => `${p.updated || ''}|${(p.picks || []).map((x) => x.id).join(',')}`;

const freshState = () => ({
  repoKey: '', etag: null, metaSha: null, logsTree: null, files: {}, dirty: { meta: 0, years: {} }, lastOk: null,
  inboxTree: null, inbox: {}, inboxBad: {}, // inbox: merged, waiting for delete; inboxBad: unreadable, left in place
  picksSha: null, picksUpdated: '', picksKey: '', // picks.json: its blob, the run it holds and which picks
});

export class Sync {
  /**
   * host: { logsOfYear(y), localYears(), applyLogs(logs), getMeta(), applyMeta(meta), onStatus(s),
   *         fromInbox(name, data) -> { logs, errors }, onInbox(logs, bad),
   *         localPicks() -> { updated, picks } | null (the PC), applyPicks(data) }
   */
  constructor(host) {
    this.host = host;
    this.cfg = { token: '', owner: '', repo: '', device: '' };
    this.state = freshState();
    this.status = { kind: 'local', detail: '' };
    this.busy = false;
    this.again = false;
    this.timer = null;
    this.desc = [];
  }

  async init(cfg) {
    this.state = { ...freshState(), ...(await getKV('sync', {})) };
    this.configure(cfg, false);
  }

  configure(cfg, persist = true) {
    this.cfg = { ...this.cfg, ...cfg };
    const key = `${this.cfg.owner}/${this.cfg.repo}`;
    if (this.state.repoKey !== key) {
      // another repo: forget what we knew about remote files, keep local dirty marks
      this.state = { ...freshState(), dirty: this.state.dirty, repoKey: key };
    }
    if (persist) this.save();
    this.setStatus(this.cfg.token ? 'idle' : 'local');
  }

  get enabled() { return !!(this.cfg.token && this.cfg.owner && this.cfg.repo); }

  save() { return setKV('sync', this.state); }

  setStatus(kind, detail = '') {
    this.status = { kind, detail, lastOk: this.state.lastOk };
    this.host.onStatus?.(this.status);
  }

  markYear(year, what) {
    this.state.dirty.years[year] = (this.state.dirty.years[year] || 0) + 1;
    if (what) this.desc.push(what);
    this.save();
  }

  markMeta(what) {
    this.state.dirty.meta++;
    if (what) this.desc.push(what);
    this.save();
  }

  pending() {
    return Object.keys(this.state.dirty.years).length + (this.state.dirty.meta ? 1 : 0);
  }

  /** Inbox files that could not be read and stay in the repo. */
  inboxBad() {
    return Object.keys(this.state.inboxBad || {}).length;
  }

  schedule(delay = 3000) {
    clearTimeout(this.timer);
    if (this.enabled) this.timer = setTimeout(() => this.run(), delay);
  }

  async req(path, { method = 'GET', body, etag, raw = false } = {}) {
    const headers = {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (etag) headers['If-None-Match'] = etag;
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${API}/repos/${this.cfg.owner}/${this.cfg.repo}${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
      });
    } catch {
      throw new SyncError('offline', 'Keine Verbindung');
    }
    if (res.status === 401) throw new SyncError('auth', 'Token ungültig oder abgelaufen');
    if (res.status === 403) {
      if (res.headers.get('x-ratelimit-remaining') === '0') throw new SyncError('error', 'GitHub-Limit erreicht, gleich nochmal');
      throw new SyncError('auth', 'Token hat keine Schreibrechte für das Repo');
    }
    return res;
  }

  /** Check token + repo access without changing anything. */
  async test() {
    const res = await this.req('');
    if (res.status === 404) throw new SyncError('auth', 'Repo nicht gefunden oder Token hat keinen Zugriff');
    if (!res.ok) throw new SyncError('error', `GitHub antwortet ${res.status}`);
    const repo = await res.json();
    return { name: repo.full_name, private: repo.private };
  }

  async blob(sha) {
    const res = await this.req(`/git/blobs/${sha}`, { raw: true });
    if (!res.ok) throw new SyncError('error', `Blob ${res.status}`);
    return JSON.parse(await res.text());
  }

  async pull() {
    const st = this.state;
    const res = await this.req('/contents', { etag: st.etag });
    if (res.status === 304) return false;
    if (res.status === 404) {
      const msg = (await res.json().catch(() => ({}))).message || '';
      if (!/empty/i.test(msg)) throw new SyncError('auth', 'Repo nicht gefunden oder Token hat keinen Zugriff');
      // empty repo: everything local has to go up
      if (!st.dirty.meta) st.dirty.meta = 1;
      for (const y of this.host.localYears()) st.dirty.years[y] = st.dirty.years[y] || 1;
      return false;
    }
    if (!res.ok) throw new SyncError('error', `GitHub antwortet ${res.status}`);
    const items = await res.json();
    const etag = res.headers.get('ETag');
    let changed = false;

    const metaItem = items.find((i) => i.path === 'meta.json');
    if (!metaItem) { if (!st.dirty.meta) st.dirty.meta = 1; }
    else if (metaItem.sha !== st.metaSha) {
      const m = mergeMeta(this.host.getMeta(), await this.blob(metaItem.sha));
      if (m.localChanged) { await this.host.applyMeta(m.meta); changed = true; }
      if (m.remoteBehind && !st.dirty.meta) st.dirty.meta = 1;
      st.metaSha = metaItem.sha;
    }

    const logsItem = items.find((i) => i.path === 'logs' && i.type === 'dir');
    const remoteYears = new Set();
    if (logsItem && logsItem.sha === st.logsTree) {
      Object.keys(st.files).forEach((p) => remoteYears.add(p.slice(5, 9)));
    } else if (logsItem) {
      const lr = await this.req('/contents/logs');
      if (!lr.ok) throw new SyncError('error', `GitHub antwortet ${lr.status}`);
      for (const f of await lr.json()) {
        const m = f.name.match(/^(\d{4})\.json$/);
        if (!m) continue;
        remoteYears.add(m[1]);
        if (st.files[f.path] === f.sha) continue;
        const remote = (await this.blob(f.sha)).logs || [];
        const r = mergeLists(this.host.logsOfYear(m[1]), remote);
        if (r.toLocal.length) { await this.host.applyLogs(r.toLocal); changed = true; }
        if (r.remoteBehind && !st.dirty.years[m[1]]) st.dirty.years[m[1]] = 1;
        st.files[f.path] = f.sha;
      }
      st.logsTree = logsItem.sha;
    }
    for (const y of this.host.localYears()) {
      if (!remoteYears.has(y) && !st.dirty.years[y]) st.dirty.years[y] = 1;
    }
    // after the year files, so a log that was already moved and edited elsewhere stays edited
    if (await this.pullInbox(items.find((i) => i.path === 'inbox' && i.type === 'dir'))) changed = true;
    await this.pullPicks(items.find((i) => i.path === 'picks.json'));
    st.etag = etag;
    return changed;
  }

  async pullPicks(item) {
    const st = this.state;
    if (!item) { st.picksSha = null; return; }
    if (item.sha === st.picksSha) return;
    const data = await this.blob(item.sha);
    st.picksSha = item.sha;
    if ((data.updated || '') >= (st.picksUpdated || '') && picksKey(data) !== st.picksKey) {
      st.picksUpdated = data.updated || '';
      st.picksKey = picksKey(data);
      await this.host.applyPicks?.(data);
    }
  }

  async pullInbox(dir) {
    const st = this.state;
    if (!dir) { st.inboxTree = null; st.inbox = {}; st.inboxBad = {}; return false; }
    if (dir.sha === st.inboxTree || !this.host.fromInbox) return false;
    const res = await this.req('/contents/inbox');
    if (!res.ok) throw new SyncError('error', `GitHub antwortet ${res.status}`);
    const files = (await res.json()).filter((f) => f.type === 'file' && /\.json$/i.test(f.name));
    const live = new Set(files.map((f) => f.path));
    for (const k of ['inbox', 'inboxBad']) {
      for (const p of Object.keys(st[k])) if (!live.has(p)) delete st[k][p];
    }
    const imported = [], bad = [];
    for (const f of files) {
      if (st.inbox[f.path] === f.sha || st.inboxBad[f.path] === f.sha) continue;
      let r;
      try {
        r = this.host.fromInbox(f.name, await this.blob(f.sha));
      } catch (e) {
        if (e instanceof SyncError) throw e;
        r = { logs: [], errors: ['kein gültiges JSON'] };
      }
      if (r.errors.length || !r.logs.length) {
        st.inboxBad[f.path] = f.sha;
        bad.push({ path: f.path, errors: r.errors.length ? r.errors : ['keine Einträge'] });
        continue;
      }
      const years = new Map();
      for (const l of r.logs) years.set(l.d.slice(0, 4), [...(years.get(l.d.slice(0, 4)) || []), l]);
      for (const [y, list] of years) {
        const m = mergeLists(this.host.logsOfYear(y), list);
        if (!m.toLocal.length) continue;
        await this.host.applyLogs(m.toLocal);
        st.dirty.years[y] = (st.dirty.years[y] || 0) + 1;
        imported.push(...m.toLocal);
      }
      st.inbox[f.path] = f.sha;
    }
    st.inboxTree = dir.sha;
    if (imported.length) this.desc.push(`Inbox: ${imported.length} Log${imported.length > 1 ? 's' : ''}`);
    if (imported.length || bad.length) this.host.onInbox?.(imported, bad);
    return imported.length > 0;
  }

  /** Remove merged inbox files. Gone already = done; a conflict forces a fresh listing next time. */
  async clearInbox() {
    const st = this.state;
    for (const [path, sha] of Object.entries(st.inbox)) {
      const res = await this.req(`/contents/${path}`, {
        method: 'DELETE', body: { message: `${this.cfg.device || 'Gerät'}: Inbox übernommen`, sha },
      });
      if (res.status === 409 || res.status === 422) st.inboxTree = null;
      else if (!res.ok && res.status !== 404) throw new SyncError('error', `Inbox aufräumen fehlgeschlagen (${res.status})`);
      delete st.inbox[path];
    }
  }

  async put(path, text, sha) {
    const what = this.desc.length ? [...new Set(this.desc)].slice(-3).join(', ') : 'Sync';
    const body = { message: `${this.cfg.device || 'Gerät'}: ${what}`, content: b64(text) };
    if (sha) body.sha = sha;
    const res = await this.req(`/contents/${path}`, { method: 'PUT', body });
    if (res.status === 409 || res.status === 422) throw new SyncError('conflict', 'Konflikt');
    if (!res.ok) throw new SyncError('error', `Speichern fehlgeschlagen (${res.status})`);
    return (await res.json()).content.sha;
  }

  async push() {
    const st = this.state;
    if (st.dirty.meta) {
      const v = st.dirty.meta;
      st.metaSha = await this.put('meta.json', serializeMeta(this.host.getMeta()), st.metaSha);
      if (st.dirty.meta === v) st.dirty.meta = 0;
    }
    for (const y of Object.keys(st.dirty.years)) {
      const v = st.dirty.years[y];
      const path = `logs/${y}.json`;
      st.files[path] = await this.put(path, serializeLogs(this.host.logsOfYear(y)), st.files[path]);
      if (st.dirty.years[y] === v) delete st.dirty.years[y];
    }
    const picks = this.host.localPicks?.();
    if (picks?.updated && picks.updated >= (st.picksUpdated || '') && picksKey(picks) !== st.picksKey) {
      this.desc.push('Vorschläge');
      st.picksSha = await this.put('picks.json', JSON.stringify(picks), st.picksSha);
      st.picksUpdated = picks.updated;
      st.picksKey = picksKey(picks);
    }
    this.desc = [];
    st.etag = null; // our own commits changed the root listing
    await this.clearInbox();
  }

  async run() {
    if (!this.enabled) { this.setStatus('local'); return; }
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    this.setStatus('syncing');
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await this.pull();
          await this.push();
          break;
        } catch (e) {
          if (e.kind !== 'conflict' || attempt >= 2) throw e;
          this.state.etag = null;
        }
      }
      this.state.lastOk = Date.now();
      this.setStatus('ok');
    } catch (e) {
      this.setStatus(e.kind === 'offline' ? 'offline' : e.kind === 'auth' ? 'auth' : 'error', e.message);
    } finally {
      this.busy = false;
      await this.save();
      if (this.again) { this.again = false; this.schedule(500); }
    }
  }
}
