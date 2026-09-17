import { readFileSync } from 'node:fs';
import { parseCsv } from './src/lib/csv.mjs';
import { buildCanonicalRows } from './src/lib/merge.mjs';
import { ingestLocalUpload } from './src/lib/ingest_local.mjs';

const parsed = parseCsv(readFileSync('./src/data/convin_source.csv', 'utf8'));
const { rows } = buildCanonicalRows(parsed, []);
const iso = '2026-07-07';
const times = ['09:12 AM', '01:30 PM', '06:05 PM'];

for (let slot = 1; slot <= 3; slot++) {
  const slice = rows.filter((_, i) => i % 3 === slot - 1);
  const res = await ingestLocalUpload(slice, { reportDate: iso, slot, filename: `convin_${iso}_u${slot}.csv`, uploadTime: times[slot - 1] });
  console.log(`  ${res.batchId}: ${res.rowCount} rows`);
}
console.log('✔ Seeded local data (3 uploads + Day Total) for', iso);
