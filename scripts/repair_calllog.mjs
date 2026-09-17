#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const expectIdx = argv.indexOf('--expect-accounts');
const EXPECT = expectIdx >= 0 ? Number(argv[expectIdx + 1]) : null;
const target = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));

function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const esc = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
const toCsv = (rows) => rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';

function repair(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return { file, ok: false, error: 'empty file' };
  const hdr = rows[0];
  const body = rows.slice(1).filter((r) => r.length === hdr.length);
  const ragged = rows.length - 1 - body.length;

  const res = {
    file: path.basename(file), columnsBefore: hdr.length, rows: body.length,
    ragged, repaired: false, cellsRecovered: 0, conflicts: 0, ok: true, notes: [],
  };
  if (ragged) res.notes.push(`${ragged} ragged row(s) dropped`);

  const seen = new Map(); const dup = [];
  hdr.forEach((h, i) => (seen.has(h) ? dup.push([seen.get(h), i]) : seen.set(h, i)));

  if (dup.length) {
    for (const r of body) {
      for (const [a, b] of dup) {
        const A = (r[a] ?? '').trim(), B = (r[b] ?? '').trim();
        if (A && B && A !== B) res.conflicts++;
      }
    }
    if (res.conflicts) {
      res.ok = false;
      res.error = `${res.conflicts} row(s) have BOTH copies populated with different values. ` +
                  `Merging would pick one arbitrarily — refusing. Inspect this file by hand.`;
      return res;
    }
    for (const r of body) {
      for (const [a, b] of dup) {
        if (!(r[a] ?? '').trim() && (r[b] ?? '').trim()) { r[a] = r[b]; res.cellsRecovered++; }
      }
    }
    const drop = new Set(dup.map(([, b]) => b));
    const keep = hdr.map((_, i) => i).filter((i) => !drop.has(i));
    const out = [keep.map((i) => hdr[i]), ...body.map((r) => keep.map((i) => r[i]))];
    fs.writeFileSync(file, toCsv(out));
    res.repaired = true;
    res.columnsAfter = keep.length;
    res.duplicatedColumns = [...new Set(dup.map(([a]) => hdr[a]))];
    res.notes.push(`merged ${dup.length} duplicated column(s), recovered ${res.cellsRecovered} cell(s)`);
  } else {
    res.columnsAfter = hdr.length;
  }

  const finalHdr = res.repaired ? hdr.filter((_, i) => !new Set(dup.map(([, b]) => b)).has(i)) : hdr;
  const idx = (n) => finalHdr.indexOf(n);
  const iLead = idx('Lead Creation Timestamp'), iExt = idx('External ID'), iCall = idx('Call Timestamp');
  if (iLead < 0 || iExt < 0 || iCall < 0) {
    res.ok = false; res.error = 'missing one of External ID / Lead Creation Timestamp / Call Timestamp';
    return res;
  }
  const reread = res.repaired ? parseCsv(fs.readFileSync(file, 'utf8')).slice(1) : body;
  const leads = new Set(), accts = new Set(); let minCall = null, maxCall = null;
  for (const r of reread) {
    if (r.length !== finalHdr.length) continue;
    leads.add((r[iLead] ?? '').slice(0, 10));
    accts.add(String(r[iExt] ?? '').split('_')[0].trim());
    const c = (r[iCall] ?? '').slice(0, 10);
    if (c) { if (!minCall || c < minCall) minCall = c; if (!maxCall || c > maxCall) maxCall = c; }
  }
  res.leadDates = [...leads].filter(Boolean).sort();
  res.accounts = accts.size;
  res.callRange = minCall ? `${minCall}..${maxCall}` : null;

  if (res.leadDates.length !== 1) {
    res.ok = false;
    res.error = `${res.leadDates.length} lead-creation dates (${res.leadDates.join(', ')}). ` +
                `The lead filter did not apply — this file mixes cohorts and must not be used.`;
  }
  if (EXPECT != null && res.accounts !== EXPECT) {
    res.ok = false;
    res.error = (res.error ? res.error + ' ' : '') +
      `expected ${EXPECT} accounts, found ${res.accounts}. A cohort must equal the sum of the ` +
      `books loaded that day, exactly.`;
  }
  return res;
}

function main() {
  if (!target) {
    console.error('usage: node scripts/repair_calllog.mjs <file.csv|dir> [--expect-accounts N] [--json]');
    process.exit(1);
  }
  const files = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter((f) => f.endsWith('.csv')).map((f) => path.join(target, f)).sort()
    : [target];

  const results = files.map(repair);
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: results.every((r) => r.ok), results }));
  } else {
    for (const r of results) {
      const tag = r.ok ? (r.repaired ? 'REPAIRED' : 'clean') : 'FAILED';
      console.log(`  ${tag.padEnd(9)} ${r.file}`);
      console.log(`            ${r.rows?.toLocaleString()} rows · ${r.accounts?.toLocaleString() ?? '?'} accounts · ` +
                  `${r.columnsBefore}${r.repaired ? `→${r.columnsAfter}` : ''} cols · ` +
                  `lead ${r.leadDates?.join(',') ?? '?'} · calls ${r.callRange ?? '?'}`);
      for (const n of r.notes) console.log(`            · ${n}`);
      if (r.error) console.log(`            ✘ ${r.error}`);
    }
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main();
