import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { readSheet, detectSheetKind } from '../src/lib/sheet.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap, normalizeAccount } from '../src/lib/normalize.mjs';
import { rollUpCallLog, applyCallLog } from '../src/lib/calllog.mjs';
import { hasDb, deleteDate, listBatches } from '../src/lib/db.mjs';
import { ingestUpload } from '../src/lib/ingest.mjs';
import { createShare } from '../src/lib/share.mjs';
import { BASE_PATH } from '../src/lib/basepath.mjs';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);
const onlys = argv.reduce((acc, a, i) => (a === '--only' && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);

const ROOT = flag('root', path.join(os.homedir(), 'Business/Convin/RBL PDD August Folder'));
const OUT = flag('out', path.join(ROOT, '_Reports'));
const SCRATCH = flag('date', '2026-08-27');
const BASE = flag('base', 'https://convin-dashboard.vercel.app').replace(/\/+$/, '');
const DRY = has('dry-run');

const line = (c = '─') => console.log(c.repeat(78));
const fmt = (n) => Number(n).toLocaleString('en-IN');

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function discover() {
  if (!fs.existsSync(ROOT)) { console.error(`\n  data root not found: ${ROOT}\n`); process.exit(1); }
  const books = [];
  for (const name of fs.readdirSync(ROOT).sort()) {
    const dir = path.join(ROOT, name);
    if (!fs.statSync(dir).isDirectory() || name.startsWith('_') || name.startsWith('.')) continue;
    const days = fs.readdirSync(dir).filter((d) => /^Day \d+/.test(d))
      .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    if (!days.length) continue;
    const slots = days.map((d) => {
      const p = path.join(dir, d);
      const fs3 = fs.readdirSync(p).filter((f) => /^[123] - /.test(f)).sort();
      return { day: +d.match(/\d+/)[0], dir: p, label: d, files: fs3.map((f) => path.join(p, f)), n: fs3.length };
    });
    const complete = slots.every((s) => s.n === 3);
    books.push({ name, dir, slots, complete });
  }
  return books;
}

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
  if (pct > 1) {
    throw new Error(
      `--fill-missing-status refused: ${fmt(missing.length)} of ${fmt(total)} accounts (${pct.toFixed(1)}%) are absent `
      + `from the status sheet. That is too many to be a gap in the bank's export — it is the wrong status file, or the `
      + `two files number accounts differently. Fix the join rather than filling in outcomes.`,
    );
  }

  const width = status.rows[0].length;
  for (const acct of missing) {
    const row = new Array(width).fill('');
    row[sAcct] = acct;
    row[sStat] = 'Unresolved';
    status.rows.push(row);
  }
  return missing;
}

function joinDay(files) {
  const sheets = files.map((f) => {
    const rows = readSheet(fs.readFileSync(f), path.basename(f));
    return { name: path.basename(f), rows, kind: detectSheetKind(rows[0]) };
  });
  const cyc = sheets.find((s) => s.kind === 'cyc');
  const primary = cyc || sheets[0];
  const callSheets = sheets.filter((s) => s.kind === 'calllog');
  const lookups = sheets.filter((s) => s !== primary && s.kind !== 'calllog');
  const mapping = autoMap(sheets.filter((s) => s.kind !== 'calllog').flatMap((s) => s.rows[0]));
  const filled = has('fill-missing-status') ? fillMissingStatus(sheets, mapping, primary) : [];
  const { rows, warnings } = buildCanonicalRows(
    primary.rows, lookups.map((s) => s.rows), mapping, lookups.map((s) => s.name),
  );
  const uncalled = [];
  for (const s of callSheets) {
    const log = rollUpCallLog(s.rows);
    try {
      applyCallLog(rows, log, { name: s.name });
    } catch (e) {
      if (!has('allow-zero-calls') || !/did not match a single account/.test(e.message)) throw e;

      uncalled.push({ name: s.name, attempts: log.stats.attempts });
    }
  }

  const calls = rows.reduce((n, r) => n + (Number(r.ai_attempts) || 0), 0);

  const sources = sheets.map((s) => ({
    slot: s === primary ? 'CYC / PDD (primary)' : (s.kind === 'status' ? 'Status' : 'Lead outcome'),
    name: s.name, rows: s.rows.length - 1, detected: s.kind,
  }));
  return { rows, warnings, calls, filled, uncalled, primaryName: primary.name, sources };
}

async function toPdf(chrome, url, out) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rbl-pdf-'));
  fs.rmSync(out, { force: true });

  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--no-pdf-header-footer', '--virtual-time-budget=45000',
    `--print-to-pdf=${out}`, url,
  ], { stdio: 'ignore', detached: true });

  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });

  const finishedSize = () => {
    if (!fs.existsSync(out)) return 0;
    const size = fs.statSync(out).size;
    if (size < 20000) return 0;
    const fd = fs.openSync(out, 'r');
    try {
      const tail = Buffer.alloc(Math.min(64, size));
      fs.readSync(fd, tail, 0, tail.length, size - tail.length);
      return tail.toString('latin1').includes('%%EOF') ? size : 0;
    } finally { fs.closeSync(fd); }
  };

  const DEADLINE = Date.now() + 420000;
  let size = 0; let last = -1; let stable = 0;
  while (Date.now() < DEADLINE) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = finishedSize();
    stable = (s && s === last) ? stable + 1 : 0;
    last = s;
    if (s && stable >= 1) { size = s; break; }
    if (exited) { size = finishedSize(); break; }
  }

  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {  } }
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(profile, { recursive: true, force: true });

  if (!size) {
    const got = fs.existsSync(out) ? `${fs.statSync(out).size} bytes, no %%EOF trailer` : 'no file written';
    throw new Error(`Chrome produced no usable PDF (${got})`);
  }
  return size;
}

line('═');
console.log('  BUILD BOOK REPORTS');
line('═');

if (!DRY && !hasDb()) {
  console.error('\n  DATABASE_URL is not set. Run with:\n    node --env-file=.env.local scripts/build_book_reports.mjs\n');
  process.exit(1);
}
const chrome = findChrome();
if (!DRY && !chrome) {
  console.error('\n  Could not find Chrome. Install Google Chrome, or pass --dry-run to see the plan.\n');
  process.exit(1);
}

let books = discover();
if (onlys.length) books = books.filter((b) => onlys.some((o) => b.name.toLowerCase().includes(o.toLowerCase())));
const skipped = books.filter((b) => !b.complete && !has('incomplete'));
if (!has('incomplete')) books = books.filter((b) => b.complete);

console.log(`  data root   ${ROOT}`);
console.log(`  output      ${OUT}`);
console.log(`  scratch     ${SCRATCH}   (each report is built here, exported, then deleted)`);
console.log(`  chrome      ${chrome || '(dry run)'}`);
console.log(`  books       ${books.length} to build${skipped.length ? `, ${skipped.length} skipped for missing files` : ''}`);
line();
for (const b of books) console.log(`    ${b.name.padEnd(26)} ${b.slots.length} day(s)`);
for (const b of skipped) console.log(`    ${b.name.padEnd(26)} SKIPPED — ${b.slots.filter((s) => s.n < 3).map((s) => s.label).join(', ')} incomplete`);
line();

if (DRY) {
  console.log('\n  --dry-run: nothing was touched.\n');
  if (has('json')) {
    console.log(JSON.stringify({
      ok: true, dryRun: true, wouldBuild: books.length, skippedCount: skipped.length,
      outDir: OUT, scratchDate: SCRATCH,
      books: books.map((b) => ({ book: b.name, days: b.slots.length })),
      skipped: skipped.map((b) => ({ book: b.name, missing: b.slots.filter((s) => s.n < 3).map((s) => s.label) })),
    }));
  }
  process.exit(0);
}
if (!books.length) { console.log('\n  Nothing to do.\n'); process.exit(0); }

const existing = (await listBatches()).filter((b) => String(b.report_date).slice(0, 10) === SCRATCH);
if (existing.length) {
  console.error(`\n  ✘ ${SCRATCH} already holds ${existing.length} batch(es).`);
  console.error('    Pick a free date with --date, or delete that report first. Refusing to overwrite.\n');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const done = []; const failed = [];

for (const [i, book] of books.entries()) {
  const t0 = Date.now();
  console.log(`\n[${i + 1}/${books.length}]  ${book.name}`);
  try {
    await deleteDate(SCRATCH);
    let rows = 0; let calls = 0; const filled = new Set();
    for (const s of book.slots) {
      const j = joinDay(s.files);
      await ingestUpload(j.rows, {
        reportDate: SCRATCH, slot: s.day, filename: j.primaryName,
        uploadTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        sources: j.sources,
      });

      rows = j.rows.length; calls = j.calls;
      for (const a of j.filled || []) filled.add(a);
      process.stdout.write(`    Day ${s.day}: ${fmt(j.rows.length)} accounts · ${fmt(j.calls)} attempts\n`);

      for (const u of j.uncalled || []) {
        console.log(`      ZERO CALLS  "${u.name}" holds ${fmt(u.attempts)} attempts, none of them for this book's accounts — built as a no-call book.`);
      }
      if (j.filled && j.filled.length) {
        console.log(`      ASSUMPTION  ${fmt(j.filled.length)} account(s) absent from the status sheet, carried as Unresolved: ${j.filled.join(', ')}`);
      }
      for (const w of j.warnings) console.log(`      ⚠ ${w}`);
    }
    const share = await createShare({
      batchId: `${SCRATCH}__daytotal`, reportDate: SCRATCH, label: book.name, days: 0,
    });
    const url = `${BASE}${BASE_PATH}/r/${share.token}`;
    const out = path.join(OUT, `${book.name.replace(/[/\\:]/g, '-')}.pdf`);
    const size = await toPdf(chrome, url, out);
    console.log(`    ✔ ${path.basename(out)}  ${(size / 1048576).toFixed(2)} MB  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    done.push({ book: book.name, rows, calls, out, assumed: [...filled] });
  } catch (e) {
    console.log(`    ✘ ${e.message}`);
    failed.push({ book: book.name, why: e.message });
  }
}

if (!has('keep')) await deleteDate(SCRATCH);

line('═');
console.log(`  ${done.length} report(s) built · ${failed.length} failed`);
line();
for (const d of done) console.log(`    ${d.book.padEnd(26)} ${fmt(d.rows).padStart(8)} accounts  ${fmt(d.calls).padStart(9)} attempts${d.assumed && d.assumed.length ? `   (${d.assumed.length} assumed Unresolved)` : ''}`);
for (const f of failed) console.log(`    ${f.book.padEnd(26)} FAILED — ${f.why}`);
line();
console.log(`  PDFs: ${OUT}\n`);

if (has('json')) {
  const suspect = done.filter((d) => d.calls === 0).map((d) => d.book);
  console.log(JSON.stringify({
    ok: failed.length === 0 && suspect.length === 0,
    built: done.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    outDir: OUT,
    scratchDate: SCRATCH,
    reports: done.map((d) => ({ book: d.book, accounts: d.rows, attempts: d.calls, pdf: d.out, assumedUnresolved: d.assumed || [] })),
    failures: failed.map((f) => ({ book: f.book, error: f.why })),
    skipped: skipped.map((b) => ({ book: b.name, missing: b.slots.filter((s) => s.n < 3).map((s) => s.label) })),
    zeroCallWarning: suspect,
  }));
}
process.exit(failed.length ? 1 : 0);
