// Unit tests for the dashboard's business-logic block (<script id="ehp-core"> in index.html).
// The page stays a single self-contained file (constitution VI); tests load that block in a VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const match = html.match(/<script id="ehp-core">([\s\S]*?)<\/script>/);
assert.ok(match, 'index.html must contain <script id="ehp-core">');
const sandbox = {};
vm.runInNewContext(match[1], sandbox);
const Core = sandbox.EHPCore;

const sample = readFileSync(new URL('tests/fixtures/sample.csv', root), 'utf8');
const header = readFileSync(new URL('tests/fixtures/header.csv', root), 'utf8');

test('parseTable handles CSV quotes, CRLF and BOM', () => {
  const rows = Core.parseTable('﻿a,b\r\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('parseTable auto-detects TSV (pasted from Google Sheets)', () => {
  const rows = Core.parseTable('a\tb\n1, 2\t3\n');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [['a', 'b'], ['1, 2', '3']]);
});

test('parseThaiDate reads d/m/yyyy in both ค.ศ. and พ.ศ.', () => {
  const ad = Core.parseThaiDate('1/10/2026, 16:05:28');
  const be = Core.parseThaiDate('1/10/2569, 16:05:28');
  assert.equal(ad.getFullYear(), 2026);
  assert.equal(ad.getMonth(), 9);
  assert.equal(ad.getDate(), 1);
  assert.equal(ad.getHours(), 16);
  assert.equal(be.getTime(), ad.getTime());
  assert.equal(Core.parseThaiDate(''), null);
  assert.equal(Core.parseThaiDate('ไม่ใช่วันที่'), null);
});

test('formatThaiDate shows พ.ศ.', () => {
  assert.match(Core.formatThaiDate(new Date(2026, 9, 1, 16, 5)), /1 ต\.ค\. 2569/);
});

test('detectColumns finds districts by header text, recipient is the next column', () => {
  const rows = Core.parseTable(header);
  const cols = Core.detectColumns(rows[0]);
  const names = cols.hospitalCols.map((h) => h.district);
  assert.equal(names.length, 14);
  assert.ok(names.includes('เมืองน่าน') && names.includes('เฉลิมพระเกียรติ'));
  for (const h of cols.hospitalCols) assert.equal(h.recipientCol, h.col + 1);
  assert.ok(cols.checklist >= 0 && cols.staff >= 0 && cols.timestamp === 0);
});

test('detectColumns throws a Thai error naming the missing columns', () => {
  assert.throws(() => Core.detectColumns(['ประทับเวลา', 'อื่นๆ']), (err) => {
    assert.match(err.message, /Checklist/);
    assert.match(err.message, /เจ้าหน้าที่ให้คำแนะนำ/);
    return true;
  });
});

test('splitTopics matches full option text and keeps unknown topics', () => {
  const known = Core.STANDARD_TOPICS.map((t) => t.text);
  const cell = `${known[0]}, ${known[14]}, หัวข้อใหม่, ${known[1]}`;
  const out = Core.splitTopics(cell, known);
  assert.deepEqual([...out.matched].sort(), [known[0], known[1], known[14]].sort());
  assert.deepEqual([...out.unknown], ['หัวข้อใหม่']);
  assert.deepEqual([...Core.splitTopics('', known).matched], []);
});

test('there are exactly 15 standard topics with short labels', () => {
  assert.equal(Core.STANDARD_TOPICS.length, 15);
  for (const t of Core.STANDARD_TOPICS) assert.ok(t.label && t.text);
});

test('loadDataset keeps every non-blank row and derives fields', () => {
  const ds = Core.loadDataset(sample);
  assert.equal(ds.records.length, 4);
  const [r1, , r3, r4] = ds.records;
  assert.equal(r1.district, 'แม่จริม');
  assert.equal(r1.hospitalCode, '00001');
  assert.equal(r1.hospitalName, 'รพ.สต.ทดสอบหนึ่ง');
  assert.equal(r1.recipient, 'ผู้รับ ทดสอบ');
  assert.equal(r1.staff, 'เจ้าหน้าที่ ก');
  assert.equal(r3.round, 'ไม่ระบุรอบ');
  assert.equal(r4.district, 'ปัว');
  assert.equal(r4.hospitalKey, null);
  assert.ok(ds.warnings.some((w) => w.includes('แถวที่ 5')));
  assert.equal(ds.districts.length, 14);
  assert.equal(ds.topics.length, 16, '15 standard + 1 new topic from the form');
});

test('loadDataset tolerates TSV with BOM', () => {
  const tsv = '﻿' + Core.parseTable(sample).map((r) => r.join('\t')).join('\n');
  assert.equal(Core.loadDataset(tsv).records.length, 4);
});

test('hospital key uses 5-digit code, falls back to district + name', () => {
  assert.equal(Core.hospitalKey('ปัว', '06472 รพ.สต.บ้านตอง'), '06472');
  assert.equal(Core.hospitalKey('ปัว', 'รพ.สต.ไม่มีรหัส'), 'ปัว|รพ.สต.ไม่มีรหัส');
});

test('summarize: union of topics per hospital, coverage over 106', () => {
  const ds = Core.loadDataset(sample);
  const s = Core.summarize(ds, ds.records);
  assert.equal(s.totalRecords, 4);
  assert.equal(s.hospitalCount, 2);
  assert.equal(s.totalHospitals, 106);
  const h1 = s.hospitals.find((h) => h.key === '00001');
  assert.equal(h1.visits, 2);
  assert.equal(h1.doneCount, 3, 'topics 1,2 then 2,3 → union of 3');
  assert.equal(h1.totalTopics, 16);
  assert.deepEqual([...h1.staff].sort(), ['เจ้าหน้าที่ ก', 'เจ้าหน้าที่ ข']);
  const topic2 = s.topicCoverage.find((t) => t.text === Core.STANDARD_TOPICS[1].text);
  assert.equal(topic2.hospitals, 1);
});

test('summarize lists every district, including ones without records', () => {
  const ds = Core.loadDataset(sample);
  const s = Core.summarize(ds, ds.records);
  assert.equal(s.byDistrict.length, 14);
  const pua = s.byDistrict.find((d) => d.district === 'ปัว');
  assert.equal(pua.records, 2);
  assert.equal(pua.hospitals, 1);
  assert.equal(s.byDistrict.find((d) => d.district === 'เมืองน่าน').records, 0);
});

test('filterRecords applies district, round and staff; options from data', () => {
  const ds = Core.loadDataset(sample);
  assert.equal(Core.filterRecords(ds.records, { district: 'ปัว' }).length, 2);
  assert.equal(Core.filterRecords(ds.records, { round: 'รอบที่ 1' }).length, 2);
  assert.equal(Core.filterRecords(ds.records, { staff: 'เจ้าหน้าที่ ข', round: 'รอบที่ 2' }).length, 1);
  assert.equal(Core.filterRecords(ds.records, {}).length, 4);
  const opts = Core.filterOptions(ds);
  assert.deepEqual([...opts.rounds], ['รอบที่ 1', 'รอบที่ 2', 'ไม่ระบุรอบ']);
});

test('sheetCsvUrl converts a Google Sheet edit link to its CSV export link', () => {
  const id = '1KnS4ozW6cf5eS70iFk6FxopSt4M737AEnMGvvLnWqc0';
  assert.equal(
    Core.sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=1304924102#gid=1304924102`),
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=1304924102`
  );
  assert.equal(
    Core.sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit`),
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`
  );
  assert.equal(Core.DEFAULT_SHEET_URL.includes(id), true);
});

test('sheetCsvUrl rejects links that are not Google Sheets with a Thai message', () => {
  assert.throws(() => Core.sheetCsvUrl('https://example.com/data.csv'), /ลิงก์ Google Sheet/);
  assert.throws(() => Core.sheetCsvUrl(''), /ลิงก์ Google Sheet/);
});

test('loadDataset explains when Google returns a login page instead of CSV', () => {
  assert.throws(() => Core.loadDataset('<!DOCTYPE html><html><body>Sign in</body></html>'), /แชร์/);
});

test('followUp: an installer sees only รพ.สต. they visited, topics counted from everyone', () => {
  const ds = Core.loadDataset(sample);
  const staff = ds.records.find((r) => r.hospitalKey).staff;
  const now = new Date(2030, 0, 1);
  const fu = Core.followUp(ds, ds.records, staff, now);
  const all = Core.summarize(ds, ds.records).hospitals;
  const mine = all.filter((h) => h.staff.includes(staff));
  assert.equal(fu.hospitals, mine.length);
  assert.equal(fu.items.length, mine.filter((h) => h.missing.length).length);
  assert.equal(fu.complete + fu.items.length, fu.hospitals);
  for (let i = 1; i < fu.items.length; i++) {
    assert.ok(fu.items[i - 1].hospital.missing.length >= fu.items[i].hospital.missing.length, 'most missing first');
  }
  assert.ok(fu.items.every((i) => i.stale), 'every visit is long before "now"');
  assert.equal(fu.team.length, 0);
  const team = Core.followUp(ds, ds.records, '', now);
  assert.ok(team.team.some((t) => t.name === staff));
});
