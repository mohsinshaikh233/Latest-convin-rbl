import fs from 'node:fs';
import path from 'node:path';
import { readSheet, detectSheetKind } from '../src/lib/sheet.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap } from '../src/lib/normalize.mjs';
import { rollUpCallLog, applyCallLog } from '../src/lib/calllog.mjs';
import { hasDb } from '../src/lib/db.mjs';
import { ingestUpload } from '../src/lib/ingest.mjs';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const files = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const bar = () => console.log('─'.repeat(76));

if (!hasDb()) {
  console.error('\n  DATABASE_URL is not set.\n');
  console.error('  Put it in .env.local (it is gitignored):');
  console.error('    DATABASE_URL=postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres\n');
  console.error('  Supabase → Project Settings → Database → Connection string → URI\n');
  process.exit(1);
}

if (files.length < 1) {
  console.error('\n  usage: npm run push -- <CYC.xlsx> <Status.xlsx> <LeadOutcome.csv> [--date YYYY-MM-DD] [--slot 1]\n');
  process.exit(1);
}

const reportDate = flag('date', new Date().toISOString().slice(0, 10));
const slot = Math.max(1, parseInt(flag('slot', '1'), 10) || 1);

console.log('');
bar();
console.log(`  PUSH → Supabase        report date ${reportDate}   ·   upload slot ${slot}`);
bar();

const sheets = files.map((f) => {
  if (!fs.existsSync(f)) { console.error(`\n  file not found: ${f}\n`); process.exit(1); }
  const rows = readSheet(fs.readFileSync(f), path.basename(f));
  const kind = detectSheetKind(rows[0]);
  const mb = (fs.statSync(f).size / 1048576).toFixed(1);
  console.log(`  ${String(kind).toUpperCase().padEnd(8)} ${path.basename(f).padEnd(48)} ${String(rows.length - 1).padStart(8)} rows  ${mb.padStart(5)} MB`);
  return { name: path.basename(f), rows, kind };
});
bar();

const cyc = sheets.find((s) => s.kind === 'cyc');
const primary = cyc || sheets[0];

const callSheets = sheets.filter((s) => s.kind === 'calllog');
const lookups = sheets.filter((s) => s !== primary && s.kind !== 'calllog');

if (!cyc) {
  console.log('  No CYC/PDD file detected — treating the first file as an already-merged export.');
}

const mapping = autoMap(sheets.filter((s) => s.kind !== 'calllog').flatMap((s) => s.rows[0]));
const t0 = Date.now();

let merged;
try {
  merged = buildCanonicalRows(primary.rows, lookups.map((s) => s.rows), mapping, lookups.map((s) => s.name));
} catch (e) {
  console.error(`\n  ✘ ${e.message}\n`);
  process.exit(1);
}

const { rows, stats, warnings } = merged;
console.log(`  joined ${rows.length.toLocaleString('en-IN')} accounts in ${Date.now() - t0} ms`);

for (const s of callSheets) {
  const log = rollUpCallLog(s.rows);
  const applied = applyCallLog(rows, log, { name: s.name });
  warnings.push(...applied.warnings);
  console.log(
    `    ${s.name.padEnd(48)} ${log.stats.attempts.toLocaleString('en-IN')} attempts`
    + ` · ${log.stats.connected.toLocaleString('en-IN')} connected`
    + ` · matched ${applied.matched.toLocaleString('en-IN')} of ${log.stats.accounts.toLocaleString('en-IN')} accounts`,
  );
}
for (const c of stats.sheetCoverage || []) {
  console.log(`    ${c.name.padEnd(48)} matched ${c.matched.toLocaleString('en-IN')} of ${c.of.toLocaleString('en-IN')}`);
}
for (const w of warnings) console.log(`\n  ⚠ ${w}`);

const sources = sheets.map((s) => ({
  slot: s === primary ? (cyc ? 'CYC / PDD (primary)' : 'Merged sheet') : (s.kind === 'status' ? 'Status' : 'Lead outcome'),
  name: s.name,
  rows: s.rows.length - 1,
  detected: s.kind,
}));

bar();
console.log('  writing to Supabase…');
const t1 = Date.now();
const res = await ingestUpload(rows, { reportDate, slot, filename: primary.name, uploadTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), sources });
console.log(`  ✔ ${res.rowCount.toLocaleString('en-IN')} rows written · batch ${res.batchId} · ${Date.now() - t1} ms`);
bar();
console.log('  Done. Open the deployed dashboard — it is already showing this.\n');
process.exit(0);
