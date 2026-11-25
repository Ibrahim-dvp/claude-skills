// Public demo of the video-guide skill on a FICTIONAL app (demo-app.html, invented data only).
const { chromium } = require('playwright');
const fs = require('fs');
const kit = require('./recorder-kit')({ overlay: 'overlay.js', locale: 'en-US', chapterWord: 'Chapter' });

const APP = 'https://demo.acme.test/';
const GUIDE = 'https://demo.acme.test/guide';
const appHtml = fs.readFileSync('demo-app.html', 'utf8');
const guideFile = 'out/acme-guide_EN.html';

(async () => {
  const browser = await chromium.launch();
  const app = await kit.openPage(browser, 'app');
  await app.route('https://demo.acme.test/**', (r) => {
    if (r.request().url().startsWith(GUIDE)) {
      const body = fs.existsSync(guideFile) ? fs.readFileSync(guideFile, 'utf8') : '<h1 style="font-family:sans-serif;padding:40px">Guide preview</h1>';
      return r.fulfill({ contentType: 'text/html; charset=utf-8', body });
    }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: appHtml });
  });
  await app.goto(APP + '#/dashboard');
  await kit.sleep(1500);
  kit.segStart('app');

  await kit.titleCard(app, 'video-guide', 'A Claude Code skill that records Loom-style walkthroughs', 4200);
  await kit.say(app, 'This whole video was recorded by a script that Claude wrote. Nobody touched the mouse.', 3500);

  kit.setChapter('1. The dashboard');
  await kit.titleCard(app, '1. The dashboard', 'What the team sees first');
  await kit.show(app, app.getByRole('heading', { name: /Good morning/ }), 'The dashboard greets the agent and shows what needs attention today.', { hold: 3000 });
  await kit.show(app, app.locator('.card').first(), 'Each step gets a highlight, a number, and a caption like this one.', { hold: 3000, badge: 1 });

  kit.setChapter('2. Finding a ticket');
  await kit.titleCard(app, '2. Finding a ticket', 'Search and open');
  await kit.show(app, app.getByRole('link', { name: 'Tickets' }), 'All requests live under <b>Tickets</b>.', { click: true });
  await kit.sleep(1200);
  const q = app.getByPlaceholder('Search by subject or customer');
  await kit.show(app, q, 'Type part of the subject or the customer name.', { still: false, hold: 1500 });
  await kit.typeSlow(q, 'password');
  await kit.sleep(800);
  await kit.show(app, app.locator('tr.row', { hasText: 'password' }), 'One click opens the ticket.', { click: true });
  await kit.sleep(1200);

  kit.setChapter('3. Replying');
  await kit.titleCard(app, '3. Replying', 'Answer the customer and close the loop');
  const reply = app.getByPlaceholder('Write a reply to the customer');
  await kit.show(app, reply, 'Write the reply here.', { still: true, hold: 1500 });
  await kit.typeSlow(reply, 'Hi Jane, I have just sent you a new reset link. It is valid for one hour.');
  await kit.show(app, app.getByRole('button', { name: 'Send reply' }), 'Then press <b>Send reply</b>.', { click: true });
  await kit.sleep(1500);
  await kit.show(app, app.getByRole('combobox', { name: 'Status' }), 'And set the status, so the team knows where things stand.', { hold: 2600 });
  await app.getByRole('combobox', { name: 'Status' }).selectOption('Solved');
  await kit.sleep(1500);

  kit.setChapter('4. Personal settings');
  await kit.titleCard(app, '4. Personal settings', 'Preferences for each person');
  await kit.show(app, app.getByRole('link', { name: 'Settings' }), 'Personal preferences are under <b>Settings</b>.', { click: true });
  await kit.sleep(1200);
  await kit.show(app, app.getByRole('button', { name: 'Two-step verification' }), 'Two-step verification is one switch away.', { click: true });
  await kit.sleep(1800);

  kit.setChapter('5. The illustrated guide');
  await kit.titleCard(app, '5. And a written guide', 'Built from the same run');
  await app.goto(GUIDE);
  await kit.sleep(1500);
  await kit.say(app, 'The same recording also builds this guide: every screenshot, numbered, ready to email.', 3500);
  await app.mouse.wheel(0, 900);
  await kit.sleep(2500);
  await app.mouse.wheel(0, 900);
  await kit.say(app, 'When the app changes, you re-record with one command. Voice-over by ElevenLabs.', 3000);
  await kit.titleCard(app, 'github.com/Ibrahim-dvp/claude-skills', 'Install: /plugin marketplace add Ibrahim-dvp/claude-skills', 5000);
  kit.segEnd();

  await kit.finish();
  await browser.close();
})().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
