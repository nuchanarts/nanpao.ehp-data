// Index of the installation report images (BF1 BF2 AT1 AT2) in the team's public Google Drive folder,
// for the dashboard's "print every image of a round" button. Run by .github/workflows/drive-index.yml
// every 30 minutes; no Google credentials — it reads Drive's public folder view like a browser would.
//
//   node tools/drive-index.mjs [out.json]
//
// Output: { updatedAt, root, rounds: { "1": { folder, sites: { "06448": { folder, title, files: { BF1: { id, name, image } } } } } } }
// Round folders are named "รอบ N" (pilot sites: "นำร่อง" → key "pilot"); site folders carry the 5-digit code.
import { writeFileSync } from 'node:fs';

const ROOT = '1sdauK6xls7iJqJcXRZ4_U_q2mMy_ZOHg'; // "ทีมงาน BGS รายงานการติดตั้ง"
const FILES = ['BF1', 'BF2', 'AT1', 'AT2'];
const MAX_DEPTH = 3; // site folder → sub-folders, like the bot's listFiles_

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Entries of one public folder: [{ id, title, folder, image }]
async function list(id) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://drive.google.com/embeddedfolderview?id=' + id, { headers: { 'Accept-Language': 'en' } });
    if (res.ok) {
      const html = await res.text();
      return [...html.matchAll(/<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g)]
        .map((m) => ({ id: m[1], title: decode(m[3]).trim(), folder: m[2].includes('/drive/folders/'), image: /\/type\/image\/|alt="[A-Z]+ Image"/.test(m[0]) }));
    }
    if (attempt >= 3) throw new Error(`folder ${id}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

async function filesIn(id, depth = 0) {
  const out = [];
  for (const e of await list(id)) {
    if (e.folder) { if (depth < MAX_DEPTH) out.push(...await filesIn(e.id, depth + 1)); }
    else out.push(e);
  }
  return out;
}

async function main() {
  const index = { updatedAt: new Date().toISOString(), root: ROOT, rounds: {} };
  for (const r of (await list(ROOT)).filter((e) => e.folder)) {
    const key = /นำร่อง/.test(r.title) ? 'pilot' : (r.title.match(/รอบ\s*(\d+)/) || [])[1];
    if (!key) continue;
    const round = index.rounds[key] = { folder: r.id, title: r.title, sites: {} };
    for (const s of (await list(r.id)).filter((e) => e.folder)) {
      const code = (s.title.match(/\d{5}/) || [])[0];
      if (!code) continue;
      const files = {};
      for (const f of await filesIn(s.id)) {
        const k = FILES.find((x) => f.title.toUpperCase().startsWith(x));
        // Several files for one slot: prefer an image, then the shortest name ("BF1.png" over "BF1 (1).png").
        if (k && (!files[k] || (f.image && !files[k].image) || (f.image === files[k].image && f.title.length < files[k].name.length))) {
          files[k] = { id: f.id, name: f.title, image: f.image };
        }
      }
      round.sites[code] = { folder: s.id, title: s.title, files };
    }
  }
  const out = process.argv[2] || 'drive-index.json';
  writeFileSync(out, JSON.stringify(index, null, 1) + '\n');
  const sites = Object.values(index.rounds).reduce((n, r) => n + Object.keys(r.sites).length, 0);
  console.log(`wrote ${out}: ${Object.keys(index.rounds).length} rounds, ${sites} site folders`);
}

main().catch((e) => { console.error(e); process.exit(1); });
