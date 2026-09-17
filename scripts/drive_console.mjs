import fs from 'node:fs';

const { chromium } = await (async () => {
  const candidates = [
    'playwright',
    'playwright-core',
    ...(process.env.PLAYWRIGHT_PATH ? [process.env.PLAYWRIGHT_PATH] : []),
  ];
  for (const c of candidates) {
    try { return await import(c); } catch {  }
  }
  const { execSync } = await import('node:child_process');
  try {
    const dir = execSync('npx --no-install playwright --version >/dev/null 2>&1 && find "$HOME/.npm/_npx" -maxdepth 3 -type d -name playwright | head -1', { shell: '/bin/bash', encoding: 'utf8' }).trim();
    if (dir) return await import(`${dir}/index.mjs`);
  } catch {  }
  console.error('\n  Playwright is not installed. This harness is optional — the console does not need it.\n  To run it:  npx playwright install chromium   (then re-run this script)\n');
  process.exit(3);
})();

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const PORT = flag('port', '3117');
const OUT = flag('out', '/tmp/console-shots');
const MONTH = flag('month', '2026-08');
const FOLDER = flag('folder', '');
const MODE = argv.includes('--live') ? 'LIVE' : 'REPLAY';
const BASE = `http://localhost:${PORT}/convin`;
const USER = flag('user', 'rosh');
const PASS = flag('pass', process.env.DASHBOARD_PASSWORD || 'rblrecovery2026');

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

const shotBoth = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}-fold.png` });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
};

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });

const shot = async (name) => { await shotBoth(name); };
const say = (...a) => console.log(...a);

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const login = await page.evaluate(async ([base, u, p]) => {
  const r = await fetch(`${base}/api/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [BASE, USER, PASS]);
say('signed in:', login.status === 200, login.body.error ?? '');
if (login.status !== 200) {
  say('  the console cannot be driven without a session. Set DASHBOARD_PASSWORD or pass --pass.');
  await browser.close();
  process.exit(2);
}

const stopped = await page.evaluate(async (base) => {
  const { runs } = await (await fetch(`${base}/api/console/run`)).json();
  const live = runs.filter((r) => ['running', 'awaiting-decision'].includes(r.status));
  for (const r of live) {
    await fetch(`${base}/api/console/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'abort', runId: r.runId }),
    });
  }
  return live.map((r) => r.runId);
}, BASE);
if (stopped.length) {
  say('stopping a run left over from an earlier drive:', stopped.join(', '));

  const cleared = await page.evaluate(async (base) => {
    for (let i = 0; i < 180; i++) {
      const { runs } = await (await fetch(`${base}/api/console/run`)).json();
      if (!runs.some((r) => ['running', 'awaiting-decision'].includes(r.status))) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }, BASE);
  say(cleared ? '  cleared.' : '  STILL RUNNING after 3 minutes — the next steps will be unreliable.');
}

await page.goto(`${BASE}/console`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Month Console")', { timeout: 20000 });
await page.waitForTimeout(2500);
await shot('1-idle');

const preflightChecks = await page.locator('text=The machine · stage 00').count();
const missingNamed = await page.evaluate(() => {
  const t = document.body.innerText;
  return ['S3_ACCESS_KEY_ID', 'CONVIN_TENANT', 'IMAP_HOST', 'CONVIN_TOKEN'].filter((v) => t.includes(v));
});
say('preflight panel present:', !!preflightChecks);
say('env vars named on screen:', missingNamed.join(', ') || '(none missing)');

await page.fill('input[type=month]', MONTH);
await page.locator(`button:has-text("${MODE}")`).first().click();
await page.waitForTimeout(2500);
await shot('2-mode');

if (FOLDER) {
  const root = await page.evaluate(async (base) => (await (await fetch(`${base}/api/console/browse`)).json()).root, BASE);
  if (!FOLDER.startsWith(root)) {
    say(`STOPPING — ${FOLDER} is outside the browse root ${root}; the picker cannot reach it.`);
    await browser.close();
    process.exit(2);
  }
  const segments = FOLDER.slice(root.length).split('/').filter(Boolean);
  say('walking:', segments.join(' → '));

  const list = page.locator('[role=listbox]');
  await list.focus();
  for (const seg of segments) {
    const names = (await page.locator('[role=option]').allInnerTexts()).map((t) => t.trim().split('\n')[0].trim());
    const i = names.findIndex((n) => n === seg);
    if (i < 0) { say(`  ✘ "${seg}" not listed here — found: ${names.slice(0, 6).join(', ')}`); break; }

    await page.keyboard.press('Home');
    for (let k = 0; k < i; k++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      (want) => (document.querySelector('.cx-fbar p')?.getAttribute('title') || '').endsWith(want),
      seg, { timeout: 10000 },
    ).catch(() => say(`  ✘ did not land in "${seg}"`));
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}

const chosen = await page.evaluate(() => /Chosen|is the run’s source/.test(document.body.innerText) ? 'yes' : 'no');
const detected = await page.evaluate(() => {
  const t = document.body.innerText;
  const m = t.match(/DETECTED ON OPEN([\s\S]{0,220})/);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 140) : '';
});
say('folder chosen:', chosen, '·', detected);
await shot('3-folder');

const runBtn = page.locator(`button:has-text("Run ${MONTH}"), button:has-text("Dry run")`).first();
const enabled = await runBtn.isEnabled();
say('Run enabled:', enabled);
if (!enabled) { say('STOPPING — Run is disabled; see the screenshots.'); await browser.close(); process.exit(2); }

await runBtn.click();
await page.waitForTimeout(3000);
await shot('4-running');

const graphNodes = await page.locator('svg [role=button]').count();
say('stage nodes in the graph:', graphNodes);

let answered = 0;
for (let round = 0; round < 3; round++) {
  const card = page.getByRole('dialog');
  try {
    await card.waitFor({ state: 'visible', timeout: 25000 });
  } catch { break; }
  await shot(`5-decision-${round + 1}`);
  say('decision card:', (await card.locator('div').first().innerText()).split('\n').slice(0, 3).join(' | '));

  const options = card.locator('button:has-text("PreX"), button:has-text("Bucket"), button:has-text("Build it short")');
  if (await options.count()) await options.first().click();
  await card.locator('textarea').fill('Driven by scripts/drive_console.mjs — accepting the inference to exercise the decision path end to end.');
  await page.waitForTimeout(300);
  await shot(`5-decision-${round + 1}-filled`);
  const apply = card.locator('button:has-text("Apply and carry on"), button:has-text("Record this")');
  if (await apply.first().isEnabled()) { await apply.first().click(); answered++; }
  await page.waitForTimeout(3000);
}
say('decisions answered:', answered);

const TERMINAL = ['done', 'failed', 'aborted', 'dry-run-complete'];
await page.waitForFunction(
  (terminal) => {
    const el = document.querySelector('[data-run-status]');
    return !!el && el.getAttribute('data-run-id') && terminal.includes(el.getAttribute('data-run-status'));
  },
  TERMINAL,
  { timeout: 420000 },
).catch(() => say('the run did not reach a terminal status inside 7 minutes'));
await page.waitForTimeout(1500);
await shot('6-final');

const facts = await page.evaluate(() => {
  const text = document.body.innerText;
  const nodes = [...document.querySelectorAll('svg [role=button]')].map((n) => n.getAttribute('aria-label'));
  return {
    badge: document.querySelector('[data-run-status]')?.getAttribute('data-run-status') ?? null,
    stages: nodes,
    cached: /SERVED FROM DISK/.test(text),
    logLines: (text.match(/([\d,]+)\s+lines/) || [])[1] ?? null,
    decisions: /It stopped to ask/i.test(text),
    pdfs: (document.querySelectorAll('.cx-out').length || null),
    failure: (text.match(/exit \d+[^\n]*/) || [])[0] ?? null,
  };
});
say('\n── what the screen says ──');
say(JSON.stringify(facts, null, 1));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await shot('7-after-reload');
const afterReload = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    rejoined: /run 20\d\d-/.test(t),
    decisionsShown: /It stopped to ask/i.test(t),
    stagesShown: document.querySelectorAll('svg [role=button]').length,
    badge: document.querySelector('[data-run-status]')?.getAttribute('data-run-status') ?? null,
  };
});
say('after reload:', JSON.stringify(afterReload));

say('\npage errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
