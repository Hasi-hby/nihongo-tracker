// IndexedDB persistence: one record per log, plus a small key-value store
// (meta, device settings, sync state). Falls back to memory if IndexedDB is blocked.

const DB_NAME = 'nihongo-hunter';
let db = null;
const mem = { logs: new Map(), kv: new Map() };

export async function openStore() {
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('logs', { keyPath: 'id' });
        req.result.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    db = null;
  }
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  return !!db;
}

function run(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req instanceof IDBRequest ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function allLogs() {
  if (!db) return [...mem.logs.values()];
  return run('logs', 'readonly', (s) => s.getAll());
}

export async function putLogs(logs) {
  if (!logs.length) return;
  if (!db) { logs.forEach((l) => mem.logs.set(l.id, l)); return; }
  await run('logs', 'readwrite', (s) => { logs.forEach((l) => s.put(l)); });
}

export async function getKV(key, fallback = null) {
  if (!db) return mem.kv.has(key) ? mem.kv.get(key) : fallback;
  const v = await run('kv', 'readonly', (s) => s.get(key));
  return v === undefined ? fallback : v;
}

export async function setKV(key, value) {
  if (!db) { mem.kv.set(key, value); return; }
  await run('kv', 'readwrite', (s) => { s.put(value, key); });
}

export const persistent = () => !!db;
