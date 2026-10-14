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

test('decodeJwt reads a Google ID token payload, including Thai names', () => {
  const payload = { aud: 'client-1', email: 'a@example.com', name: 'วณิชญา ตรีมงคล', exp: 1790000000 };
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = b64url({ alg: 'RS256' }) + '.' + b64url(payload) + '.sig';
  assert.deepEqual({ ...Core.decodeJwt(token) }, payload);
  assert.equal(Core.decodeJwt('not-a-token'), null);
  assert.equal(Core.decodeJwt(''), null);
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

test('nextRound: first round with no site live yet, load per installer without pilots', () => {
  const nr = Core.nextRound(new Date(2026, 9, 10));
  assert.equal(nr.round, 3);
  assert.equal(nr.start, '2026-10-16');
  assert.equal(nr.daysUntil, 6);
  const planned = Core.MASTER_PLAN.filter((p) => p.round === 3 && !p.pilot).length;
  assert.equal(nr.staff.reduce((n, s) => n + s.sites, 0), planned);
  assert.ok(nr.staff.every((s, i) => !i || nr.staff[i - 1].sites >= s.sites), 'busiest first');
  // Once round 3 has started (even partly), the next one is round 4; after round 4 there is none.
  assert.equal(Core.nextRound(new Date(2026, 9, 16)).round, 4);
  assert.equal(Core.nextRound(new Date(2026, 9, 23)), null);
});

const T = Core.STANDARD_TOPICS.map((t) => t.text);
const visit = (code, day, topics, staff, recipient) =>
  ({ hospitalCode: code, timestamp: new Date(2026, 9, day, 10), topics, staff, recipient, round: 'รอบที่ 1' });

test('siteReports: one report per planned รพ.สต., sorted by round, อำเภอ, code, with first-advised date and staff', () => {
  const ds = { topics: T, records: [
    visit('06474', 3, [T[1], T[2]], 'เจ้าหน้าที่ ข', 'ผู้รับ ข'),
    visit('06474', 2, [T[0], T[1]], 'เจ้าหน้าที่ ก', 'ผู้รับ ก')
  ] };
  const all = Core.siteReports(ds);
  assert.equal(all.length, 106);
  assert.ok(all.every((r, i) => !i || all[i - 1].plan.round <= r.plan.round), 'rounds in order');
  const r1 = Core.siteReports(ds, { round: 1 });
  assert.equal(r1.length, Core.MASTER_PLAN.filter((p) => p.round === 1).length);
  const r = r1.find((x) => x.plan.code === '06474');
  assert.deepEqual([...r.visits].map((v) => v.timestamp.getDate()), [2, 3], 'visits oldest first');
  const t1 = r.topics.find((t) => t.text === T[1]);
  assert.equal(t1.status, 'done');
  assert.equal(t1.first.getDate(), 2);
  assert.equal(t1.by, 'เจ้าหน้าที่ ก');
  // แม่จริม, HOSxP-PCU: Lab Online (ปัว only) and Drug Catalog MY PCU (MyPCU only) do not count.
  assert.equal(r.topics.filter((t) => t.status === 'na').length, 2);
  assert.equal(r.total, 13);
  assert.equal(r.done, 3);
  assert.equal(r.missing.length, 10);
  assert.deepEqual([...r.staff], ['เจ้าหน้าที่ ก', 'เจ้าหน้าที่ ข']);
  assert.deepEqual([...r.recipients], ['ผู้รับ ก', 'ผู้รับ ข']);
});

test('siteReports: pilot sites count as complete without inventing dates; filters by staff and drop pilots', () => {
  const ds = { topics: T, records: [] };
  const pilot = Core.siteReports(ds).find((x) => x.plan.pilot);
  assert.equal(pilot.completeness, 1);
  assert.ok(pilot.topics.every((t) => t.status === 'pilot' || t.status === 'na'));
  assert.ok(pilot.topics.every((t) => t.first === null));
  assert.equal(Core.siteReports(ds, { pilots: false }).length, 106 - Core.MASTER_PLAN.filter((p) => p.pilot).length);
  const staff = Core.MASTER_PLAN[0].staff;
  assert.ok(Core.siteReports(ds, { staff }).every((x) => x.plan.staff === staff));
});

test('parseDriveStatus reads the bot tab by header text and rejects any other tab', () => {
  const csv = [
    'รหัส,โฟลเดอร์รายงานติดตั้ง,รอบ (รายงานติดตั้ง),BF1,BF2,AT1,AT2,จำนวนไฟล์รายงาน,แก้ไขล่าสุด,โฟลเดอร์ Cleansing,รอบ (Cleansing),C01,C02,C03,อัปเดตเมื่อ',
    '06474,มี,1,มี,มี,ไม่มี,มี,3,2026-10-05 14:20,มี,1,มี,ไม่มี,ไม่มี,2026-10-10 09:15',
    '06475,ไม่มี,,ไม่มี,ไม่มี,ไม่มี,ไม่มี,0,,มี,1,มี,มี,มี,2026-10-10 09:15'
  ].join('\n');
  const d = Core.parseDriveStatus(csv);
  assert.equal(d.updatedAt.getHours(), 9);
  assert.deepEqual(JSON.parse(JSON.stringify(d.sites['06474'].install)), { BF1: true, BF2: true, AT1: false, AT2: true });
  assert.equal(d.sites['06474'].installFiles, 3);
  assert.equal(d.sites['06474'].installLatest.getDate(), 5);
  assert.equal(d.sites['06475'].installFolder, false);
  assert.equal(d.sites['06475'].cleansing.C03, true);
  assert.equal(Core.parseDriveStatus(header), null, 'the form tab (what Google returns when the tab is missing)');
  assert.equal(Core.parseDriveStatus(''), null);
  assert.match(Core.driveStatusUrl(Core.DEFAULT_SHEET_URL), /\/gviz\/tq\?tqx=out:csv&sheet=%E0%B8%AA/);
  assert.equal(Core.driveStatusUrl('https://example.com'), null);
});

test('siteReports keeps the Master plan order of อำเภอ within a round', () => {
  const r1 = Core.siteReports({ topics: T, records: [] }, { round: 1 });
  const order = [...new Set(r1.map((r) => r.plan.district))];
  const planOrder = [...new Set(Core.MASTER_PLAN.filter((p) => p.round === 1).map((p) => p.district))];
  assert.deepEqual(order, planOrder);
});

test('Drive image index: a planned site is found in its own round folder (pilot: นำร่อง), else in any round', () => {
  const idx = Core.parseDriveIndex(JSON.stringify({ updatedAt: '2026-10-10T05:00:00Z', rounds: {
    1: { sites: { '06448': { files: { BF1: { id: 'a', name: 'BF1.png', image: true } } } } },
    pilot: { sites: { '06449': { files: {} } } },
    2: { sites: { '06452': { files: {} } } }
  } }));
  assert.equal(idx.updatedAt.toISOString(), '2026-10-10T05:00:00.000Z');
  const plan = (code) => Core.MASTER_PLAN.find((p) => p.code === code);
  assert.equal(Core.installFolder(idx, plan('06448')).files.BF1.id, 'a');
  assert.ok(Core.installFolder(idx, plan('06449')), 'pilot site in the นำร่อง folder');
  assert.ok(Core.installFolder(idx, plan('06452')), 'round 1 site filed under another round folder');
  assert.equal(Core.installFolder(idx, plan('06453')), null);
  assert.equal(Core.installFolder(null, plan('06448')), null);
  assert.equal(Core.parseDriveIndex('{}'), null);
  assert.equal(Core.imageUrl('a b'), 'https://lh3.googleusercontent.com/d/a%20b=w2000');
});

test('cleansingStatus: C01–C03 per planned site from the bot tab, summed overall and per อำเภอ', () => {
  const reports = Core.siteReports({ topics: T, records: [] }, { round: 1, pilots: false });
  const [a, b, c] = reports.map((r) => r.plan.code);
  const drive = Core.parseDriveStatus([
    'รหัส,โฟลเดอร์รายงานติดตั้ง,BF1,BF2,AT1,AT2,โฟลเดอร์ Cleansing,รอบ (Cleansing),C01,C02,C03,อัปเดตเมื่อ',
    `${a},มี,มี,มี,มี,มี,มี,1,มี,มี,มี,2026-10-10 09:15`,
    `${b},มี,มี,มี,มี,มี,มี,1,มี,ไม่มี,มี,2026-10-10 09:15`,
    `${c},มี,มี,มี,มี,มี,ไม่มี,,ไม่มี,ไม่มี,ไม่มี,2026-10-10 09:15`
  ].join('\n'));
  const s = Core.cleansingStatus(reports, drive);
  assert.equal(s.rows.length, reports.length);
  assert.equal(s.rows[0].status, 'complete');
  assert.equal(s.rows[1].status, 'partial');
  assert.deepEqual([...s.rows[1].missing], ['C02']);
  assert.equal(s.rows[2].status, 'nofolder');
  assert.equal(s.rows[3].status, 'nofolder', 'no row in the tab = no folder yet');
  assert.equal(s.totals.complete, 1);
  assert.equal(s.totals.partial, 1);
  assert.equal(s.totals.nofolder, reports.length - 2);
  assert.equal(s.totals.files.C01, 2);
  assert.equal(s.totals.files.C02, 1);
  const sumDistricts = s.districts.reduce((n, d) => n + d.sites, 0);
  assert.equal(sumDistricts, reports.length);
  assert.equal(s.districts[0].district, reports[0].plan.district, 'Master plan order of อำเภอ');

  const none = Core.cleansingStatus(reports, null);
  assert.ok(none.rows.every((r) => r.status === 'nodata' && r.missing.length === 0));
  assert.equal(none.totals.nodata, reports.length);
});

test('cleansingFolderUrl links every round folder (0 = นำร่อง) and nothing else', () => {
  for (const r of [0, 1, 2, 3, 4]) assert.match(Core.cleansingFolderUrl(r), /^https:\/\/drive\.google\.com\/drive\/folders\/[\w-]{20,}$/);
  assert.equal(Core.cleansingFolderUrl(5), null);
  const pilots = Core.MASTER_PLAN.filter((p) => p.pilot);
  assert.ok(pilots.length > 0 && pilots.every((p) => p.round >= 1), 'pilot sites keep their Master plan round');
});


test('Cleansing book: file names map to C01–C03, Thai names included', () => {
  assert.equal(Core.cleansingPartOf('C01-Cleansing_Card.pdf'), 'C01');
  assert.equal(Core.cleansingPartOf('C02-Cleansing_Allergy.jpg'), 'C02');
  assert.equal(Core.cleansingPartOf('C03-Cleansing_Visit.jpg'), 'C03');
  assert.equal(Core.cleansingPartOf('06448_ข้อมูลเวชระเบียน.pdf'), 'C01');
  assert.equal(Core.cleansingPartOf('06448_ข้อมูลการแพ้ยา.pdf'), 'C02');
  assert.equal(Core.cleansingPartOf('06448_ข้อมูลจ่ายยา.pdf'), 'C03');
  assert.equal(Core.cleansingPartOf('รวม 2 ใบ ไม่มีประวัติแพ้ยา'), 'C02');
  assert.equal(Core.cleansingPartOf('รพ.สต.สะเนียน.pdf'), null);
  assert.equal(Core.cleansingPartOf('C010.pdf'), null);
});

test('Cleansing book: folders find their site by code or name, and files their round book', () => {
  assert.equal(Core.cleansingSiteOf('(รอบ 1) 06457 รพ.สต.กองควาย').code, '06457');
  assert.equal(Core.cleansingSiteOf('(รอบ 2)  06517 รพ.สต.น้ำปั้ว').code, '06517');
  assert.equal(Core.cleansingSiteOf('รพ.สต.ไชยวัฒนา').code, '06494', 'pilot folders have no code');
  assert.equal(Core.cleansingSiteOf('รอบ 1'), null);
  const site = Core.planFor('06457');
  assert.equal(Core.cleansingBookOf(['รอบ 1-20261014T123035Z-1-001', 'รอบ 1', '(รอบ 1) 06457 x', 'a.pdf'], site), '1');
  assert.equal(Core.cleansingBookOf(['นำร่อง-2026', 'นำร่อง', 'รพ.สต.ไชยวัฒนา', 'a.pdf'], site), 'pilot');
  assert.equal(Core.cleansingBookOf(['x', '(รอบที่ 1) 10395 y', 'a.pdf'], site), '1');
  assert.equal(Core.cleansingBookOf(['x', 'y', 'a.pdf'], site), String(site.round));
});

test('cleansingCollect groups files per book and site, skips test folders and keeps other files by name only', () => {
  const e = (...path) => ({ path });
  const got = Core.cleansingCollect([
    e('รอบ 1', '(รอบ 1) 06457 รพ.สต.กองควาย', 'C01-Cleansing_Card.pdf'),
    e('รอบ 1', '(รอบ 1) 06457 รพ.สต.กองควาย', 'C03-Cleansing_Visit.jpg'),
    e('รอบ 1', '(รอบ 1) 06467 รพ.สต.สะเนียน', 'รพ.สต.สะเนียน.pdf'),
    e('รอบ 1', '(รอบ 1) 06467 รพ.สต.สะเนียน', 'พิมพ์รวม Cleansing รอบ 1.pdf'),
    e('รอบ 1', '(รอบ x) xxxxx รพ.สต.ทดสอบ', 'C01-Cleansing_Card.pdf'),
    e('รอบ 2', '(รอบ 2) 06543 รพ.สต.ปิงหลวง', 'รพ.สต.ปิงหลวง_CleansingData_.xlsx')
  ]);
  assert.equal(Object.keys(got.books).join(), '1,2');
  assert.equal(got.books['2']['06543'].parts.C01.length, 0, 'a folder with only the Excel sheet counts as a folder without files');
  const s = got.books['1']['06457'];
  assert.equal(s.parts.C01.length, 1);
  assert.equal(s.parts.C02.length, 0);
  assert.equal(s.parts.C03.length, 1);
  assert.equal(JSON.stringify(got.books['1']['06467'].other), JSON.stringify(['รพ.สต.สะเนียน.pdf']));
  assert.equal(got.skipped.length, 0);

  const rows = Core.cleansingBookRows('1', got.books['1']);
  const plan1 = Core.MASTER_PLAN.filter((p) => p.round === 1 && !p.pilot);
  assert.equal(rows.length, plan1.length, 'every planned site of the round is listed, with or without files');
  assert.equal(rows.map((r) => r.plan.code).join(), plan1.map((p) => p.code).join(), 'Master plan order');
  assert.equal(rows.find((r) => r.plan.code === '06448').s, null);

  const presence = Core.cleansingPresence(got.books);
  assert.equal(JSON.stringify(presence.sites['06457'].cleansing), JSON.stringify({ C01: true, C02: false, C03: true }));
  assert.equal(Core.cleansingStatus(Core.siteReports(Core.loadDataset(sample), { round: 1 }), presence)
    .rows.find((r) => r.plan.code === '06457').status, 'partial');
});

test('fileKind reads the first bytes, and jpegOrientation the EXIF flag', () => {
  assert.equal(Core.fileKind(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), 'pdf');
  assert.equal(Core.fileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(Core.fileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'png');
  assert.equal(Core.fileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null);
  // SOI · APP1 "Exif" · TIFF little-endian · IFD with one entry: Orientation (0x0112) = 6
  const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0, 0, 0, 0];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00].concat(tiff);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, app1.length + 2].concat(app1, [0xff, 0xda, 0x00, 0x02]));
  assert.equal(Core.jpegOrientation(jpg), 6);
  assert.equal(Core.jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0, 0, 0, 0, 0, 0])), 1);
});
