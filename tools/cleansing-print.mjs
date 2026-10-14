// Merge the Cleansing documents (C01 C02 C03) of every รพ.สต. into one printable PDF per round, on this computer.
// Input: the Drive folder downloaded as .zip (Drive → ดาวน์โหลด) or an extracted folder. Nothing is uploaded anywhere.
//   node tools/cleansing-print.mjs                     → every Cleansing zip in ~/Downloads
//   node tools/cleansing-print.mjs a.zip b.zip dir --out <folder>
// Output: "<out>/Cleansing รอบที่ N.pdf" — a contents page (page numbers, missing files), then each รพ.สต. in Master plan
// order with C01 → C02 → C03. PDFs are copied page by page; JPG/PNG go one per A4 page, turned upright and fitted.
// The files hold patient data (constitution V): keep the output on team computers, never commit or publish it.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import vm from 'node:vm';
import { unzipSync } from 'fflate';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const ROOT = new URL('../', import.meta.url);
const DOWNLOADS = join(homedir(), 'Downloads');
const PARTS = [
  { key: 'C01', re: /C0?1\b|Cleansing_Card|บัตร/i },
  { key: 'C02', re: /C0?2\b|Cleansing_Allergy|แพ้ยา/i },
  { key: 'C03', re: /C0?3\b|Cleansing_Visit/i }
];
const A4 = [595.28, 841.89];
const MARGIN = 24;
const FONT = ['C:/Windows/Fonts/tahoma.ttf', 'C:/Windows/Fonts/LeelawUI.ttf', '/System/Library/Fonts/Supplemental/Tahoma.ttf'];
const FONT_BOLD = ['C:/Windows/Fonts/tahomabd.ttf', 'C:/Windows/Fonts/leelawdb.ttf', '/System/Library/Fonts/Supplemental/Tahoma Bold.ttf'];

// ---------- Master plan from the dashboard (single source, constitution VI) ----------
function loadPlan() {
  const html = readFileSync(new URL('index.html', ROOT), 'utf8');
  const sandbox = {};
  vm.runInNewContext(html.match(/<script id="ehp-core">([\s\S]*?)<\/script>/)[1], sandbox);
  return sandbox.EHPCore.MASTER_PLAN;
}
const PLAN = loadPlan();
const bareName = (s) => String(s).replace(/รพ\.?\s*สต\.?|สสช\.?|สอน\.?|\(.*?\)|\d{5}|[\s.\-]/g, '').replace(/^บ้าน/, '');
function siteOf(segment) {
  const code = (segment.match(/(?:^|\D)(\d{5})(?:\D|$)/) || [])[1];
  if (code) return PLAN.find((p) => p.code === code) || { code, name: segment.replace(/^\(.*?\)\s*\d{5}\s*/, ''), district: '', round: 0 };
  const n = bareName(segment);
  if (n.length < 2) return null;
  return PLAN.find((p) => bareName(p.name) === n) || null;
}

// ---------- read inputs ----------
function defaultInputs() {
  if (!existsSync(DOWNLOADS)) return [];
  return readdirSync(DOWNLOADS)
    .filter((f) => /\.zip$/i.test(f) && /^(รอบ\s*\d|นำร่อง|ทีมงาน BGS-Cleansing|Cleansing)/i.test(f.normalize('NFC')))
    .map((f) => join(DOWNLOADS, f));
}
function* entries(input) {
  if (statSync(input).isDirectory()) {
    const walk = function* (dir, rel) {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) yield* walk(p, rel.concat(f));
        else yield { path: rel.concat(f), time: statSync(p).mtimeMs, read: () => readFileSync(p) };
      }
    };
    yield* walk(input, [basename(input)]);
    return;
  }
  const files = unzipSync(readFileSync(input));
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    yield { path: [basename(input, '.zip')].concat(name.normalize('NFC').split('/')), time: 0, read: () => data };
  }
}
function kindOf(bytes) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  return null;
}

// Group key: 'pilot' for the นำร่อง folder, else the round number.
function groupOf(path, site) {
  if (path.some((s) => s.trim() === 'นำร่อง' || /^นำร่อง/.test(s))) return 'pilot';
  for (const s of path) {
    const m = s.match(/^รอบ(?:ที่)?\s*(\d)\b/) || s.match(/\(รอบ(?:ที่)?\s*(\d)\)/);
    if (m) return m[1];
  }
  return site && site.round ? String(site.round) : null;
}

function collect(inputs) {
  const groups = {};
  const skipped = [];
  for (const input of inputs) {
    for (const e of entries(input)) {
      const name = e.path[e.path.length - 1];
      if (/^พิมพ์รวม|^Cleansing รอบ|^~\$/.test(name)) continue;
      let site = null, siteSeg = null;
      for (let i = e.path.length - 2; i >= 0 && !site; i--) { site = siteOf(e.path[i]); siteSeg = e.path[i]; }
      if (!site || /xxxxx|ทดสอบ/.test(siteSeg)) continue;
      const g = groupOf(e.path, site);
      if (!g) continue;
      const part = PARTS.find((p) => p.re.test(name.replace(extname(name), '')));
      const grp = (groups[g] = groups[g] || {});
      const s = (grp[site.code] = grp[site.code] || { site, folder: siteSeg, parts: { C01: [], C02: [], C03: [] }, other: [] });
      if (part) s.parts[part.key].push({ name, time: e.time, read: e.read });
      else if (/\.(pdf|jpe?g|png)$/i.test(name)) s.other.push(name);
      else if (!/\.(xlsx?|csv|gsheet|docx?)$/i.test(name)) skipped.push(e.path.join('/'));
    }
  }
  return { groups, skipped };
}

// ---------- JPEG orientation (phones store photos sideways plus an EXIF flag) ----------
function jpegOrientation(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, le = b[t] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16)) + b[t + o + 3] * 16777216
        : b[t + o] * 16777216 + ((b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]));
      const ifd = u32(4), n = u16(ifd);
      for (let k = 0; k < n; k++) if (u16(ifd + 2 + k * 12) === 0x0112) return u16(ifd + 2 + k * 12 + 8);
      return 1;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}

async function appendFile(out, f) {
  const bytes = f.read();
  const kind = kindOf(bytes);
  if (kind === 'pdf') {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    return pages.length;
  }
  if (kind !== 'jpg' && kind !== 'png') throw new Error('ไม่ใช่ PDF/JPG/PNG');
  const img = kind === 'jpg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);
  const turn = kind === 'jpg' ? jpegOrientation(bytes) : 1;
  const sideways = turn === 6 || turn === 8;
  const [iw, ih] = sideways ? [img.height, img.width] : [img.width, img.height];
  const [pw, ph] = iw > ih ? [A4[1], A4[0]] : A4;
  const k = Math.min((pw - 2 * MARGIN) / iw, (ph - 2 * MARGIN) / ih);
  const dw = iw * k, dh = ih * k, X = (pw - dw) / 2, Y = (ph - dh) / 2;
  const page = out.addPage([pw, ph]);
  // Raw image box is (W × H) = displayed box turned back; pdf-lib rotates around the box's lower-left corner.
  const W = sideways ? dh : dw, H = sideways ? dw : dh;
  if (turn === 6) page.drawImage(img, { x: X, y: Y + dh, width: W, height: H, rotate: degrees(-90) });
  else if (turn === 8) page.drawImage(img, { x: X + dw, y: Y, width: W, height: H, rotate: degrees(90) });
  else if (turn === 3) page.drawImage(img, { x: X + dw, y: Y + dh, width: W, height: H, rotate: degrees(180) });
  else page.drawImage(img, { x: X, y: Y, width: W, height: H });
  return 1;
}

// ---------- contents pages ----------
const TOC_ROWS = 34;
function drawToc(doc, fonts, title, rows, notes) {
  const pages = [];
  const chunks = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += TOC_ROWS) chunks.push(rows.slice(i, i + TOC_ROWS));
  const grey = rgb(0.4, 0.4, 0.4), red = rgb(0.75, 0.1, 0.1);
  const cols = [MARGIN + 8, MARGIN + 34, MARGIN + 80, MARGIN + 250, MARGIN + 330, MARGIN + 372, MARGIN + 414, MARGIN + 456];
  chunks.forEach((chunk, ci) => {
    const page = doc.insertPage(pages.length, A4);
    pages.push(page);
    let y = A4[1] - MARGIN - 18;
    page.drawText(title + (chunks.length > 1 ? `  (สารบัญ ${ci + 1}/${chunks.length})` : ''), { x: MARGIN + 8, y, size: 15, font: fonts.bold });
    y -= 18;
    page.drawText(notes.summary, { x: MARGIN + 8, y, size: 9.5, font: fonts.reg, color: grey });
    y -= 22;
    ['ที่', 'รหัส', 'รพ.สต.', 'อำเภอ', 'C01', 'C02', 'C03', 'หมายเหตุ'].forEach((h, i) =>
      page.drawText(h, { x: cols[i], y, size: 9.5, font: fonts.bold }));
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 0.6 });
    chunk.forEach((r) => {
      y -= 19;
      const cells = [r.no, r.code, r.name, r.district, r.C01, r.C02, r.C03];
      cells.forEach((c, i) => page.drawText(fit(String(c), fonts.reg, 9.5, (cols[i + 1] || A4[0]) - cols[i] - 4), {
        x: cols[i], y, size: 9.5, font: fonts.reg, color: c === '–' ? red : rgb(0, 0, 0) }));
      page.drawText(fit(r.note, fonts.reg, 8, A4[0] - MARGIN - cols[7]), { x: cols[7], y, size: 8, font: fonts.reg, color: r.note ? red : grey });
      page.drawLine({ start: { x: MARGIN, y: y - 6 }, end: { x: A4[0] - MARGIN, y: y - 6 }, thickness: 0.2, color: rgb(0.8, 0.8, 0.8) });
    });
    page.drawText('ตัวเลขในช่อง C01–C03 = หน้าที่เริ่มในไฟล์นี้ · – = ไม่มีไฟล์ · เอกสารมีข้อมูลผู้ป่วย เก็บรักษาตามระเบียบ',
      { x: MARGIN + 8, y: MARGIN, size: 8, font: fonts.reg, color: grey });
  });
  return pages.length;
}
function drawCover(doc, fonts, label, rows, complete) {
  const page = doc.insertPage(0, A4);
  const center = (text, y, size, font, color = rgb(0, 0, 0)) =>
    page.drawText(text, { x: (A4[0] - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
  const districts = [...new Set(rows.map((r) => r.district).filter(Boolean))];
  center('รายงานการตรวจสอบและปรับปรุงข้อมูล (Cleansing)', 560, 20, fonts.bold);
  center('ระบบ EHP On Cloud', 530, 16, fonts.bold);
  center(label, 480, 28, fonts.bold);
  center('C01 Cleansing Card · C02 Cleansing Allergy · C03 Cleansing Visit', 440, 11, fonts.reg);
  center(`${rows.length} แห่ง · ครบ ${complete} แห่ง`, 410, 12, fonts.reg);
  if (districts.length) center(fit('อำเภอ ' + districts.join(' · '), fonts.reg, 11, A4[0] - 4 * MARGIN), 388, 11, fonts.reg);
  center('องค์การบริหารส่วนจังหวัดน่าน', 200, 16, fonts.bold);
  center('ข้อมูล ณ วันที่ ' + new Date().toLocaleDateString('th-TH', { dateStyle: 'long' }), 176, 11, fonts.reg);
  center('เอกสารมีข้อมูลผู้ป่วย — ใช้ภายในเท่านั้น', 60, 9, fonts.reg, rgb(0.6, 0.1, 0.1));
}
function fit(text, font, size, width) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  while (text.length > 1 && font.widthOfTextAtSize(text + '…', size) > width) text = text.slice(0, -1);
  return text + '…';
}
const firstFont = (list) => list.find((p) => existsSync(p));

async function buildGroup(key, sites, outDir) {
  const label = key === 'pilot' ? 'นำร่อง' : 'รอบที่ ' + key;
  // Master plan order; sites found on Drive but not in the plan go last.
  const order = PLAN.filter((p) => (key === 'pilot' ? p.pilot : String(p.round) === key && !p.pilot)).map((p) => p.code);
  Object.keys(sites).forEach((c) => { if (!order.includes(c)) order.push(c); });
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = {
    reg: await doc.embedFont(readFileSync(firstFont(FONT)), { subset: true }),
    bold: await doc.embedFont(readFileSync(firstFont(FONT_BOLD) || firstFont(FONT)), { subset: true })
  };
  const rows = [];
  let complete = 0;
  for (const code of order) {
    const s = sites[code];
    const plan = PLAN.find((p) => p.code === code) || (s && s.site) || { code, name: '', district: '' };
    const row = { no: rows.length + 1, code, name: plan.name, district: plan.district, note: '' };
    const notes = [];
    if (!s) { row.C01 = row.C02 = row.C03 = '–'; row.note = 'ไม่มีโฟลเดอร์ / ยังไม่มีไฟล์'; rows.push(row); continue; }
    let all = true;
    for (const part of PARTS) {
      const files = s.parts[part.key];
      // Prefer PDFs when a part has both a PDF and photos of the same form; otherwise print every photo (multi-page forms).
      const byKind = files.map((f) => ({ ...f, kind: kindOf(f.read()) }));
      const pdfs = byKind.filter((f) => f.kind === 'pdf');
      const use = (pdfs.length ? pdfs : byKind.filter((f) => f.kind)).sort((a, b) => a.name.localeCompare(b.name));
      if (!use.length) { row[part.key] = '–'; all = false; if (files.length) notes.push(part.key + ' เปิดไม่ได้'); continue; }
      row[part.key] = doc.getPageCount() + 1; // offset by the contents pages below
      for (const f of use) {
        try { await appendFile(doc, f); } catch (err) { notes.push(`${part.key} ${f.name}: ${err.message}`); }
      }
      if (use.length > 1) notes.push(`${part.key} ${use.length} ไฟล์`);
    }
    if (all) complete++;
    else notes.unshift('ขาด ' + PARTS.filter((p) => row[p.key] === '–').map((p) => p.key).join(' '));
    if (s.other.length) notes.push('ไม่ได้รวม: ' + s.other.join(', '));
    row.note = notes.join(' · ');
    rows.push(row);
  }
  const summary = `${rows.length} แห่ง · ครบ C01–C03 ${complete} แห่ง · ขาด ${rows.length - complete} แห่ง · สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`;
  const front = 1 + Math.ceil(Math.max(rows.length, 1) / TOC_ROWS); // cover + contents
  rows.forEach((r) => PARTS.forEach((p) => { if (typeof r[p.key] === 'number') r[p.key] += front; }));
  drawToc(doc, fonts, 'สารบัญ เอกสาร Cleansing ' + label, rows, { summary });
  drawCover(doc, fonts, label, rows, complete);
  const total = doc.getPageCount();
  doc.getPages().forEach((p, i) => {
    if (i === 0) return;
    const { width } = p.getSize();
    const t = `Cleansing ${label} · หน้า ${i + 1}/${total}`;
    p.drawText(t, { x: width - MARGIN - fonts.reg.widthOfTextAtSize(t, 7), y: 8, size: 7, font: fonts.reg, color: rgb(0.45, 0.45, 0.45) });
  });
  const file = join(outDir, `Cleansing ${label}.pdf`);
  writeFileSync(file, await doc.save());
  return { file, sites: rows.length, complete, pages: doc.getPageCount(), rows };
}

// ---------- main ----------
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outDir = outAt >= 0 ? args.splice(outAt, 2)[1] : join(DOWNLOADS, 'Cleansing-พิมพ์');
const inputs = args.length ? args : defaultInputs();
if (!inputs.length) {
  console.error('ไม่พบไฟล์ zip — ดาวน์โหลดโฟลเดอร์ "รอบ 1" … "รอบ 4" จาก Google Drive ลง Downloads ก่อน หรือระบุไฟล์/โฟลเดอร์');
  process.exit(1);
}
console.log('อ่าน:\n  ' + inputs.map((i) => basename(i)).join('\n  '));
mkdirSync(outDir, { recursive: true });
const { groups, skipped } = collect(inputs);
const keys = Object.keys(groups).sort((a, b) => (a === 'pilot') - (b === 'pilot') || a.localeCompare(b));
for (const key of keys) {
  const r = await buildGroup(key, groups[key], outDir);
  console.log(`\n${basename(r.file)}: ${r.pages} หน้า · ${r.sites} แห่ง · ครบ ${r.complete}`);
  r.rows.filter((x) => x.note).forEach((x) => console.log(`  ${x.code} ${x.name}: ${x.note}`));
}
if (skipped.length) console.log('\nข้ามไฟล์ที่ไม่รู้จัก:\n  ' + skipped.join('\n  '));
console.log('\nบันทึกที่: ' + outDir);
