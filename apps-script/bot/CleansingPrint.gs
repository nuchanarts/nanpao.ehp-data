// ╔══════════════════════════════════════════════════════════════════╗
// ║  🐱 แมวส้ม: รวมไฟล์ Cleansing (C01 C02 C03) ทั้งรอบเป็น PDF เดียว       ║
// ║  เปิด Google Sheet → เมนู 🐱 แมวส้ม → พิมพ์รวม Cleansing รอบ N          ║
// ║  เพิ่มเป็นไฟล์ใหม่ในโปรเจกต์ Apps Script ของบอท — วิธีติดตั้งใน README.md   ║
// ╚══════════════════════════════════════════════════════════════════╝
//
// ไฟล์ Cleansing มีข้อมูลผู้ป่วย จึงรวมใน Google Drive เท่านั้น ไม่ผ่าน Dashboard (constitution V)
// ผลลัพธ์ = "พิมพ์รวม Cleansing รอบ N.pdf" ในโฟลเดอร์ Cleansing ของรอบนั้น (สิทธิ์การเปิดเหมือนไฟล์ต้นฉบับ)
// ถ้าไฟล์รวมใหญ่เกิน จะแบ่งเป็น "… ส่วนที่ 1.pdf", "… ส่วนที่ 2.pdf"
// สร้างใหม่ทุกครั้งที่สั่ง ไฟล์เดิมชื่อเดียวกันจะย้ายไปถังขยะ (กู้คืนได้ 30 วัน)
//
// หน้าแรก = สารบัญ: ทุกแห่งในรอบ เรียงตามรายชื่อ รพ.สต. (Master plan) บอกว่าไฟล์ครบหรือขาดอะไร และอยู่หน้าไหน
// หน้าถัดไป = เอกสารของแต่ละแห่ง เรียง C01 C02 C03 — PDF ทุกหน้า และรูป JPG/PNG 1 รูปต่อหน้า A4
// (ไฟล์ชนิดอื่น เช่น Google Sheet ไม่รวม แต่บอกไว้ในสารบัญ)
// รวม PDF ด้วย pdf-lib (โหลดจาก cdnjs ทุกครั้งที่สั่ง) · ใช้ฟังก์ชันจาก Code.gs: readMaster_ isPilot_ codeOf listFiles_ fmt_
//
// แท็บ "PDF Cleansing" ใน Sheet นี้ = ID ของไฟล์รวมแต่ละรอบ ให้ปุ่มในเมนู Cleansing ของ Dashboard เปิดไฟล์ได้ทันที
// (ทีมตัดสินใจ 2026-10-14) — Sheet เปิดสาธารณะ จึงเขียนการแชร์ของไฟล์ไว้ด้วย Dashboard ไม่แสดงลิงก์ถ้าไฟล์ยังเปิดสาธารณะ

const CL_ROOT_ID     = '1F6GbqiGF9QpqJjpC2ASiaEA10prKIt4o';  // "รายงาน Cleansing ข้อมูลแยกรอบ"
const CL_PRINT_TITLE = 'พิมพ์รวม Cleansing';
const CL_PRINT_FILES = [                                       // กติกาเดียวกับบอท: ชื่อไฟล์มีรหัสหรือชื่อแฟ้ม
  { key: 'C01', re: /C01|Cleansing_Card/i },
  { key: 'C02', re: /C02|Cleansing_Allergy/i },
  { key: 'C03', re: /C03|Cleansing_Visit/i }
];
const CL_PART_MAX_BYTES = 25 * 1024 * 1024;   // ไฟล์ต้นฉบับรวมเกินนี้ → เริ่มส่วนใหม่ (Apps Script รับไฟล์ได้ราว 50 MB)
const CL_TIME_LIMIT_MS  = 5 * 60 * 1000;      // Apps Script หยุดที่ 6 นาที เผื่อเวลาบันทึกไฟล์
const CL_PAGE = { width: 595.28, height: 841.89, margin: 24 };   // หน้า A4 สำหรับรูป (pt)
const CL_PDF_TAB = 'PDF Cleansing';
const PDF_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

// ----- เมนู: เรียกจาก onOpen (ดู README.md) -----
function addCleansingMenu_(menu) {
  menu.addSeparator();
  ['1', '2', '3', '4'].forEach(r => menu.addItem(`พิมพ์รวม Cleansing รอบ ${r}`, 'printCleansingRound' + r));
  menu.addItem('พิมพ์รวม Cleansing นำร่อง', 'printCleansingPilot');
}
function printCleansingRound1() { return printCleansingRound_('1'); }
function printCleansingRound2() { return printCleansingRound_('2'); }
function printCleansingRound3() { return printCleansingRound_('3'); }
function printCleansingRound4() { return printCleansingRound_('4'); }
function printCleansingPilot()  { return printCleansingRound_('pilot'); }

async function printCleansingRound_(round) {
  const ui = SpreadsheetApp.getUi();
  const name = clRoundName_(round);
  SpreadsheetApp.getActive().toast(`กำลังรวมไฟล์ Cleansing ${name} อาจใช้เวลา 1–5 นาที`, '🐱 แมวส้ม', 30);
  let r;
  try {
    r = await buildCleansingPrint_(round);
  } catch (err) {
    console.error(err);
    ui.alert('😿 ทำไม่สำเร็จ', String(err && err.message || err), ui.ButtonSet.OK);
    return;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = '<div style="font-family:sans-serif;line-height:1.6">' +
    `<p>${esc(name)}: ${r.sites} แห่ง · ไฟล์ครบ ${r.complete} แห่ง · ยังไม่ครบ/ไม่มีโฟลเดอร์ ${r.sites - r.complete} แห่ง · รวม ${r.pages} หน้า</p>` +
    r.parts.map(p => `<p><a href="${esc(p.url)}" target="_blank" style="font-size:15px">📄 ${esc(p.name)}</a></p>`).join('') +
    (r.stoppedAt ? `<p style="color:#a32d2d">⚠️ ใช้เวลานานเกิน ทำได้ถึง ${esc(r.stoppedAt)} — สั่งใหม่อีกครั้ง หรือแจ้งผู้ดูแลบอท</p>` : '') +
    '<p style="font-size:12px;color:#666">ไฟล์มีข้อมูลผู้ป่วย โปรดแชร์เฉพาะทีม</p></div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(480).setHeight(260), `🐱 พิมพ์รวม Cleansing ${name}`);
}

function clRoundName_(round) { return round === 'pilot' ? 'นำร่อง' : 'รอบ ' + round; }

// ----- สร้าง PDF -----
async function buildCleansingPrint_(round) {
  const t0 = Date.now();
  round = String(round);
  const name = clRoundName_(round);
  const roundFolder = clRoundFolder_(round);
  if (!roundFolder) throw new Error(`ไม่พบโฟลเดอร์ "${name}" ในโฟลเดอร์ Cleansing (${CL_ROOT_ID})`);

  // โฟลเดอร์ของแต่ละ รพ.สต. ในรอบนี้ ตามรหัส 5 หลักในชื่อโฟลเดอร์
  const folders = {};
  const it = roundFolder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const code = codeOf(f.getName());
    if (code && !folders[code]) folders[code] = f;
  }
  // เรียงตามรายชื่อ รพ.สต. ของรอบ แล้วต่อด้วยโฟลเดอร์ที่ไม่มีในรายชื่อ (ถ้ามี)
  const master = readMaster_().filter(m => round === 'pilot' ? isPilot_(m.system) : m.round === round && !isPilot_(m.system));
  const sites = master.map(m => ({ code: m.code, name: m.name, staff: m.staff }));
  Object.keys(folders).filter(c => !master.some(m => m.code === c)).sort()
    .forEach(c => sites.push({ code: c, name: folders[c].getName().replace(/^\(.*?\)\s*/, '').replace(c, '').trim(), staff: '' }));
  sites.forEach(s => { s.folder = !!folders[s.code]; s.files = pickCleansingFiles_(folders[s.code]); s.pages = 0; s.notPdf = []; });

  const PDFLib = loadPdfLib_();
  const out = [];   // ส่วนของไฟล์ผลลัพธ์: { doc, bytes }
  let part = null, complete = 0, stoppedAt = '';
  const newPart = () => { part = { doc: null, bytes: 0 }; out.push(part); };
  newPart();

  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    if (Date.now() - t0 > CL_TIME_LIMIT_MS) { stoppedAt = `${s.code} ${s.name} (แห่งที่ ${i + 1} จาก ${sites.length})`; break; }
    if (s.folder && CL_PRINT_FILES.every(x => s.files[x.key])) complete++;
    const files = CL_PRINT_FILES.map(x => s.files[x.key]).filter(Boolean);
    files.filter(f => !clPrintable_(f)).forEach(f => s.notPdf.push(clKeyOf_(f) + ' (ไม่ใช่ PDF หรือรูป)'));
    const printable = files.filter(clPrintable_);
    const size = printable.reduce((n, f) => n + f.getSize(), 0);
    if (part.bytes && part.bytes + size > CL_PART_MAX_BYTES) newPart();
    s.part = out.length;
    for (const f of printable) {
      try {
        if (!part.doc) part.doc = await PDFLib.PDFDocument.create();
        s.pages += await clAppendFile_(PDFLib, part.doc, f);
        part.bytes += f.getSize();
      } catch (err) {
        console.error(`${s.code} ${f.getName()}: ${err}`);
        s.notPdf.push(clKeyOf_(f) + ' (เปิดไม่ได้)');
      }
    }
  }

  // แต่ละส่วน: สารบัญไว้หน้าแรก แล้วบันทึกลงโฟลเดอร์ของรอบ
  const base = `${CL_PRINT_TITLE} ${name}`;
  clTrashOld_(roundFolder, base);
  const parts = [];
  let pageTotal = 0;
  for (let n = 0; n < out.length; n++) {
    const fileName = out.length > 1 ? `${base} ส่วนที่ ${n + 1}.pdf` : `${base}.pdf`;
    const toc = await clTocPdf_(PDFLib, name, sites, n + 1, out.length, stoppedAt);
    const doc = await PDFLib.PDFDocument.create();
    (await doc.copyPages(toc, toc.getPageIndices())).forEach(pg => doc.addPage(pg));
    if (out[n].doc) (await doc.copyPages(out[n].doc, out[n].doc.getPageIndices())).forEach(pg => doc.addPage(pg));
    const bytes = await doc.save();
    pageTotal += doc.getPageCount();
    const file = roundFolder.createFile(Utilities.newBlob(Array.from(new Int8Array(bytes)), MimeType.PDF, fileName));
    parts.push({ name: fileName, url: file.getUrl(), id: file.getId(), pages: doc.getPageCount(), sharing: String(file.getSharingAccess()) });
  }
  clWritePdfTab_(round, parts, sites.length, complete);
  console.log(`✅ ${base}: ${sites.length} แห่ง · ${parts.length} ไฟล์ · ${pageTotal} หน้า · ${Math.round((Date.now() - t0) / 1000)} วินาที`);
  return { parts, sites: sites.length, complete, pages: pageTotal, stoppedAt };
}

// สารบัญของส่วนที่ n: Google Doc ชั่วคราว → PDF แล้วลบ Doc ทิ้ง · เลขหน้า = หน้าใน PDF ของส่วนนี้ (นับหน้าสารบัญด้วย)
async function clTocPdf_(PDFLib, name, sites, n, count, stoppedAt) {
  const doc = DocumentApp.create(`tmp ${CL_PRINT_TITLE} ${name}`);
  const body = doc.getBody();
  body.setPageWidth(595.3).setPageHeight(841.9).setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);
  body.getChild(0).asParagraph().setText(`${CL_PRINT_TITLE} ${name}` + (count > 1 ? ` (ส่วนที่ ${n}/${count})` : ''))
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(`สร้างเมื่อ ${fmt_(new Date())} · ${sites.length} แห่ง · เรียงตามรายชื่อ รพ.สต. · ` +
    'C01 Cleansing_Card · C02 Cleansing_Allergy · C03 Cleansing_Visit · มีข้อมูลผู้ป่วย โปรดแชร์เฉพาะทีม').editAsText().setFontSize(9);
  const rows = [['ที่', 'รหัส', 'รพ.สต.', 'ผู้รับผิดชอบ', 'ไฟล์', 'หน้า']]
    .concat(sites.map((s, i) => [String(i + 1), s.code, s.name, s.staff || '-', clFileStatus_(s), '–']));
  const table = body.appendTable(rows);
  table.setBorderColor('#999999');
  table.editAsText().setFontSize(8);
  table.getRow(0).editAsText().setBold(true);
  if (stoppedAt) body.appendParagraph(`⚠️ ใช้เวลานานเกิน หยุดที่ ${stoppedAt} — สั่งใหม่อีกครั้ง`);
  doc.saveAndClose();

  // นับหน้าสารบัญก่อน แล้วเติมเลขหน้า (ช่อง "–" แทนที่ด้วยเลข จำนวนหน้าสารบัญไม่เปลี่ยน)
  const file = DriveApp.getFileById(doc.getId());
  const tocPages = (await PDFLib.PDFDocument.load(new Uint8Array(file.getAs(MimeType.PDF).getBytes()))).getPageCount();
  let page = tocPages + 1;
  const reopened = DocumentApp.openById(doc.getId());
  const t = reopened.getBody().getTables()[0];
  sites.forEach((s, i) => {
    if (!s.pages) return;
    let text = `ส่วนที่ ${s.part}`;
    if (s.part === n) { text = s.pages > 1 ? `${page}–${page + s.pages - 1}` : String(page); page += s.pages; }
    t.getRow(i + 1).getCell(5).setText(text);
  });
  reopened.saveAndClose();
  const pdf = await PDFLib.PDFDocument.load(new Uint8Array(file.getAs(MimeType.PDF).getBytes()));
  file.setTrashed(true);
  return pdf;
}

// แท็บ "PDF Cleansing": แทนที่แถวของรอบนี้ด้วยไฟล์รวมชุดใหม่ (Dashboard อ่านตามชื่อหัวตาราง ห้ามเปลี่ยนชื่อ)
// การแชร์ = DriveApp.Access ของไฟล์ (PRIVATE = เฉพาะคนที่ได้รับสิทธิ์) — ANYONE / ANYONE_WITH_LINK Dashboard จะไม่แสดงลิงก์
function clWritePdfTab_(round, parts, siteCount, complete) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CL_PDF_TAB) || ss.insertSheet(CL_PDF_TAB);
  const head = ['รอบ', 'ส่วน', 'จำนวนส่วน', 'ไฟล์', 'แห่ง', 'ครบ', 'หน้า', 'การแชร์', 'สร้างเมื่อ'];
  const old = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues() : [];
  const now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
  const rows = old.filter(r => String(r[0]) !== round && r[0] !== '')
    .concat(parts.map((p, i) => [round, String(i + 1), String(parts.length), p.id, String(siteCount), String(complete), String(p.pages), p.sharing, now]))
    .sort((a, b) => CL_ROUNDS.indexOf(String(a[0])) - CL_ROUNDS.indexOf(String(b[0])) || Number(a[1]) - Number(b[1]));
  sh.clearContents();
  // '@' = เก็บเป็นข้อความทั้งหมด (Google ไม่เดาชนิดข้อมูลผิด)
  sh.getRange(1, 1, rows.length + 1, head.length).setNumberFormat('@').setValues([head].concat(rows));
  sh.setFrozenRows(1);
}

// อัปเดตคอลัมน์การแชร์ตามไฟล์จริง (ทีมเปลี่ยนการแชร์ได้ทุกเมื่อ) · ไฟล์ที่ถูกลบ → ลบแถว
function clRefreshPdfSharing_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CL_PDF_TAB);
  if (!sh || sh.getLastRow() < 2) return;
  const range = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn());
  const rows = range.getValues(), col = rows[0].indexOf('ไฟล์'), share = rows[0].indexOf('การแชร์');
  const keep = [rows[0]];
  rows.slice(1).forEach(r => {
    try {
      const f = DriveApp.getFileById(String(r[col]));
      if (f.isTrashed()) return;
      r[share] = String(f.getSharingAccess());
      keep.push(r);
    } catch (err) { /* ไฟล์ถูกลบหรือบอทเปิดไม่ได้: ไม่แสดงใน Dashboard */ }
  });
  sh.clearContents();
  sh.getRange(1, 1, keep.length, keep[0].length).setNumberFormat('@').setValues(keep);
}

// PDF: ทุกหน้า · รูป JPG/PNG: 1 รูปต่อหน้า A4 ย่อให้พอดี (แนวนอนถ้ารูปกว้างกว่าสูง) → คืนจำนวนหน้าที่เพิ่ม
function clPrintable_(f) { return /^(application\/pdf|image\/(jpeg|png))$/.test(f.getMimeType()); }
async function clAppendFile_(PDFLib, doc, f) {
  const bytes = new Uint8Array(f.getBlob().getBytes());
  if (f.getMimeType() === MimeType.PDF) {
    const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach(p => doc.addPage(p));
    return pages.length;
  }
  const img = f.getMimeType() === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const wide = img.width > img.height;
  const pw = wide ? CL_PAGE.height : CL_PAGE.width, ph = wide ? CL_PAGE.width : CL_PAGE.height, m = CL_PAGE.margin;
  const scale = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height, 1);
  const w = img.width * scale, h = img.height * scale;
  doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  return 1;
}

function clFileStatus_(s) {
  if (!s.folder) return 'ยังไม่มีโฟลเดอร์';
  const miss = CL_PRINT_FILES.filter(x => !s.files[x.key]).map(x => x.key);
  return [miss.length ? 'ขาด ' + miss.join(' ') : 'ครบ'].concat(s.notPdf.length ? ['ไม่ได้รวม ' + s.notPdf.join(' ')] : []).join(' · ');
}

// โฟลเดอร์ "รอบ N" (หรือ "นำร่อง") ในโฟลเดอร์ Cleansing
function clRoundFolder_(round) {
  const it = DriveApp.getFolderById(CL_ROOT_ID).getFolders();
  while (it.hasNext()) {
    const f = it.next(), title = f.getName();
    if (round === 'pilot' ? /นำร่อง/.test(title) : (title.match(/รอบ\s*(\d+)/) || [])[1] === round) return f;
  }
  return null;
}

// ไฟล์ C01 C02 C03 ในโฟลเดอร์ (รวมโฟลเดอร์ย่อย) · หลายไฟล์ตรงกัน → PDF ก่อน แล้วไฟล์ที่แก้ไขล่าสุด
// ข้ามไฟล์ที่บอทสร้างเอง ("พิมพ์รวม …")
function pickCleansingFiles_(folder) {
  const out = {};
  if (!folder) return out;
  const isPdf = f => f.getMimeType() === MimeType.PDF;
  listFiles_(folder).forEach(f => {
    const fileName = String(f.getName());
    if (fileName.indexOf(CL_PRINT_TITLE) === 0) return;
    const x = CL_PRINT_FILES.find(c => c.re.test(fileName));
    if (!x) return;
    const old = out[x.key];
    if (!old || (isPdf(f) && !isPdf(old)) || (isPdf(f) === isPdf(old) && f.getLastUpdated() > old.getLastUpdated())) out[x.key] = f;
  });
  return out;
}

function clKeyOf_(f) {
  const x = CL_PRINT_FILES.find(c => c.re.test(String(f.getName())));
  return x ? x.key : f.getName();
}

// ย้ายผลลัพธ์ครั้งก่อน (ชื่อขึ้นต้นเหมือนกัน รวมทุกส่วน) ไปถังขยะ
function clTrashOld_(folder, base) {
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(base) === 0 && /\.pdf$/.test(f.getName())) f.setTrashed(true);
  }
}

// pdf-lib ใน Apps Script: ไม่มี setTimeout จึงส่งตัวแทนที่เรียกฟังก์ชันทันที (pdf-lib ใช้แค่รอ 1 tick)
// ฟังก์ชันที่ใช้ pdf-lib เป็น async — Apps Script V8 รอ Promise จนเสร็จก่อนจบการทำงาน
function loadPdfLib_() {
  const code = UrlFetchApp.fetch(PDF_LIB_URL).getContentText();
  return new Function('setTimeout', code + '\nreturn PDFLib;')(fn => fn());
}

// ----- สร้างใหม่อัตโนมัติ (ปุ่ม "PDF รอบที่ N" ในเมนู Cleansing ของ Dashboard เปิดโฟลเดอร์ที่มีไฟล์นี้) -----
// ทริกเกอร์ทุกชั่วโมง: หารอบถัดไปที่มีไฟล์ C01–C03 ใหม่กว่า PDF รวมเดิม แล้วสร้างใหม่ครั้งละ 1 รอบ (Apps Script ทำงานได้ 6 นาที)
const CL_ROUNDS = ['1', '2', '3', '4', 'pilot'];
async function cleansingPrintTick() {
  clRefreshPdfSharing_();
  const props = PropertiesService.getScriptProperties();
  const start = Number(props.getProperty('CL_PRINT_NEXT') || 0) % CL_ROUNDS.length;
  for (let k = 0; k < CL_ROUNDS.length; k++) {
    const i = (start + k) % CL_ROUNDS.length;
    if (!clNeedsRebuild_(CL_ROUNDS[i])) continue;
    props.setProperty('CL_PRINT_NEXT', String((i + 1) % CL_ROUNDS.length));
    const r = await buildCleansingPrint_(CL_ROUNDS[i]);
    console.log(`🔁 สร้างใหม่ ${clRoundName_(CL_ROUNDS[i])}: ${r.parts.map(p => p.name).join(', ')}`);
    return;
  }
  console.log('PDF รวม Cleansing ทุกรอบเป็นปัจจุบันแล้ว');
}

// รอบนี้ต้องสร้างใหม่ไหม: มีไฟล์ C01–C03 แต่ยังไม่มี PDF รวม หรือมีไฟล์ที่แก้ไขหลัง PDF รวม
function clNeedsRebuild_(round) {
  const folder = clRoundFolder_(round);
  if (!folder) return false;
  const base = `${CL_PRINT_TITLE} ${clRoundName_(round)}`;
  let built = null;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(base) === 0 && /\.pdf$/.test(f.getName()) && (!built || f.getLastUpdated() < built)) built = f.getLastUpdated();
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const files = pickCleansingFiles_(subs.next());
    if (Object.keys(files).some(k => !built || files[k].getLastUpdated() > built)) return true;
  }
  return false;
}

// รันครั้งเดียวเพื่อติดตั้งทริกเกอร์ทุกชั่วโมง (รันซ้ำได้ ไม่สร้างซ้ำ)
function installCleansingPrintTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'cleansingPrintTick').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('cleansingPrintTick').timeBased().everyHours(1).create();
  console.log('✅ ติดตั้งทริกเกอร์ cleansingPrintTick ทุก 1 ชั่วโมงแล้ว');
}

// ทดสอบจากหน้า Apps Script: รวมรอบ 1 แล้วดูลิงก์ใน "บันทึกการดำเนินการ"
async function testCleansingPrint() {
  console.log(JSON.stringify(await buildCleansingPrint_('1'), null, 2));
}
