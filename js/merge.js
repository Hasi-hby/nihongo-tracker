// Pure merge + serialization for sync. Every record carries `u` (last change, ms);
// the newer record wins, deletions are tombstones (`x: 1`) so they sync too.

const LOG_KEYS = ['id', 'd', 't', 'a', 'm', 'n', 'md', 'src', 'u', 'x'];

/** Fixed key order and no empty optional fields, so files diff cleanly. */
export function canonLog(l) {
  const out = {};
  for (const k of LOG_KEYS) {
    const v = l[k];
    if (v === undefined || v === null || v === '' || (k === 'x' && !v)) continue;
    out[k] = v;
  }
  return out;
}

function stable(o) {
  if (!o || typeof o !== 'object') return JSON.stringify(o);
  return JSON.stringify(Object.keys(o).sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {}));
}

/** >0 if a is newer, <0 if b is newer, 0 if identical. Ties on `u` break deterministically. */
export function cmp(a, b) {
  if (!a && !b) return 0;
  if (!b) return 1;
  if (!a) return -1;
  if ((a.u || 0) !== (b.u || 0)) return (a.u || 0) > (b.u || 0) ? 1 : -1;
  const sa = stable(a), sb = stable(b);
  return sa === sb ? 0 : sa > sb ? 1 : -1;
}

/**
 * Merge two lists of records by id.
 * toLocal: remote records that replace or add to the local side.
 * remoteBehind: the local side has something the remote file lacks (needs a push).
 */
export function mergeLists(local = [], remote = []) {
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const out = new Map(L);
  const toLocal = [];
  let remoteBehind = false;
  for (const [id, r] of R) {
    const c = cmp(L.get(id), r);
    if (c < 0) { out.set(id, r); toLocal.push(r); }
    else if (c > 0) remoteBehind = true;
  }
  for (const id of L.keys()) if (!R.has(id)) remoteBehind = true;
  return { items: [...out.values()], toLocal, remoteBehind };
}

export const META_LISTS = ['activities', 'shortcuts', 'quests'];
export const META_SINGLE = ['settings', 'timer'];

export function mergeMeta(local, remote) {
  const meta = { v: 1 };
  let localChanged = false, remoteBehind = false;
  for (const k of META_LISTS) {
    const r = mergeLists(local?.[k] || [], remote?.[k] || []);
    meta[k] = r.items;
    if (r.toLocal.length) localChanged = true;
    if (r.remoteBehind) remoteBehind = true;
  }
  for (const k of META_SINGLE) {
    const c = cmp(local?.[k], remote?.[k]);
    meta[k] = c >= 0 ? local?.[k] : remote[k];
    if (c < 0) localChanged = true;
    if (c > 0) remoteBehind = true;
  }
  return { meta, localChanged, remoteBehind };
}

export function serializeLogs(logs) {
  const sorted = [...logs].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return '{"v":1,"logs":[\n' + sorted.map((l) => JSON.stringify(canonLog(l))).join(',\n') + '\n]}\n';
}

export function serializeMeta(meta) {
  const out = { v: 1 };
  for (const k of META_LISTS) out[k] = meta[k] || [];
  for (const k of META_SINGLE) if (meta[k]) out[k] = meta[k];
  return JSON.stringify(out, null, 1) + '\n';
}

/** Defaults for a fresh device. u = 0 so anything already synced wins. */
export function defaultMeta() {
  const acts = [
    ['Immersion', '#34d399', 'listen'], ['passive immersion', '#8fb3e8', 'listen'],
    ['Anki', '#e8c170', 'memory'], ['Output', '#f472b6', 'output'],
    ['phonetic training', '#a78bfa', 'pron'],
  ];
  const sc = [['Anki', 15], ['Immersion', 20], ['Output', 15], ['passive immersion', 20], ['phonetic training', 10]];
  return {
    v: 1,
    activities: acts.map(([name, color, attr], o) => ({ id: name, name, color, attr, o, u: 0 })),
    shortcuts: sc.map(([a, m], o) => ({ id: 's' + (o + 1), a, m, o, u: 0 })),
    quests: [],
    settings: { dayEnd: 0, weekStart: 1, freezeStart: null, starterFreezes: 1, u: 0 },
    timer: { state: 'idle', u: 0 },
  };
}
