// Public demo of the video-guide skill on a FICTIONAL app (demo-app.html, invented data only).
//   node make.js --scenario record.js --guide guide.json --guide-out out/acme-guide \
//                --voice Xb7hH8MSUJpSbSDYk0k2 --deps demo-app.html --out out/video-guide-demo
const { chromium } = require('playwright');
const fs = require('fs');
const kit = require('./recorder-kit')({ overlay: 'overlay.js', locale: 'en-US', chapterWord: 'Chapter' });

const APP = 'https://demo.acme.test/';
const GUIDE = 'https://demo.acme.test/guide';
const appHtml = fs.readFileSync('demo-app.html', 'utf8');
const guideFile = 'out/acme-guide_EN.html';

(async () => {
  const browser = await kit.launch(chromium); // 2x capture: the zoom stays sharp
  const app = await kit.openPage(browser, 'app');
  // No server: the fictional app and the guide are served from files through page.route.
  await app.route('https://demo.acme.test/**', (r) => {
    if (r.request().url().startsWith(GUIDE)) {
      const body = fs.existsSync(guideFile) ? fs.readFileSync(guideFile, 'utf8') : '<h1 style="font-family:sans-serif;padding:40px">Guide preview</h1>';
      return r.fulfill({ contentType: 'text/html; charset=utf-8', body });
    }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: appHtml });
  });
  await app.goto(APP + '#/dashboard');
  await kit.sleep(1200);
  kit.segStart('app');

  await kit.titleCard(app, 'video-guide', 'A Claude Code skill that records product walkthroughs', 3600);
  await kit.say(app, 'This whole video was recorded by a script that Claude wrote. Nobody touched the mouse.', 3200);

  kit.setChapter('1. The dashboard');
  await kit.titleCard(app, '1. The dashboard', 'What the team sees first', 2400);
  await kit.show(app, app.getByRole('heading', { name: /Good morning/ }), 'The dashboard shows what needs attention today.', { hold: 2400, zoom: false });
  await kit.show(app, app.locator('.card').first(), 'The camera moves in on every step, with a highlight and a caption.', { hold: 2800, badge: 1 });

  kit.setChapter('2. Finding a ticket');
  await kit.titleCard(app, '2. Finding a ticket', 'Search and open', 2400);
  await kit.show(app, app.getByRole('link', { name: 'Tickets' }), 'All requests live under <b>Tickets</b>.', { click: true, hold: 2200 });
  await kit.sleep(900);
  const q = app.getByPlaceholder('Search by subject or customer');
  await kit.show(app, q, 'Type part of the subject, or the customer name.', { still: false, hold: 1500 });
  await kit.typeSlow(q, 'password');
  await kit.sleep(700);
  await kit.show(app, app.locator('tr.row', { hasText: 'password' }), 'One click opens the ticket.', { click: true, hold: 2000 });
  await kit.sleep(900);

  kit.setChapter('3. Replying');
  await kit.titleCard(app, '3. Replying', 'Answer the customer and close the loop', 2400);
  const reply = app.getByPlaceholder('Write a reply to the customer');
  await kit.show(app, reply, 'Write the reply here.', { hold: 1500 });
  await kit.typeSlow(reply, 'Hi Jane, I have just sent you a new reset link.');
  await kit.show(app, app.getByRole('button', { name: 'Send reply' }), 'Then press <b>Send reply</b>.', { click: true, hold: 2000 });
  await kit.sleep(1300);
  const status = app.getByRole('combobox', { name: 'Status' });
  await kit.show(app, status, 'And set the status, so the team knows where things stand.', { hold: 2400 });
  await status.selectOption('Solved');
  await kit.sleep(1300);

  kit.setChapter('4. Personal settings');
  await kit.titleCard(app, '4. Personal settings', 'Preferences for each person', 2400);
  await kit.show(app, app.getByRole('link', { name: 'Settings' }), 'Personal preferences are under <b>Settings</b>.', { click: true, hold: 2000 });
  await kit.sleep(900);
  // The switch is tiny: frame its whole row, click the switch.
  await kit.show(app, app.getByRole('button', { name: 'Two-step verification' }), 'Two-step verification is one switch away.', { click: true, hold: 2000, ring: app.locator('.toggle', { hasText: 'Two-step' }) });
  await kit.sleep(1400);

  kit.setChapter('5. The illustrated guide');
  await kit.titleCard(app, '5. And a written guide', 'Built from the same run', 2400);
  await kit.cut(app, async () => { await app.goto(GUIDE); await kit.sleep(800); }); // the page load hides behind a cross-fade
  await kit.say(app, 'The same recording also builds this guide: every screenshot, numbered, ready to email.', 3000);
  await kit.scroll(app, 900);
  await kit.sleep(900);
  await kit.scroll(app, 900);
  await kit.say(app, 'When the app changes, one command records everything again.', 2600);
  await kit.titleCard(app, 'github.com/Ibrahim-dvp/claude-skills', 'Install: /plugin marketplace add Ibrahim-dvp/claude-skills', 4200);

  await kit.finish();
  await browser.close();
})().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
