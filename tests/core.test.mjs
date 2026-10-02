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
  assert.equal(h1.totalTopics, 15, 'แม่จริม: 15 standard + 1 new topic − Lab Online');
  assert.deepEqual([...h1.staff].sort(), ['เจ้าหน้าที่ ก', 'เจ้าหน้าที่ ข']);
  const topic2 = s.topicCoverage.find((t) => t.text === Core.STANDARD_TOPICS[1].text);
  assert.equal(topic2.hospitals, 1);
});

test('summarize counts pilot sites as covered and complete', () => {
  const ds = Core.loadDataset(sample);
  const s = Core.summarize(ds, ds.records);
  assert.equal(s.pilotsDone, 10);
  assert.equal(s.coveredCount, s.hospitalCount + 10);
  const pua = Core.summarize(ds, ds.records, ds.records, { district: 'ปัว' });
  assert.equal(pua.pilotsDone, 5);
  const d = s.byDistrict.find((x) => x.district === 'ปัว');
  assert.equal(d.pilotsDone, 5);
  assert.equal(d.covered, d.hospitals + 5);
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

test('follow-up-later topics (Cleansing Data, ติดตาม Drug Catalog, Lab Online) are always listed last', () => {
  const later = ['Cleansing Data', 'ติดตาม Drug Catalog', 'Lab Online'];
  assert.deepEqual([...Core.STANDARD_TOPICS.slice(-3).map((t) => t.label)], later);
  const ds = Core.loadDataset(sample);
  assert.deepEqual([...ds.topics.slice(-3).map((t) => Core.topicLabel(t))], later);
  const fu = Core.followUp(ds, ds.records, '', new Date(2030, 0, 1));
  const firstLater = fu.topicGaps.findIndex((g) => g.later);
  if (firstLater >= 0) assert.ok(fu.topicGaps.slice(firstLater).every((g) => g.later), 'main topic gaps come first');
});

test('follow-up-later gaps keep Cleansing Data before ติดตาม Drug Catalog, whatever the counts', () => {
  const ds = Core.loadDataset(sample);
  const cleansing = ds.topics.find((t) => Core.topicLabel(t) === 'Cleansing Data');
  // Mark Cleansing Data done on one record so it lacks fewer รพ.สต. than ติดตาม Drug Catalog.
  const records = ds.records.map((r, i) => (i === 0 && r.hospitalKey ? { ...r, topics: [...r.topics, cleansing] } : r));
  const labels = Core.followUp(ds, records, '', new Date(2030, 0, 1)).topicGaps.filter((g) => g.later).map((g) => g.label);
  const ci = labels.indexOf('Cleansing Data'), di = labels.indexOf('ติดตาม Drug Catalog');
  if (ci >= 0 && di >= 0) assert.ok(ci < di);
});

test('followUp score: success % and work quality', () => {
  const ds = Core.loadDataset(sample);
  const fu = Core.followUp(ds, ds.records, '', new Date(2030, 0, 1));
  const sc = fu.score;
  const hs = Core.summarize(ds, ds.records).hospitals;
  const done = hs.reduce((n, h) => n + h.doneCount, 0);
  assert.equal(sc.topicsDone, done);
  const possible = hs.reduce((n, h) => n + h.totalTopics, 0);
  assert.equal(sc.topicsPossible, possible);
  assert.equal(sc.topicPct, done / possible);
  assert.equal(sc.completeHospitals, fu.complete);
  for (const t of fu.team) assert.ok(t.score.hospitals <= sc.hospitals);
});

test('Lab Online counts toward % only for รพ.สต. in อ.ปัว', () => {
  const lab = Core.STANDARD_TOPICS.find((t) => t.label === 'Lab Online').text;
  assert.equal(Core.topicApplies(lab, 'ปัว'), true);
  assert.equal(Core.topicApplies(lab, 'แม่จริม'), false);
  assert.equal(Core.topicApplies(Core.STANDARD_TOPICS[0].text, 'แม่จริม'), true);
  assert.equal(Core.topicScope(lab), 'เฉพาะ อ.ปัว');
  const ds = Core.loadDataset(sample);
  const s = Core.summarize(ds, ds.records);
  const h1 = s.hospitals.find((h) => h.key === '00001');
  const h2 = s.hospitals.find((h) => h.key === '00002');
  assert.ok(!h1.missing.includes(lab), 'แม่จริม is never missing Lab Online');
  assert.ok(h2.missing.includes(lab), 'ปัว still needs Lab Online');
  assert.equal(h2.totalTopics, h1.totalTopics + 1);
  const cov = s.topicCoverage.find((t) => t.text === lab);
  assert.equal(cov.eligible, 1, 'only the ปัว รพ.สต. is in the Lab Online base');
  const gap = Core.followUp(ds, ds.records, '', new Date(2030, 0, 1)).topicGaps.find((g) => g.text === lab);
  assert.equal(gap.hospitals, 1);
});

test('Drug Catalog MY PCU counts toward % only for รพ.สต. whose legacy system is MyPCU', () => {
  const dc = Core.STANDARD_TOPICS.find((t) => t.label === 'Drug Catalog MY PCU').text;
  assert.equal(Core.topicApplies(dc, 'เมืองน่าน', 'MyPCU'), true);
  assert.equal(Core.topicApplies(dc, 'แม่จริม', 'HOSxP-PCU'), false);
  assert.equal(Core.topicApplies(dc, 'ปัว', 'HOSxPXE-PCU'), false);
  assert.equal(Core.topicApplies(dc, 'แม่จริม', null), true, 'unknown system keeps the topic');
  assert.equal(Core.topicScope(dc), 'เฉพาะระบบเดิม MyPCU');
  const topics = Core.STANDARD_TOPICS.map((t) => t.text);
  const rec = (code, district) => ({ row: 2, timestamp: new Date(2026, 9, 2), round: 'รอบที่ 1', district, hospitalKey: code,
    hospitalCode: code, hospitalName: code, recipient: '-', topics: [], otherAdvice: '', suggestion: '', staff: 'x' });
  const ds = { topics, newTopics: [], districts: ['แม่จริม', 'เมืองน่าน'], records: [rec('06475', 'แม่จริม'), rec('06448', 'เมืองน่าน')] };
  const s = Core.summarize(ds, ds.records);
  const hosxp = s.hospitals.find((h) => h.code === '06475');
  const mypcu = s.hospitals.find((h) => h.code === '06448');
  assert.equal(hosxp.totalTopics, 13, 'HOSxP-PCU in แม่จริม: 15 − Lab Online − Drug Catalog MY PCU');
  assert.equal(mypcu.totalTopics, 14, 'MyPCU in เมืองน่าน: 15 − Lab Online');
  assert.ok(!hosxp.missing.includes(dc));
  assert.equal(s.topicCoverage.find((t) => t.text === dc).eligible, 1);
});

test('master plan: 106 รพ.สต. with round, district, legacy system and go-live date', () => {
  const plan = Core.MASTER_PLAN;
  assert.equal(plan.length, Core.TOTAL_HOSPITALS);
  assert.equal(new Set(plan.map((h) => h.code)).size, 106, 'codes are unique');
  const inRound = (r) => plan.filter((h) => h.round === r).length;
  assert.deepEqual([1, 2, 3, 4].map(inRound), [30, 20, 29, 27], 'per round, pilots included');
  assert.equal(plan.filter((h) => h.pilot).length, 10);
  assert.equal(plan.filter((h) => h.district === 'ปัว').length, 12);
  for (const h of plan) {
    assert.match(h.code, /^\d{5}$/);
    assert.ok(h.staff && h.system && /^\d{4}-\d{2}-\d{2}$/.test(h.goLive), h.code);
  }
  const yod = Core.planFor('06550');
  assert.deepEqual([yod.district, yod.round, yod.pilot, yod.system], ['สองแคว', 3, true, 'HOSxP-PCU']);
  assert.equal(Core.planFor('99999'), null);
});

test('planOverview: progress by round/system and live รพ.สต. without a visit', () => {
  const topics = Core.STANDARD_TOPICS.map((t) => t.text);
  const rec = (code, district, ts, staff, done) => ({
    row: 2, timestamp: new Date(ts), round: 'รอบที่ 1', district, hospitalKey: code, hospitalCode: code, hospitalName: code,
    recipient: '-', topics: done, otherAdvice: '', suggestion: '', staff
  });
  const nonLab = topics.filter((t) => Core.topicApplies(t, 'แม่จริม'));
  const ds = { topics, records: [
    rec('06475', 'แม่จริม', '2026-10-02', 'ศศิธร จันทำ (ก้อย)', nonLab), // complete (Lab Online not counted)
    rec('06448', 'เมืองน่าน', '2026-10-02', 'ภาณุพงศ์ เหล่าสิทธิสุข', topics.slice(0, 3)),
    rec('99999', 'เมืองน่าน', '2026-10-02', 'ภาณุพงศ์ เหล่าสิทธิสุข', [])
  ] };
  const now = new Date(2026, 9, 3); // 3 ต.ค. 2569
  const o = Core.planOverview(ds, ds.records, { now });
  assert.equal(o.total, 106);
  assert.equal(o.visited, 12, '2 with form records + 10 pilot sites (finished)');
  assert.equal(o.pilots, 10);
  assert.deepEqual([...o.unplanned], ['99999']);
  // live by 3 ต.ค.: 10 pilots + round-1 sites with go-live 2 or 3 ต.ค. (all 26)
  assert.equal(o.live, 36);
  assert.equal(o.upcoming, 70);
  assert.equal(o.notVisited.length, 24, 'pilot sites are not followed up');
  assert.ok(o.notVisited.every((i) => !i.plan.pilot));
  const r1 = o.byRound.find((g) => g.key === 1);
  assert.deepEqual([r1.total, r1.visited, r1.complete, r1.pilots], [30, 6, 5, 4], 'pilots count as visited and complete');
  const order = o.notVisited.map((i) => i.plan.staff + '|' + i.plan.name);
  assert.deepEqual([...order], [...order].sort((a, b) => a.localeCompare(b, 'th', { numeric: true })), 'sorted by staff, then รพ.สต.');
  assert.deepEqual([...o.byRound.map((g) => g.total)], [30, 20, 29, 27]);
  assert.equal(o.bySystem.reduce((n, g) => n + g.total, 0), 106);
  const mine = Core.planOverview(ds, ds.records, { now, staff: 'ศศิธร จันทำ (ก้อย)' });
  assert.ok(mine.total > 0 && mine.notVisited.every((i) => i.plan.staff === 'ศศิธร จันทำ'));
  assert.equal(Core.planOverview(ds, ds.records, { now, district: 'ปัว' }).total, 12);
});
