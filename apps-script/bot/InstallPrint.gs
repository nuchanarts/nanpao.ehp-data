// ╔══════════════════════════════════════════════════════════════════╗
// ║  🐱 แมวส้ม: รวมรูปรายงานการติดตั้งทั้งรอบเป็นเอกสารเดียว พร้อมพิมพ์      ║
// ║  เปิด Google Sheet → เมนู 🐱 แมวส้ม → พิมพ์รวมรายงานการติดตั้ง รอบ N    ║
// ║  เพิ่มเป็นไฟล์ใหม่ในโปรเจกต์ Apps Script ของบอท — วิธีติดตั้งใน README.md   ║
// ╚══════════════════════════════════════════════════════════════════╝
//
// ผลลัพธ์อยู่ในโฟลเดอร์ของรอบนั้น (DRIVE_FOLDERS) 2 ไฟล์:
//   "พิมพ์รวม รายงานการติดตั้ง รอบ N"      Google Doc (แก้ไขได้)
//   "พิมพ์รวม รายงานการติดตั้ง รอบ N.pdf"  PDF (เปิดแล้วสั่งพิมพ์ได้ทันที)
// สร้างใหม่ทุกครั้งที่สั่ง ไฟล์เดิมชื่อเดียวกันจะย้ายไปถังขยะ (กู้คืนได้ 30 วัน)
//
// หน้าแรก = สารบัญ: ทุกแห่งในรอบ เรียงตามรายชื่อ รพ.สต. (Master plan) พร้อมบอกว่าไฟล์ครบหรือขาดอะไร
// หน้าถัดไป = 1 แห่งต่อหน้า: ชื่อ รพ.สต. + รูป BF1 BF2 AT1 AT2 เรียง 2×2
// ไม่รวม รพ.สต.นำร่อง (ไม่อยู่ในโฟลเดอร์ของรอบ)

const PRINT_TITLE   = 'พิมพ์รวม รายงานการติดตั้ง';
const PRINT_PAGE    = { width: 595.3, height: 841.9, margin: 36 };   // A4 แนวตั้ง หน่วย pt (36pt ≈ 1.27 ซม.)
const PRINT_IMG_MAX = { width: 250, height: 300 };                    // ขนาดรูปสูงสุดในแต่ละช่อง (2 คอลัมน์)
const PRINT_TIME_LIMIT_MS = 5 * 60 * 1000;                             // Apps Script หยุดที่ 6 นาที เผื่อเวลาบันทึกไฟล์

// ----- เมนูใน Google Sheet -----
function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu('🐱 แมวส้ม');
  Object.keys(DRIVE_FOLDERS).forEach(r => menu.addItem(`พิมพ์รวมรายงานการติดตั้ง รอบ ${r}`, 'printInstallRound' + r));
  menu.addToUi();
}
function printInstallRound1() { printInstallRound_(1); }
function printInstallRound2() { printInstallRound_(2); }
function printInstallRound3() { printInstallRound_(3); }
function printInstallRound4() { printInstallRound_(4); }

function printInstallRound_(round) {
  const ui = SpreadsheetApp.getUi();
  SpreadsheetApp.getActive().toast(`กำลังรวมรูปรายงานการติดตั้ง รอบ ${round} อาจใช้เวลา 1–3 นาที`, '🐱 แมวส้ม', 30);
  let r;
  try {
    r = buildInstallPrint_(round);
  } catch (err) {
    console.error(err);
    ui.alert('😿 ทำไม่สำเร็จ', String(err && err.message || err), ui.ButtonSet.OK);
    return;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const link = (url, text) => `<p><a href="${esc(url)}" target="_blank" style="font-size:15px">${esc(text)}</a></p>`;
  const html = '<div style="font-family:sans-serif;line-height:1.6">' +
    `<p>รอบ ${round}: ${r.sites} แห่ง · ไฟล์ครบ ${r.complete} แห่ง · ยังไม่ครบ/ไม่มีโฟลเดอร์ ${r.sites - r.complete} แห่ง</p>` +
    (r.pdfUrl ? link(r.pdfUrl, '📄 เปิด PDF แล้วสั่งพิมพ์') : '<p>สร้าง PDF ไม่สำเร็จ (ไฟล์ใหญ่เกินไป) ให้เปิด Google Doc แล้วเลือก ไฟล์ → พิมพ์</p>') +
    link(r.docUrl, '📝 เปิด Google Doc') +
    (r.stoppedAt ? `<p style="color:#a32d2d">⚠️ ใช้เวลานานเกิน ทำได้ถึง ${esc(r.stoppedAt)} — สั่งใหม่อีกครั้ง หรือแจ้งผู้ดูแลบอท</p>` : '') +
    '</div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(230), `🐱 พิมพ์รวม รอบ ${round}`);
}

// ----- สร้างเอกสาร -----
function buildInstallPrint_(round) {
  const t0 = Date.now();
  round = String(round);
  const rf = roundFolders_().find(x => x.round === round);
  if (!rf) throw new Error(`ไม่พบโฟลเดอร์รายงานการติดตั้งของรอบ ${round} (ดู DRIVE_FOLDERS)`);

  // โฟลเดอร์ของแต่ละ รพ.สต. ในรอบนี้ ตามรหัส 5 หลักในชื่อโฟลเดอร์
  const folders = {};
  const it = rf.folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const code = codeOf(f.getName());
    if (code && !folders[code]) folders[code] = f;
  }
  // เรียงตามรายชื่อ รพ.สต. ของรอบ แล้วต่อด้วยโฟลเดอร์ที่ไม่มีในรายชื่อ (ถ้ามี)
  const master = readMaster_().filter(m => m.round === round && !isPilot_(m.system));
  const sites = master.map(m => ({ code: m.code, name: m.name, amphoe: m.amphoe, staff: m.staff, golive: m.golive }));
  Object.keys(folders).filter(c => !master.some(m => m.code === c)).sort()
    .forEach(c => sites.push({ code: c, name: folders[c].getName().replace(/^\(.*?\)\s*/, '').replace(c, '').trim(), amphoe: '', staff: '', golive: '' }));
  sites.forEach(s => { s.files = pickInstallFiles_(folders[s.code]); s.folder = !!folders[s.code]; });

  trashOld_(rf.folder, PRINT_TITLE + ' รอบ ' + round);
  const doc = DocumentApp.create(`${PRINT_TITLE} รอบ ${round}`);
  const docFile = DriveApp.getFileById(doc.getId());
  docFile.moveTo(rf.folder);
  const body = doc.getBody();
  body.setPageWidth(PRINT_PAGE.width).setPageHeight(PRINT_PAGE.height)
    .setMarginTop(PRINT_PAGE.margin).setMarginBottom(PRINT_PAGE.margin)
    .setMarginLeft(PRINT_PAGE.margin).setMarginRight(PRINT_PAGE.margin);

  // หน้าสารบัญ
  body.getChild(0).asParagraph().setText(`${PRINT_TITLE} รอบ ${round}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(`สร้างเมื่อ ${fmt_(new Date())} · ${sites.length} แห่ง · 1 แห่งต่อหน้า เรียงตามรายชื่อ รพ.สต.`).editAsText().setFontSize(9);
  const rows = [['ที่', 'รหัส', 'รพ.สต.', 'ผู้รับผิดชอบ', 'ไฟล์']].concat(sites.map((s, i) => [
    String(i + 1), s.code, s.name, s.staff || '-', fileStatus_(s)
  ]));
  const toc = body.appendTable(rows);
  styleTable_(toc, 8);
  toc.getRow(0).editAsText().setBold(true);

  let complete = 0, stoppedAt = '';
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    if (Date.now() - t0 > PRINT_TIME_LIMIT_MS) { stoppedAt = `${s.code} ${s.name} (แห่งที่ ${i + 1} จาก ${sites.length})`; break; }
    if (s.folder && INSTALL_FILES.every(k => s.files[k])) complete++;
    body.appendPageBreak();
    body.appendParagraph(`${s.code} ${s.name}`).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph([`รอบ ${round}`, s.amphoe ? 'อ.' + s.amphoe : '', s.golive ? 'เปิดใช้ ' + s.golive : '',
                          s.staff ? 'ผู้รับผิดชอบ ' + s.staff : '', `แห่งที่ ${i + 1} จาก ${sites.length}`]
      .filter(Boolean).join(' · ')).editAsText().setFontSize(9);
    if (!s.folder) { body.appendParagraph('ยังไม่มีโฟลเดอร์รายงานการติดตั้ง'); continue; }
    const grid = body.appendTable([['', ''], ['', '']]);
    styleTable_(grid, 9);
    INSTALL_FILES.forEach((k, n) => {
      const cell = grid.getRow(Math.floor(n / 2)).getCell(n % 2);
      const f = s.files[k];
      cell.getChild(0).asParagraph().setText(f ? `${k} · ${f.getName()} · ${fmt_(f.getLastUpdated())}` : `${k} · ยังไม่มีไฟล์`).editAsText().setBold(true);
      if (!f) return;
      if (!/^image\//.test(f.getMimeType())) {
        cell.appendParagraph(`ไฟล์นี้ไม่ใช่รูปภาพ (${f.getMimeType()}) — พิมพ์แยกจากโฟลเดอร์`);
        return;
      }
      try {
        const img = cell.appendImage(f.getBlob());
        const ratio = Math.min(PRINT_IMG_MAX.width / img.getWidth(), PRINT_IMG_MAX.height / img.getHeight(), 1);
        img.setWidth(Math.round(img.getWidth() * ratio)).setHeight(Math.round(img.getHeight() * ratio));
      } catch (err) {
        console.error(`${s.code} ${k}: ${err}`);
        cell.appendParagraph('ใส่รูปไม่ได้: ' + err);
      }
    });
  }
  if (stoppedAt) body.appendParagraph(`⚠️ ใช้เวลานานเกิน หยุดที่ ${stoppedAt} — สั่งใหม่อีกครั้ง`);
  doc.saveAndClose();

  let pdfUrl = '';
  try {
    const pdf = rf.folder.createFile(docFile.getAs('application/pdf')).setName(`${PRINT_TITLE} รอบ ${round}.pdf`);
    pdfUrl = pdf.getUrl();
  } catch (err) {
    console.error('สร้าง PDF ไม่ได้: ' + err);
  }
  console.log(`✅ ${PRINT_TITLE} รอบ ${round}: ${sites.length} แห่ง · ${Math.round((Date.now() - t0) / 1000)} วินาที`);
  return { docUrl: docFile.getUrl(), pdfUrl, sites: sites.length, complete, stoppedAt };
}

// ไฟล์ BF1 BF2 AT1 AT2 ในโฟลเดอร์ (รวมโฟลเดอร์ย่อย) · ถ้ามีหลายไฟล์ขึ้นต้นเหมือนกัน ใช้ไฟล์ที่แก้ไขล่าสุด
function pickInstallFiles_(folder) {
  const out = {};
  if (!folder) return out;
  listFiles_(folder).forEach(f => {
    const k = INSTALL_FILES.find(x => String(f.getName()).toUpperCase().startsWith(x.toUpperCase()));
    if (k && (!out[k] || f.getLastUpdated() > out[k].getLastUpdated())) out[k] = f;
  });
  return out;
}

function fileStatus_(s) {
  if (!s.folder) return 'ยังไม่มีโฟลเดอร์';
  const miss = INSTALL_FILES.filter(k => !s.files[k]);
  return miss.length ? 'ขาด ' + miss.join(' ') : 'ครบ';
}

function styleTable_(table, size) {
  table.setBorderColor('#999999');
  table.editAsText().setFontSize(size);
}

// ย้ายผลลัพธ์รอบก่อน (ชื่อเดียวกันเป๊ะ) ไปถังขยะ
function trashOld_(folder, name) {
  [name, name + '.pdf'].forEach(n => {
    const it = folder.getFilesByName(n);
    while (it.hasNext()) it.next().setTrashed(true);
  });
}

// ทดสอบจากหน้า Apps Script: สร้างรอบ 1 แล้วดูลิงก์ใน "บันทึกการดำเนินการ"
function testInstallPrint() {
  console.log(JSON.stringify(buildInstallPrint_(1), null, 2));
}
