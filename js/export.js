// Export files for switching trackers: plain CSV, an Excel-friendly CSV, the LingoTrack
// activity_logs.csv format, daily totals, and the full re-importable backup.

import { canonLog } from './merge.js?v=2.5.0';
import { pad } from './util.js?v=2.5.0';

const BOM = '﻿';
const csvCell = (v, sep) => {
  const s = String(v ?? '');
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows, sep = ',') => BOM + rows.map((r) => r.map((v) => csvCell(v, sep)).join(sep)).join('\r\n') + '\r\n';

const localStamp = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const utcStamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// LingoTrack "types" per attribute of an activity
const LT_TYPES = { listen: 'Listening,Watching', memory: 'Vocabulary', output: 'Speaking', pron: 'Listening,Pronunciation', read: 'Reading' };

export const EXPORT_FILES = ['LIESMICH.txt', 'logs.csv', 'logs_excel.csv', 'lingotrack_activity_logs.csv', 'tage.csv', 'tsuzuku-backup.json'];

/** -> [{ name, data }] for zip() */
export function buildExport({ logs, meta, now = new Date(), version = '' }) {
  const live = logs.filter((l) => !l.x).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const attrOf = new Map((meta.activities || []).map((a) => [a.name, a.attr]));
  const actNames = [...new Set(live.map((l) => l.a))];
  const total = live.reduce((s, l) => s + l.m, 0);

  const head = ['id', 'datum', 'start_lokal', 'zeitstempel_utc', 'aktivitaet', 'minuten', 'notiz', 'medium', 'quelle'];
  const row = (l) => [l.id, l.d, localStamp(l.t), utcStamp(l.t), l.a, l.m, l.n || '', l.md || '', l.src || ''];
  const logsCsv = csv([head, ...live.map(row)]);
  const excelCsv = csv([head, ...live.map((l) => row(l).map((v, i) => (i === 5 ? String(v).replace('.', ',') : v)))], ';');

  const ltCsv = csv([
    ['id', 'timestamp_utc', 'language', 'action', 'types', 'minutes'],
    ...live.map((l) => [l.id.startsWith('lt-') ? l.id.slice(3) : l.id, utcStamp(l.t), 'Japanese', l.a, LT_TYPES[attrOf.get(l.a) || 'listen'], l.m]),
  ]);

  const days = new Map();
  for (const l of live) {
    const e = days.get(l.d) || { total: 0, by: {} };
    e.total += l.m;
    e.by[l.a] = (e.by[l.a] || 0) + l.m;
    days.set(l.d, e);
  }
  const dayCsv = csv([
    ['datum', 'gesamt_minuten', ...actNames],
    ...[...days.keys()].sort().map((d) => [d, round(days.get(d).total), ...actNames.map((a) => round(days.get(d).by[a] || 0))]),
  ]);

  const backup = JSON.stringify({ app: 'tsuzuku', v: 1, exported: now.toISOString(), meta, logs: logs.map(canonLog) });

  const readme = [
    `Tsuzuku Export ${version}`.trim(),
    `Erstellt: ${localStamp(now.getTime())}`,
    `${live.length} Logs, ${(total / 60).toFixed(1).replace('.', ',')} Stunden, ${days.size} Tage`,
    '',
    'Dateien',
    '-------',
    'logs.csv                       Alle Logs, eine Zeile pro Eintrag (Komma, UTF-8). Für andere Tracker,',
    '                               Google Sheets, Numbers oder eigene Skripte.',
    'logs_excel.csv                 Dasselbe mit Semikolon und Dezimalkomma, öffnet in deutschem Excel per Doppelklick.',
    'lingotrack_activity_logs.csv   Gleiches Format wie der LingoTrack-Export',
    '                               (id, timestamp_utc, language, action, types, minutes).',
    'tage.csv                       Minuten pro Tag, gesamt und je Aktivität.',
    'tsuzuku-backup.json            Vollständiges Backup inkl. Shortcuts, Zielen und Einstellungen.',
    '                               Lässt sich in Tsuzuku unter Einstellungen > "Backup einspielen" laden.',
    '',
    'Spalten in logs.csv',
    '-------------------',
    'datum            Tag, zu dem der Log zählt (berücksichtigt das eingestellte Tagesende)',
    'start_lokal      Zeitpunkt des Logs in deiner Ortszeit',
    'zeitstempel_utc  derselbe Zeitpunkt in UTC (ISO 8601)',
    'minuten          Dauer in Minuten',
    'quelle           lt = aus LingoTrack importiert, manual, shortcut, timer',
    '',
    'Deine Daten liegen außerdem jederzeit lesbar im privaten GitHub-Repo (logs/<jahr>.json, meta.json).',
  ].join('\r\n');

  return [
    { name: 'LIESMICH.txt', data: BOM + readme + '\r\n' },
    { name: 'logs.csv', data: logsCsv },
    { name: 'logs_excel.csv', data: excelCsv },
    { name: 'lingotrack_activity_logs.csv', data: ltCsv },
    { name: 'tage.csv', data: dayCsv },
    { name: 'tsuzuku-backup.json', data: backup },
  ];
}

const round = (m) => Math.round(m * 100) / 100;
