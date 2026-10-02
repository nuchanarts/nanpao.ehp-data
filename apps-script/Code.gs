/**
 * EHP On Cloud น่าน Dashboard — บันทึกการเข้าชม (constitution V, VI)
 *
 * Web app ที่ Dashboard เรียกทุกครั้งที่ผู้ดู (ลงชื่อด้วย Google แล้ว) เปิดหน้า เปลี่ยนเมนู ส่งออก
 * และส่งสัญญาณทุก 1 นาทีขณะเปิดหน้าไว้ เก็บลง Google Sheet ที่ผูกกับสคริปต์นี้:
 *   - ชีต "บันทึกการเข้าชม": 1 แถวต่อการกระทำ (ไม่บันทึกสัญญาณรายนาที)
 *   - ชีต "กำลังดู": 1 แถวต่อผู้ดู อัปเดตเวลาล่าสุด ใช้แสดงว่าใครกำลังดูอยู่
 *
 * ตั้งค่า: Project Settings → Script properties → CLIENT_ID = OAuth Client ID ของ Dashboard
 * Deploy: Web app · Execute as: Me · Who has access: Anyone
 */

var LOG_SHEET = 'บันทึกการเข้าชม';
var ONLINE_SHEET = 'กำลังดู';
var ONLINE_MS = 2 * 60 * 1000;   // seen within 2 minutes = viewing now
var RECENT_ROWS = 100;           // log rows returned to the page
var ACTIONS = { open: 'เปิดหน้า', view: 'เปลี่ยนเมนู', export: 'ส่งออก', heartbeat: '' };

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var user = verifyToken_(body.token);
    var action = ACTIONS.hasOwnProperty(body.action) ? body.action : 'heartbeat';
    var now = new Date();
    var view = clip_(body.view, 40), filter = clip_(body.filter, 120), device = clip_(body.device, 60), detail = clip_(body.detail, 40);

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      markOnline_(user, view, now);
      if (action !== 'heartbeat') {
        sheet_(LOG_SHEET, ['เวลา', 'ชื่อ', 'อีเมล', 'การกระทำ', 'เมนู', 'รายละเอียด', 'ตัวกรอง', 'อุปกรณ์'])
          .appendRow([now, user.name, user.email, ACTIONS[action], view, detail, filter, device]);
      }
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true, online: online_(now), recent: recent_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// Trust only a Google-signed ID token issued for this Dashboard; never names sent by the page.
function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) throw new Error('no token');
  var clientId = PropertiesService.getScriptProperties().getProperty('CLIENT_ID');
  if (!clientId) throw new Error('CLIENT_ID is not set');
  var cache = CacheService.getScriptCache();
  var key = 'tok:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('invalid token');
  var info = JSON.parse(res.getContentText());
  var issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  if (info.aud !== clientId || !issuerOk || String(info.email_verified) !== 'true' || Number(info.exp) * 1000 < Date.now()) {
    throw new Error('invalid token');
  }
  var user = { email: String(info.email), name: String(info.name || info.email) };
  var ttl = Math.max(0, Math.min(3000, Number(info.exp) - Math.floor(Date.now() / 1000) - 60));
  if (ttl > 0) cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function markOnline_(user, view, now) {
  var sh = sheet_(ONLINE_SHEET, ['อีเมล', 'ชื่อ', 'เมนู', 'ล่าสุด']);
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] === user.email) { sh.getRange(i + 1, 2, 1, 3).setValues([[user.name, view, now]]); return; }
  }
  sh.appendRow([user.email, user.name, view, now]);
}

// Names only: the page MUST NOT show viewers' e-mail addresses.
function online_(now) {
  var rows = sheet_(ONLINE_SHEET, ['อีเมล', 'ชื่อ', 'เมนู', 'ล่าสุด']).getDataRange().getValues().slice(1);
  return rows.filter(function (r) { return r[3] instanceof Date && now - r[3] <= ONLINE_MS; })
    .map(function (r) { return { name: r[1], view: r[2], at: r[3].getTime() }; });
}

function recent_() {
  var sh = sheet_(LOG_SHEET, ['เวลา', 'ชื่อ', 'อีเมล', 'การกระทำ', 'เมนู', 'รายละเอียด', 'ตัวกรอง', 'อุปกรณ์']);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var n = Math.min(RECENT_ROWS, last - 1);
  return sh.getRange(last - n + 1, 1, n, 8).getValues().reverse().map(function (r) {
    return { at: r[0] instanceof Date ? r[0].getTime() : null, name: r[1], action: r[3], view: r[4], detail: r[5], device: r[7] };
  });
}

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

function clip_(v, n) { return String(v == null ? '' : v).slice(0, n); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
