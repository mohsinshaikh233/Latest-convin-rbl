import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/tmp/pw/node_modules/playwright-core/index.mjs';
import { readSheet, detectSheetKind } from '../src/lib/sheet.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap, normalizeAccount } from '../src/lib/normalize.mjs';
import { rollUpCallLog, applyCallLog } from '../src/lib/calllog.mjs';
import { ingestLocalUpload, deleteLocalDate } from '../src/lib/ingest_local.mjs';
import { createShare } from '../src/lib/share.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const onlys = argv.reduce((a, x, i) => (x === '--only' && argv[i + 1] ? [...a, argv[i + 1]] : a), []);

const PLAN = JSON.parse(fs.readFileSync(flag('plan', '/tmp/plan.json'), 'utf8'));
const OUT = flag('out');
const SCRATCH = flag('date', '2026-08-27');
const PORT = flag('port', '3111');
const LIMIT = Number(flag('limit', '999'));
fs.mkdirSync(OUT, { recursive: true });

const load = (f) => {
  const rows = readSheet(fs.readFileSync(f), path.basename(f));
  return { name: path.basename(f), rows, kind: detectSheetKind(rows[0]) };
};

function fillMissingStatus(sheets, mapping, primary) {
  const status = sheets.find((s) => s.kind === 'status');
  if (!status) return [];
  const idx = (rows, exact, re) => {
    const i = rows[0].findIndex((h) => String(h ?? '').trim() === exact);
    return i >= 0 ? i : rows[0].findIndex((h) => re.test(String(h ?? '')));
  };
  const acctHdr = (mapping && mapping.account_no) || '';
  const sAcct = idx(status.rows, acctHdr, /account/i);
  const sStat = idx(status.rows, (mapping && mapping.status) || '', /status/i);
  const pAcct = idx(primary.rows, acctHdr, /account/i);
  if (sAcct < 0 || sStat < 0 || pAcct < 0) return [];
  const forms = (v) => {
    const n = normalizeAccount(v);
    if (!n) return [];
    const z = n.replace(/^0+/, '');
    return z && z !== n ? [n, z] : [n];
  };
  const have = new Set();
  for (let r = 1; r < status.rows.length; r++) for (const f of forms(status.rows[r][sAcct])) have.add(f);
  const missing = []; const seen = new Set();
  for (let r = 1; r < primary.rows.length; r++) {
    const raw = primary.rows[r][pAcct];
    const f = forms(raw);
    if (!f.length || f.some((x) => have.has(x)) || seen.has(f[0])) continue;
    seen.add(f[0]);
    missing.push(String(raw ?? '').trim());
  }
  if (!missing.length) return [];
  const total = primary.rows.length - 1;
  const pct = (missing.length / total) * 100;
  if (pct > 1) throw new Error(`--fill-missing-status refused: ${missing.length} of ${total} (${pct.toFixed(1)}%) absent from the status sheet — wrong file or a join mismatch, not a gap.`);
  const width = status.rows[0].length;
  for (const acct of missing) {
    const row = new Array(width).fill('');
    row[sAcct] = acct; row[sStat] = 'Unresolved';
    status.rows.push(row);
  }
  return missing;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const names = Object.keys(PLAN).filter((n) => !onlys.length || onlys.some((o) => n.includes(o)));
let done = 0;
for (const name of names) {
  const outPdf = path.join(OUT, `${name.replace(/[/\\:]/g, '-')}.pdf`);
  if (fs.existsSync(outPdf) && fs.statSync(outPdf).size > 50000) { console.log(`SKIP\t${name}\t(already built)`); continue; }
  if (done >= LIMIT) break;
  const p = PLAN[name];
  const t0 = Date.now();
  try {
    await deleteLocalDate(SCRATCH).catch(() => {});
    const sheets = [p.book, p.status, p.calllog].map(load);
    const primary = sheets.find((s) => s.kind === 'cyc') || sheets[0];
    const callSheets = sheets.filter((s) => s.kind === 'calllog');
    const lookups = sheets.filter((s) => s !== primary && s.kind !== 'calllog');
    const mapping = autoMap(sheets.filter((s) => s.kind !== 'calllog').flatMap((s) => s.rows[0]));
    const filled = argv.includes('--fill-missing-status') ? fillMissingStatus(sheets, mapping, primary) : [];
    if (filled.length) console.log(`ASSUMED\t${name}\t${filled.length} account(s) absent from the status sheet booked Unresolved: ${filled.join(', ')}`);
    const { rows } = buildCanonicalRows(primary.rows, lookups.map((s) => s.rows), mapping, lookups.map((s) => s.name));

    for (const s of callSheets) {
      const log = rollUpCallLog(s.rows);
      applyCallLog(rows, log, { name: s.name });
    }

    const attempts = rows.reduce((n, r) => n + (Number(r.ai_attempts) || 0), 0);
    const sources = sheets.map((s) => ({
      slot: s === primary ? 'CYC / PDD (primary)' : (s.kind === 'status' ? 'Status' : 'Lead outcome'),
      name: s.name, rows: s.rows.length - 1, detected: s.kind,
    }));
    await ingestLocalUpload(rows, { reportDate: SCRATCH, slot: 1, filename: primary.name, uploadTime: '10:00 AM', sources });
    const share = await createShare({ batchId: `${SCRATCH}__daytotal`, reportDate: SCRATCH, label: name, days: 0 });

    await page.goto(`http://localhost:${PORT}/convin/r/${share.token}`, { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForFunction(() => document.body.innerText.length > 4000, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(3500);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: outPdf, printBackground: true, preferCSSPageSize: true });
    const kb = (fs.statSync(outPdf).size / 1024).toFixed(0);
    console.log(`OK\t${name}\taccts=${rows.length}\tattempts=${attempts}\tload=${p.load}\t${kb}KB\t${((Date.now() - t0) / 1000).toFixed(0)}s`);
    done += 1;
  } catch (e) {
    console.log(`FAIL\t${name}\t${String(e.message).slice(0, 220)}`);
  }
}
await browser.close();
console.log(`\nbuilt ${done} this run`);
