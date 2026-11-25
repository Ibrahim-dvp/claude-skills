// Example scenario: two chapters on a web app, signed in with a saved session.
// Copy this file to record.js in your working folder and replace BASE, the selectors and the texts.
// Run: node record.js   (first run silent; after voice.js, run again for the voiced version)
const { chromium } = require('playwright');
const kit = require('./recorder-kit')({ overlay: 'overlay.js', locale: 'it-IT', chapterWord: 'Capitolo' });

const BASE = 'https://staging.example.com'; // STAGING only, never production

(async () => {
  const browser = await chromium.launch();

  // ---------- Chapter 1 ----------
  kit.setChapter('1. La pagina iniziale');
  // Saved session from login.example.js: no password is typed while recording.
  const app = await kit.openPage(browser, 'app', { storageState: '../state-admin.json' });
  // Privacy on a shared test server: blur every list row that does not contain one of these texts.
  await kit.pages.app.ctx.addInitScript(`window.__keep = ["Mario Prova"]; window.__hideCounts = true;`);
  await app.goto(BASE + '/dashboard');
  await kit.sleep(2000);
  kit.segStart('app');
  await kit.titleCard(app, 'Guida alla piattaforma', 'Una prova passo per passo', 3500);
  await kit.titleCard(app, '1. La pagina iniziale', 'Cosa si vede dopo l’accesso');
  await kit.show(app, app.getByRole('heading').first(), 'Questa è la pagina iniziale: cosa richiede attenzione adesso.', { hold: 3000 });
  await kit.show(app, app.getByRole('link', { name: /Richieste/ }).first(), 'Tutte le richieste sono qui: un clic su <b>Richieste</b>.', { click: true });
  await kit.sleep(2000);

  // ---------- Chapter 2 ----------
  kit.setChapter('2. Cercare una richiesta');
  await kit.titleCard(app, '2. Cercare una richiesta', 'Per nome o per numero');
  const search = app.getByPlaceholder(/Cerca/);
  await kit.show(app, search, 'Si scrive il nome del cliente o il numero della richiesta.', { still: false, hold: 1400 });
  await kit.typeSlow(search, 'Mario Prova');
  await search.press('Enter');
  await kit.sleep(2500);
  await kit.show(app, app.getByRole('row').nth(1), 'Ecco la richiesta: un clic per aprirla.', { click: true });
  await kit.sleep(2500);
  await kit.say(app, 'Fine della guida. Grazie!', 2500);
  kit.segEnd();

  await kit.finish();
  await browser.close();
})().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
