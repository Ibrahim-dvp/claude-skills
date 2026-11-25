// Builds the illustrated HTML guide from steps.json + the stills, one file per language.
//   node build-guide.js guide.json <out-prefix>      -> <out-prefix>_IT.html, <out-prefix>_EN.html ...
//
// guide.json (see example/guide.example.json):
//   { "languages": ["it", "en"],
//     "text": { "it": { title, sub, sections: [{ "h": "...", "items": ["..."] }], stepsH, tryH, tryIntro, tries: [], backH, back, stepWord },
//               "en": { ... } },
//     "translate": { "en": { "<caption in the first language>": "<translation>", "<chapter name>": "<translation>" } } }
// The first language is the one the captions were recorded in. Every other language must translate
// every caption and chapter, or the build stops and lists what is missing.
// Images are embedded as JPEG, so the guide is ONE file that can be emailed. No HTML comments are
// written: a client deliverable must not carry hidden notes.
const fs = require('fs');
const { execFileSync } = require('child_process');

const [CONF, OUT] = process.argv.slice(2);
if (!CONF || !OUT) { console.error('usage: node build-guide.js guide.json <out-prefix>'); process.exit(1); }
const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'));
const steps = JSON.parse(fs.readFileSync('steps.json', 'utf8'));
const [base, ...others] = conf.languages;

fs.mkdirSync('jpg', { recursive: true });
const img = {};
for (const s of steps) {
  const out = `jpg/${s.file.replace('.png', '.jpg')}`;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `shots/${s.file}`, '-vf', 'scale=1100:-1', '-q:v', '5', out]);
  img[s.n] = 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64');
}

const esc = (s) => String(s).replace(/&(?![a-z#0-9]+;)/gi, '&amp;');
function tr(L, s) {
  if (L === base) return s;
  const t = (conf.translate[L] || {})[s];
  if (t === undefined) throw new Error(`missing ${L} translation: ${s}`);
  return t;
}

function page(L) {
  const t = conf.text[L];
  const chapters = [];
  for (const s of steps) {
    let ch = chapters.find((c) => c.name === s.chapter);
    if (!ch) { ch = { name: s.chapter, items: [] }; chapters.push(ch); }
    ch.items.push(s);
  }
  const li = (arr) => '<ul>' + arr.map((x) => `<li>${x}</li>`).join('') + '</ul>';
  let n = 0;
  const body = chapters.map((c) => `<section class="chap"><h3>${tr(L, c.name)}</h3>` + c.items.map((s) => {
    n += 1;
    return `<figure><div class="cap"><span class="num">${n}</span><span>${tr(L, s.text)}</span></div><img src="${img[s.n]}" alt="${t.stepWord} ${n}"></figure>`;
  }).join('') + '</section>').join('');
  const sections = (t.sections || []).map((x) => `<div class="box"><h2 style="margin-top:4px">${x.h}</h2>${li(x.items)}</div>`).join('');
  const tries = t.tries && t.tries.length
    ? `<h2>${t.tryH}</h2><div class="box"><p>${t.tryIntro || ''}</p><ol class="tries">${t.tries.map((x) => `<li><span class="check"></span>${x}</li>`).join('')}</ol></div>` : '';
  const back = t.back ? `<h2>${t.backH}</h2><div class="box"><p>${t.back}</p></div>` : '';
  return `<!doctype html><html lang="${L}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.title)}</title>
<style>
:root{--acc:#e4572e;--ink:#1d232b;--mut:#5b636e;--bg:#faf8f5;--card:#fff;--line:#ebe5dd}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 'Segoe UI',system-ui,-apple-system,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:40px 24px 80px}
header{border-bottom:3px solid var(--acc);padding-bottom:18px;margin-bottom:28px}
h1{font-size:30px;margin:0 0 6px}header p{margin:0;color:var(--mut)}
h2{font-size:22px;margin:38px 0 12px}h3{font-size:19px;margin:0 0 14px;color:var(--acc)}
.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 22px;margin:14px 0}
ul{margin:6px 0;padding-left:20px}li{margin:5px 0}a{color:#b2401c}
.chap{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin:22px 0}
figure{margin:0 0 26px}figure:last-child{margin-bottom:0}
.cap{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;font-size:17px}
.num{flex:0 0 30px;height:30px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:15px}
figure img{width:100%;border-radius:10px;border:1px solid var(--line);display:block}
ol.tries li{margin:8px 0}
.check{display:inline-block;width:16px;height:16px;border:2px solid var(--mut);border-radius:4px;margin-right:8px;vertical-align:-2px}
</style></head><body><div class="wrap">
<header><h1>${t.title}</h1><p>${t.sub || ''}</p></header>
${sections}
<h2>${t.stepsH}</h2>${body}
${tries}${back}
</div></body></html>`;
}

for (const L of [base, ...others]) {
  const html = page(L);
  if (html.includes('<!--')) throw new Error('an HTML comment slipped into the guide: remove it');
  const file = `${OUT}_${L.toUpperCase()}.html`;
  fs.writeFileSync(file, html);
  console.log(file, fs.statSync(file).size);
}
