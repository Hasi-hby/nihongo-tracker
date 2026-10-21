import { allLogs, getKV, openStore, persistent, putLogs, setKV } from './store.js?v=2.1.1';
import { canonLog, defaultMeta, mergeLists, mergeMeta, renameActivity } from './merge.js?v=2.1.1';
import { Sync } from './sync.js?v=2.1.1';
import { parseInbox } from './inbox.js?v=2.1.1';
import * as St from './stats.js?v=2.1.1';
import * as Ch from './charts.js?v=2.1.1';
import { buildExport } from './export.js?v=2.1.1';
import { zip } from './zip.js?v=2.1.1';
import {
  addDays, dayOf, eachDay, esc, fmtClock, fmtDate, fmtH, fmtMin, fmtNum, pad, parseDuration, startOfWeek, todayStr, uid,
} from './util.js?v=2.1.1';

const VERSION = '2.1.1';
const $ = (sel, root = document) => root.querySelector(sel);
// activity colours that read well on the dark background
const PALETTE = ['#3ee6b5', '#7aa2ff', '#ffd27a', '#ff9ec4', '#b9a6ff', '#7fd1c7', '#e9a23b', '#ff8a6b', '#8fd3ff', '#c5e478'];
// default colours of earlier designs, swapped once for the current ones (colours picked by hand stay)
const OLD_COLORS = {
  // first design
  '#34d399': '#3ee6b5', '#8fb3e8': '#7aa2ff', '#e8c170': '#ffd27a', '#f472b6': '#ff9ec4', '#a78bfa': '#b9a6ff',
  '#2dd4bf': '#7fd1c7', '#fb923c': '#e9a23b', '#f87171': '#ff8a6b', '#38bdf8': '#8fd3ff', '#a3e635': '#c5e478',
  // 和 design (2.0)
  '#165e83': '#3ee6b5', '#89c3eb': '#7aa2ff', '#d0af4c': '#ffd27a', '#e16b8c': '#ff9ec4', '#7058a3': '#b9a6ff',
  '#7ebea5': '#7fd1c7', '#c39143': '#e9a23b', '#d05a6e': '#ff8a6b', '#5b7e91': '#8fd3ff', '#93b69c': '#c5e478',
};

const S = {
  logs: new Map(),
  meta: defaultMeta(),
  device: { token: '', owner: 'Hasi-hby', repo: 'nihongo-tracker-data', name: guessDevice() },
  ui: { view: 'home', theme: 'dark', period: 'week', homeRange: 'day', anchor: null, heatYear: null, logQ: '', logA: '', logDay: '', logLimit: 150 },
  ver: 0,
};
let cache = { ver: -1 };
let sync;
let pendingRender = false;
let justSealed = false;

function guessDevice() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'PC';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Gerät';
}

// ---- Accessors ---------------------------------------------------------------

const settings = () => S.meta.settings || {};
const ws = () => settings().weekStart ?? 1;
const today = () => todayStr(settings().dayEnd || 0);
const byOrder = (a, b) => (a.o ?? 0) - (b.o ?? 0);
const acts = () => (S.meta.activities || []).filter((a) => !a.x).sort(byOrder);
const shortcuts = () => (S.meta.shortcuts || []).filter((s) => !s.x).sort(byOrder);
const quests = () => (S.meta.quests || []).filter((q) => !q.x);
const timer = () => S.meta.timer || { state: 'idle' };
const pct = (x) => Math.max(0, Math.min(100, x * 100)).toFixed(1);
const days = (n) => `${fmtNum(n)} Tag${n === 1 ? '' : 'e'}`;
const CHORUS_DEFAULTS = { on: true, a: 'phonetic training', m: 5, from: 14, until: 16 };
const chorusCfg = () => ({ ...CHORUS_DEFAULTS, ...(settings().chorus || {}) });
const TIMER_WARN_MIN = 180; // longer runs are probably a forgotten timer: ask before logging

/** ms until the current tracking day ends (midnight, or the custom day end). */
function msUntilDayEnd() {
  const now = new Date(), end = new Date(now);
  end.setHours(settings().dayEnd || 0, 0, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end - now;
}

function colorOf(name) {
  const a = (S.meta.activities || []).find((x) => x.name === name);
  if (a) return a.color;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Activities in display order, including names that only appear in logs. */
function chartActs(by) {
  const known = acts().map((a) => ({ name: a.name, color: a.color }));
  const names = new Set(known.map((a) => a.name));
  const extra = Object.keys(by).filter((n) => !names.has(n)).map((n) => ({ name: n, color: colorOf(n) }));
  return [...known, ...extra];
}

/** Everything derived from the logs, recomputed only when data or the day changes. */
function D() {
  const t = today();
  if (cache.ver === S.ver && cache.today === t) return cache;
  const logs = [...S.logs.values()];
  const live = logs.filter((l) => !l.x);
  const dm = St.dayMap(live);
  const cc = chorusCfg();
  const chorus = St.chorusInfo(dm, t, { activity: cc.a, min: cc.m });
  const goals = quests().map((q) => ({ q, p: St.questProgress(q, dm, t, ws()) }));
  // the day's seal: something logged, chorus done (when on) and every daily goal met
  const sealed = (dm.get(t)?.total || 0) > 0 && (!cc.on || chorus.state === 'done')
    && goals.every(({ q, p }) => q.scope !== 'day' || p.complete);
  cache = {
    ver: S.ver, today: t, logs, live, dm, chorus, goals, sealed,
    streak: St.streakInfo(dm, t), tot: St.totals(dm), qh: St.questHistory(quests(), dm, t),
    firstDay: [...dm.keys()].sort()[0] || t,
  };
  return cache;
}

function relDay(d) {
  const t = today();
  if (d === t) return 'heute';
  if (d === addDays(t, -1)) return 'gestern';
  return fmtDate(d, { weekday: true, year: d.slice(0, 4) !== t.slice(0, 4) });
}

const clock = (ms) => { const x = new Date(ms); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };

// ---- Mutations ----------------------------------------------------------------

async function saveLog(l, { desc, prevYear } = {}) {
  const c = canonLog({ ...l, u: Date.now() });
  S.logs.set(c.id, c);
  await putLogs([c]);
  sync.markYear(c.d.slice(0, 4), desc);
  if (prevYear && prevYear !== c.d.slice(0, 4)) sync.markYear(prevYear);
  S.ver++;
  sync.schedule();
}

/** Many logs at once (e.g. renaming an activity): one store write and one sync mark per year. */
async function saveLogs(list, desc) {
  const c = list.map(canonLog);
  c.forEach((l) => S.logs.set(l.id, l));
  await putLogs(c);
  new Set(c.map((l) => l.d.slice(0, 4))).forEach((y) => sync.markYear(y, desc));
  S.ver++;
  sync.schedule();
}

async function addLog({ a, m, d, t, n, md, src = 'manual' }) {
  const before = D();
  const l = { id: uid(), d: d || today(), t: t || Date.now(), a, m, n, md, src };
  await saveLog(l, { desc: `+${fmtMin(m)} ${a}` });
  const after = D();
  justSealed = !before.sealed && after.sealed;
  render();
  toast(`${fmtMin(m)} ${a} geloggt`, { label: 'Rückgängig', fn: () => deleteLog(l.id, true) });
  milestones(before, after).forEach((note) => toast(note));
  return l;
}

async function deleteLog(id, quiet = false) {
  const l = S.logs.get(id);
  if (!l || l.x) return;
  await saveLog({ ...l, x: 1 }, { desc: `−${fmtMin(l.m)} ${l.a}` });
  render();
  if (!quiet) toast('Log gelöscht', { label: 'Rückgängig', fn: () => restoreLog(id) });
  else toast('Rückgängig gemacht');
}

async function restoreLog(id) {
  const { x, ...rest } = S.logs.get(id);
  await saveLog(rest, { desc: `+${fmtMin(rest.m)} ${rest.a}` });
  render();
}

async function setMeta(mutate, desc, delay = 3000) {
  mutate(S.meta);
  await setKV('meta', S.meta);
  sync.markMeta(desc);
  S.ver++;
  sync.schedule(delay);
  render();
}

function upsertItem(list, item) {
  return (m) => {
    m[list] = m[list] || [];
    const i = m[list].findIndex((x) => x.id === item.id);
    const next = { ...(i >= 0 ? m[list][i] : {}), ...item, u: Date.now() };
    if (i >= 0) m[list][i] = next; else m[list].push(next);
  };
}

function setSettings(patch, desc) {
  return setMeta((m) => { m.settings = { ...m.settings, ...patch, u: Date.now() }; }, desc);
}

/** Swap the first design's activity colours for their 和色 counterparts. Runs once: afterwards nothing matches. */
function migrateColors() {
  const old = (S.meta.activities || []).filter((a) => OLD_COLORS[a.color?.toLowerCase()]);
  if (!old.length) return null;
  return setMeta((m) => old.forEach((a) => upsertItem('activities', { id: a.id, color: OLD_COLORS[a.color.toLowerCase()] })(m)), 'Farben');
}

// ---- Timer ----------------------------------------------------------------------

const timerElapsed = (tm = timer()) => (tm.acc || 0) + (tm.state === 'running' ? Date.now() - tm.start : 0);

function setTimer(next, desc) {
  return setMeta((m) => { m.timer = { ...next, u: Date.now() }; }, desc, 800);
}

async function timerAction(kind) {
  const tm = timer();
  if (kind === 'start') {
    const a = $('#timerAct')?.value || acts()[0]?.name || 'Immersion';
    return setTimer({ state: 'running', a, start: Date.now(), begin: Date.now(), acc: 0 }, `Timer ${a}`);
  }
  if (kind === 'pause') return setTimer({ ...tm, state: 'paused', acc: timerElapsed(tm), start: null }, 'Timer pausiert');
  if (kind === 'resume') return setTimer({ ...tm, state: 'running', start: Date.now() }, 'Timer weiter');
  if (kind === 'discard') return setTimer({ state: 'idle' }, 'Timer verworfen');
  if (kind === 'stop') {
    const ms = timerElapsed(tm), mins = Math.round(ms / 60000);
    const entry = { a: tm.a, m: mins, d: dayOf(tm.begin || Date.now(), settings().dayEnd || 0), t: tm.begin, src: 'timer' };
    if (mins > TIMER_WARN_MIN) {
      // paused until confirmed: cancelling the dialog loses nothing
      if (tm.state === 'running') await setTimer({ ...tm, state: 'paused', acc: ms, start: null }, 'Timer pausiert');
      return openLogModal(null, {
        ...entry,
        title: `Timer lief ${fmtMin(mins)} – stimmt das?`,
        sub: 'Falls du ihn vergessen hast, korrigiere die Dauer. Abbrechen lässt den Timer pausiert.',
        onSaved: () => setTimer({ state: 'idle' }, 'Timer gestoppt'),
      });
    }
    await setTimer({ state: 'idle' }, 'Timer gestoppt');
    if (mins < 1) { toast('Unter einer Minute, nichts geloggt'); return; }
    await addLog(entry);
  }
}

// ---- Milestones --------------------------------------------------------------------

/** Short notes for what a new log completed: the day's seal, the chorus duty, goals. */
function milestones(before, after) {
  if (!before.sealed && after.sealed) return ['Tag erfüllt ✓'];
  const notes = [];
  if (chorusCfg().on && before.chorus.state !== 'done' && after.chorus.state === 'done') {
    notes.push(before.chorus.state === 'penalty' ? 'Nachgeholt, deine Chorus-Serie läuft weiter' : 'Chorus erledigt');
  }
  const was = new Map(before.goals.map(({ q, p }) => [q.id, p.complete]));
  for (const { q, p } of after.goals) if (p.complete && !was.get(q.id)) notes.push(`Ziel erreicht: ${goalName(q)}`);
  return notes;
}

function chorusLog() {
  const cc = chorusCfg();
  return openLogModal(null, { a: cc.a, m: D().chorus.need, src: 'shortcut', quick: true });
}

// ---- Toasts ---------------------------------------------------------------------------

function toast(msg, action = null) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.remove(); action.fn(); };
  $('#toasts').append(el);
  setTimeout(() => el.remove(), action ? 6000 : 3000);
}

// ---- Views ----------------------------------------------------------------------------

const ICON_PATHS = {
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 2.8l2.1 2.1-1.4 1.4-2.1-2.1zm13.4 13.4 2.1 2.1-1.4 1.4-2.1-2.1zM2.8 19.8l2.1-2.1 1.4 1.4-2.1 2.1zM16.2 6.4l2.1-2.1 1.4 1.4-2.1 2.1z',
  calendar: 'M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm-2 8v9h14v-9zm0-2h14V6H5z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  timer: 'M9 1h6v2H9zm3 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 2h2v5h-2z',
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  grid: 'M3 3h5v5H3zm6.5 0h5v5h-5zM16 3h5v5h-5zM3 9.5h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5zM3 16h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5z',
  history: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.41 1.41A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z',
  wave: 'M2 12h2l2-6 3 12 3-14 3 16 3-10 2 2h2v2h-3.2L18 13l-3 10-3-16-3 13-2.8-11L5 14H2z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  edit: 'M4 17.25V20h2.75L17.8 8.94l-2.75-2.75zM20.7 6.04a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.13 1.13 2.75 2.75z',
};
const icon = (name, size = 18) => `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${ICON_PATHS[name]}"/></svg>`;

/** Top of the home page: the glowing streak, the last seven days, then today's lines. */
function headCard(d) {
  const s = d.streak;
  const week = St.sumRange(d.dm, startOfWeek(d.today, ws()), d.today);
  const ms = St.nextMilestone(d.tot.total, St.avgPerDay(d.dm, d.today), d.today);
  const when = ms.date ? ` · etwa ${fmtDate(ms.date, { year: ms.date.slice(0, 4) !== d.today.slice(0, 4) })}` : '';
  const record = s.current > 0 && s.current >= s.longest;
  return `<section class="hero ${d.sealed ? 'done' : ''} ${d.sealed && justSealed ? 'just-done' : ''}">
      <div class="hero-num num">${fmtNum(s.current)}</div>
      <div class="hero-sub">${s.current === 1 ? 'Tag' : 'Tage'} am Stück${record ? ' · Rekord' : ''}${d.sealed ? ' · <span class="done-mark">Tag erfüllt ✓</span>' : ''}</div>
      ${Ch.weekBars(d.dm, d.today)}
    </section>
    <div class="lines">
      <div class="line"><span>heute <b class="num">${fmtMin(d.dm.get(d.today)?.total || 0)}</b></span><span>Woche <b class="num">${fmtH(week)}</b></span></div>
      ${s.atRisk ? '<div class="line warn">Heute ist noch nichts geloggt. Ohne Log endet die Serie heute Nacht.</div>' : ''}
      <div class="line"><span class="muted">Noch <b class="num">${fmtNum(Math.ceil(ms.leftMin / 60))} h</b> bis ${fmtNum(ms.hours)} h${when}</span></div>
      ${chorusBlock(d)}
    </div>`;
}

function logItem(l, { date = true } = {}) {
  return `<div class="item">
    <span class="dot" style="background:${colorOf(l.a)}"></span>
    <div class="what"><div><b>${esc(l.a)}</b> · <span class="num">${fmtMin(l.m)}</span>${l.md ? ` · ${esc(l.md)}` : ''}</div>
      ${l.n ? `<div class="note">${esc(l.n)}</div>` : ''}</div>
    <div class="right"><span class="muted small">${date ? relDay(l.d) + ' · ' : ''}${clock(l.t)}</span>
      <button class="link" data-action="edit-log" data-id="${esc(l.id)}" aria-label="Bearbeiten">${icon('edit', 16)}</button></div></div>`;
}

const scopeOf = (q) => St.QUEST_SCOPES.find((s) => s.id === q.scope) || St.QUEST_SCOPES[0];
const goalName = (q) => q.name || `${q.a || 'Gesamt'}: ${fmtMin(q.m)}${scopeOf(q).per}`;
const GOAL_TITLES = { day: 'Tagesziele', week: 'Wochenziele', month: 'Monatsziele' };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Statistics page: chorus streak numbers and the last five weeks as a small calendar. */
function chorusCard(d) {
  const cc = chorusCfg();
  if (!cc.on) return '';
  const c = d.chorus;
  const start = addDays(startOfWeek(d.today, ws()), -28);
  const cells = [...eachDay(start, addDays(start, 34))].map((day) => {
    let st = c.marks.get(day) || '';
    if (day === d.today) st = c.state === 'done' ? 'done' : c.state === 'penalty' ? 'penalty' : 'today';
    else if (day > d.today) st = 'future';
    else if (!st && c.first && day >= c.first) st = 'missed';
    const label = { done: 'erledigt', redeemed: 'nachgeholt', missed: 'verpasst', penalty: 'heute Nachholtag', today: 'heute offen' }[st] || '';
    const m = d.dm.get(day)?.by[cc.a] || 0;
    return `<i class="cc-${st || 'none'}" title="${fmtDate(day, { weekday: true })}${label ? ` · ${label}` : ''}${m ? ` · ${fmtMin(m)}` : ''}">${+day.slice(8)}</i>`;
  }).join('');
  const wd = [...eachDay(start, addDays(start, 6))].map((x) => `<b>${WD[new Date(`${x}T12:00`).getDay()]}</b>`).join('');
  return `<div class="card"><div class="card-head"><h2>${icon('wave')} Chorus</h2><span class="sub">täglich ${fmtMin(cc.m)} ${esc(cc.a)} · verpasst = am nächsten Tag doppelt</span></div>
    <div class="cols-2">
      <div class="stat-list">
        <div class="stat-row"><span>Aktuelle Serie</span><b>${days(c.current)}</b></div>
        <div class="stat-row"><span>Längste Serie</span><b>${days(c.longest)}</b></div>
        <div class="stat-row"><span>Tage erledigt</span><b>${fmtNum(c.daysDone)}</b></div>
        <div class="stat-row"><span>Nachgeholt</span><b>${fmtNum(c.redeemedCount)}</b></div>
        <div class="stat-row"><span>Chorusing gesamt</span><b>${fmtH(c.totalMin)}</b></div>
      </div>
      <div><div class="ccal">${wd}${cells}</div>
        <div class="ccal-legend small muted"><span><i class="cc-done"></i>erledigt</span><span><i class="cc-redeemed"></i>nachgeholt</span>
          <span><i class="cc-missed"></i>verpasst</span><span><i class="cc-penalty"></i>Nachholtag</span></div></div>
    </div></div>`;
}

/** Today's chorus duty as a line, or the catch-up day after a missed one. */
function chorusBlock(d) {
  const cc = chorusCfg();
  if (!cc.on) return '';
  const c = d.chorus, need = c.need, done = c.doneToday;
  const serie = `Serie ${days(c.current)}`;
  const logBtn = `<button class="line-btn" data-action="chorus-log">Loggen</button>`;

  if (c.state === 'done') {
    return `<div class="line"><span><span class="ok">✓</span> Chorus erledigt · heute ${fmtMin(done)}</span><span class="muted small">${serie}</span></div>`;
  }
  if (c.state === 'penalty') {
    return `<div class="line warn block"><div class="line-top"><b>Nachholtag</b><span class="num" id="cqCountdown">${fmtClock(msUntilDayEnd())}</span></div>
      <div>Gestern kein Chorus. Heute <b>${fmtMin(need)}</b>, dann zählt gestern mit. Sonst endet deine Chorus-Serie von <b>${days(c.current)}</b>.</div>
      <div class="bar"><i style="width:${pct(done / need)}%"></i></div>
      <div class="line-top"><span class="num">${fmtMin(done)} / ${fmtMin(need)}</span>${logBtn}</div></div>`;
  }
  // open
  const hour = new Date().getHours();
  let hint = `ab ${cc.from} Uhr · ${serie}`, cls = '';
  if (hour >= cc.from && hour < cc.until) { hint = `Jetzt ist Chorus-Zeit, ${fmtMin(need)} genügen`; cls = 'now'; }
  else if (hour >= cc.until) {
    hint = c.current > 0
      ? `Noch <b class="num" id="cqCountdown">${fmtClock(msUntilDayEnd())}</b>, sonst wird morgen ein Nachholtag`
      : `Heute geht noch was: <b class="num" id="cqCountdown">${fmtClock(msUntilDayEnd())}</b>`;
    cls = 'late';
  }
  return `<div class="line block ${cls}"><div class="line-top"><span>Chorus heute <b class="num">${fmtMin(done)} / ${fmtMin(need)}</b></span>${logBtn}</div>
    <div class="line-sub">${hint}</div></div>`;
}

function shortcutsCard() {
  return `<div class="card plain"><div class="card-head"><h2>${icon('bolt')} Schnell loggen</h2>
      <button class="btn btn-sm btn-ghost" data-action="goto-settings" data-anchor="shortcuts">${icon('edit', 14)} Bearbeiten</button></div>
    <div class="shortcuts">${shortcuts().map((sc, i) => `<button class="sc" data-action="shortcut" data-id="${esc(sc.id)}" style="--c:${colorOf(sc.a)}">
      <b>${esc(sc.a)}</b><span class="num">${fmtMin(sc.m)}</span>${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}</button>`).join('')}
      <button class="sc sc-add" data-action="new-log"><b>${icon('plus', 16)} Aktivität</b><span>frei eintragen</span><kbd>N</kbd></button></div></div>`;
}

function goalsPanel(d) {
  const row = ({ q, p }) => `<button class="quest ${p.complete ? 'done' : ''}" data-action="quest-edit" data-id="${esc(q.id)}">
      <div class="quest-top"><span class="quest-name">${esc(goalName(q))}</span>
        <span class="num quest-amt">${fmtMin(p.done)} / ${fmtMin(p.target)}</span></div>
      <div class="bar ${p.complete ? 'done' : ''}"><i style="width:${pct(p.pct)}%"></i></div>
      <div class="quest-sub">${p.complete ? 'Erreicht' : `noch ${fmtMin(p.target - p.done)}`}${q.name ? ` · ${esc(q.a || 'Gesamt')}` : ''}</div></button>`;
  const head = `<div class="card-head"><h2>${icon('target')} Ziele</h2>
    <button class="btn btn-sm btn-ghost" data-action="quest-new">${icon('plus', 14)} Ziel</button></div>`;
  if (!d.goals.length) {
    return `<div class="card plain">${head}
      <p class="muted small" style="margin:0 0 10px">Eigene Ziele für den Tag, die Woche oder den Monat. Oder nimm einen Vorschlag:</p>
      <div class="row">
        <button class="btn btn-sm" data-action="quest-suggest" data-scope="day" data-a="" data-m="180">Täglich 3 h gesamt</button>
        <button class="btn btn-sm" data-action="quest-suggest" data-scope="day" data-a="Anki" data-m="15">Anki 15 min / Tag</button>
        <button class="btn btn-sm" data-action="quest-suggest" data-scope="week" data-a="" data-m="1500">25 h / Woche</button>
      </div></div>`;
  }
  const groups = St.QUEST_SCOPES.map((s) => [s.id, d.goals.filter(({ q }) => q.scope === s.id)]).filter(([, l]) => l.length);
  return `<div class="card plain">${head}
    ${groups.map(([scope, list]) => `<div class="goal-group">${GOAL_TITLES[scope]}</div>${list.map(row).join('')}`).join('')}
    ${d.goals.some(({ q }) => q.scope === 'day') ? `<div class="quest-streak">Tagesziele erfüllt: <b class="num">${d.qh.streak}</b> Tage in Folge · Bestwert ${d.qh.best}</div>` : ''}
  </div>`;
}

function timerCard() {
  const tm = timer();
  if (tm.state === 'idle' || !tm.state) {
    return `<div class="card"><div class="card-head"><h2>${icon('timer')} Timer</h2><span class="sub">läuft auf allen Geräten mit</span></div>
      <div class="row"><select id="timerAct" style="flex:1;min-width:160px">${acts().map((a) => `<option>${esc(a.name)}</option>`).join('')}</select>
      <button class="btn btn-primary" data-action="timer" data-kind="start">Start</button></div></div>`;
  }
  const running = tm.state === 'running', elapsed = timerElapsed(tm);
  return `<div class="card timer-live"><div class="card-head"><h2>${icon('timer')} Timer</h2><span class="sub">${esc(tm.a)} · seit ${clock(tm.begin || Date.now())}</span></div>
    <div id="timerClock" class="timer-clock ${running ? 'running' : ''}">${fmtClock(elapsed)}</div>
    ${running && elapsed > TIMER_WARN_MIN * 60000 ? `<div class="timer-warn">Läuft seit über ${fmtMin(Math.floor(elapsed / 3600000) * 60)} – noch dran? Beim Stoppen kannst du die Dauer korrigieren.</div>` : ''}
    <div class="row" style="margin-top:12px">
      ${running ? '<button class="btn" data-action="timer" data-kind="pause">Pause</button>' : '<button class="btn" data-action="timer" data-kind="resume">Weiter</button>'}
      <button class="btn btn-primary" data-action="timer" data-kind="stop">Stop &amp; loggen</button>
      <span class="spacer"></span><button class="btn btn-danger btn-sm" data-action="timer" data-kind="discard">Verwerfen</button></div></div>`;
}

/** Today's (or this week's) time per activity, compared with the average of the 7 days before. */
function todayCard(d) {
  const week = S.ui.homeRange === 'week';
  const start = week ? startOfWeek(d.today, ws()) : d.today;
  const by = {};
  let total = 0, count = 0;
  for (const day of eachDay(start, d.today)) {
    const e = d.dm.get(day);
    if (!e) continue;
    total += e.total;
    count += e.count;
    for (const [a, m] of Object.entries(e.by)) by[a] = (by[a] || 0) + m;
  }
  // reference: average day (or week) over the 7 days (or 4 weeks) before
  const refDays = week ? 28 : 7, refEnd = addDays(start, -1);
  const refBy = {};
  for (const day of eachDay(addDays(start, -refDays), refEnd)) {
    const e = d.dm.get(day);
    if (e) for (const [a, m] of Object.entries(e.by)) refBy[a] = (refBy[a] || 0) + m;
  }
  const refDiv = week ? 4 : 7;
  const list = chartActs(by).filter((a) => by[a.name] > 0).sort((a, b) => by[b.name] - by[a.name]);
  const max = Math.max(1, ...list.map((a) => by[a.name]));
  const refTotal = Object.values(refBy).reduce((s, m) => s + m, 0) / refDiv;
  const rows = list.map((a) => {
    const m = by[a.name], ref = (refBy[a.name] || 0) / refDiv;
    return `<div class="tl-row" style="--c:${a.color}">
      <div class="tl-top"><span class="tl-name"><i></i>${esc(a.name)}</span>
        <span class="num"><b>${fmtMin(m)}</b> <span class="muted">${Math.round((m / total) * 100)} %</span></span></div>
      <div class="tl-bar"><i style="width:${pct(m / max)}%"></i></div>
      <div class="tl-ref">Ø ${week ? 'Woche' : 'Tag'} zuletzt: ${fmtMin(ref)}</div></div>`;
  }).join('');
  // a running day/week is shown as "share of your average", not as a (mostly negative) difference
  const share = refTotal > 0 ? Math.round((total / refTotal) * 100) : null;
  const unit = week ? 'Woche' : 'Tag';
  return `<div class="card today-card"><div class="card-head"><h2>${icon(week ? 'calendar' : 'sun')} ${week ? 'Diese Woche' : 'Heute'} nach Aktivität</h2>
      <div class="seg"><button class="${week ? '' : 'active'}" data-action="home-range" data-r="day">Heute</button>
        <button class="${week ? 'active' : ''}" data-action="home-range" data-r="week">Woche</button></div></div>
    <div class="today-body">
      <div class="today-donut">${Ch.donut(list.map((a) => ({ label: a.name, value: by[a.name], color: a.color })), { size: 176, stroke: 22, center: fmtMin(total), sub: `${count} Logs` })}
        ${share != null ? `<div class="today-share ${share >= 100 ? 'up' : ''}">${share >= 100 ? '✓ ' : ''}${share} % von deinem Ø-${unit}
          <span class="muted">(${fmtMin(refTotal)})</span></div>` : ''}</div>
      <div class="today-list">${rows || `<div class="muted">${week ? 'Diese Woche' : 'Heute'} ist noch nichts geloggt. Tippe oben auf einen Shortcut.</div>`}</div>
    </div></div>`;
}

function heatCard(d) {
  const year = S.ui.heatYear || +d.today.slice(0, 4);
  const firstYear = +d.firstDay.slice(0, 4);
  return `<div class="card"><div class="card-head"><h2>${icon('grid')} Heatmap</h2>
      <div class="row"><button class="btn btn-sm" data-action="heat" data-dir="-1" ${year <= firstYear ? 'disabled' : ''}>←</button>
      <b class="num">${year}</b><button class="btn btn-sm" data-action="heat" data-dir="1" ${year >= +d.today.slice(0, 4) ? 'disabled' : ''}>→</button></div></div>
    <div class="scroll-x" id="heatScroll">${Ch.heatmap(d.dm, year, { today: d.today })}</div>
    <div class="row small muted" style="margin-top:8px"><span class="heat-legend">weniger
      ${[0.22, 0.4, 0.6, 0.8, 1].map((o) => `<i style="opacity:${o}"></i>`).join('')} mehr (8 h+)</span>
      <span class="spacer"></span><span>Tag antippen zeigt seine Logs</span></div></div>`;
}

function viewHome() {
  const d = D();
  const recent = [...d.live].sort((a, b) => b.t - a.t).slice(0, 6);
  return `<div class="grid">
    ${headCard(d)}
    ${!S.device.token && !d.live.length ? `<div class="card"><div class="card-head"><h2>Willkommen</h2></div>
      <p style="margin:0 0 12px">Verbinde dieses Gerät mit deinem privaten Daten-Repo, dann lädt dein kompletter Verlauf.</p>
      <button class="btn btn-primary" data-action="goto-settings" data-anchor="sync">Gerät verbinden</button></div>` : ''}
    <div class="cols-2">${shortcutsCard()}${goalsPanel(d)}</div>
    ${todayCard(d)}
    ${timerCard()}
    ${heatCard(d)}
    <div class="card"><div class="card-head"><h2>${icon('history')} Letzte Aktivität</h2><button class="btn btn-sm btn-ghost" data-view="logs">Alle Logs →</button></div>
      <div class="list">${recent.length ? recent.map((l) => logItem(l)).join('') : '<p class="muted">Noch keine Logs.</p>'}</div></div>
  </div>`;
}

const RECAP_TITLE = { week: 'Wochenrückblick', month: 'Monatsrückblick', year: 'Jahresrückblick', all: 'Gesamtrückblick' };

function viewStats() {
  const d = D(), p = S.ui.period, anchor = S.ui.anchor || d.today;
  const range = St.periodRange(p, anchor, { ws: ws(), firstDay: d.firstDay, today: d.today });
  const agg = St.aggregate(d.dm, range);
  const rc = St.recap(d.dm, range, d.today, ws());
  const list = chartActs(agg.by).filter((a) => agg.by[a.name] > 0).sort((a, b) => agg.by[b.name] - agg.by[a.name]);
  const counts = {};
  for (const l of d.live) if (l.d >= range.start && l.d <= range.end) counts[l.a] = (counts[l.a] || 0) + 1;
  const isNow = range.start <= d.today && d.today <= range.end;
  return `<div class="grid">
    <div class="card"><div class="card-head">
      <div class="seg">${St.PERIODS.map((x) => `<button class="${x.id === p ? 'active' : ''}" data-action="period" data-p="${x.id}">${x.label}</button>`).join('')}</div>
      ${p !== 'all' ? `<div class="row"><button class="btn btn-sm" data-action="shift" data-dir="-1">←</button><b class="num">${esc(range.label)}</b>
        <button class="btn btn-sm" data-action="shift" data-dir="1" ${range.end >= d.today ? 'disabled' : ''}>→</button>
        ${isNow ? '' : '<button class="btn btn-sm" data-action="shift" data-dir="0">Heute</button>'}</div>` : `<b>${esc(range.label)}</b>`}</div>
      <div class="cols-2">
        <div class="row" style="gap:20px;align-items:center">
          ${Ch.donut(list.map((a) => ({ label: a.name, value: agg.by[a.name], color: a.color })), { center: fmtH(agg.total), sub: `${fmtNum(agg.count)} Logs` })}
          <div class="legend" style="flex:1;min-width:180px">${list.map((a) => `<div class="legend-row"><span class="sw" style="background:${a.color}"></span>
            <span>${esc(a.name)}</span><span class="num">${fmtH(agg.by[a.name])}</span><span class="pct num">${Math.round((agg.by[a.name] / agg.total) * 100)} %</span></div>`).join('') || '<span class="muted">Keine Logs in diesem Zeitraum.</span>'}</div>
        </div>
        <div class="recap"><h3>${RECAP_TITLE[p]}</h3><div class="stat-list">
          <div class="stat-row"><span>Gesamt</span><b>${fmtH(rc.total)}</b></div>
          ${rc.pct != null ? `<div class="stat-row"><span>ggü. gleichem Zeitraum davor</span><b class="${rc.pct >= 0 ? 'up' : 'down'}">${rc.pct >= 0 ? '+' : ''}${rc.pct} %</b></div>` : ''}
          <div class="stat-row"><span>Ø pro Tag</span><b>${fmtMin(rc.avg)}</b></div>
          <div class="stat-row"><span>Aktive Tage</span><b>${rc.active} / ${rc.elapsed}</b></div>
          ${rc.best ? `<div class="stat-row"><span>Bester Tag (${fmtDate(rc.best.d, { weekday: true })})</span><b>${fmtMin(rc.best.total)}</b></div>` : ''}
          ${rc.top ? `<div class="stat-row"><span>Top-Aktivität: ${esc(rc.top[0])}</span><b>${fmtH(rc.top[1])}</b></div>` : ''}
        </div></div>
      </div></div>
    <div class="card"><div class="card-head"><h2>Verlauf</h2><span class="sub">Stunden pro ${p === 'week' || p === 'month' ? 'Tag' : 'Monat'} · gestrichelt: kumuliert (rechte Achse)</span></div>
      <div class="scroll-x" id="barsBox" data-range="1"></div></div>
    ${chorusCard(d)}
    <div class="card"><div class="card-head"><h2>Aktivitäten</h2></div><div class="list">
      ${list.map((a) => `<div class="item"><span class="dot" style="background:${a.color}"></span><div class="what"><b>${esc(a.name)}</b>
        <div class="note">${fmtNum(counts[a.name] || 0)} Logs · Ø ${fmtMin(agg.by[a.name] / (counts[a.name] || 1))} pro Log</div></div>
        <div class="right num">${fmtH(agg.by[a.name])}</div></div>`).join('') || '<p class="muted">Keine Logs.</p>'}</div></div>
  </div>`;
}

function drawBars() {
  const box = $('#barsBox');
  if (!box) return;
  const d = D();
  const range = St.periodRange(S.ui.period, S.ui.anchor || d.today, { ws: ws(), firstDay: d.firstDay, today: d.today });
  const agg = St.aggregate(d.dm, range);
  const width = Math.max(box.clientWidth, range.buckets.length * 14, 320);
  box.innerHTML = Ch.historyBars(agg, chartActs(agg.by), { width, height: 270 });
  box.scrollLeft = box.scrollWidth;
}

function viewLogs() {
  return `<div class="grid"><div class="card">
    <div class="row" style="margin-bottom:6px">
      <input type="search" id="logQ" placeholder="Suchen (Aktivität, Notiz, Medium)…" value="${esc(S.ui.logQ)}" style="flex:2;min-width:180px">
      <select id="logA" style="flex:1;min-width:150px"><option value="">Alle Aktivitäten</option>
        ${chartActs(D().tot.by).map((a) => `<option ${S.ui.logA === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      ${S.ui.logDay ? `<button class="btn btn-sm btn-primary" data-action="clear-day">${fmtDate(S.ui.logDay, { weekday: true })} ✕</button>` : ''}
    </div>
    <div id="logList"></div></div></div>`;
}

function renderLogList() {
  const box = $('#logList');
  if (!box) return;
  const d = D(), q = S.ui.logQ.trim().toLowerCase();
  const rows = d.live.filter((l) => (!S.ui.logA || l.a === S.ui.logA) && (!S.ui.logDay || l.d === S.ui.logDay)
    && (!q || `${l.a} ${l.n || ''} ${l.md || ''}`.toLowerCase().includes(q))).sort((a, b) => (b.d === a.d ? b.t - a.t : b.d < a.d ? -1 : 1));
  const shown = rows.slice(0, S.ui.logLimit);
  let html = '', day = null;
  for (const l of shown) {
    if (l.d !== day) {
      day = l.d;
      const tot = rows.filter((x) => x.d === day).reduce((s, x) => s + x.m, 0);
      html += `<div class="day-head"><span>${relDay(day) === 'heute' || relDay(day) === 'gestern' ? relDay(day) + ', ' + fmtDate(day) : fmtDate(day, { weekday: true })}</span><span class="num">${fmtMin(tot)}</span></div>`;
    }
    html += logItem(l, { date: false });
  }
  box.innerHTML = `<div class="muted small">${fmtNum(rows.length)} Logs · ${fmtH(rows.reduce((s, x) => s + x.m, 0))}</div>
    <div class="list">${html || '<p class="muted">Nichts gefunden.</p>'}</div>
    ${rows.length > shown.length ? `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" data-action="more-logs">Mehr anzeigen (${fmtNum(rows.length - shown.length)} weitere)</button></div>` : ''}`;
}

const HOURS = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${h}:00 Uhr</option>`).join('');
const ACT_OPTS = (sel, withAll = false) => (withAll ? `<option value="">Gesamt (alle)</option>` : '')
  + acts().map((a) => `<option ${a.name === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

function syncText() {
  const s = sync.status, pend = sync.pending(), bad = sync.inboxBad();
  const last = s.lastOk ? `zuletzt ${relDay(dayOf(s.lastOk))} ${clock(s.lastOk)}` : '';
  const badTxt = bad ? ` · ⚠ ${bad} Inbox-Datei${bad > 1 ? 'en' : ''} unlesbar (liegt im Repo unter inbox/)` : '';
  return {
    local: 'Nur auf diesem Gerät gespeichert. Mit Token wird zwischen deinen Geräten gesynct.',
    idle: 'Verbunden.', syncing: 'Synchronisiere …', ok: `Synchron ✓ ${last}${badTxt}`,
    offline: `Offline, ${pend} Datei(en) warten auf Upload. Geht automatisch weiter.`,
    error: `Fehler: ${s.detail}`, auth: `Zugriff fehlgeschlagen: ${s.detail}`,
  }[s.kind] || '';
}

function viewSettings() {
  const set = settings(), d = D();
  return `<div class="grid">
    <div class="card" id="sec-sync"><div class="card-head"><h2>Sync (GitHub)</h2><span class="sub" id="syncText">${esc(syncText())}</span></div>
      <div class="form-grid">
        <label class="field"><span>Gerätename</span><input type="text" id="devName" value="${esc(S.device.name)}"></label>
        <label class="field"><span>Privates Daten-Repo</span><input type="text" id="devRepo" value="${esc(`${S.device.owner}/${S.device.repo}`)}"></label>
        <label class="field full"><span>GitHub-Token (bleibt nur auf diesem Gerät)</span>
          <input type="password" id="devToken" autocomplete="off" placeholder="${S.device.token ? 'gespeichert ✓ (zum Ändern neu einfügen)' : 'github_pat_…'}"></label>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn btn-primary" data-action="sync-connect">Verbinden &amp; testen</button>
        <button class="btn" data-action="sync-now" ${S.device.token ? '' : 'disabled'}>Jetzt synchronisieren</button>
        ${S.device.token ? '<span class="spacer"></span><button class="btn btn-danger btn-sm" data-action="sync-disconnect">Token entfernen</button>' : ''}</div>
      <details class="guide" style="margin-top:14px" ${S.device.token ? '' : 'open'}><summary>So erstellst du einen Token (einmal pro Gerät)</summary><ol>
        <li>Öffne <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained token erstellen</a> (eingeloggt als <b>Hasi-hby</b>).</li>
        <li>Name z. B. „Tsuzuku ${esc(S.device.name)}“, Ablaufdatum nach Wunsch (max. 1 Jahr oder „No expiration“).</li>
        <li><b>Repository access</b> → „Only select repositories“ → <code>nihongo-tracker-data</code>.</li>
        <li><b>Permissions</b> → Repository permissions → <b>Contents: Read and write</b>. Sonst nichts.</li>
        <li>„Generate token“, kopieren, oben einfügen und „Verbinden &amp; testen“ drücken.</li>
      </ol><p class="muted small">Ein Token pro Gerät: Geht ein Handy verloren, löschst du nur dessen Token auf GitHub.</p></details>
    </div>

    <div class="card" id="sec-inbox"><div class="card-head"><h2>${icon('bolt')} Loggen ohne App</h2><span class="sub">Siri, Widget, Apple Watch, PC</span></div>
      <p class="muted small" style="margin:0 0 12px">Alles, was eine Datei in <code>inbox/</code> im Daten-Repo ablegt, wird beim nächsten Sync ein normaler Log, auch wenn die App gerade zu ist.
        Format: <code>{"a":"Immersion","m":20,"md":"…","t":"…","src":"siri"}</code>, Pflicht sind nur <code>a</code> (Aktivität) und <code>m</code> (Minuten).</p>
      <details class="guide"><summary>iOS-Kurzbefehl einrichten</summary><ol>
        <li>Eigenen <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained Token</a> „Tsuzuku Kurzbefehl“: nur <code>${esc(S.device.repo)}</code>, <b>Contents: Read and write</b>.</li>
        <li>Kurzbefehle-App → <b>+</b> → <b>„Nach Eingabe fragen“</b> (Zahl, „Wie viele Minuten?“). Für einen 1-Tipp-Log stattdessen eine feste Zahl nehmen.</li>
        <li><b>„Wörterbuch“</b>: <code>a</code> = Immersion, <code>m</code> = Eingabe (Zahl), <code>t</code> = Aktuelles Datum (Format ISO 8601), <code>src</code> = siri, optional <code>md</code> = Medium.</li>
        <li><b>„Base64-Codierung“</b> auf das Wörterbuch, Zeilenumbrüche: <i>Keine</i>.</li>
        <li><b>„Inhalt von URL abrufen“</b>: <code>https://api.github.com/repos/${esc(S.device.owner)}/${esc(S.device.repo)}/contents/inbox/</code> + Aktuelles Datum (Benutzerdefiniert <code>yyyyMMdd-HHmmss</code>) + <code>.json</code>.
          Methode <b>PUT</b>, Header <code>Authorization</code> = <code>Bearer &lt;Token&gt;</code>, Hauptteil <b>JSON</b>: <code>message</code> = Kurzbefehl, <code>content</code> = Base64-Text.</li>
        <li>Starten per Siri (Name des Kurzbefehls), Home-Bildschirm-Widget, Apple Watch oder NFC-Automation.</li>
      </ol></details>
      <details class="guide" style="margin-top:10px"><summary>Vom PC oder aus eigenen Skripten</summary>
        <code class="code-block">python tools/log.py Immersion 25 --md "Frieren S1E03"</code>
        <p class="muted small" style="margin:0">Legt die Datei im Daten-Klon an und pusht sie mit deinem normalen Git-Login. Aus Python: <code>from log import log</code>.</p></details>
    </div>

    <div class="card" id="sec-shortcuts"><div class="card-head"><h2>Shortcuts</h2><span class="sub">Standard-Dauer pro Shortcut · Tasten 1–9</span></div>
      <label class="toggle"><input type="checkbox" data-change="set-instant" ${set.instantShortcuts ? 'checked' : ''}>
        <span><b>Sofort loggen</b><br><span class="muted small">Aus: Ein Tipp öffnet den Schnell-Log, dort passt du die tatsächliche Dauer an. An: Es wird direkt die Standard-Dauer geloggt.</span></span></label>
      <div class="list">${shortcuts().map((sc, i, arr) => `<div class="item" style="grid-template-columns:minmax(0,1fr) 76px auto">
        <select data-change="sc-a" data-id="${esc(sc.id)}">${ACT_OPTS(sc.a)}</select>
        <input type="number" min="1" data-change="sc-m" data-id="${esc(sc.id)}" value="${sc.m}" aria-label="Minuten">
        <div class="right"><button class="link" data-action="sc-move" data-id="${esc(sc.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="link" data-action="sc-move" data-id="${esc(sc.id)}" data-dir="1" ${i === arr.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="link" data-action="sc-del" data-id="${esc(sc.id)}" aria-label="Löschen">✕</button></div></div>`).join('')}</div>
      <button class="btn btn-sm" data-action="sc-add" style="margin-top:10px">+ Shortcut</button></div>

    <div class="card" id="sec-quests"><div class="card-head"><h2>Ziele</h2>
      <button class="btn btn-sm btn-primary" data-action="quest-new">${icon('plus', 14)} Neues Ziel</button></div>
      <div class="list">${quests().map((q) => `<div class="item" style="grid-template-columns:minmax(0,1fr) auto"><div class="what"><b>${esc(goalName(q))}</b>
        <div class="note">${scopeOf(q).label} · ${esc(q.a || 'Gesamt')} · ${fmtMin(q.m)} · seit ${fmtDate(q.since || d.today)}</div></div>
        <div class="right"><button class="link" data-action="quest-edit" data-id="${esc(q.id)}" aria-label="Bearbeiten">${icon('edit', 16)}</button></div></div>`).join('')
        || '<p class="muted">Noch keine Ziele. Lege mit „Neues Ziel“ dein erstes an.</p>'}</div></div>

    <div class="card" id="sec-acts"><div class="card-head"><h2>Aktivitäten</h2><span class="sub">Farbe pro Aktivität</span></div>
      <div class="list">${acts().map((a) => `<div class="item" style="grid-template-columns:auto minmax(0,1fr) auto">
        <input type="color" value="${esc(a.color)}" data-change="act-color" data-id="${esc(a.id)}" aria-label="Farbe">
        <b>${esc(a.name)}</b>
        <div class="right"><button class="link" data-action="act-rename" data-id="${esc(a.id)}" title="Umbenennen oder zusammenführen" aria-label="Umbenennen">${icon('edit', 16)}</button>
          <button class="link" data-action="act-hide" data-id="${esc(a.id)}" title="Aus Auswahllisten entfernen (Logs bleiben)">✕</button></div></div>`).join('')}</div>
      <div class="form-grid form-inline act-form">
        <label class="field"><span>Neue Aktivität</span><input type="text" id="newActName" placeholder="z. B. Lesen"></label>
        <label class="field"><span>Farbe</span><input type="color" id="newActColor" value="#5b7e91"></label>
        <button class="btn" data-action="act-add">Hinzufügen</button></div></div>

    <div class="card" id="sec-chorus"><div class="card-head"><h2>${icon('wave')} Chorus-Pflicht</h2><span class="sub">täglich, verpasst = Nachholtag mit doppelter Zeit</span></div>
      <label class="toggle"><input type="checkbox" data-change="ch-on" ${chorusCfg().on ? 'checked' : ''}>
        <span><b>Chorus-Pflicht aktiv</b><br><span class="muted small">Jeden Tag ein paar Minuten. Verpasst du sie, kannst du sie am nächsten Tag mit doppelter Zeit
          nachholen, dann läuft deine Chorus-Serie weiter.</span></span></label>
      <div class="form-grid">
        <label class="field"><span>Zählt als Chorusing</span><select data-change="ch-a">${ACT_OPTS(chorusCfg().a)}</select></label>
        <label class="field"><span>Minuten pro Tag</span><input type="number" min="1" max="120" data-change="ch-m" value="${chorusCfg().m}"></label>
        <label class="field"><span>Chorus-Zeit ab</span><select data-change="ch-from">${HOURS(chorusCfg().from)}</select></label>
        <label class="field"><span>bis</span><select data-change="ch-until">${HOURS(chorusCfg().until)}</select></label>
      </div></div>

    <div class="card"><div class="card-head"><h2>Allgemein</h2></div><div class="form-grid">
      <label class="field"><span>Tagesende (Custom day end)</span><select data-change="set-dayend">${[0, 1, 2, 3, 4, 5, 6].map((h) => `<option value="${h}" ${(set.dayEnd || 0) === h ? 'selected' : ''}>${h === 0 ? 'Mitternacht (Standard)' : `${h}:00 Uhr nachts`}</option>`).join('')}</select></label>
      <div class="field"><span>Design</span><div class="seg">${[['dark', 'Dunkel'], ['light', 'Hell']].map(([k, l]) => `<button class="${S.ui.theme === k ? 'active' : ''}" data-action="set-theme" data-theme="${k}">${l}</button>`).join('')}</div></div>
    </div></div>

    <div class="card" id="sec-export"><div class="card-head"><h2>${icon('history')} Export &amp; Backup</h2><span class="sub">${fmtNum(d.live.length)} Logs · ${fmtH(d.tot.total)}${persistent() ? '' : ' · ⚠ Browser-Speicher nicht verfügbar'}</span></div>
      <div class="export-main">
        <div><b>Alles exportieren</b>
          <p class="muted small" style="margin:4px 0 0">Ein ZIP mit allem, was du für einen Wechsel brauchst:</p>
          <ul class="export-list small">
            <li><code>logs.csv</code> alle Logs für andere Tracker, Google Sheets oder Numbers</li>
            <li><code>logs_excel.csv</code> öffnet direkt in deutschem Excel</li>
            <li><code>lingotrack_activity_logs.csv</code> im LingoTrack-Format</li>
            <li><code>tage.csv</code> Minuten pro Tag und Aktivität</li>
            <li><code>tsuzuku-backup.json</code> komplettes Backup inkl. Shortcuts und Zielen</li>
          </ul></div>
        <button class="btn btn-primary btn-wide" data-action="export-all">ZIP exportieren</button>
      </div>
      <div class="row" style="margin-top:14px">
        <span class="muted small">Einzeln:</span>
        <button class="btn btn-sm" data-action="export-one" data-file="logs.csv" data-type="text/csv">Logs (CSV)</button>
        <button class="btn btn-sm" data-action="export-one" data-file="logs_excel.csv" data-type="text/csv">Excel (CSV)</button>
        <button class="btn btn-sm" data-action="export-one" data-file="tsuzuku-backup.json" data-type="application/json">Backup (JSON)</button>
        <span class="spacer"></span>
        <label class="btn btn-sm">Backup einspielen<input type="file" id="importFile" accept=".json,application/json" hidden></label></div>
      <p class="muted small">Unabhängig von dieser App liegen deine Daten als lesbare Dateien im privaten Repo <code>${esc(S.device.owner)}/${esc(S.device.repo)}</code> (mit kompletter Versionshistorie) und als Kopie in OneDrive. Einspielen führt zusammen und überschreibt nichts Neueres.</p></div>

    <p class="muted small" style="text-align:center">Tsuzuku 続く ${VERSION} · ${esc(S.device.name)}</p>
  </div>`;
}

// ---- Log modal --------------------------------------------------------------------------

function openLogModal(id = null, preset = {}) {
  const l = id ? S.logs.get(id) : null;
  const quick = !l && !!preset.quick;
  const dflt = l || {
    a: preset.a || shortcuts()[0]?.a || acts()[0]?.name, m: preset.m || '', d: preset.d || today(), t: preset.t || Date.now(),
  };
  const names = acts().map((a) => a.name);
  if (dflt.a && !names.includes(dflt.a)) names.push(dflt.a);
  const media = [...new Set(D().live.map((x) => x.md).filter(Boolean))].slice(0, 200);
  const title = l ? 'Log bearbeiten' : preset.title || (quick ? 'Wie lange wirklich?' : 'Aktivität loggen');
  const sub = quick ? `Shortcut · Standard ${fmtMin(preset.m)}` : !l && preset.sub ? preset.sub : '';
  const dlg = $('#modal');
  dlg.className = 'sheet';
  dlg.innerHTML = `<form class="modal-body" id="logForm" style="--c:${colorOf(dflt.a)}">
    <div class="modal-head"><div><h2>${esc(title)}</h2>${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}</div>
      <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <label class="field"><span>Aktivität</span><select name="a" class="act-select">${names.map((n) => `<option ${n === dflt.a ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <div class="field"><span>Dauer</span>
      <div class="stepper"><button type="button" class="btn" data-step="-5" aria-label="5 Minuten weniger">−5</button>
        <input type="text" name="m" inputmode="decimal" autocomplete="off" placeholder="45 oder 1:30" value="${dflt.m || ''}" required title="Mausrad: hoch = 1 min mehr, runter = 1 min weniger">
        <button type="button" class="btn" data-step="5" aria-label="5 Minuten mehr">+5</button></div>
      <div class="quick-min">${[10, 15, 20, 30, 45, 60, 90, 120].map((m) => `<button type="button" class="btn btn-sm" data-min="${m}">${fmtMin(m)}</button>`).join('')}</div>
      <span class="muted small" id="durHint"></span></div>
    <details class="more" ${quick ? '' : 'open'}><summary>Tag, Uhrzeit, Notiz, Medium</summary>
      <div class="form-grid">
        <label class="field"><span>Tag</span><input type="date" name="d" value="${dflt.d}" max="${today()}" required></label>
        <label class="field"><span>Uhrzeit</span><input type="time" name="time" value="${clock(dflt.t)}"></label>
        <label class="field full"><span>Notiz</span><input type="text" name="n" value="${esc(l?.n || '')}" placeholder="optional"></label>
        <label class="field full"><span>Medium</span><input type="text" name="md" list="mediaList" value="${esc(l?.md || '')}" placeholder="optional, z. B. Frieren S1"></label>
        <datalist id="mediaList">${media.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      </div></details>
    <div class="modal-foot">${l ? '<button type="button" class="btn btn-danger" data-del>Löschen</button>' : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn btn-primary btn-wide">${l ? 'Speichern' : 'Loggen'}</button></div>
  </form>`;
  const form = $('#logForm');
  const hint = () => {
    const m = parseDuration(form.m.value);
    $('#durHint').textContent = m > 0 && !/^\d+$/.test(form.m.value.trim()) ? `= ${fmtMin(m)}` : '';
  };
  form.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => dlg.close(); });
  form.querySelectorAll('[data-min]').forEach((b) => { b.onclick = () => { form.m.value = b.dataset.min; hint(); }; });
  const stepBy = (n) => {
    form.m.value = Math.max(1, Math.round((parseDuration(form.m.value) || 0) + n));
    form.m.setCustomValidity('');
    hint();
  };
  form.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => stepBy(+b.dataset.step); });
  // mouse wheel over the duration, like LingoTrack: up = one minute more, down = one less.
  // A mouse notch (about 100 px or 3 lines) is one minute, a fast spin bundles several notches
  // into one event, and the small deltas of a trackpad add up.
  let wheel = 0;
  form.querySelector('.stepper').addEventListener('wheel', (e) => {
    if (!e.deltaY) return;
    e.preventDefault();
    const px = e.deltaY * ([1, 33, 100][e.deltaMode] || 1);
    if (Math.abs(px) >= 40) {
      stepBy(-Math.sign(px) * Math.max(1, Math.round(Math.abs(px) / 100)));
      wheel = 0;
      return;
    }
    wheel += px;
    if (Math.abs(wheel) >= 40) { stepBy(-Math.sign(wheel)); wheel = 0; }
  }, { passive: false });
  form.a.onchange = () => form.style.setProperty('--c', colorOf(form.a.value));
  if (l) form.querySelector('[data-del]').onclick = () => { dlg.close(); deleteLog(l.id); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const m = parseDuration(form.m.value);
    if (!(m > 0)) { form.m.setCustomValidity('Bitte eine Dauer eingeben, z. B. 45 oder 1:30'); form.m.reportValidity(); return; }
    const dayEnd = settings().dayEnd || 0;
    const [hh, mm] = (form.time.value || clock(Date.now())).split(':').map(Number);
    const dt = new Date(`${form.d.value}T00:00:00`);
    dt.setHours(hh, mm, 0, 0);
    if (hh < dayEnd) dt.setDate(dt.getDate() + 1);
    const fields = { a: form.a.value, m: Math.round(m * 100) / 100, d: form.d.value, t: dt.getTime(), n: form.n.value.trim(), md: form.md.value.trim() };
    dlg.close();
    if (l) {
      await saveLog({ ...l, ...fields }, { desc: `✎ ${fields.a}`, prevYear: l.d.slice(0, 4) });
      render();
      toast('Log gespeichert');
    } else {
      await addLog({ ...fields, src: preset.src || 'manual' });
      await preset.onSaved?.();
    }
  };
  form.m.oninput = () => { form.m.setCustomValidity(''); hint(); };
  form.m.onfocus = () => form.m.select();
  dlg.showModal();
  if (!l) { form.m.focus(); form.m.select(); }
}

function openQuestModal(id = null) {
  const q = id ? quests().find((x) => x.id === id) : null;
  const cur = q || { scope: 'day', a: '', m: '', name: '' };
  const chips = { day: [15, 30, 60, 120, 180, 240], week: [300, 600, 1200, 1500, 1800, 2400], month: [1200, 3000, 6000, 9000] };
  const dlg = $('#modal');
  dlg.className = 'sheet';
  dlg.innerHTML = `<form class="modal-body" id="questForm">
    <div class="modal-head"><div><h2>${q ? 'Ziel bearbeiten' : 'Neues Ziel'}</h2>
      <div class="muted small">Für den Tag, die Woche oder den Monat</div></div>
      <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <div class="field"><span>Zeitraum</span><div class="seg seg-full">${St.QUEST_SCOPES.map((s) => `<button type="button" data-scope="${s.id}" class="${s.id === cur.scope ? 'active' : ''}">${s.label}</button>`).join('')}</div></div>
    <label class="field"><span>Aktivität</span><select name="a">${ACT_OPTS(cur.a, true)}</select></label>
    <div class="field"><span>Ziel</span><input type="text" name="m" inputmode="decimal" autocomplete="off" placeholder="z. B. 2:00, 90 oder 25h" value="${cur.m ? (cur.m % 60 ? cur.m : `${cur.m / 60}h`) : ''}" required>
      <div class="quick-min" id="qChips"></div><span class="muted small" id="qHint"></span></div>
    <label class="field"><span>Name (optional)</span><input type="text" name="qname" maxlength="60" value="${esc(cur.name || '')}" placeholder="z. B. Morgen-Anki oder Podcast-Woche"></label>
    <div class="modal-foot">${q ? '<button type="button" class="btn btn-danger" data-del>Löschen</button>' : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn btn-primary btn-wide">Ziel speichern</button></div>
  </form>`;
  const form = $('#questForm');
  let scope = cur.scope;
  const hint = () => {
    const m = parseDuration(form.m.value);
    $('#qHint').textContent = m > 0 ? `= ${fmtMin(m)}${St.QUEST_SCOPES.find((s) => s.id === scope).per || ' pro Tag'}` : '';
  };
  const drawChips = () => {
    $('#qChips').innerHTML = chips[scope].map((m) => `<button type="button" class="btn btn-sm" data-m="${m}">${fmtMin(m)}</button>`).join('');
    $('#qChips').querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { form.m.value = b.dataset.m % 60 ? b.dataset.m : `${b.dataset.m / 60}h`; hint(); }; });
  };
  form.querySelectorAll('[data-scope]').forEach((b) => {
    b.onclick = () => {
      scope = b.dataset.scope;
      form.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('active', x === b));
      drawChips();
      hint();
    };
  });
  form.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => dlg.close(); });
  if (q) form.querySelector('[data-del]').onclick = () => { dlg.close(); setMeta(upsertItem('quests', { id: q.id, x: 1 }), 'Ziel entfernt'); toast('Ziel gelöscht'); };
  form.m.oninput = () => { form.m.setCustomValidity(''); hint(); };
  form.onsubmit = (e) => {
    e.preventDefault();
    const m = parseDuration(form.m.value);
    if (!(m > 0)) { form.m.setCustomValidity('Bitte ein Ziel eingeben, z. B. 2:00 oder 30'); form.m.reportValidity(); return; }
    dlg.close();
    setMeta(upsertItem('quests', {
      id: q?.id || uid(), scope, a: form.a.value, m: Math.round(m), name: form.elements.qname.value.trim(), since: q?.since || today(),
    }), q ? 'Ziel geändert' : 'Neues Ziel');
    toast(q ? 'Ziel gespeichert' : 'Ziel angelegt');
  };
  drawChips();
  hint();
  dlg.showModal();
}

/** Rename an activity, or merge it into another one when the new name exists already. */
function openActModal(id) {
  const act = acts().find((a) => a.id === id);
  if (!act) return;
  const count = D().live.filter((l) => l.a === act.name).length;
  const others = acts().filter((a) => a.id !== act.id);
  const dlg = $('#modal');
  dlg.className = 'sheet';
  dlg.innerHTML = `<form class="modal-body" id="actForm" style="--c:${colorOf(act.name)}">
    <div class="modal-head"><div><h2>Aktivität umbenennen</h2><div class="muted small">${esc(act.name)} · ${fmtNum(count)} Logs</div></div>
      <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <label class="field"><span>Neuer Name</span><input type="text" name="to" list="actNames" maxlength="60" autocomplete="off" value="${esc(act.name)}" required>
      <datalist id="actNames">${others.map((a) => `<option value="${esc(a.name)}">`).join('')}</datalist></label>
    <p class="muted small" id="actHint" style="margin:0">Den Namen einer anderen Aktivität wählen, um beide zusammenzuführen.</p>
    <div class="modal-foot"><span class="spacer"></span>
      <button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn btn-primary btn-wide" id="actSubmit">Umbenennen</button></div>
  </form>`;
  const form = $('#actForm');
  const targetOf = (v) => others.find((a) => a.name.toLowerCase() === v.trim().toLowerCase());
  form.to.oninput = () => {
    const t = targetOf(form.to.value);
    $('#actSubmit').textContent = t ? 'Zusammenführen' : 'Umbenennen';
    $('#actHint').innerHTML = t
      ? `<b>${fmtNum(count)} Logs</b> von „${esc(act.name)}“ wandern zu „${esc(t.name)}“. „${esc(act.name)}“ verschwindet aus den Listen. Lässt sich nicht rückgängig machen.`
      : 'Den Namen einer anderen Aktivität wählen, um beide zusammenzuführen.';
  };
  form.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => dlg.close(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const to = targetOf(form.to.value)?.name || form.to.value.trim();
    dlg.close();
    if (to && to !== act.name) await renameAct(act.name, to);
  };
  dlg.showModal();
  form.to.select();
}

async function renameAct(from, to) {
  const r = renameActivity([...S.logs.values()], S.meta, from, to, Date.now(), { chorusDefault: CHORUS_DEFAULTS.a });
  const desc = `${from} → ${to}`;
  if (r.logs.length) await saveLogs(r.logs, desc);
  if (S.ui.logA === from) S.ui.logA = to;
  await setMeta((m) => Object.assign(m, r.meta), desc, 800);
  if (r.merged) toast(`${fmtNum(r.logs.length)} Logs nach „${to}“ verschoben`);
  else toast(`Umbenannt in „${to}“`, { label: 'Rückgängig', fn: () => renameAct(to, from) });
}

function shortcutTap(sc) {
  if (settings().instantShortcuts) return addLog({ a: sc.a, m: sc.m, src: 'shortcut' });
  return openLogModal(null, { a: sc.a, m: sc.m, src: 'shortcut', quick: true });
}

// ---- Export / import ----------------------------------------------------------------------

/** Phones get the share sheet ("In Dateien sichern"), everything else a normal download. */
async function saveFile(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  const phone = matchMedia('(pointer: coarse)').matches;
  if (phone && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportFiles() {
  return buildExport({ logs: [...S.logs.values()], meta: S.meta, version: VERSION });
}

async function exportAll() {
  await saveFile(`tsuzuku-export-${today()}.zip`, zip(exportFiles()));
  toast('Export erstellt');
}

async function exportOne(name, type) {
  const f = exportFiles().find((x) => x.name === name);
  const [base, ext] = name.split(/\.(?=[^.]+$)/);
  const stem = base.startsWith('tsuzuku') ? base : `tsuzuku-${base.replace(/_/g, '-')}`;
  await saveFile(`${stem}-${today()}.${ext}`, new Blob([f.data], { type }));
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const logs = Array.isArray(data.logs) ? data.logs.filter((l) => l && l.id && l.d && l.a && l.m >= 0) : [];
    const r = mergeLists([...S.logs.values()], logs);
    if (r.toLocal.length) {
      const c = r.toLocal.map(canonLog);
      c.forEach((l) => S.logs.set(l.id, l));
      await putLogs(c);
      new Set(c.map((l) => l.d.slice(0, 4))).forEach((y) => sync.markYear(y, 'Backup eingespielt'));
    }
    if (data.meta) {
      const m = mergeMeta(S.meta, data.meta);
      if (m.localChanged) { S.meta = m.meta; await setKV('meta', S.meta); sync.markMeta('Backup eingespielt'); }
    }
    S.ver++;
    sync.schedule(500);
    render();
    toast(`${fmtNum(r.toLocal.length)} Logs übernommen`);
  } catch (e) {
    toast(`Backup nicht lesbar: ${e.message}`);
  }
}

// ---- Rendering + navigation --------------------------------------------------------------

const VIEWS = { home: viewHome, stats: viewStats, logs: viewLogs, settings: viewSettings };

function render() {
  const active = document.activeElement;
  if (active && $('#main').contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && active.type !== 'file') {
    pendingRender = true; // don't wipe what the user is typing
    return;
  }
  pendingRender = false;
  const v = VIEWS[S.ui.view] ? S.ui.view : 'home';
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#main').innerHTML = VIEWS[v]();
  justSealed = false; // the glow animation plays once
  const td = $('#topDate');
  if (td) td.textContent = fmtDate(today(), { weekday: true, year: false });
  if (v === 'stats') drawBars();
  if (v === 'logs') renderLogList();
  const hs = $('#heatScroll');
  if (hs) {
    const year = S.ui.heatYear || +today().slice(0, 4);
    if (year === +today().slice(0, 4)) {
      const col = Math.floor((Date.parse(today()) - Date.parse(`${year}-01-01`)) / 864e5 / 7);
      hs.scrollLeft = Math.max(0, 26 + col * 15 - hs.clientWidth + 80);
    }
  }
  renderSyncPill();
}

function go(view, anchor) {
  S.ui.view = VIEWS[view] ? view : 'home';
  if (location.hash !== `#${S.ui.view}`) history.replaceState(null, '', `#${S.ui.view}`);
  saveUI();
  render();
  if (anchor) $(`#sec-${anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else window.scrollTo({ top: 0 });
}

function renderSyncPill() {
  const pill = $('#syncPill');
  if (!pill || !sync) return;
  const s = sync.status, pend = sync.pending();
  let kind = s.kind, txt = { local: 'lokal', idle: 'bereit', syncing: 'sync …', ok: 'synchron', offline: 'offline', error: 'Fehler', auth: 'Token?' }[kind];
  if (pend && (kind === 'ok' || kind === 'idle')) { kind = 'pending'; txt = `${pend} offen`; }
  pill.dataset.kind = kind;
  pill.querySelector('.txt').textContent = txt;
  pill.title = syncText();
  const st = $('#syncText');
  if (st) st.textContent = syncText();
}

function applyTheme() {
  const t = S.ui.theme === 'light' ? 'light' : 'dark'; // dark unless chosen otherwise (an old 'auto' too)
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#050807' : '#f4f8f6';
}

function saveUI() {
  const { view, theme, period, homeRange } = S.ui;
  setKV('ui', { view, theme, period, homeRange });
}

// ---- Events --------------------------------------------------------------------------------

async function onAction(el) {
  const { action, id } = el.dataset;
  switch (action) {
    case 'new-log': return openLogModal();
    case 'edit-log': return openLogModal(id);
    case 'shortcut': {
      const sc = shortcuts().find((x) => x.id === id);
      if (sc) await shortcutTap(sc);
      return;
    }
    case 'chorus-log': return chorusLog();
    case 'quest-new': return openQuestModal();
    case 'quest-edit': return openQuestModal(id);
    case 'timer': return timerAction(el.dataset.kind);
    case 'heat': S.ui.heatYear = (S.ui.heatYear || +today().slice(0, 4)) + +el.dataset.dir; return render();
    case 'home-range': S.ui.homeRange = el.dataset.r; saveUI(); return render();
    case 'period': S.ui.period = el.dataset.p; S.ui.anchor = null; saveUI(); return render();
    case 'shift': S.ui.anchor = +el.dataset.dir === 0 ? null : St.shiftAnchor(S.ui.period, S.ui.anchor || today(), +el.dataset.dir); return render();
    case 'goto-settings': return go('settings', el.dataset.anchor);
    case 'clear-day': S.ui.logDay = ''; return render();
    case 'more-logs': S.ui.logLimit += 300; return renderLogList();
    case 'theme': S.ui.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); saveUI(); return render();
    case 'set-theme': S.ui.theme = el.dataset.theme; applyTheme(); saveUI(); return render();
    case 'quest-suggest':
      return setMeta(upsertItem('quests', { id: uid(), scope: el.dataset.scope, a: el.dataset.a, m: +el.dataset.m, since: today() }), 'Ziel');
    case 'sc-add': {
      const o = Math.max(-1, ...shortcuts().map((s) => s.o ?? 0)) + 1;
      return setMeta(upsertItem('shortcuts', { id: uid(), a: acts()[0]?.name || 'Immersion', m: 15, o }), 'Shortcut');
    }
    case 'sc-del': return setMeta(upsertItem('shortcuts', { id, x: 1 }), 'Shortcut entfernt');
    case 'sc-move': {
      const list = shortcuts(), i = list.findIndex((s) => s.id === id), j = i + +el.dataset.dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      return setMeta((m) => list.forEach((s, o) => upsertItem('shortcuts', { id: s.id, o })(m)), 'Shortcuts sortiert');
    }
    case 'act-add': {
      const name = $('#newActName').value.trim();
      if (!name) return;
      if (acts().some((a) => a.name.toLowerCase() === name.toLowerCase())) { toast('Gibt es schon'); return; }
      const o = Math.max(-1, ...acts().map((a) => a.o ?? 0)) + 1;
      // ids are the original names: a renamed activity may still own this one, a hidden one comes back
      const same = (S.meta.activities || []).find((a) => a.id === name);
      const aid = same && same.name !== name ? uid() : name;
      return setMeta(upsertItem('activities', { id: aid, name, color: $('#newActColor').value, o, x: 0 }), `Aktivität ${name}`);
    }
    case 'act-hide': return setMeta(upsertItem('activities', { id, x: 1 }), 'Aktivität ausgeblendet');
    case 'act-rename': return openActModal(id);
    case 'export-all': return exportAll();
    case 'export-one': return exportOne(el.dataset.file, el.dataset.type);
    case 'sync-now':
      if (!S.device.token) return go('settings', 'sync');
      return sync.run();
    case 'sync-connect': return connectSync();
    case 'sync-disconnect':
      S.device.token = '';
      await setKV('device', S.device);
      sync.configure({ token: '' });
      toast('Token von diesem Gerät entfernt');
      return render();
    default:
  }
}

async function connectSync() {
  const token = $('#devToken').value.trim() || S.device.token;
  const [owner, repo] = $('#devRepo').value.trim().split('/');
  const name = $('#devName').value.trim() || guessDevice();
  if (!token) { toast('Bitte zuerst einen Token einfügen'); return; }
  if (!owner || !repo) { toast('Repo im Format besitzer/name angeben'); return; }
  sync.configure({ token, owner, repo, device: name }, false);
  try {
    const info = await sync.test();
    S.device = { token, owner, repo, name };
    await setKV('device', S.device);
    sync.configure({ token, owner, repo, device: name });
    toast(`Verbunden mit ${info.name}${info.private ? ' (privat)' : ' ⚠ öffentlich!'}`);
    $('#devToken').value = '';
    await sync.run();
    render();
  } catch (e) {
    sync.configure({ ...S.device, device: S.device.name }, false);
    toast(e.message);
    renderSyncPill();
  }
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('dialog')) return;
    const nav = e.target.closest('[data-view]');
    if (nav) { go(nav.dataset.view); return; }
    const el = e.target.closest('[data-action]');
    if (el && !el.disabled) { onAction(el); return; }
    const day = e.target.closest('[data-day]');
    if (day && !day.classList.contains('hm-future')) {
      S.ui.logDay = day.dataset.day;
      S.ui.logQ = '';
      S.ui.logA = '';
      go('logs');
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'importFile' && el.files[0]) { importBackup(el.files[0]); el.value = ''; return; }
    if (el.id === 'logA') { S.ui.logA = el.value; S.ui.logLimit = 150; renderLogList(); return; }
    const key = el.dataset.change, id = el.dataset.id;
    if (!key) return;
    if (key === 'sc-a') setMeta(upsertItem('shortcuts', { id, a: el.value }), 'Shortcut');
    if (key === 'sc-m') { const m = parseDuration(el.value); if (m > 0) setMeta(upsertItem('shortcuts', { id, m }), 'Shortcut'); }
    if (key === 'act-color') setMeta(upsertItem('activities', { id, color: el.value }), 'Farbe');
    if (key === 'set-dayend') setSettings({ dayEnd: +el.value }, 'Tagesende');
    if (key === 'set-instant') setSettings({ instantShortcuts: el.checked }, 'Shortcut-Modus');
    if (key.startsWith('ch-')) {
      const field = key.slice(3);
      const value = field === 'on' ? el.checked : field === 'a' ? el.value : +el.value;
      if (field === 'm' && !(value > 0)) return;
      setSettings({ chorus: { ...chorusCfg(), [field]: value } }, 'Chorus-Pflicht');
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'logQ') { S.ui.logQ = e.target.value; S.ui.logLimit = 150; renderLogList(); }
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => { if (pendingRender && !$('#main').contains(document.activeElement)) render(); }, 0);
  });

  document.addEventListener('keydown', (e) => {
    if ($('#modal').open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (/^[1-9]$/.test(e.key)) {
      const sc = shortcuts()[+e.key - 1];
      if (sc) { e.preventDefault(); shortcutTap(sc); }
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openLogModal();
    }
  });

  addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (v && !VIEWS[v]) { go('home'); return; } // e.g. a link to the old hunter page
    if (VIEWS[v] && v !== S.ui.view) { S.ui.view = v; render(); window.scrollTo({ top: 0 }); }
  });
  addEventListener('online', () => sync.run());
  addEventListener('offline', () => sync.setStatus('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync.run(); render(); } });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.ui.view === 'stats') drawBars(); }, 150); });

  setInterval(() => {
    const el = $('#timerClock');
    if (el && timer().state === 'running') el.textContent = fmtClock(timerElapsed());
    const cd = $('#cqCountdown');
    if (cd) cd.textContent = fmtClock(msUntilDayEnd());
  }, 1000);
  let lastHour = new Date().getHours();
  setInterval(() => {
    const h = new Date().getHours();
    if ((cache.today && cache.today !== today()) || h !== lastHour) { lastHour = h; render(); }
  }, 60_000);
  setInterval(() => { if (document.visibilityState === 'visible') sync.run(); }, 120_000);
}

// ---- Boot --------------------------------------------------------------------------------------

async function boot() {
  await openStore();
  const [logs, meta, device, ui] = await Promise.all([allLogs(), getKV('meta'), getKV('device'), getKV('ui')]);
  logs.forEach((l) => S.logs.set(l.id, l));
  if (meta) S.meta = meta;
  if (device) S.device = { ...S.device, ...device };
  if (ui) Object.assign(S.ui, ui);
  const hv = location.hash.slice(1);
  if (VIEWS[hv]) S.ui.view = hv;
  if (!VIEWS[S.ui.view] || (hv && !VIEWS[hv])) { // e.g. the old hunter page
    S.ui.view = 'home';
    history.replaceState(null, '', '#home');
  }
  applyTheme();

  sync = new Sync({
    logsOfYear: (y) => [...S.logs.values()].filter((l) => l.d.startsWith(y)),
    localYears: () => [...new Set([...S.logs.values()].map((l) => l.d.slice(0, 4)))],
    applyLogs: async (list) => {
      const c = list.map(canonLog);
      c.forEach((l) => S.logs.set(l.id, l));
      await putLogs(c);
      S.ver++;
      render();
    },
    getMeta: () => S.meta,
    applyMeta: async (m) => { S.meta = m; await setKV('meta', m); S.ver++; render(); },
    onStatus: () => renderSyncPill(),
    fromInbox: (name, data) => parseInbox(name, data, {
      dayEnd: settings().dayEnd || 0, actNames: (S.meta.activities || []).map((a) => a.name),
    }),
    onInbox: (logs, bad) => {
      if (logs.length === 1) {
        const [l] = logs;
        toast(`Inbox: +${fmtMin(l.m)} ${l.a}${l.src && l.src !== 'inbox' ? ` (${l.src})` : ''}`);
      } else if (logs.length) {
        toast(`Inbox: ${logs.length} Logs übernommen (${fmtMin(logs.reduce((s, l) => s + l.m, 0))})`);
      }
      if (bad.length) toast(`Inbox-Datei unlesbar (${bad[0].path.split('/').pop()}): ${bad[0].errors[0]}`);
    },
  });
  await sync.init({ token: S.device.token, owner: S.device.owner, repo: S.device.repo, device: S.device.name });

  bindEvents();
  render();
  window.__booted = true;
  try { sessionStorage.removeItem('nh-heal'); } catch { /* storage blocked */ }
  // colours only after the first sync, so a newer remote meta is merged before anything is rewritten
  sync.run().then(migrateColors);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
