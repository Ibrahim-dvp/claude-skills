// The recording toolkit: every helper a scenario needs, nothing app-specific.
//
//   const kit = require('./recorder-kit')({ overlay: 'overlay.js' });
//   const page = await kit.openPage(browser, 'main', { storageState: '../state-admin.json' });
//   kit.setChapter('1. Accedere');
//   kit.segStart('main');                                  // this page is on screen from now
//   await kit.titleCard(page, '1. Accedere', 'Il primo passo');
//   await kit.show(page, page.getByRole('button', { name: 'Accedi' }), 'Premete <b>Accedi</b>.', { click: true });
//   kit.segEnd();
//   await kit.finish();                                    // writes steps/segments/lines/cues json
//
// Voice-over: when voice/manifest.json exists (voice.js), every caption and title card holds at
// least as long as its spoken clip, and its start is logged in cues.json for assemble.js.
const fs = require('fs');

module.exports = function recorderKit({ overlay = 'overlay.js', viewport = { width: 1280, height: 720 }, locale = 'it-IT', chapterWord = 'Capitolo' } = {}) {
  const OVER = fs.readFileSync(overlay, 'utf8');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  const VOICE = fs.existsSync('voice/manifest.json') ? JSON.parse(fs.readFileSync('voice/manifest.json', 'utf8')) : null;

  const segments = []; // {page, from, to} ms since that page's video start
  const steps = [];    // {n, file, chapter, text}
  const pages = {};    // name -> {page, ctx, t0}
  const spoken = new Set();
  const cues = [];
  let shotN = 0;
  let chapter = '';
  let cur = null;

  fs.mkdirSync('shots', { recursive: true });

  async function openPage(browser, name, opts = {}) {
    const ctx = await browser.newContext({ viewport, locale, recordVideo: { dir: `vid/${name}`, size: viewport }, ...opts });
    await ctx.addInitScript(OVER);
    const page = await ctx.newPage();
    pages[name] = { page, ctx, t0: Date.now() };
    return page;
  }
  const now = (name) => Date.now() - pages[name].t0;
  const nameOf = (page) => Object.keys(pages).find((k) => pages[k].page === page);
  function segStart(name) { if (cur) segEnd(); cur = { page: name, from: now(name) }; }
  function segEnd() { if (!cur) return; cur.to = now(cur.page); segments.push(cur); cur = null; }
  const setChapter = (c) => { chapter = c; };

  async function g(page, fn, ...args) {
    try { return await page.evaluate(({ fn, args }) => window.__g && window.__g[fn](...args), { fn, args }); } catch (e) { log('overlay err', e.message); }
  }
  const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  function cue(page, line) {
    spoken.add(line);
    const name = nameOf(page);
    if (VOICE && VOICE[line] && cur && cur.page === name) cues.push({ page: name, t: now(name), line });
    return VOICE && VOICE[line] ? VOICE[line].ms : 0;
  }

  // Caption bar. Returns the length of its spoken clip (0 without voice).
  async function caption(page, text) { await g(page, 'caption', text || ''); return text ? cue(page, plain(text)) : 0; }
  // Caption that stays up at least `ms` (or as long as its voice).
  async function say(page, text, ms = 2600) { const v = await caption(page, text); await sleep(Math.max(ms, v + 500)); }

  async function titleCard(page, h, p, ms = 3000) {
    await g(page, 'title', h, p);
    const v = cue(page, plain(h.replace(/^(\d+)\. /, `${chapterWord} $1: `)));
    await sleep(Math.max(ms, v + 600));
    await g(page, 'title', '');
  }

  // A still for the HTML guide, caption bar hidden (the guide prints the text itself).
  async function shot(page, text) {
    shotN += 1;
    const file = `guide-${String(shotN).padStart(2, '0')}.png`;
    await g(page, 'capHidden', true);
    await page.screenshot({ path: `shots/${file}` });
    await g(page, 'capHidden', false);
    steps.push({ n: shotN, file, chapter, text });
  }

  // Point at an element: move the cursor, ring it, caption it; optional still and click.
  async function show(page, loc, text, { click = false, still = true, hold = 2600, badge } = {}) {
    await loc.first().scrollIntoViewIfNeeded().catch(() => {});
    const bb = await loc.first().boundingBox();
    if (!bb) { log('no box for', text); return false; }
    // Click: cursor on the target. Otherwise parked beside it so the text stays readable.
    const px = click ? bb.x + bb.width / 2 : Math.min(bb.x + bb.width + 10, viewport.width - 20);
    const py = click ? bb.y + bb.height / 2 : bb.y + bb.height + 6;
    await g(page, 'move', px, py);
    await sleep(750);
    await g(page, 'ring', bb.x, bb.y, bb.width, bb.height, badge || null);
    const v = await caption(page, text);
    if (v) hold = Math.max(hold, v + 500);
    await sleep(900);
    if (still) await shot(page, text);
    await sleep(Math.max(600, hold - 900));
    if (click) {
      await g(page, 'ripple', bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sleep(250);
      await loc.first().click({ timeout: 6000 }).catch(() => loc.first().click({ force: true }));
    }
    await g(page, 'unring');
    return true;
  }

  // Human-speed typing, so the viewer can follow.
  async function typeSlow(loc, text, delay = 38) { await loc.click(); await loc.pressSequentially(text, { delay }); }

  // Writes the json files, closes every context (that finalises the videos), records video paths.
  async function finish(extra = {}) {
    segEnd();
    const videos = {};
    for (const [name, p] of Object.entries(pages)) { await p.ctx.close(); videos[name] = await p.page.video().path(); }
    fs.writeFileSync('steps.json', JSON.stringify(steps, null, 1));
    fs.writeFileSync('lines.json', JSON.stringify([...spoken], null, 1));
    fs.writeFileSync('cues.json', JSON.stringify(cues, null, 1));
    fs.writeFileSync('segments.json', JSON.stringify({ segments, videos, ...extra }, null, 1));
    log('done', steps.length, 'stills', segments.length, 'segments', spoken.size, 'spoken lines');
  }

  return { openPage, segStart, segEnd, setChapter, g, caption, say, titleCard, shot, show, typeSlow, finish, sleep, log, pages };
};
