import { allLogs, getKV, openStore, persistent, putLogs, setKV } from './store.js';
import { canonLog, defaultMeta, mergeLists, mergeMeta } from './merge.js';
import { Sync } from './sync.js';
import * as St from './stats.js';
import * as Hu from './hunter.js';
import * as Ch from './charts.js';
import {
  addDays, dayOf, esc, fmtClock, fmtDate, fmtH, fmtMin, fmtNum, pad, parseDuration, todayStr, uid,
} from './util.js';

const VERSION = '1.0.0';
const $ = (sel, root = document) => root.querySelector(sel);
const PALETTE = ['#34d399', '#8fb3e8', '#e8c170', '#f472b6', '#a78bfa', '#2dd4bf', '#fb923c', '#f87171', '#a3e635', '#38bdf8'];

const S = {
  logs: new Map(),
  meta: defaultMeta(),
  device: { token: '', owner: 'Hasi-hby', repo: 'nihongo-tracker-data', name: guessDevice() },
  ui: { view: 'home', theme: 'auto', period: 'week', anchor: null, heatYear: null, logQ: '', logA: '', logDay: '', logLimit: 150 },
  ver: 0,
};
let cache = { ver: -1 };
let sync;
let pendingRender = false;

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
  const set = settings();
  const streak = St.streakInfo(dm, t, { freezeStart: set.freezeStart || t, starterFreezes: set.starterFreezes ?? 1 });
  const tot = St.totals(dm);
  const hours = tot.total / 60;
  const qh = St.questHistory(quests(), dm, t);
  const firstDay = [...dm.keys()].sort()[0] || t;
  cache = {
    ver: S.ver, today: t, logs, live, dm, streak, tot, hours, qh, firstDay,
    level: Hu.levelFor(hours), rank: Hu.rankFor(hours),
    ach: Hu.achievements(dm, streak, live, qh.hist, ws()),
  };
  return cache;
}

function reachedDate(dm, minutes) {
  let cum = 0;
  for (const d of [...dm.keys()].sort()) {
    cum += dm.get(d).total;
    if (cum >= minutes) return d;
  }
  return null;
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

async function addLog({ a, m, d, t, n, md, src = 'manual' }) {
  const before = D();
  const l = { id: uid(), d: d || today(), t: t || Date.now(), a, m, n, md, src };
  await saveLog(l, { desc: `+${fmtMin(m)} ${a}` });
  render();
  const undo = () => toast(`${fmtMin(m)} ${a} geloggt`, { label: 'Rückgängig', fn: () => deleteLog(l.id, true) });
  if (celebrate(before, D())) $('#modal').addEventListener('close', undo, { once: true });
  else undo();
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
    const mins = Math.round(timerElapsed(tm) / 60000);
    await setTimer({ state: 'idle' }, 'Timer gestoppt');
    if (mins < 1) { toast('Unter einer Minute, nichts geloggt'); return; }
    const dayEnd = settings().dayEnd || 0;
    await addLog({ a: tm.a, m: mins, d: dayOf(tm.begin || Date.now(), dayEnd), t: tm.begin, src: 'timer' });
  }
}

// ---- Celebrations -------------------------------------------------------------------

function celebrate(before, after) {
  const lines = [];
  let big = '';
  if (after.rank.idx > before.rank.idx) {
    big = 'RANG-AUFSTIEG';
    lines.push(`Du bist jetzt <b>${esc(after.rank.rank.name)}</b>.`);
  }
  if (after.level.level > before.level.level) {
    big = big || 'LEVEL UP!';
    lines.push(`Lv. ${before.level.level} → <b>Lv. ${after.level.level}</b>`);
  }
  const had = new Set(before.ach.filter((a) => a.date).map((a) => a.id));
  for (const a of after.ach) {
    if (a.date && !had.has(a.id)) { big = big || 'TITEL ERHALTEN'; lines.push(`${a.icon} Titel <b>„${esc(a.name)}“</b> erhalten`); }
  }
  if (!lines.length) return false;
  const dlg = $('#modal');
  dlg.className = 'system-popup';
  dlg.innerHTML = `<form method="dialog" class="modal-body">
    <div class="sys-title">System</div>
    <div class="big">${big}</div>
    ${lines.map((l) => `<div>${l}</div>`).join('')}
    <button class="btn btn-system" value="ok" autofocus>Weiter</button></form>`;
  dlg.showModal();
  return true;
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

function tile(k, v, s = '', cls = '') {
  return `<div class="tile ${cls}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
}

function equippedTitle(d) {
  const got = d.ach.filter((a) => a.date);
  return got.find((a) => a.id === settings().title) || got.sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
}

function hunterCard(d) {
  const r = d.rank, L = d.level, title = equippedTitle(d);
  return `<button class="card hunter-card" data-view="hunter" style="text-align:left;width:100%">
    <div class="emblem" style="--rank:${r.rank.color}">${r.rank.id}</div>
    <div class="hunter-main">
      <div class="hunter-name"><h1>${esc(settings().name || 'Hunter')}</h1><span class="lvl">Lv. ${L.level}</span>
        ${title ? `<span class="title-chip">${title.icon} ${esc(title.name)}</span>` : ''}</div>
      <div class="bar"><i style="width:${pct(L.progress)}%"></i></div>
      <div class="row small muted"><span>${esc(r.rank.name)}${r.next ? ` · ${esc(r.next.name)} in ${fmtH(r.toNext * 60)}` : ''}</span>
        <span class="spacer"></span><span>Lv. ${L.level + 1} in ${fmtH(L.toNext * 60)}</span></div>
    </div></button>`;
}

function logItem(l, { date = true } = {}) {
  return `<div class="item">
    <span class="dot" style="background:${colorOf(l.a)}"></span>
    <div class="what"><div><b>${esc(l.a)}</b> · <span class="num">${fmtMin(l.m)}</span>${l.md ? ` · ${esc(l.md)}` : ''}</div>
      ${l.n ? `<div class="note">${esc(l.n)}</div>` : ''}</div>
    <div class="right"><span class="muted small">${date ? relDay(l.d) + ' · ' : ''}${clock(l.t)}</span>
      <button class="link" data-action="edit-log" data-id="${esc(l.id)}" aria-label="Bearbeiten">✎</button></div></div>`;
}

function questLabel(q) {
  return `${esc(q.a || 'Gesamt')}: ${fmtMin(q.m)}${q.scope === 'week' ? ' / Woche' : ''}`;
}

function questsPanel(d) {
  const qs = quests();
  const daily = qs.filter((q) => q.scope === 'day'), weekly = qs.filter((q) => q.scope === 'week');
  const row = (q) => {
    const p = St.questProgress(q, d.dm, d.today, ws());
    return `<div class="quest ${p.complete ? 'done' : ''}"><div class="quest-top"><span>${questLabel(q)}</span>
      <span class="num">${fmtMin(Math.min(p.done, 99999))} / ${fmtMin(p.target)}</span></div>
      <div class="bar ${p.complete ? 'green' : ''}"><i style="width:${pct(p.pct)}%"></i></div></div>`;
  };
  if (!qs.length) {
    return `<div class="sys"><div class="sys-title">Daily Quest</div>
      <p class="muted small" style="margin:0 0 10px">Noch keine Quests. Das System schlägt vor:</p>
      <div class="row">
        <button class="btn btn-sm btn-system" data-action="quest-suggest" data-scope="day" data-a="" data-m="180">Täglich 3 h gesamt</button>
        <button class="btn btn-sm btn-system" data-action="quest-suggest" data-scope="day" data-a="Anki" data-m="15">Anki 15 min / Tag</button>
        <button class="btn btn-sm btn-system" data-action="quest-suggest" data-scope="week" data-a="" data-m="1500">25 h / Woche</button>
      </div></div>`;
  }
  return `<div class="sys">
    ${daily.length ? `<div class="sys-title">Daily Quest</div>${daily.map(row).join('')}` : ''}
    ${weekly.length ? `<div class="sys-title" style="margin-top:${daily.length ? 16 : 0}px">Weekly Quest</div>${weekly.map(row).join('')}` : ''}
    <div class="row small muted" style="margin-top:10px">
      ${daily.length ? `<span>Quests erfüllt: <b class="num">${d.qh.streak}</b> Tage in Folge · Bestwert ${d.qh.best}</span>` : ''}
      <span class="spacer"></span><button class="btn btn-sm" data-action="goto-settings" data-anchor="quests">Verwalten</button></div></div>`;
}

function timerCard() {
  const tm = timer();
  if (tm.state === 'idle' || !tm.state) {
    return `<div class="card"><div class="card-head"><h2>⏱ Timer</h2><span class="sub">läuft auf allen Geräten mit</span></div>
      <div class="row"><select id="timerAct" style="flex:1;min-width:160px">${acts().map((a) => `<option>${esc(a.name)}</option>`).join('')}</select>
      <button class="btn btn-primary" data-action="timer" data-kind="start">Start</button></div></div>`;
  }
  const running = tm.state === 'running';
  return `<div class="card"><div class="card-head"><h2>⏱ Timer</h2><span class="sub">${esc(tm.a)} · seit ${clock(tm.begin || Date.now())}</span></div>
    <div id="timerClock" class="timer-clock ${running ? 'running' : ''}">${fmtClock(timerElapsed(tm))}</div>
    <div class="row" style="margin-top:12px">
      ${running ? '<button class="btn" data-action="timer" data-kind="pause">Pause</button>' : '<button class="btn" data-action="timer" data-kind="resume">Weiter</button>'}
      <button class="btn btn-primary" data-action="timer" data-kind="stop">Stop &amp; loggen</button>
      <span class="spacer"></span><button class="btn btn-danger btn-sm" data-action="timer" data-kind="discard">Verwerfen</button></div></div>`;
}

function heatCard(d) {
  const year = S.ui.heatYear || +d.today.slice(0, 4);
  const firstYear = +d.firstDay.slice(0, 4);
  return `<div class="card"><div class="card-head"><h2>Tracking-Heatmap</h2>
      <div class="row"><button class="btn btn-sm" data-action="heat" data-dir="-1" ${year <= firstYear ? 'disabled' : ''}>←</button>
      <b class="num">${year}</b><button class="btn btn-sm" data-action="heat" data-dir="1" ${year >= +d.today.slice(0, 4) ? 'disabled' : ''}>→</button></div></div>
    <div class="scroll-x" id="heatScroll">${Ch.heatmap(d.dm, year, { today: d.today, frozen: d.streak.frozen })}</div>
    <div class="row small muted" style="margin-top:8px"><span class="heat-legend">weniger
      ${[0.22, 0.4, 0.6, 0.8, 1].map((o) => `<i style="opacity:${o}"></i>`).join('')} mehr (8 h+)</span>
      <span class="heat-legend"><i style="background:var(--frozen)"></i> Freeze</span>
      <span class="spacer"></span><span>Tag antippen zeigt seine Logs</span></div></div>`;
}

function viewHome() {
  const d = D(), s = d.streak, wc = St.weekCompare(d.dm, d.today, ws());
  const tday = d.dm.get(d.today);
  const recent = [...d.live].sort((a, b) => b.t - a.t).slice(0, 6);
  const record = s.current > 0 && s.current >= s.longest;
  const wcTxt = wc.pct == null ? 'erste Woche' : `<span class="${wc.pct >= 0 ? 'up' : 'down'}">${wc.pct >= 0 ? '+' : ''}${wc.pct} %</span> ggü. letzter Woche`;
  return `<div class="grid">
    ${hunterCard(d)}
    ${!S.device.token && !d.live.length ? `<div class="sys"><div class="sys-title">Willkommen, Hunter</div>
      <p style="margin:0 0 12px">Verbinde dieses Gerät mit deinem privaten Daten-Repo, dann lädt dein kompletter Verlauf.</p>
      <button class="btn btn-system" data-action="goto-settings" data-anchor="sync">Gerät verbinden</button></div>` : ''}
    ${s.atRisk ? `<div class="alert"><span style="font-size:1.3rem">🔥</span><div><b>Streak in Gefahr.</b> Heute ist noch nichts geloggt.
      ${s.freezes ? `${s.freezes} Freeze${s.freezes > 1 ? 's' : ''} auf Vorrat würde${s.freezes > 1 ? 'n' : ''} dich retten.` : 'Kein Freeze auf Vorrat.'}</div></div>` : ''}
    <div class="tiles">
      ${tile('Aktueller Streak', `${fmtNum(s.current)}<small>Tage</small>`, `${record ? '🏆 Rekord' : `Rekord ${fmtNum(s.longest)}`} · ❄ ${s.freezes}`, 'streak')}
      ${tile('Heute', fmtMin(tday?.total || 0), `${tday?.count || 0} Logs`)}
      ${tile('Diese Woche', fmtH(wc.cur), wcTxt)}
      ${tile('Gesamt', fmtH(d.tot.total), `${fmtNum(d.tot.count)} Logs`)}
      ${tile('Längster Streak', `${fmtNum(s.longest)}<small>Tage</small>`, `${fmtNum(s.daysLogged)} Tage geloggt`)}
    </div>
    <div class="card"><div class="card-head"><h2>⚡ Shortcuts</h2>
      <button class="btn btn-sm" data-action="goto-settings" data-anchor="shortcuts">Bearbeiten</button></div>
      <div class="shortcuts">${shortcuts().map((sc, i) => `<button class="chip" data-action="shortcut" data-id="${esc(sc.id)}" style="--c:${colorOf(sc.a)}">
        <span class="sw"></span>${esc(sc.a)}<span class="m">${sc.m} min</span>${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}</button>`).join('')}
        <button class="chip" data-action="new-log"><span class="m">+ Aktivität</span><kbd>N</kbd></button></div></div>
    <div class="cols-2">${timerCard()}${questsPanel(d)}</div>
    ${heatCard(d)}
    <div class="card"><div class="card-head"><h2>Letzte Aktivität</h2><button class="btn btn-sm" data-view="logs">Alle Logs →</button></div>
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
        <div class="sys"><div class="sys-title">${RECAP_TITLE[p]}</div><div class="stat-list">
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

function viewHunter() {
  const d = D(), set = settings(), r = d.rank, L = d.level;
  const attrs = Hu.attributes(d.tot.by, S.meta.activities || []);
  const title = equippedTitle(d);
  const avg = St.avgPerDay(d.dm, d.today, 30);
  const cur = d.tot.total;
  const fc = (min) => St.forecast(d.today, cur, min, avg);
  const fcRow = (label, min) => {
    const f = fc(min);
    return `<div class="stat-row"><span>${label}</span><b>${f.reached ? 'erreicht' : f.date ? `${fmtDate(f.date)} <span class="muted small">(in ${fmtNum(f.days)} Tagen)</span>` : '–'}</b></div>`;
  };
  const got = d.ach.filter((a) => a.date).length;
  return `<div class="grid">
    <div class="cols-2">
      <div class="sys"><div class="sys-title">Status</div>
        <div class="hunter-card" style="margin-bottom:12px"><div class="emblem" style="--rank:${r.rank.color}">${r.rank.id}</div>
          <div class="hunter-main"><div class="hunter-name"><h1>${esc(set.name || 'Hunter')}</h1><span class="lvl">Lv. ${L.level}</span></div>
          <div class="muted small">${esc(r.rank.name)}${title ? ` · Titel: ${title.icon} ${esc(title.name)}` : ''}</div>
          <div class="bar"><i style="width:${pct(L.progress)}%"></i></div>
          <div class="small muted">XP ${fmtNum(cur)} · Lv. ${L.level + 1} bei ${fmtNum(L.next * 60)} XP</div></div></div>
        <div class="row" style="justify-content:center">${Ch.radar(attrs)}</div>
        <div class="stat-list">${attrs.map((a) => `<div class="stat-row"><span>${a.name} <span class="muted small">(${fmtH(a.hours * 60)})</span></span><b>${a.stat}</b></div>`).join('')}</div>
        <p class="muted small" style="margin:10px 0 0">Attribute = 10 · √Stunden. Welche Aktivität welches Attribut trainiert, stellst du unter Einstellungen → Aktivitäten ein.</p>
      </div>
      <div class="card"><div class="card-head"><h2>Hunter-Ränge</h2><span class="sub">nach Gesamtstunden</span></div><div class="ranks">
        ${Hu.RANKS.map((x, i) => {
          const reached = d.hours >= x.h;
          const when = reached ? (x.h ? reachedDate(d.dm, x.h * 60) : d.firstDay) : null;
          const f = reached ? null : fc(x.h * 60);
          return `<div class="rank-row ${reached ? 'reached' : ''}"><div class="emblem small" style="--rank:${x.color}">${x.id}</div>
            <div><b>${esc(x.name)}</b>${i === r.idx ? ' <span class="title-chip">aktuell</span>' : ''}<div class="muted small">ab ${fmtNum(x.h)} h</div></div>
            <div class="small muted" style="text-align:right">${reached ? `seit ${fmtDate(when)}` : `noch ${fmtH((x.h - d.hours) * 60)}${f?.date ? `<br>~ ${fmtDate(f.date)}` : ''}`}</div></div>`;
        }).join('')}</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Prognose</h2><span class="sub">bei deinem Schnitt der letzten 30 Tage: ${fmtMin(avg)} pro Tag</span></div>
      <div class="stat-list">
        ${fcRow(`Lv. ${L.level + 1}`, L.next * 60)}
        ${r.next ? fcRow(r.next.name, r.next.h * 60) : ''}
        ${[3000, 5000, 10000].filter((h) => h * 60 > cur).slice(0, 3).map((h) => fcRow(`${fmtNum(h)} Stunden`, h * 60)).join('')}
      </div></div>
    <div class="card"><div class="card-head"><h2>Titel &amp; Erfolge</h2><span class="sub">${got} / ${d.ach.length} freigeschaltet · antippen, um einen Titel zu tragen</span></div>
      <div class="ach-grid">${d.ach.map((a) => `<button class="ach ${a.date ? '' : 'locked'} ${title?.id === a.id ? 'equipped' : ''}" data-action="equip" data-id="${a.id}" ${a.date ? '' : 'disabled'} style="text-align:left">
        <span class="i">${a.icon}</span><b>${esc(a.name)}</b><span class="muted small">${esc(a.desc)}</span>
        <div class="small ${a.date ? '' : 'muted'}">${a.date ? fmtDate(a.date) : 'gesperrt'}</div></button>`).join('')}</div></div>
  </div>`;
}

function viewLogs() {
  return `<div class="grid"><div class="card">
    <div class="row" style="margin-bottom:6px">
      <input type="search" id="logQ" placeholder="Suchen (Aktivität, Notiz, Medium)…" value="${esc(S.ui.logQ)}" style="flex:2;min-width:180px">
      <select id="logA" style="flex:1;min-width:150px"><option value="">Alle Aktivitäten</option>
        ${chartActs(D().tot.by).map((a) => `<option ${S.ui.logA === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      ${S.ui.logDay ? `<button class="btn btn-sm btn-system" data-action="clear-day">${fmtDate(S.ui.logDay, { weekday: true })} ✕</button>` : ''}
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

const ATTR_OPTS = (sel) => Hu.ATTRS.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.name}</option>`).join('');
const ACT_OPTS = (sel, withAll = false) => (withAll ? `<option value="">Gesamt (alle)</option>` : '')
  + acts().map((a) => `<option ${a.name === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

function syncText() {
  const s = sync.status, pend = sync.pending();
  const last = s.lastOk ? `zuletzt ${relDay(dayOf(s.lastOk))} ${clock(s.lastOk)}` : '';
  return {
    local: 'Nur auf diesem Gerät gespeichert. Mit Token wird zwischen deinen Geräten gesynct.',
    idle: 'Verbunden.', syncing: 'Synchronisiere …', ok: `Synchron ✓ ${last}`,
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
        <li>Name z. B. „Hunter ${esc(S.device.name)}“, Ablaufdatum nach Wunsch (max. 1 Jahr oder „No expiration“).</li>
        <li><b>Repository access</b> → „Only select repositories“ → <code>nihongo-tracker-data</code>.</li>
        <li><b>Permissions</b> → Repository permissions → <b>Contents: Read and write</b>. Sonst nichts.</li>
        <li>„Generate token“, kopieren, oben einfügen und „Verbinden &amp; testen“ drücken.</li>
      </ol><p class="muted small">Ein Token pro Gerät: Geht ein Handy verloren, löschst du nur dessen Token auf GitHub.</p></details>
    </div>

    <div class="card" id="sec-shortcuts"><div class="card-head"><h2>Shortcuts</h2><span class="sub">Ein Tipp = sofort geloggt · Tasten 1–9</span></div>
      <div class="list">${shortcuts().map((sc, i, arr) => `<div class="item" style="grid-template-columns:minmax(0,1fr) 76px auto">
        <select data-change="sc-a" data-id="${esc(sc.id)}">${ACT_OPTS(sc.a)}</select>
        <input type="number" min="1" data-change="sc-m" data-id="${esc(sc.id)}" value="${sc.m}" aria-label="Minuten">
        <div class="right"><button class="link" data-action="sc-move" data-id="${esc(sc.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="link" data-action="sc-move" data-id="${esc(sc.id)}" data-dir="1" ${i === arr.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="link" data-action="sc-del" data-id="${esc(sc.id)}" aria-label="Löschen">✕</button></div></div>`).join('')}</div>
      <button class="btn btn-sm" data-action="sc-add" style="margin-top:10px">+ Shortcut</button></div>

    <div class="card" id="sec-quests"><div class="card-head"><h2>Quests (Ziele)</h2><span class="sub">Daily &amp; Weekly Quests im System-Fenster</span></div>
      <div class="list">${quests().map((q) => `<div class="item" style="grid-template-columns:1fr auto"><div><b>${questLabel(q)}</b>
        <div class="note">${q.scope === 'week' ? 'Wöchentlich' : 'Täglich'} · seit ${fmtDate(q.since || d.today)}</div></div>
        <div class="right"><button class="link" data-action="quest-del" data-id="${esc(q.id)}" aria-label="Löschen">✕</button></div></div>`).join('') || '<p class="muted">Noch keine Quests.</p>'}</div>
      <div class="form-grid form-inline q-form">
        <label class="field"><span>Art</span><select id="qScope"><option value="day">Täglich</option><option value="week">Wöchentlich</option></select></label>
        <label class="field"><span>Aktivität</span><select id="qAct">${ACT_OPTS('', true)}</select></label>
        <label class="field"><span>Ziel</span><input type="text" id="qMin" placeholder="z. B. 2:00" inputmode="decimal"></label>
        <button class="btn btn-system" data-action="quest-add">Hinzufügen</button></div></div>

    <div class="card" id="sec-acts"><div class="card-head"><h2>Aktivitäten</h2><span class="sub">Farbe und Attribut fürs Status-Fenster</span></div>
      <div class="list">${acts().map((a) => `<div class="item" style="grid-template-columns:auto minmax(0,1fr) minmax(0,140px) auto">
        <input type="color" value="${esc(a.color)}" data-change="act-color" data-id="${esc(a.id)}" aria-label="Farbe">
        <b>${esc(a.name)}</b><select data-change="act-attr" data-id="${esc(a.id)}">${ATTR_OPTS(a.attr)}</select>
        <button class="link" data-action="act-hide" data-id="${esc(a.id)}" title="Aus Auswahllisten entfernen (Logs bleiben)">✕</button></div>`).join('')}</div>
      <div class="form-grid form-inline act-form">
        <label class="field"><span>Neue Aktivität</span><input type="text" id="newActName" placeholder="z. B. Lesen"></label>
        <label class="field"><span>Farbe</span><input type="color" id="newActColor" value="#38bdf8"></label>
        <label class="field"><span>Attribut</span><select id="newActAttr">${ATTR_OPTS('read')}</select></label>
        <button class="btn" data-action="act-add">Hinzufügen</button></div></div>

    <div class="card"><div class="card-head"><h2>Allgemein</h2></div><div class="form-grid">
      <label class="field"><span>Hunter-Name</span><input type="text" data-change="set-name" value="${esc(set.name || '')}" placeholder="Hunter"></label>
      <label class="field"><span>Tagesende (Custom day end)</span><select data-change="set-dayend">${[0, 1, 2, 3, 4, 5, 6].map((h) => `<option value="${h}" ${(set.dayEnd || 0) === h ? 'selected' : ''}>${h === 0 ? 'Mitternacht (Standard)' : `${h}:00 Uhr nachts`}</option>`).join('')}</select></label>
      <div class="field full"><span>Design</span><div class="seg">${[['auto', 'Automatisch'], ['dark', 'Dunkel'], ['light', 'Hell']].map(([k, l]) => `<button class="${S.ui.theme === k ? 'active' : ''}" data-action="set-theme" data-theme="${k}">${l}</button>`).join('')}</div></div>
    </div>
      <p class="muted small">❄ Streak-Freeze aktiv seit ${fmtDate(set.freezeStart || d.today)}: alle 7 Streak-Tage gibt es einen Freeze (max. 2). Verpasst du einen Tag, wird automatisch einer verbraucht.
        Verfügbar: <b>${d.streak.freezes}</b> · nächster in ${d.streak.nextFreezeIn} Streak-Tag${d.streak.nextFreezeIn === 1 ? '' : 'en'}.</p></div>

    <div class="card"><div class="card-head"><h2>Daten &amp; Backup</h2><span class="sub">${fmtNum(d.live.length)} Logs auf diesem Gerät${persistent() ? '' : ' · ⚠ Browser-Speicher nicht verfügbar'}</span></div>
      <div class="row"><button class="btn" data-action="export-json">Backup (JSON)</button><button class="btn" data-action="export-csv">Export (CSV)</button>
        <label class="btn">Backup einspielen<input type="file" id="importFile" accept=".json,application/json" hidden></label></div>
      <p class="muted small">Deine Daten liegen auf jedem Gerät lokal, im privaten Repo <code>${esc(S.device.owner)}/${esc(S.device.repo)}</code> (mit kompletter Versionshistorie) und als Kopie in OneDrive. Einspielen führt zusammen und überschreibt nichts Neueres.</p></div>

    <p class="muted small" style="text-align:center">Nihongo Hunter ${VERSION} · ${esc(S.device.name)}</p>
  </div>`;
}

// ---- Log modal --------------------------------------------------------------------------

function openLogModal(id = null, preset = {}) {
  const l = id ? S.logs.get(id) : null;
  const now = new Date();
  const dflt = l || { a: preset.a || shortcuts()[0]?.a || acts()[0]?.name, m: preset.m || '', d: today(), t: now.getTime() };
  const names = acts().map((a) => a.name);
  if (dflt.a && !names.includes(dflt.a)) names.push(dflt.a);
  const media = [...new Set(D().live.map((x) => x.md).filter(Boolean))].slice(0, 200);
  const dlg = $('#modal');
  dlg.className = '';
  dlg.innerHTML = `<form class="modal-body" id="logForm">
    <div class="modal-head"><h2>${l ? 'Log bearbeiten' : 'Aktivität loggen'}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <div class="form-grid">
      <label class="field full"><span>Aktivität</span><select name="a">${names.map((n) => `<option ${n === dflt.a ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="field full"><span>Dauer</span><input type="text" name="m" inputmode="decimal" placeholder="z. B. 45 oder 1:30" value="${dflt.m || ''}" required></label>
      <div class="quick-min full">${[10, 15, 20, 30, 45, 60, 90, 120].map((m) => `<button type="button" class="btn btn-sm" data-min="${m}">${fmtMin(m)}</button>`).join('')}</div>
      <label class="field"><span>Tag</span><input type="date" name="d" value="${dflt.d}" max="${today()}" required></label>
      <label class="field"><span>Uhrzeit</span><input type="time" name="time" value="${clock(dflt.t)}"></label>
      <label class="field full"><span>Notiz</span><input type="text" name="n" value="${esc(l?.n || '')}" placeholder="optional"></label>
      <label class="field full"><span>Medium</span><input type="text" name="md" list="mediaList" value="${esc(l?.md || '')}" placeholder="optional, z. B. Solo Leveling S2"></label>
      <datalist id="mediaList">${media.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    </div>
    <div class="modal-foot">${l ? '<button type="button" class="btn btn-danger" data-del>Löschen</button>' : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn btn-primary">Speichern</button></div>
  </form>`;
  const form = $('#logForm');
  form.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => dlg.close(); });
  form.querySelectorAll('[data-min]').forEach((b) => { b.onclick = () => { form.m.value = b.dataset.min; }; });
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
      await addLog(fields);
    }
  };
  form.m.oninput = () => form.m.setCustomValidity('');
  dlg.showModal();
  if (!l) form.m.focus();
}

// ---- Export / import ----------------------------------------------------------------------

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportJSON() {
  const data = { app: 'nihongo-hunter', v: 1, exported: new Date().toISOString(), meta: S.meta, logs: [...S.logs.values()].map(canonLog) };
  download(`nihongo-hunter-backup-${today()}.json`, JSON.stringify(data), 'application/json');
}

function exportCSV() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = D().live.sort((a, b) => a.t - b.t).map((l) => [l.id, l.d, clock(l.t), l.a, l.m, l.n, l.md, l.src].map(q).join(','));
  download(`nihongo-hunter-logs-${today()}.csv`, '﻿id,datum,uhrzeit,aktivitaet,minuten,notiz,medium,quelle\n' + rows.join('\n'), 'text/csv');
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

const VIEWS = { home: viewHome, stats: viewStats, hunter: viewHunter, logs: viewLogs, settings: viewSettings };

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
  S.ui.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
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
  const t = S.ui.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : S.ui.theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === 'light' ? '#f5f6fa' : '#0a0b10';
}

function saveUI() {
  const { view, theme, period } = S.ui;
  setKV('ui', { view, theme, period });
}

// ---- Events --------------------------------------------------------------------------------

async function onAction(el) {
  const { action, id } = el.dataset;
  switch (action) {
    case 'new-log': return openLogModal();
    case 'edit-log': return openLogModal(id);
    case 'shortcut': {
      const sc = shortcuts().find((x) => x.id === id);
      if (sc) await addLog({ a: sc.a, m: sc.m, src: 'shortcut' });
      return;
    }
    case 'timer': return timerAction(el.dataset.kind);
    case 'heat': S.ui.heatYear = (S.ui.heatYear || +today().slice(0, 4)) + +el.dataset.dir; return render();
    case 'period': S.ui.period = el.dataset.p; S.ui.anchor = null; saveUI(); return render();
    case 'shift': S.ui.anchor = +el.dataset.dir === 0 ? null : St.shiftAnchor(S.ui.period, S.ui.anchor || today(), +el.dataset.dir); return render();
    case 'goto-settings': return go('settings', el.dataset.anchor);
    case 'clear-day': S.ui.logDay = ''; return render();
    case 'more-logs': S.ui.logLimit += 300; return renderLogList();
    case 'equip': return setSettings({ title: id }, 'Titel gewählt');
    case 'theme': S.ui.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); saveUI(); return render();
    case 'set-theme': S.ui.theme = el.dataset.theme; applyTheme(); saveUI(); return render();
    case 'quest-suggest':
      return setMeta(upsertItem('quests', { id: uid(), scope: el.dataset.scope, a: el.dataset.a, m: +el.dataset.m, since: today() }), 'Quest');
    case 'quest-add': {
      const m = parseDuration($('#qMin').value);
      if (!(m > 0)) { toast('Bitte ein Ziel eingeben, z. B. 2:00 oder 30'); return; }
      return setMeta(upsertItem('quests', { id: uid(), scope: $('#qScope').value, a: $('#qAct').value, m, since: today() }), 'Quest');
    }
    case 'quest-del': return setMeta(upsertItem('quests', { id, x: 1 }), 'Quest entfernt');
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
      return setMeta(upsertItem('activities', { id: name, name, color: $('#newActColor').value, attr: $('#newActAttr').value, o }), `Aktivität ${name}`);
    }
    case 'act-hide': return setMeta(upsertItem('activities', { id, x: 1 }), 'Aktivität ausgeblendet');
    case 'export-json': return exportJSON();
    case 'export-csv': return exportCSV();
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
    if (key === 'act-attr') setMeta(upsertItem('activities', { id, attr: el.value }), 'Attribut');
    if (key === 'set-name') setSettings({ name: el.value.trim() }, 'Name');
    if (key === 'set-dayend') setSettings({ dayEnd: +el.value }, 'Tagesende');
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
      if (sc) { e.preventDefault(); addLog({ a: sc.a, m: sc.m, src: 'shortcut' }); }
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openLogModal();
    }
  });

  addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (VIEWS[v] && v !== S.ui.view) { S.ui.view = v; render(); window.scrollTo({ top: 0 }); }
  });
  addEventListener('online', () => sync.run());
  addEventListener('offline', () => sync.setStatus('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync.run(); render(); } });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.ui.view === 'stats') drawBars(); }, 150); });

  setInterval(() => {
    const el = $('#timerClock');
    if (el && timer().state === 'running') el.textContent = fmtClock(timerElapsed());
  }, 1000);
  setInterval(() => { if (cache.today && cache.today !== today()) render(); }, 60_000);
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
  });
  await sync.init({ token: S.device.token, owner: S.device.owner, repo: S.device.repo, device: S.device.name });

  bindEvents();
  render();
  sync.run();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
