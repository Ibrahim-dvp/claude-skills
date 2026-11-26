// The recording toolkit: every helper a scenario needs, nothing app-specific.
//
//   const kit = require('./recorder-kit')({ overlay: 'overlay.js' });
//   const browser = await kit.launch(chromium);           // 2x capture, so the zoom stays sharp
//   const page = await kit.openPage(browser, 'main', { storageState: '../state-admin.json' });
//   kit.setChapter('1. Accedere');
//   kit.segStart('main');                                  // this page is on screen from now
//   await kit.titleCard(page, '1. Accedere', 'Il primo passo');
//   await kit.show(page, page.getByRole('button', { name: 'Accedi' }), 'Premete <b>Accedi</b>.', { click: true });
//   await kit.cut(page, () => page.goto(OTHER));           // hides a page load behind a cross-fade
//   await kit.finish();                                    // writes steps/segments/lines/cues json
//
// What is drawn where: cursor, ring, spotlight and title cards are drawn in the page (overlay.js).
// Captions and the camera zoom are NOT: this kit only logs them (text, target rectangle, time) and
// assemble.js adds them in the edit. That is why a zoom can never crop a caption.
//
// Voice-over: when voice/manifest.json exists (voice.js), every caption and title card holds until
// its spoken clip has ended plus a breath, and its start is logged in cues.json for assemble.js.
//
// Environment (set by make.js): VG_DRY=1 fast pass without video, only to collect lines and stills;
// VG_VOICE=0 ignore the manifest; VG_ZOOM=0 / VG_SPOTLIGHT=0 switch those effects off.
const fs = require('fs');
const crypto = require('crypto');

module.exports = function recorderKit({
  overlay = 'overlay.js', viewport = { width: 1280, height: 720 }, locale = 'it-IT', chapterWord = 'Capitolo',
  zoom = true,        // camera zoom toward each step (false = static frame)
  maxZoom = 1.5,      // how far the camera may go in; a step can override with { zoom: 1.8 } or { zoom: false }
  spotlight = true,   // dim the rest of the screen around the highlighted element
  accent = '#e4572e', // ring, badge and title-card colour, as #rrggbb
  xfade = 500,        // ms of cross-fade at every join (title cards, kit.cut, page changes)
  // What overlay.js blurs and hides when the scenario sets window.__keep / window.__hideCounts.
  // These defaults fit one app; give your own CSS selectors for yours (see SKILL.md, "Privacy").
  privacy = {},       // { rows, rowBox, counts, hide, mainNumbers }
} = {}) {
  const env = process.env;
  if (env.VG_ZOOM === '0') zoom = false;
  if (env.VG_SPOTLIGHT === '0') spotlight = false;
  const DRY = env.VG_DRY === '1';
  const BREATH = 450; // silence left after a spoken line before the next thing happens
  const OVER = `window.__gOpts=${JSON.stringify({ accent, spotlight, privacy })};` + fs.readFileSync(overlay, 'utf8');
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
  const pace = (ms) => (DRY ? Math.min(ms, 40) : ms); // presentational waits collapse on a dry pass
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  const VOICE = !DRY && env.VG_VOICE !== '0' && fs.existsSync('voice/manifest.json') ? JSON.parse(fs.readFileSync('voice/manifest.json', 'utf8')) : null;

  const segments = []; // {page, from, to} ms on our clock since that page was opened
  const steps = [];    // {n, file, chapter, text}
  const pages = {};    // name -> {page, ctx, t0, scale}
  const spoken = new Set();
  const cues = [];     // {page, t, line}       voice clip starts
  const captions = []; // {page, from, to, file, target?} caption bar on screen; target = the rectangle it talks about
  const cam = [];      // {page, t, type:'focus', x,y,w,h, max} | {page, t, type:'release'}
  const marks = [];    // {page, t} magenta flashes, to line our clock up with the recording's
  const hiDpi = new WeakSet();
  let warned1x = false;
  let shotN = 0;
  let chapter = '';
  let cur = null;        // the live segment
  let openCap = null;    // the caption currently on screen
  let speechEnd = 0;     // wall clock: the spoken line is over
  let quietUntil = 0;    // wall clock: a cross-fade is running, nothing may be said yet
  let camHome = 0;       // wall clock: the camera is back to the full frame
  let capPage = null;
  let camPage = null;     // the page the camera is zoomed on

  fs.mkdirSync('shots', { recursive: true });
  fs.mkdirSync('caps', { recursive: true });

  // Chromium records CSS pixels unless the whole browser runs at 2x. Launching through the kit
  // gives a 2560x1440 recording of a 1280x720 page, which is what keeps a 1.5x zoom sharp.
  async function launch(chromium, opts = {}) {
    const browser = await chromium.launch({ ...opts, args: [...(opts.args || []), '--force-device-scale-factor=2'] });
    hiDpi.add(browser);
    return browser;
  }

  async function openPage(browser, name, opts = {}) {
    const scale = hiDpi.has(browser) ? 2 : 1;
    if (scale === 1 && zoom && !DRY && !warned1x) {
      warned1x = true;
      console.warn('WARNING: this browser was started with chromium.launch(), so the page is recorded at 1x and the camera zoom will look soft. Start it with kit.launch(chromium) to record at 2x.');
    }
    const size = { width: viewport.width * scale, height: viewport.height * scale };
    const ctx = await browser.newContext({ viewport, locale, deviceScaleFactor: scale, ...(DRY ? {} : { recordVideo: { dir: `vid/${name}`, size } }), ...opts });
    await ctx.addInitScript(OVER);
    const page = await ctx.newPage();
    pages[name] = { page, ctx, t0: Date.now(), scale, browser };
    if (!DRY) { // first clock mark, on the blank page (finish() adds a second one)
      await page.evaluate(() => { const d = document.createElement('div'); d.id = '__g_f0'; d.style.cssText = 'position:fixed;inset:0;background:#f0f;z-index:2147483647'; document.documentElement.appendChild(d); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))); }).catch(() => {});
      marks.push({ page: name, t: now(name) });
      await sleep(240);
      await page.evaluate(() => document.getElementById('__g_f0')?.remove()).catch(() => {});
      await sleep(200);
    }
    return page;
  }
  const now = (name) => Date.now() - pages[name].t0;
  const nameOf = (page) => Object.keys(pages).find((k) => pages[k].page === page);
  const live = (name) => !!cur && cur.page === name;
  function closeCap(linger = 0) { if (openCap) { openCap.to = now(openCap.page) + linger; captions.push(openCap); openCap = null; } }
  function segStart(name) { if (cur) segEnd(); cur = { page: name, from: now(name) }; quietUntil = Date.now() + xfade + 100; }
  function segEnd() {
    if (!cur) return;
    closeCap(); cur.to = now(cur.page);
    // A sliver (two title cards in a row, or the instant after the last one) is too short to cross-fade: drop it.
    if (cur.to - cur.from >= xfade * 2.4) segments.push(cur);
    cur = null;
  }
  const setChapter = (c) => { chapter = c; };

  async function g(page, fn, ...args) {
    try { return await page.evaluate(({ fn, args }) => window.__g && window.__g[fn](...args), { fn, args }); } catch (e) { log('overlay err', e.message); }
  }
  const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  // A spoken line starts now. Never on top of the previous line, never inside a cross-fade.
  async function cue(page, line) {
    spoken.add(line);
    const name = nameOf(page);
    const clip = VOICE && VOICE[line];
    if (!clip) return 0;
    await sleep(Math.max(speechEnd + 250, quietUntil) - Date.now());
    if (live(name)) cues.push({ page: name, t: now(name), line });
    speechEnd = Date.now() + clip.ms;
    return clip.ms;
  }

  // Before a join or a title card: caption gone, line finished plus a breath, camera back home.
  async function settle() {
    closeCap();
    if (camHome === Infinity && camPage) release(camPage); // a zoom nobody released
    if (DRY) return;
    await sleep(Math.max(speechEnd + Math.max(BREATH, xfade + 100), camHome) - Date.now());
  }

  // Captions are rendered once to a transparent PNG at 2x; assemble.js fades and slides them in.
  async function renderCap(browser, html) {
    const file = `caps/${crypto.createHash('sha1').update(`${accent}|${viewport.width}|${html}`).digest('hex').slice(0, 16)}.png`;
    if (fs.existsSync(file)) return file;
    if (!capPage) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      capPage = await ctx.newPage();
      await capPage.setContent(`<style>html,body{margin:0;background:transparent}
        #w{display:inline-block;padding:10px 26px 26px}
        #c{max-width:${Math.round(viewport.width * 0.76)}px;box-sizing:border-box;background:rgba(17,21,29,.9);color:#fff;font:500 21px/1.38 system-ui,'Segoe UI',sans-serif;padding:13px 24px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 26px rgba(0,0,0,.3);text-align:center}
        #c b{color:#ffb38a;font-weight:700}</style><div id="w"><div id="c"></div></div>`);
    }
    await capPage.evaluate((h) => { document.getElementById('c').innerHTML = h; }, html);
    await capPage.locator('#w').screenshot({ path: file, omitBackground: true });
    return file;
  }

  // Caption bar ('' clears it). Returns the length of its spoken clip (0 without voice).
  // `target` (a bounding box) is what the caption talks about: assemble.js moves the bar to the
  // top of the frame when it would otherwise sit on that rectangle.
  async function caption(page, text, target) {
    const name = nameOf(page);
    if (!text) { closeCap(); return 0; }
    const file = await renderCap(pages[name].browser, text);
    const clip = VOICE && VOICE[plain(text)];
    if (clip) await sleep(Math.max(speechEnd + 250, quietUntil) - Date.now()); // the caption appears with its voice, not before
    closeCap();
    if (live(name)) openCap = { page: name, from: now(name), file, ...(target ? { target: { x: target.x, y: target.y, w: target.width, h: target.height } } : {}) };
    return cue(page, plain(text));
  }
  // Caption that stays up at least `ms`, and as long as its voice plus a breath.
  async function say(page, text, ms = 2600) { const v = await caption(page, text); await sleep(pace(Math.max(ms, v + BREATH))); }

  // The camera. Only logged here; assemble.js turns the log into an eased zoom and pan.
  function focus(name, bb, z) {
    if (!zoom || z === false || !live(name)) return;
    cam.push({ page: name, t: now(name), type: 'focus', x: bb.x, y: bb.y, w: bb.width, h: bb.height, max: typeof z === 'number' ? z : maxZoom });
    camHome = Infinity; camPage = name;
  }
  function release(name) {
    if (camHome !== Infinity) return;
    cam.push({ page: name, t: now(name), type: 'release' });
    camHome = Date.now() + 1250; // assemble.js needs this long to ease back out
  }

  // Full-screen chapter card. Inside a segment it becomes its own piece, so the edit cross-fades
  // into it and out of it instead of cutting.
  async function titleCard(page, h, p, ms = 3000) {
    const name = nameOf(page);
    const on = live(name);
    await settle();
    if (on) segEnd();
    const m = h.match(/^(\d+)\. (.*)$/);
    await g(page, 'title', m ? m[2] : h, p, m ? `${chapterWord} ${m[1]}` : '');
    await sleep(120); // painted before the piece starts
    if (on) segStart(name);
    const t0 = Date.now();
    const v = await cue(page, plain(h.replace(/^(\d+)\. /, `${chapterWord} $1: `)));
    await sleep(pace(Math.max(t0 + ms, Date.now() + v + BREATH) - Date.now()));
    await settle();
    if (on) segEnd();
    await g(page, 'title', '');
    await sleep(120);
    if (on) segStart(name);
  }

  // Do something that should not be watched (a page load, a slow save) behind a cross-fade.
  async function cut(page, fn) {
    const name = nameOf(page);
    const on = live(name);
    await settle();
    if (on) segEnd();
    await fn();
    await sleep(150);
    if (on) segStart(name);
  }

  // A still for the HTML guide (the guide prints the caption text itself).
  // Taken at the device scale, NOT with { scale: 'css' }: to make a CSS-pixel screenshot Chromium
  // drops the page to 1x for a moment, and the recording catches it as one or two frames of the
  // page shrunk into the top-left corner on grey. build-guide.js scales the stills down anyway.
  async function shot(page, text) {
    shotN += 1;
    const file = `guide-${String(shotN).padStart(2, '0')}.png`;
    await page.screenshot({ path: `shots/${file}` });
    steps.push({ n: shotN, file, chapter, text });
  }

  async function glide(page, x, y) {
    const ms = await g(page, 'move', x, y, DRY ? 0 : undefined);
    await sleep((ms || 0) + (DRY ? 0 : 60));
  }

  // Smooth scroll by `dy` pixels.
  async function scroll(page, dy, ms) { const t = await g(page, 'scroll', dy, DRY ? 0 : ms); await sleep((t || 0) + (DRY ? 0 : 80)); }

  // Point at an element: the camera goes to it, the cursor glides onto it and really hovers it
  // (so the app's own :hover styles show), then ring, caption, optional still and click.
  async function show(page, loc, text, { click = false, still = true, hold = 2600, badge, zoom: z, spotlight: spot, ring } = {}) {
    const name = nameOf(page);
    const el = loc.first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    let bb = await el.boundingBox();
    if (!bb) { log('no box for', text); return false; }
    // `ring`: a larger element to frame (a whole settings row) while the cursor goes to the small control in it.
    const framed = ring ? ring.first() : el;
    let rb = (ring && await framed.boundingBox()) || bb;
    // Click: cursor on the middle. Otherwise low on the right, inside the element, so its text stays readable.
    const px = click ? bb.x + bb.width / 2 : bb.x + bb.width - Math.min(28, bb.width * 0.2);
    const py = click ? bb.y + bb.height / 2 : bb.y + bb.height - Math.min(10, bb.height * 0.25);
    focus(name, rb, z);
    await glide(page, px, py);
    await el.hover({ position: { x: px - bb.x, y: py - bb.y }, timeout: 2500 }).catch(() => page.mouse.move(px, py).catch(() => {}));
    await sleep(pace(140));
    bb = (await el.boundingBox()) || bb; // a hover style may have resized it
    rb = ring ? (await framed.boundingBox()) || rb : bb;
    await g(page, 'ring', rb.x, rb.y, rb.width, rb.height, badge || null, spot);
    const v = await caption(page, text, rb);
    if (v) hold = Math.max(hold, v + BREATH);
    await sleep(DRY ? 560 : 900); // the ring has finished moving before the still
    if (still) await shot(page, text);
    await sleep(pace(Math.max(500, hold - 900)));
    if (click) {
      await g(page, 'press', bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sleep(pace(190));
      await el.click({ timeout: 6000 }).catch(() => el.click({ force: true }));
      closeCap(450); // the caption described the click: it leaves with it instead of hanging over the next screen
    }
    await g(page, 'unring');
    release(name);
    return true;
  }

  // Typing with a human rhythm: uneven keys, short pauses after a word or a comma. The rhythm is
  // seeded by the text, so the silent and the voiced run take the same time.
  async function typeSlow(loc, text, delay = 38) {
    const page = loc.page();
    const name = nameOf(page);
    const el = loc.first();
    const bb = await el.boundingBox();
    if (bb && name) {
      focus(name, bb);
      // Click near the right edge of the field: the arrow must not sit on the text being typed.
      const x = bb.x + bb.width - Math.min(34, bb.width * 0.15); const y = bb.y + Math.min(bb.height / 2, 24);
      await glide(page, x, y);
      await g(page, 'press', x, y);
      await sleep(pace(150));
    }
    await el.click();
    if (DRY) await page.keyboard.type(text);
    else {
      let s = [...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      for (const ch of text) {
        await page.keyboard.type(ch);
        await sleep(delay * (0.7 + 1.3 * rnd()) + (/[\s,.;:!?]/.test(ch) ? delay * (1 + 2.5 * rnd()) : 0));
      }
    }
    if (name) release(name);
  }

  // Writes the json files, closes every context (that finalises the videos), records video paths.
  async function finish(extra = {}) {
    await settle();
    segEnd();
    const videos = {};
    const scale = {};
    for (const [name, p] of Object.entries(pages)) {
      scale[name] = p.scale;
      if (!DRY) { // second clock mark
        await g(p.page, 'flash', true);
        marks.push({ page: name, t: now(name) });
        await sleep(240);
        await g(p.page, 'flash', false);
        await sleep(240);
      }
      await p.ctx.close();
      if (!DRY) videos[name] = await p.page.video().path();
    }
    if (capPage) await capPage.context().close();
    fs.writeFileSync('steps.json', JSON.stringify(steps, null, 1));
    fs.writeFileSync('lines.json', JSON.stringify([...spoken], null, 1));
    fs.writeFileSync('cues.json', JSON.stringify(cues, null, 1));
    fs.writeFileSync('segments.json', JSON.stringify({ segments, videos, marks, cam, captions, viewport, scale, xfade, dry: DRY, ...extra }, null, 1));
    log('done', steps.length, 'stills', segments.length, 'pieces', spoken.size, 'spoken lines', DRY ? '(dry pass, no video)' : '');
  }

  return { launch, openPage, segStart, segEnd, setChapter, g, caption, say, titleCard, cut, shot, show, scroll, typeSlow, finish, sleep, log, pages, dry: DRY };
};
