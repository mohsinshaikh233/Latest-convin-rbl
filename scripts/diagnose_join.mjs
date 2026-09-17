import fs from 'node:fs';
import path from 'node:path';
import { readSheet } from '../src/lib/sheet.mjs';
import { toObjects } from '../src/lib/merge.mjs';
import { getField, autoMap } from '../src/lib/normalize.mjs';

const files = process.argv.slice(2);
if (files.length < 2) {
  console.error('\n  usage: node scripts/diagnose_join.mjs <primary/CYC file> <other file> [more files...]\n');
  process.exit(1);
}

const bar = (s = '─') => console.log(s.repeat(78));
const digitsOnly = (v) => String(v ?? '').replace(/\D/g, '');
const strip0 = (v) => digitsOnly(v).replace(/^0+/, '');

const sheets = files.map((f) => {
  const rows = readSheet(fs.readFileSync(f), path.basename(f));
  return { file: path.basename(f), headers: rows[0] || [], objs: toObjects(rows) };
});

const primary = sheets[0];
const mapping = autoMap(sheets.flatMap((s) => s.headers));

console.log(`\n  PRIMARY (the spine — every account here, and only these, ends up in the report)`);
bar();
console.log(`  file    : ${primary.file}`);
console.log(`  rows    : ${primary.objs.length.toLocaleString('en-IN')}`);

const pKeyCol = mapping.account_no;
const pIds = primary.objs.map((o) => String(getField(o, 'account_no', mapping) ?? '').trim()).filter(Boolean);
console.log(`  key col : ${pKeyCol || '(resolved via aliases)'}`);
console.log(`  samples : ${pIds.slice(0, 3).join(', ')}`);
const lens = [...new Set(pIds.map((v) => digitsOnly(v).length))].sort((a, b) => a - b);
console.log(`  lengths : ${lens.join(', ')} digits`);

const pRaw = new Set(pIds.map(digitsOnly));
const pStrip = new Set(pIds.map(strip0));

const pSuf = {};
for (const n of [16, 12, 10, 8, 6]) pSuf[n] = new Set(pIds.map((v) => digitsOnly(v).slice(-n)).filter((v) => v.length === n));

for (const s of sheets.slice(1)) {
  console.log(`\n  LOOKUP: ${s.file}   (${s.objs.length.toLocaleString('en-IN')} rows)`);
  bar();

  const results = [];
  for (const col of s.headers) {
    if (!col) continue;
    const vals = s.objs.map((o) => o[col]).filter((v) => v !== undefined && String(v).trim() !== '');
    if (!vals.length) continue;

    const numericish = vals.filter((v) => digitsOnly(v).length >= 6);
    if (numericish.length < vals.length * 0.5) continue;

    const uniq = new Set(numericish.map(digitsOnly));
    const hitRaw = [...uniq].filter((v) => pRaw.has(v)).length;
    const hitStrip = [...new Set(numericish.map(strip0))].filter((v) => pStrip.has(v)).length;

    let best = { how: 'exact', hits: Math.max(hitRaw, hitStrip) };
    if (hitStrip > hitRaw) best.how = 'ignoring leading zeros';

    for (const n of [16, 12, 10, 8, 6]) {
      const tails = new Set(numericish.map((v) => digitsOnly(v).slice(-n)).filter((v) => v.length === n));
      const h = [...tails].filter((v) => pSuf[n].has(v)).length;
      if (h > best.hits) best = { how: `on the last ${n} digits`, hits: h };
    }

    if (best.hits > 0) {
      results.push({
        col, hits: best.hits, how: best.how,
        pct: (best.hits / Math.min(uniq.size, pRaw.size)) * 100,
        sample: digitsOnly(numericish[0]),
        len: [...new Set(numericish.map((v) => digitsOnly(v).length))].sort((a, b) => a - b).join('/'),
      });
    }
  }

  results.sort((a, b) => b.hits - a.hits);

  if (!results.length) {
    console.log('  ✘ NOT ONE COLUMN in this file joins to the primary — not exactly, not on leading');
    console.log('    zeros, not on any digit-tail from 6 to 16.\n');

    const ownKey = String(getField(s.objs[0] || {}, 'account_no', mapping) ?? '');
    console.log(`    primary looks like : ${pIds[0]}  (${digitsOnly(pIds[0]).length} digits)`);
    console.log(`    this file looks like: ${ownKey}  (${digitsOnly(ownKey).length} digits)`);
    console.log('');
    console.log('    These are not the same accounts. Almost always this means the export is for a');
    console.log('    DIFFERENT CYCLE than the CYC file — the leads are real, they are just not');
    console.log('    these leads. Re-pull the lead export filtered to the campaign that was run');
    console.log('    against this exact CYC book, and it will join.');
    continue;
  }

  console.log(`  Columns in this file that DO join to the primary's Account No:\n`);
  console.log(`    ${'column'.padEnd(26)} ${'matched'.padStart(8)}  ${'coverage'.padStart(9)}  how`);
  for (const r of results.slice(0, 6)) {
    console.log(`    ${r.col.slice(0, 25).padEnd(26)} ${String(r.hits).padStart(8)}  ${(r.pct.toFixed(1) + '%').padStart(9)}  ${r.how}`);
  }
  const top = results[0];
  console.log('');
  if (top.how === 'exact' || top.how === 'ignoring leading zeros') {
    console.log(`  ✔ FIX: on the upload screen, open "Show all fields" and map`);
    console.log(`         Account No  →  "${top.col}"    (currently: "${mapping.account_no}")`);
  } else {
    console.log(`  ⚠ "${top.col}" joins ${top.how} — the two files use different but related IDs.`);
    console.log(`    A tail match is NOT safe to do silently: two accounts can share a tail, and`);
    console.log(`    attaching the wrong customer's balance is worse than attaching none. Ask RBL`);
    console.log(`    or Convin for an export that carries the full Account No.`);
  }
  console.log('');
}
bar('═');
console.log('');
