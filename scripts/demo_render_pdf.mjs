import { chromium } from '/sessions/hopeful-zealous-fermi/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const URL = flag('url');
const OUT = flag('out', 'report.pdf');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console error]', m.text().slice(0, 160)); });

console.log('  loading', URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 180000 });

await page.waitForFunction(() => document.body.innerText.length > 2000, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(6000);

const text = await page.evaluate(() => document.body.innerText);
console.log('  rendered text length:', text.length);
for (const probe of ['Performance by bucket', 'Performance by language', 'Bucket', 'language']) {
  if (text.includes(probe)) console.log(`  ✔ found on page: "${probe}"`);
}

await page.emulateMedia({ media: 'print' });
await page.pdf({ path: OUT, printBackground: true, preferCSSPageSize: true });
console.log('  wrote', OUT);
await browser.close();
