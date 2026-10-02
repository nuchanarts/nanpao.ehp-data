# ตั้งค่าการลงชื่อด้วย Google และบันทึกการเข้าชม

Dashboard จะบังคับลงชื่อและบันทึกการเข้าชมเมื่อใส่ค่า 2 ค่าใน `index.html` (ตัวแปร `AUTH`) ครบ
ถ้ายังไม่ใส่ หน้าเว็บจะทำงานแบบเดิมโดยไม่ต้องลงชื่อ (constitution V, VI)

ใช้เวลาประมาณ 15 นาที ทำด้วยบัญชี Google ของทีม (บัญชีเดียวกันทั้ง 2 ส่วน)

## ส่วนที่ 1 — สร้าง OAuth Client ID (ใช้กับปุ่มลงชื่อ)

1. เปิด https://console.cloud.google.com/ → มุมซ้ายบนเลือก **New Project** ตั้งชื่อ เช่น `ehp-nan-dashboard` → Create
2. เมนู **APIs & Services → OAuth consent screen** (หรือ **Google Auth Platform → Branding**)
   - User type: **External**
   - App name: `EHP On Cloud น่าน Dashboard`, User support email และ Developer contact: อีเมลของทีม
   - Scopes: ไม่ต้องเพิ่ม (ใช้แค่ชื่อและอีเมลพื้นฐาน)
   - ไปที่ **Audience** แล้วกด **Publish app** (ถ้าไม่ publish จะลงชื่อได้เฉพาะ Test users ที่เพิ่มไว้)
3. เมนู **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins เพิ่ม 2 รายการ:
     - `https://nuchanarts.github.io`
     - `http://localhost:8765` (สำหรับทดสอบในเครื่อง)
   - Create แล้วคัดลอก **Client ID** (ลงท้ายด้วย `.apps.googleusercontent.com`)

## ส่วนที่ 2 — สร้าง Google Sheet บันทึกการเข้าชม + Apps Script

1. สร้าง Google Sheet ใหม่ ตั้งชื่อ เช่น `EHP Dashboard — บันทึกการเข้าชม`
   **อย่าแชร์แบบ "ทุกคนที่มีลิงก์"** — Sheet นี้มีอีเมลของผู้ดู แชร์เฉพาะคนในทีมที่ต้องดู
2. เมนู **ส่วนขยาย (Extensions) → Apps Script**
3. ลบโค้ดเดิมใน `Code.gs` แล้ววางโค้ดทั้งหมดจากไฟล์ `apps-script/Code.gs` ใน repository นี้ → บันทึก
4. ⚙️ **Project Settings → Script properties → Add script property**
   - Property: `CLIENT_ID`  Value: Client ID จากส่วนที่ 1 → Save
5. **Deploy → New deployment** → ⚙️ เลือก **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy → กด Authorize access และอนุญาตสิทธิ์ (Google จะเตือนว่าแอปยังไม่ได้ตรวจสอบ → Advanced → Go to … (unsafe) เพราะเป็นสคริปต์ของทีมเอง)
   - คัดลอก **Web app URL** (ขึ้นต้นด้วย `https://script.google.com/macros/s/…/exec`)

ชีต `บันทึกการเข้าชม` และ `กำลังดู` จะถูกสร้างเองเมื่อมีคนลงชื่อครั้งแรก

## ส่วนที่ 3 — ใส่ค่าใน Dashboard

ส่ง Client ID และ Web app URL ให้ผู้ดูแลโค้ด หรือแก้ใน `index.html` เอง:

```js
var AUTH = {
  clientId: 'xxxxxxxx.apps.googleusercontent.com',
  endpoint: 'https://script.google.com/macros/s/xxxxxxxx/exec'
};
```

แล้ว commit และอัปขึ้น GitHub Pages

## เมื่อแก้โค้ด Apps Script ภายหลัง

**Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (URL เดิมใช้ต่อได้)

## ข้อควรรู้

- การลงชื่อใช้ระบุว่าใครเข้าดู ไม่ได้ป้องกันข้อมูล เพราะ Google Sheet คำตอบฟอร์มยังเปิดดูได้ด้วยลิงก์
- สคริปต์ตรวจ token ของ Google ทุกครั้ง (ผู้ออก, Client ID, อายุ) ก่อนบันทึก จึงปลอมชื่อจากหน้าเว็บไม่ได้
- ทีมต้องกำหนดระยะเวลาเก็บบันทึก และลบแถวเก่าใน Sheet ตามนั้น (TODO(LOG_RETENTION) ใน constitution)
