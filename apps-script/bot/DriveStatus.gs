// ╔══════════════════════════════════════════════════════════════════╗
// ║  🐱 แมวส้ม: เขียนสถานะไฟล์ใน Drive ลงแท็บ "สถานะไฟล์ Drive"            ║
// ║  ให้ Dashboard ใช้ทำรายงานราย รพ.สต. (เมนู "ส่งออกข้อมูล")             ║
// ║  เพิ่มเป็นไฟล์ใหม่ในโปรเจกต์ Apps Script ของบอท — วิธีติดตั้งใน README.md   ║
// ╚══════════════════════════════════════════════════════════════════╝
//
// เขียนเฉพาะ "มีไฟล์ไหนแล้ว" ของแต่ละ รพ.สต. ไม่เขียนชื่อไฟล์ ลิงก์ หรือเนื้อหาในไฟล์
// (Sheet นี้แชร์แบบทุกคนที่มีลิงก์ดูได้ และไฟล์ Cleansing อาจมีข้อมูลผู้ป่วย)
// Dashboard อ่านคอลัมน์ตามชื่อหัวตาราง ถ้าเปลี่ยนชื่อหัวตาราง ต้องแก้ Dashboard ด้วย

const DRIVE_STATUS_SHEET = 'สถานะไฟล์ Drive';

// เรียกจาก checkDrive_ ทุก 15 นาที (หลังอัปเดตสรุป Drive และ Cleansing แล้ว)
function writeDriveStatusSheet_() {
  const install = {};
  (loadDriveSummary_() || []).forEach(f => {
    if (!f.code) return;
    const old = install[f.code];
    // รหัสเดียวกันมีหลายโฟลเดอร์ (เช่น อยู่ 2 รอบ) → ใช้โฟลเดอร์ที่ไฟล์ครบกว่า แล้วไฟล์มากกว่า
    const score = x => (x.have ? x.have.filter(Boolean).length : 0) * 1000 + (x.count || 0);
    if (!old || score(f) > score(old)) install[f.code] = f;
  });
  const clean = cleansingMap_();
  const codes = Object.keys(install).concat(Object.keys(clean))
    .filter((c, i, a) => a.indexOf(c) === i).sort();

  const mark = v => (v ? 'มี' : 'ไม่มี');
  const stamp = d => (d ? Utilities.formatDate(new Date(d), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm') : '');
  const now = stamp(new Date());
  const rows = [['รหัส', 'โฟลเดอร์รายงานติดตั้ง', 'รอบ (รายงานติดตั้ง)'].concat(
    INSTALL_FILES, ['จำนวนไฟล์รายงาน', 'แก้ไขล่าสุด', 'โฟลเดอร์ Cleansing', 'รอบ (Cleansing)'],
    CLEANSING_FILES.map(c => c.label), ['อัปเดตเมื่อ'])];
  codes.forEach(code => {
    const f = install[code];
    const c = clean[code];
    rows.push([code, mark(f), f ? String(f.round) : '']
      .concat(INSTALL_FILES.map((k, i) => mark(f && f.have && f.have[i])),
        [f ? String(f.count || 0) : '0', f ? stamp(f.latest) : '', mark(c), c ? String(c.round) : ''],
        CLEANSING_FILES.map((k, i) => mark(c && c.s[i])), [now]));
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(DRIVE_STATUS_SHEET) || ss.insertSheet(DRIVE_STATUS_SHEET);
  sh.clearContents();
  // '@' = เก็บเป็นข้อความทั้งหมด (รหัสไม่เสียเลข 0 นำหน้า และ Google ไม่เดาชนิดข้อมูลผิด)
  sh.getRange(1, 1, rows.length, rows[0].length).setNumberFormat('@').setValues(rows);
  sh.setFrozenRows(1);
}

// รันเองได้: อ่าน Drive ใหม่ทั้งหมดแล้วเขียนแท็บทันที (ไม่ส่งข้อความเข้า LINE)
function updateDriveStatusSheet() {
  checkDrive_(true);   // silent: อัปเดตสรุป Drive + Cleansing แล้วเรียก writeDriveStatusSheet_ ให้เอง
  console.log('✅ เขียนแท็บ "' + DRIVE_STATUS_SHEET + '" แล้ว');
}
