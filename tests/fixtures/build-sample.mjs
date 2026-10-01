// Builds tests/fixtures/sample.csv: the real form header + synthetic rows (fake names only).
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url);
const header = readFileSync(new URL('header.csv', dir), 'utf8').trim();
const cols = header.split(',');
const idx = (name, nth = 0) => cols.map((c, i) => (c.includes(name) ? i : -1)).filter((i) => i >= 0)[nth];
const T = [
  'แนะนำการผูกบุคลากรกับ User และตรวจสอบว่า Login ของทุก User ใน รพ.สต.สามารถเข้าใช้งานได้',
  'สามารถตรวจสอบสิทธิการรักษาได้',
  'สามารถดำเนินการปิดสิทธิการรักษาได้',
  'สามารถพิมพ์สติกเกอร์ได้',
];
const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function row({ ts, round, district, hospCol, hosp, who, topics, other = '', sugg = '', staff }) {
  const r = Array(cols.length).fill('');
  r[0] = ts; r[1] = round; r[2] = district;
  if (hospCol !== undefined) { r[hospCol] = hosp; r[hospCol + 1] = who; }
  r[idx('Checklist')] = topics.join(', ');
  r[idx('การให้คำแนะนำอื่นๆ')] = other;
  r[idx('ขอเสนอแนะอื่น')] = sugg;
  r[idx('เจ้าหน้าที่ให้คำแนะนำ')] = staff;
  return r.map(q).join(',');
}
const mae = idx('อำเภอแม่จริม'), pua = idx('อำเภอปัว');
const rows = [
  row({ ts: '1/10/2026, 16:05:28', round: 'รอบที่ 1', district: 'แม่จริม', hospCol: mae, hosp: '00001 รพ.สต.ทดสอบหนึ่ง', who: 'ผู้รับ ทดสอบ', topics: [T[0], T[1]], staff: 'เจ้าหน้าที่ ก' }),
  row({ ts: '2/10/2569, 09:00:00', round: 'รอบที่ 2', district: 'แม่จริม', hospCol: mae, hosp: '00001 รพ.สต.ทดสอบหนึ่ง', who: 'ผู้รับ ทดสอบ', topics: [T[1], T[2]], other: 'แนะนำเพิ่มเติม', staff: 'เจ้าหน้าที่ ข' }),
  row({ ts: '3/10/2026, 10:30:00', round: '', district: 'ปัว', hospCol: pua, hosp: '00002 รพ.สต.ทดสอบสอง', who: 'ผู้รับ สอง', topics: [T[3], 'หัวข้อใหม่จากฟอร์ม'], sugg: 'ขอคู่มือ', staff: 'เจ้าหน้าที่ ก' }),
  row({ ts: '4/10/2026, 11:00:00', round: 'รอบที่ 1', district: 'ปัว', topics: [], staff: 'เจ้าหน้าที่ ข' }),
];
writeFileSync(new URL('sample.csv', dir), [header, ...rows].join('\r\n') + '\r\n');
