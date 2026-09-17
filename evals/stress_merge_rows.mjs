import fs from 'node:fs';
import path from 'node:path';
import { buildCanonicalRows } from '../src/lib/merge.mjs';
import { unionByAccount } from '../src/lib/dayunion.mjs';
import { autoMap, isResolved } from '../src/lib/normalize.mjs';
import { Aggregator } from '../src/lib/aggregate.mjs';

const STATUS_H = ['Account No', 'Status', 'Total AI Call Attempts', 'AI Connected Calls', 'AI Connected Seconds',
  'Qualification Status', 'CollectionsDisposition_v2 L1', 'Lead Entity Paid', 'Lead Entity Promise to Pay',
  'Lead Entity Refusal to pay'];
const PORT_H = ['Account No', 'Customer Name', 'total_outstanding', 'minimum_amount_due', 'Months on Book',
  'Curr Bal Band', 'Region', 'Primary State', 'Total Accounts with customer'];

const statusSheet = (accts) => [STATUS_H, ...accts.map((a) => [
  a.acct, a.status, a.att ?? 3, a.conn ?? 1, a.secs ?? 90, 'Qualified', 'Schedule Callback',
  a.paid ?? 'N/A', a.promise ?? 'N/A', 'N/A'])];
const portSheet = (accts) => [PORT_H, ...accts.map((a) => [
  a.acct, a.name ?? 'CUST', a.out ?? 50000, 5000, 24, '30-50K', 'South', 'Karnataka', 1])];

const mk = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const agg = (rows) => { const a = new Aggregator(); for (const r of rows) a.add(r); return a.payload('x'); };

const displayRow = (r) => [r.account_no, r.customer_name, r.status, r.disp_l1 || '—', r.region || '—',
  r.primary_state || '—', r.curr_bal_band, r.total_outstanding, isResolved(r) ? r.total_outstanding : 0,
  r.ai_attempts, r.ai_connected_calls, r.payment_mode || '—', r.promise_flag === 'YES' ? 'Yes' : '—',
  r.mobile || '—', r.lead_link || ''];

function explorerPage(all, { page = 0, size = 15, status = 'All', sort = 'Outstanding', dir = 'desc', q = '' }) {
  const I = { Status: 2, Region: 4, Band: 6, Disposition: 3, Outstanding: 7, Recovered: 8, Attempts: 9, Connected: 10 };
  const qq = q.trim().toLowerCase();
  let f = all.filter((row) => {
    if (status !== 'All' && row[2] !== status) return false;
    if (qq) { const hay = `${row[0]} ${row[1]} ${row[13]}`.toLowerCase(); if (!hay.includes(qq)) return false; }
    return true;
  });
  const si = I[sort] ?? 7; const d = dir === 'asc' ? 1 : -1;
  f = f.slice().sort((a, b) => (parseFloat(a[si]) - parseFloat(b[si])) * d);
  const lim = Math.min(100, Math.max(1, +size));
  return { total: f.length, rows: f.slice(page * lim, (page + 1) * lim), totalPages: Math.max(1, Math.ceil(f.length / lim)) };
}

let fails = 0, checks = 0;
const fail = (c, msg) => { fails++; console.log(`✘ ${c}\n    -> ${msg}`); };
const pass = (c) => console.log(`✔ ${c}`);
const check = (c, cond, msg) => { checks++; if (cond) return true; fail(c, msg); return false; };

console.log('══ THE MERGE ══\n');

{
  const c = 'clean two-sheet join (200 accounts, all match)';
  const A = mk(200, (i) => ({ acct: `A${i}`, status: i % 2 ? 'Resolved' : 'Unresolved', out: 10000 + i }));
  const { rows, stats, warnings } = buildCanonicalRows(statusSheet(A), [portSheet(A)], autoMap(STATUS_H));
  const expected = A.reduce((s, a) => s + a.out, 0);
  const got = rows.reduce((s, r) => s + r.total_outstanding, 0);
  let ok = check(c, rows.length === 200, `got ${rows.length} rows, expected 200`);
  ok = check(c, got === expected, `outstanding ${got} != ${expected}`) && ok;
  ok = check(c, stats.matched === 200, `matched ${stats.matched}/200`) && ok;
  ok = check(c, warnings.length === 0, `unexpected warnings: ${warnings}`) && ok;
  if (ok) pass(`${c}  [₹${got.toLocaleString('en-IN')} joined intact]`);
}

{
  const c = 'portfolio sheet is missing half the accounts — must be BLOCKED';
  const A = mk(200, (i) => ({ acct: `A${i}`, status: i % 2 ? 'Resolved' : 'Unresolved', out: 50000 }));
  const half = A.slice(0, 100);
  checks++;
  try {
    const { rows } = buildCanonicalRows(statusSheet(A), [portSheet(half)], autoMap(STATUS_H));
    const got = rows.reduce((s, r) => s + r.total_outstanding, 0);
    fail(c, `it loaded anyway and reported ₹${got.toLocaleString('en-IN')} instead of ₹${(200 * 50000).toLocaleString('en-IN')}`);
  } catch (e) {
    if (/stopped|understated/i.test(e.message)) pass(`${c}\n    "${e.message.slice(0, 130)}…"`);
    else fail(c, `blocked, but with an unhelpful message: ${e.message}`);
  }
}

{
  const c = 'blank Account No on some rows — drop them, keep the good ones, say so';
  const A = mk(200, (i) => ({ acct: i < 20 ? '' : `A${i}`, status: 'Resolved', out: 50000 }));
  const { rows, stats, warnings } = buildCanonicalRows(statusSheet(A), [portSheet(A)], autoMap(STATUS_H));
  checks += 2;
  const kept = check(c, rows.length === 180, `kept ${rows.length}, expected 180 good rows`);
  const told = check(c, stats.skippedNoAccount === 20 && warnings.some((w) => /Account No/i.test(w)),
    `dropped ${stats.skippedNoAccount ?? '?'} rows — reported? ${warnings.some((w) => /Account No/i.test(w))}`);
  if (kept && told) pass(`${c}  [180 kept, 20 skipped and reported]`);
}

{
  const c = 'duplicate accounts in the status sheet';
  const A = mk(200, (i) => ({ acct: `A${i % 100}`, status: 'Resolved', out: 50000 }));
  const { rows, warnings } = buildCanonicalRows(statusSheet(A), [portSheet(A)], autoMap(STATUS_H));
  const p = agg(rows);
  checks++;
  const uniq = new Set(rows.map((r) => r.account_no)).size;
  if (uniq !== rows.length && !warnings.some((w) => /duplicat/i.test(w))) {
    fail(c, `${rows.length} rows but only ${uniq} distinct accounts — the book double-counts to ₹${(p.agg.totals.sumOut / 1e5).toFixed(1)}L with no warning`);
  } else pass(c);
}

{
  const c = 'Excel-corrupted account numbers (7.4787E+15) — must be BLOCKED, not silently zeroed';
  const A = mk(200, (i) => ({ acct: i < 40 ? '7.4787E+15' : `A${i}`, status: 'Resolved', out: 50000 }));
  checks++;
  try {
    const { rows } = buildCanonicalRows(statusSheet(A), [portSheet(A)], autoMap(STATUS_H));
    const got = rows.reduce((s, r) => s + r.total_outstanding, 0);
    fail(c, `loaded anyway and reported ₹${got.toLocaleString('en-IN')} of ₹${(200 * 50000).toLocaleString('en-IN')}`);
  } catch (e) {
    if (/stopped|understated/i.test(e.message)) pass(`${c}\n    blocked, and told the user how to fix the export`);
    else fail(c, `blocked with an unhelpful message: ${e.message}`);
  }
}

{
  const c = 'corrupted account numbers in a MERGED sheet — still loads (nothing to lose)';
  const H = [...STATUS_H, 'total_outstanding', 'minimum_amount_due', 'Curr Bal Band'];
  const A = mk(200, (i) => [i < 40 ? '7.4787E+15' : `A${i}`, i % 2 ? 'Resolved' : 'Unresolved',
    3, 1, 90, 'Qualified', 'Schedule Callback', 'N/A', 'N/A', 'N/A', 50000, 5000, '30-50K']);
  checks++;
  try {
    const { rows } = buildCanonicalRows([H, ...A], [], autoMap(H));
    const got = rows.reduce((s, r) => s + r.total_outstanding, 0);
    if (got === 200 * 50000) pass(`${c}  [₹${got.toLocaleString('en-IN')} intact]`);
    else fail(c, `money lost: ₹${got.toLocaleString('en-IN')} of ₹${(200 * 50000).toLocaleString('en-IN')}`);
  } catch (e) { fail(c, `blocked unnecessarily: ${e.message}`); }
}

{
  const c = 'leading zeros stripped in one sheet only';
  const A = mk(100, (i) => ({ acct: `000${i + 1}`, status: 'Resolved', out: 50000 }));
  const B = A.map((a) => ({ ...a, acct: a.acct.replace(/^0+/, '') }));
  const { rows, stats } = buildCanonicalRows(statusSheet(A), [portSheet(B)], autoMap(STATUS_H));
  const got = rows.reduce((s, r) => s + r.total_outstanding, 0);
  checks++;
  if (got === 100 * 50000) pass(c + ' — matched across both forms');
  else fail(c, `only ₹${got.toLocaleString('en-IN')} of ₹${(100 * 50000).toLocaleString('en-IN')} joined (${stats.matched}/100 matched)`);
}

{
  const c = 'a lookup sheet that matches ZERO accounts is refused, not ignored';
  const A = mk(200, (i) => ({ acct: `A${i}`, status: 'Resolved', out: 50000 }));
  const junk = mk(6, (i) => ({ acct: `${8989 + i}`, status: '', out: 0 }));
  checks++;
  try {
    buildCanonicalRows(statusSheet(A), [portSheet(A), portSheet(junk)], autoMap(STATUS_H), ['portfolio.csv', 'lead_outcome.csv']);
    fail(c, 'the upload went through — a file that joined to nothing was silently dropped');
  } catch (e) {
    if (/did not match a single account/.test(e.message) && /lead_outcome\.csv/.test(e.message)) pass(c + ' — and it names the file');
    else fail(c, `threw, but not usefully: ${e.message}`);
  }
}

{
  const c = 'a partially-covering lookup sheet warns about its denominator';
  const A = mk(200, (i) => ({ acct: `A${i}`, status: 'Resolved', out: 50000 }));
  const half = A.slice(0, 80);
  const { rows, stats, warnings } = buildCanonicalRows(
    statusSheet(A), [portSheet(A), portSheet(half)], autoMap(STATUS_H), ['portfolio.csv', 'leads.csv'],
  );
  checks++;
  const warned = warnings.some((w) => /leads\.csv/.test(w) && /80 of 200/.test(w));
  const cov = (stats.sheetCoverage || []).find((x) => x.name === 'leads.csv');
  if (warned && cov && cov.matched === 80 && rows.length === 200) pass(c + ' — 80 of 200, and the money is untouched');
  else fail(c, `warnings=${JSON.stringify(warnings)} coverage=${JSON.stringify(stats.sheetCoverage)}`);
}

const WRECKED_H = ['account_number', 'External ID', 'Customer Name', 'total_outstanding',
  'minimum_amount_due', 'Months on Book', 'Curr Bal Band', 'Region', 'Primary State',
  'Total Accounts with customer'];

const excelWreck = (acct) => Number(String(acct).replace(/\D/g, '')).toExponential(5).toUpperCase();

const wreckedSheet = (accts, { lifeboat = true } = {}) => [WRECKED_H, ...accts.map((a) => [
  excelWreck(a.acct),
  lifeboat ? `${a.acct}_03072026#` : '',
  a.name ?? 'CUST', a.out ?? 50000, 5000, 24, '30-50K', 'South', 'Karnataka', 1])];

{
  const c = 'a corrupt Account No is recovered from External ID, not guessed';
  const A = mk(200, (i) => ({ acct: `000747600000000${1000 + i}`, status: 'Resolved', out: 50000 }));
  const { rows, stats, warnings } = buildCanonicalRows(
    statusSheet(A), [wreckedSheet(A)], autoMap([...STATUS_H, ...WRECKED_H]), ['leads.csv'],
  );
  checks++;
  const cov = (stats.sheetCoverage || []).find((x) => x.name === 'leads.csv');
  const money = rows.reduce((t, r) => t + r.total_outstanding, 0);
  const warned = warnings.some((w) => /corrupted by Excel/.test(w) && /External ID/.test(w));
  if (cov && cov.matched === 200 && money === 200 * 50000 && warned) {
    pass(`${c} — 200/200 joined, ₹${money.toLocaleString('en-IN')} intact, and the user is told`);
  } else {
    fail(c, `matched=${cov && cov.matched} money=${money} warned=${warned}`);
  }
}

{
  const c = 'a corrupt Account No with no lifeboat column is refused, never guessed';
  const A = mk(200, (i) => ({ acct: `000747600000000${1000 + i}`, status: 'Resolved', out: 50000 }));
  checks++;
  try {
    buildCanonicalRows(statusSheet(A), [wreckedSheet(A, { lifeboat: false })],
      autoMap([...STATUS_H, ...WRECKED_H]), ['leads.csv']);
    fail(c, 'it joined anyway — accounts were matched on a mangled key');
  } catch (e) {
    if (/did not match a single account|would report the wrong number/.test(e.message)) pass(`${c} — blocked`);
    else fail(c, `threw, but not usefully: ${e.message}`);
  }
}

console.log('\n══ THE DAY TOTAL ══\n');

{
  const c = 'the same book uploaded 3× does not multiply the money';
  const A = mk(500, (i) => ({ acct: `A${i}`, status: i % 4 === 0 ? 'Resolved' : 'Unresolved', out: 50000 }));
  const one = buildCanonicalRows(statusSheet(A), [portSheet(A)], autoMap(STATUS_H)).rows;
  const u = unionByAccount([one, one, one]);
  const single = agg(one).agg.totals;
  const day = agg(u.rows).agg.totals;
  checks++;
  const same = day.accounts === single.accounts
    && Math.abs(day.sumOut - single.sumOut) < 1
    && Math.abs(day.recovered - single.recovered) < 1;
  if (same && u.duplicates === 1000) {
    pass(`${c} — ${day.accounts} accounts, ₹${day.sumOut.toLocaleString('en-IN')}, identical to one upload`);
  } else {
    fail(c, `day=${day.accounts}/${day.sumOut} vs single=${single.accounts}/${single.sumOut}, dupes=${u.duplicates}`);
  }
}

{
  const c = 'two uploads covering DIFFERENT accounts still sum correctly';
  const A = mk(300, (i) => ({ acct: `A${i}`, status: 'Resolved', out: 50000 }));
  const B = mk(200, (i) => ({ acct: `B${i}`, status: 'Unresolved', out: 30000 }));
  const ra = buildCanonicalRows(statusSheet(A), [portSheet(A)], autoMap(STATUS_H)).rows;
  const rb = buildCanonicalRows(statusSheet(B), [portSheet(B)], autoMap(STATUS_H)).rows;
  const u = unionByAccount([ra, rb]);
  const day = agg(u.rows).agg.totals;
  checks++;
  const want = 300 * 50000 + 200 * 30000;
  if (day.accounts === 500 && Math.abs(day.sumOut - want) < 1 && u.duplicates === 0) {
    pass(`${c} — 500 accounts, ₹${want.toLocaleString('en-IN')}, nothing lost`);
  } else {
    fail(c, `${day.accounts} accounts / ₹${day.sumOut} (wanted 500 / ₹${want}), dupes=${u.duplicates}`);
  }
}

{
  const c = 'when uploads disagree about an account, the newest upload wins';
  const stale = buildCanonicalRows(
    statusSheet([{ acct: 'A1', status: 'Unresolved', out: 50000 }]),
    [portSheet([{ acct: 'A1', out: 50000 }])], autoMap(STATUS_H),
  ).rows;
  const fresh = buildCanonicalRows(
    statusSheet([{ acct: 'A1', status: 'Resolved', out: 50000 }]),
    [portSheet([{ acct: 'A1', out: 50000 }])], autoMap(STATUS_H),
  ).rows;
  const u = unionByAccount([stale, fresh]);
  checks++;
  const day = agg(u.rows).agg.totals;
  if (u.rows.length === 1 && day.resolved === 1 && day.recovered === 50000) {
    pass(`${c} — the account reads Resolved, from the second upload`);
  } else {
    fail(c, `${u.rows.length} row(s), resolved=${day.resolved}, recovered=${day.recovered}`);
  }
}

console.log('\n══ THE ACCOUNT EXPLORER ══\n');

{
  const A = mk(437, (i) => ({ acct: `A${i}`, status: i % 3 === 0 ? 'Resolved' : 'Unresolved', out: 10000 + i * 37 }));
  const { rows } = buildCanonicalRows(statusSheet(A), [portSheet(A)], autoMap(STATUS_H));
  const p = agg(rows);
  const table = rows.map(displayRow);

  const c1 = 'table row count == headline account count';
  check(c1, table.length === p.agg.totals.accounts, `${table.length} vs ${p.agg.totals.accounts}`) && pass(c1);

  const c2 = 'summing the Outstanding column == headline outstanding';
  const sumOut = table.reduce((s, r) => s + r[7], 0);
  check(c2, Math.abs(sumOut - p.agg.totals.sumOut) < 1, `table ₹${sumOut} vs KPI ₹${p.agg.totals.sumOut}`) && pass(c2);

  const c3 = 'summing the Recovered column == headline recovered';
  const sumRec = table.reduce((s, r) => s + r[8], 0);
  check(c3, Math.abs(sumRec - p.agg.totals.recovered) < 1, `table ₹${sumRec} vs KPI ₹${p.agg.totals.recovered}`) && pass(c3);

  const c4 = 'paging returns every row exactly once (no gaps, no duplicates)';
  const seen = new Set(); let dupes = 0;
  const first = explorerPage(table, { page: 0, size: 15 });
  for (let pg = 0; pg < first.totalPages; pg++) {
    for (const r of explorerPage(table, { page: pg, size: 15 }).rows) {
      if (seen.has(r[0])) dupes++;
      seen.add(r[0]);
    }
  }
  check(c4, seen.size === table.length && dupes === 0, `saw ${seen.size}/${table.length} rows, ${dupes} duplicated across pages`) && pass(c4);

  const c5 = 'filtering by Resolved returns exactly the resolved accounts';
  const res = explorerPage(table, { page: 0, size: 100, status: 'Resolved' });
  check(c5, res.total === p.agg.totals.resolved, `${res.total} vs ${p.agg.totals.resolved}`) && pass(c5);

  const c6 = 'sorting by a TEXT column does not scramble the table';
  const byStatus = explorerPage(table, { page: 0, size: 20, sort: 'Status' });
  const clean = byStatus.rows.length === 20 && byStatus.rows.every((r) => r[0]);
  check(c6, clean, 'sort by Status uses parseFloat on text -> NaN comparator -> arbitrary order') && pass(c6);

  const c7 = 'a page beyond the end returns nothing, not garbage';
  const beyond = explorerPage(table, { page: 9999, size: 15 });
  check(c7, beyond.rows.length === 0, `returned ${beyond.rows.length} rows past the end`) && pass(c7);

  const c8 = 'a negative page number does not wrap around to the last page';
  const neg = explorerPage(table, { page: -1, size: 15 });
  check(c8, neg.rows.length === 0, `page -1 returned ${neg.rows.length} rows (Array.slice with a negative index reads from the END of the table)`) && pass(c8);
}

console.log(`\n${'─'.repeat(72)}`);
console.log(`${checks} checks · ${fails} failure(s)`);
fs.writeFileSync(path.join(process.cwd(), 'evals', 'stress_merge_report.txt'), `${checks} checks, ${fails} failures\n`);
if (fails) process.exitCode = 1;
