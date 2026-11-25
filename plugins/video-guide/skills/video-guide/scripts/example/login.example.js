// Signs in ONCE per throwaway test account and saves the session to ../state-<who>.json,
// so the recording never types a password and never hits the sign-in rate limit.
// Passwords live in ../pw-<who>.txt (one folder up, never in a client folder, never in git).
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'https://staging.example.com';
const ACCOUNTS = { admin: 'guida.admin@example.invalid', agent: 'guida.operatore@example.invalid' };

(async () => {
  const browser = await chromium.launch();
  for (const [who, email] of Object.entries(ACCOUNTS)) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + '/login');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', fs.readFileSync(`../pw-${who}.txt`, 'utf8').trim());
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), page.click('button[type=submit]')]);
    await ctx.storageState({ path: `../state-${who}.json` });
    console.log(who, 'ok');
  }
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
