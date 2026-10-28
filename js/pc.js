// Bridge to the PC helper (jp/technical/scripts/tsuzuku_helper.py). A web page may not start
// programs, so a tiny server on the PC does it: Tsuzuku shows the latest Anki recommendations
// (content in which the Anki words you struggle with come up a lot) and can start a new run.
// The helper only exists on the Windows PC; everywhere else none of this shows.

const BASE = 'http://127.0.0.1:8796';
export const PC_REPORT = `${BASE}/report`;
export const PC_ACTIONS = {
  'all-vpn': 'Alles aktualisieren',
  all: 'Aktualisieren ohne TVer',
  rank: 'Neu sortieren',
  taste: 'Geschmack auffrischen',
};
/** state: unknown (not asked yet) | online | offline | blocked (by the browser) | none (not the PC) */
export const PC = { state: 'unknown', status: null, picks: null, picksAt: null };
export const pcAvailable = () => /Windows/.test(navigator.userAgent);

/** Chrome asks once whether a website may reach apps on this device ("Local Network Access"). */
async function accessDenied() {
  try {
    return (await navigator.permissions.query({ name: 'local-network-access' })).state === 'denied';
  } catch {
    return false; // a browser without that permission
  }
}

async function getJSON(path, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(BASE + path, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Asks the helper what is going on; returns the result of a run that has just finished, if any. */
export async function refreshPC() {
  if (!pcAvailable()) { PC.state = 'none'; return null; }
  const wasRunning = PC.status?.running;
  try {
    PC.status = await getJSON('/status', 2000);
    PC.state = 'online';
  } catch {
    PC.state = (await accessDenied()) ? 'blocked' : 'offline';
    PC.status = null;
    return null;
  }
  if (PC.status.updated && PC.status.updated !== PC.picksAt) {
    try {
      PC.picks = await getJSON('/picks', 5000);
      PC.picksAt = PC.status.updated;
    } catch { /* keep the old list */ }
  }
  return wasRunning && !PC.status.running ? PC.status.last : null;
}

/** Don't recommend this pick (scope 'item') or its whole series ('series') again; undo brings it back. */
export async function markSeenPC(id, scope, undo = false) {
  const q = new URLSearchParams({ id, scope, ...(undo ? { undo: '1' } : {}) });
  const r = await fetch(`${BASE}/seen?${q}`, { method: 'POST', cache: 'no-store' });
  if (!r.ok) throw new Error(`Helfer antwortet ${r.status}`);
  PC.status = await r.json();
  PC.picks = await getJSON('/picks', 5000);
  PC.picksAt = PC.status.updated;
}

export async function runPC(action) {
  const r = await fetch(`${BASE}/run/${action}`, { method: 'POST', cache: 'no-store' });
  if (r.status === 409) throw new Error('Es läuft schon etwas');
  if (!r.ok) throw new Error(`Helfer antwortet ${r.status}`);
  PC.status = await r.json();
}
