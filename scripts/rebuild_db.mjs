import { getPool, listBatches, getPayload, upsertBatch, forEachRowOfDate, DATA_COLS } from '../src/lib/db.mjs';
import { Aggregator } from '../src/lib/aggregate.mjs';
import { PAYLOAD_VERSION } from '../src/lib/payload_version.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const displayDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

const COLS = DATA_COLS;

const pool = await getPool();
const batches = await listBatches();
const uploads = batches.filter((b) => b.kind === 'upload');

if (!uploads.length) {
  console.log('No uploads in the database — nothing to rebuild.');
  process.exit(0);
}

console.log(`Rebuilding ${uploads.length} upload${uploads.length > 1 ? 's' : ''} to payload v${PAYLOAD_VERSION}.\n`);

const dates = new Set();
const sourcesByDate = new Map();

for (const b of uploads) {
  const iso = b.report_date;
  dates.add(iso);

  const old = await getPayload(b.id);
  const sources = old?.meta?.sources || [];
  if (!sourcesByDate.has(iso)) sourcesByDate.set(iso, []);
  sourcesByDate.get(iso).push(...sources);

  const { rows } = await pool.query(
    `SELECT ${COLS.join(',')} FROM account_rows WHERE batch_id = $1`, [b.id],
  );
  if (!rows.length) {
    console.log(`  ⚠ ${b.id}: no rows in account_rows — LEAVING ITS PAYLOAD ALONE.`);
    console.log('    (Overwriting it with an empty aggregate would turn a stale report into a blank one.)');
    continue;
  }

  const agg = new Aggregator();
  for (const r of rows) agg.add(r);

  const label = String(b.label || '').replace(/^Upload\b/i, 'Day') || 'Day';

  await upsertBatch(
    {
      id: b.id, reportDate: iso, filename: b.filename, rowCount: rows.length,
      kind: 'upload', label, uploadTime: b.upload_time,
    },
    agg.payload(displayDate(iso), sources),
  );

  const renamed = label !== b.label ? `  ("${b.label}" → "${label}")` : '';
  console.log(`  ${b.id}: ${rows.length.toLocaleString('en-IN')} rows${renamed}`);
}

for (const iso of [...dates].sort()) {
  const byAccount = new Map();
  await forEachRowOfDate(iso, (r) => {
    const k = String(r.account_no ?? '').trim();
    if (k) byAccount.set(k, r);
  });
  if (!byAccount.size) continue;

  const agg = new Aggregator();
  for (const r of byAccount.values()) agg.add(r);

  await upsertBatch(
    {
      id: `${iso}__daytotal`, reportDate: iso, filename: '', rowCount: byAccount.size,
      kind: 'daytotal', label: 'Day Total', uploadTime: '',
    },
    agg.payload(displayDate(iso), sourcesByDate.get(iso) || []),
  );
  console.log(`✔ ${iso} Day Total: ${byAccount.size.toLocaleString('en-IN')} accounts`);
}

console.log('\nDone. Reload the dashboard — no re-upload, no re-join, and no number changed');
console.log('except the ones the aggregator now computes differently.');
await pool.end();
