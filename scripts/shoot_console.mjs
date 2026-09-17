import { chromium } from '/tmp/pw/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const [file, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

await page.goto('file://' + file, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.screenshot({ path: `${out}/1-source.png` });

await page.evaluate(() => document.querySelectorAll('.rise').forEach((e) => e.classList.add('in')));
await page.waitForTimeout(400);

await page.click('#go');
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/2-running.png` });

await page.waitForFunction(() => document.querySelector('#liveTxt').textContent === 'Complete', { timeout: 60000 });
await page.waitForTimeout(700);

const facts = await page.evaluate(() => ({
  live: document.querySelector('#liveTxt').textContent,
  books: document.querySelector('#m1').textContent,
  accounts: document.querySelector('#m2').textContent,
  attempts: document.querySelector('#m3').textContent,
  connected: document.querySelector('#m4').textContent,
  talkHours: document.querySelector('#m5').textContent,
  built: document.querySelectorAll('.bk.built').length,
  stagesDone: document.querySelectorAll('.stg.done').length,
  cohorts: document.querySelectorAll('.coh.in').length,
  finding: document.querySelector('#fbig').textContent,
  logLines: document.querySelectorAll('.ln').length,
}));
console.log(JSON.stringify(facts, null, 1));
console.log('page errors:', errs.length ? errs : 'none');

await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${out}/3-complete.png` });
for (const [i, sel] of [['4-cohorts', 4], ['5-books', 5], ['6-proof', 6], ['7-delivered', 7]]) {
  await page.evaluate((n) => document.querySelectorAll('section')[n - 1]
    .scrollIntoView({ block: 'start', behavior: 'instant' }), sel);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${i}.png` });
}
await browser.close();
