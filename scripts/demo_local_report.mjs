import fs from 'node:fs';
import path from 'node:path';
import { readSheet, detectSheetKind } from '../src/lib/sheet.mjs';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { autoMap } from '../src/lib/normalize.mjs';
import { rollUpCallLog, applyCallLog } from '../src/lib/calllog.mjs';
import { ingestLocalUpload } from '../src/lib/ingest_local.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const BOOK = flag('book');
const STATUS = flag('status');
const CALLLOG = flag('calllog');
const DATE = flag('date', '2026-08-18');
if (!BOOK) throw new Error('--book is required');

const load = (f) => {
  const rows = readSheet(fs.readFileSync(f), path.basename(f));
  return { name: path.basename(f), rows, kind: detectSheetKind(rows[0]) };
};

const sheets = [BOOK, STATUS, CALLLOG].filter(Boolean).map(load);
for (const s of sheets) console.log(`  ${s.kind.padEnd(9)} ${s.name}  (${s.rows.length - 1} rows)`);

const cyc = sheets.find((s) => s.kind === 'cyc');
const primary = cyc || sheets[0];
const callSheets = sheets.filter((s) => s.kind === 'calllog');
const lookups = sheets.filter((s) => s !== primary && s.kind !== 'calllog');

const mapping = autoMap(sheets.filter((s) => s.kind !== 'calllog').flatMap((s) => s.rows[0]));
const { rows, warnings } = buildCanonicalRows(
  primary.rows, lookups.map((s) => s.rows), mapping, lookups.map((s) => s.name),
);
console.log(`\n  canonical rows: ${rows.length}`);
if (warnings?.length) warnings.slice(0, 5).forEach((w) => console.log(`  ! ${w}`));

for (const s of callSheets) {
  const log = rollUpCallLog(s.rows);
  applyCallLog(rows, log, { name: s.name });
  console.log(`  call log applied: ${log.stats.attempts.toLocaleString('en-IN')} attempts`);
}

const sources = sheets.map((s) => ({
  slot: s === primary ? 'CYC / PDD (primary)' : (s.kind === 'status' ? 'Status' : 'Lead outcome'),
  name: s.name, rows: s.rows.length - 1, detected: s.kind,
}));

const res = await ingestLocalUpload(rows, {
  reportDate: DATE, slot: 1, filename: primary.name, uploadTime: '10:00 AM', sources,
});
console.log(`\n✔ ${res.batchId}: ${res.rowCount} rows -> src/data/batches`);
