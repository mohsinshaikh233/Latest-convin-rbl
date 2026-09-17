import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isResolved } from './src/lib/normalize.mjs';
import { Aggregator } from './src/lib/aggregate.mjs';
import { unionByAccount } from './src/lib/dayunion.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const displayDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const BATCHES = path.join(process.cwd(), 'src', 'data', 'batches');
const DATA = path.join(process.cwd(), 'src', 'data');
const r2 = (n) => Math.round(n * 100) / 100;

function displayRow(r) {
  const o = r.total_outstanding;
  return [r.account_no, r.customer_name, r.status, r.disp_l1 || '—', r.region || '—', r.primary_state || '—',
    r.curr_bal_band, r2(o), isResolved(r) ? r2(o) : 0, r.ai_attempts, r.ai_connected_calls,
    r.payment_mode || '—', r.promise_flag === 'YES' ? 'Yes' : '—', r.mobile || '—', r.lead_link || ''];
}
const writeJson = (p, o) => writeFile(p, JSON.stringify(o), 'utf8');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const files = (await readdir(BATCHES)).filter((f) => f.endsWith('.canon.json')).sort();
if (!files.length) { console.log('No canonical rows found — nothing to rebuild.'); process.exit(0); }

const byDate = new Map();
for (const f of files) {
  const iso = f.slice(0, 10);
  if (!byDate.has(iso)) byDate.set(iso, []);
  byDate.get(iso).push(f);
}

const dayCounts = new Map();

for (const [iso, dayFiles] of [...byDate].sort()) {
  const disp = displayDate(iso);
  const chunks = [];

  const daySources = [];

  for (const f of dayFiles) {
    const bid = f.replace('.canon.json', '');
    const rows = await readJson(path.join(BATCHES, f));

    let sources = [];
    try { sources = await readJson(path.join(BATCHES, `${bid}.sources.json`)); } catch { sources = []; }
    for (const x of sources) daySources.push({ ...x, upload: bid.replace(`${iso}__`, '') });

    const agg = new Aggregator();
    for (const r of rows) agg.add(r);
    await writeJson(path.join(BATCHES, `${bid}.json`), agg.payload(disp, sources));
    await writeJson(path.join(BATCHES, `${bid}.rows.json`), rows.map(displayRow));
    chunks.push(rows);
    console.log(`  ${bid}: ${rows.length} rows`);
  }

  const union = unionByAccount(chunks);
  const dayAgg = new Aggregator();
  for (const r of union.rows) dayAgg.add(r);

  const dt = `${iso}__daytotal`;
  await writeJson(path.join(BATCHES, `${dt}.json`), dayAgg.payload(disp, daySources));
  await writeJson(path.join(BATCHES, `${dt}.rows.json`), union.rows.map(displayRow));

  dayCounts.set(iso, union.rows.length);

  const dupNote = union.duplicates ? ` — ${union.duplicates.toLocaleString('en-IN')} duplicate account rows counted ONCE, not summed` : '';
  console.log(`✔ ${iso} rebuilt (${dayFiles.length} upload${dayFiles.length > 1 ? 's' : ''} + Day Total: ${union.rows.length.toLocaleString('en-IN')} accounts${dupNote})`);
}

{
  const manPath = path.join(DATA, 'manifest.json');
  const man = JSON.parse(await readFile(manPath, 'utf8'));
  let fixed = 0;
  for (const d of man.dates || []) {
    const n = dayCounts.get(d.date);
    if (n !== undefined && d.rowCount !== n) {
      console.log(`  manifest: ${d.date} rowCount ${d.rowCount.toLocaleString('en-IN')} → ${n.toLocaleString('en-IN')} (deduplicated)`);
      d.rowCount = n;
      fixed++;
    }

    for (const u of d.uploads || []) {
      if (!/^Upload\b/i.test(u.label || '')) continue;
      const next = u.label.replace(/^Upload\b/i, 'Day');
      console.log(`  manifest: ${d.date} "${u.label}" → "${next}"`);
      u.label = next;
      fixed++;
    }
  }
  if (fixed) await writeJson(manPath, man);
}
