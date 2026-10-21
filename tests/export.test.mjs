import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as nodeCrc } from 'node:zlib';
import { crc32, zip } from '../js/zip.js';
import { buildExport, EXPORT_FILES } from '../js/export.js';

const meta = { activities: [{ id: 'Anki', name: 'Anki', attr: 'memory' }, { id: 'Immersion', name: 'Immersion', attr: 'listen' }] };
const logs = [
  { id: 'lt-1', d: '2026-10-17', t: Date.UTC(2026, 9, 17, 8, 0), a: 'Immersion', m: 30, src: 'lt', u: 1 },
  { id: 'b', d: '2026-10-17', t: Date.UTC(2026, 9, 17, 9, 0), a: 'Anki', m: 12.5, n: 'Karten, "neu"', src: 'manual', u: 1 },
  { id: 'c', d: '2026-10-18', t: Date.UTC(2026, 9, 18, 9, 0), a: 'Anki', m: 15, src: 'shortcut', u: 1 },
  { id: 'gone', d: '2026-10-18', t: Date.UTC(2026, 9, 18, 10, 0), a: 'Anki', m: 99, src: 'manual', u: 2, x: 1 },
];

test('crc32 matches zlib', () => {
  const data = new TextEncoder().encode('日本語 Tsuzuku ✓ '.repeat(50));
  assert.equal(crc32(data), nodeCrc(data));
});

test('zip has a valid directory with every file', async () => {
  const files = [{ name: 'a.txt', data: 'hallo' }, { name: 'ordner/ü.csv', data: 'x,y\n1,2\n' }];
  const buf = new Uint8Array(await zip(files).arrayBuffer());
  const v = new DataView(buf.buffer);
  const end = buf.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);
  let p = v.getUint32(end + 16, true);
  const names = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const len = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true), size = v.getUint32(p + 20, true);
    names.push(new TextDecoder().decode(buf.subarray(p + 46, p + 46 + len)));
    const data = buf.subarray(off + 30 + len, off + 30 + len + size);
    assert.equal(crc32(data), v.getUint32(p + 16, true));
    p += 46 + len;
  }
  assert.deepEqual(names, ['a.txt', 'ordner/ü.csv']);
});

test('export contains all files, skips deleted logs, escapes CSV', () => {
  const files = buildExport({ logs, meta, now: new Date(Date.UTC(2026, 9, 18, 12)) });
  assert.deepEqual(files.map((f) => f.name), EXPORT_FILES);
  const get = (n) => files.find((f) => f.name === n).data.replace(/^﻿/, '').trim().split('\r\n');

  const csv = get('logs.csv');
  assert.equal(csv.length, 4); // header + 3 live logs
  assert.ok(csv[2].includes('"Karten, ""neu"""'));
  assert.ok(csv[1].includes('2026-10-17T08:00:00Z'));

  assert.ok(get('logs_excel.csv')[2].includes(';12,5;'));

  const lt = get('lingotrack_activity_logs.csv');
  assert.equal(lt[0], 'id,timestamp_utc,language,action,types,minutes');
  assert.equal(lt[1], '1,2026-10-17T08:00:00Z,Japanese,Immersion,"Listening,Watching",30');
  assert.ok(lt[2].endsWith('Anki,Vocabulary,12.5'));

  const days = get('tage.csv');
  assert.equal(days[0], 'datum,gesamt_minuten,Immersion,Anki');
  assert.equal(days[1], '2026-10-17,42.5,30,12.5');
  assert.equal(days[2], '2026-10-18,15,0,15');

  const backup = JSON.parse(files.find((f) => f.name === 'tsuzuku-backup.json').data);
  assert.equal(backup.logs.length, 4); // tombstones stay in the backup so deletions survive a restore
});
