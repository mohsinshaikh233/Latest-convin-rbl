import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const MONTH = '2099-09';
const STATE = path.join(REPO, 'state', `${MONTH}.json`);
const RAW = path.join(REPO, '.pipeline-data', 'raw', MONTH);
const ASSEMBLED = path.join(REPO, '.pipeline-data', 'assembled', MONTH);

let checks = 0, failures = 0;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) { console.log(`  ok   ${label}`); return true; }
  failures++;
  console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  return false;
};
const eq = (label, got, want) => ok(`${label}`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} · want ${JSON.stringify(want)}`);

const S = '2099-09-05';
const day = (n) => `2099-09-${String(5 + n).padStart(2, '0')}`;

const LONG = { book: 'LONG PDD+1', days: 5, accounts: ['70100200301', '70100200302'] };
const SHORT = { book: 'SHORT PDD+4', days: 3, accounts: ['70100900801', '70100900802'] };
const COHORT_KEY = `prex|${S}`;

const CALLLOG_HEAD = ['To Phone Num', 'Call Attempt ID', 'Call Direction', 'From Phone Num', 'Campaign Name',
  'Campaign ID', 'Campaign Start Date', 'External ID', 'Lead ID', 'Lead Name', 'Lead Link',
  'Lead Creation Timestamp', 'Call Status', 'Telephony Disposition', 'Sense Disposition L1',
  'Sense Disposition L2', 'Sense Disposition L3', 'Sense Disposition Reason', 'Call Timestamp',
  'Call Answered Timestamp', 'Call End Timestamp', 'Call Duration (Seconds)', 'Call Pulse Unit',
  'Call Pulse Count', 'Attempt Number', 'Disconnect Reason Key', 'Call Disconnected By',
  'Hangup Cause', 'DND Identifier', 'Recording URL', 'Agent Name'];

const IDX = Object.fromEntries(CALLLOG_HEAD.map((h, i) => [h, i]));
const callRow = (acct, attempt, isoDay) => {
  const r = new Array(CALLLOG_HEAD.length).fill('');
  r[IDX['External ID']] = `${acct}_05092099`;
  r[IDX['Attempt Number']] = String(attempt);
  r[IDX['Call Timestamp']] = `${isoDay} 10:00:00`;
  r[IDX['Call Answered Timestamp']] = `${isoDay} 10:00:05`;
  r[IDX['Call Duration (Seconds)']] = '30';
  r[IDX['Call Status']] = 'answered';
  r[IDX['Sense Disposition L1']] = 'CONNECTED';
  r[IDX['From Phone Num']] = '+915000000001';
  return r;
};

function writeBook(dir, name, accounts) {
  const aoa = [['Account No', 'Customer Name', 'Total Outstanding', 'Due date'],
    ...accounts.map((a, i) => [a, `Placeholder ${i}`, 1000 + i, '05-09-2099'])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  const p = path.join(dir, `${name}.xlsx`);
  XLSX.writeFile(wb, p);
  return p;
}

function writeStatus(dir, label, isoDate, accounts) {
  const aoa = [['account_no', 'status'], ...accounts.map((a) => [a, 'Resolved'])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  const p = path.join(dir, `${label} Status ${isoDate.slice(-2)} Sep_99.xlsx`);
  XLSX.writeFile(wb, p);
  return p;
}

function buildFixture({ shortLastDay }) {
  fs.rmSync(RAW, { recursive: true, force: true });
  fs.rmSync(ASSEMBLED, { recursive: true, force: true });
  fs.rmSync(STATE, { force: true });
  const bookDir = path.join(RAW, 'books');
  const statusDir = path.join(RAW, 'status');
  const logDir = path.join(RAW, 'calllogs');
  for (const d of [bookDir, statusDir, logDir]) fs.mkdirSync(d, { recursive: true });

  const books = {};
  for (const b of [LONG, SHORT]) {
    books[b.book] = { file: `${b.book}.xlsx`, path: writeBook(bookDir, b.book, b.accounts), loadDate: S };
  }

  const statusFiles = [];
  for (let n = 1; n <= Math.max(LONG.days, SHORT.days); n++) {
    statusFiles.push({ file: path.basename(writeStatus(statusDir, 'PreX', day(n), [...LONG.accounts, ...SHORT.accounts])), path: path.join(statusDir, `PreX Status ${day(n).slice(-2)} Sep_99.xlsx`), loadDate: day(n) });
  }

  const rows = [CALLLOG_HEAD];
  for (const a of LONG.accounts) for (let n = 1; n <= LONG.days; n++) rows.push(callRow(a, n, day(n)));
  for (const a of SHORT.accounts) for (let n = 1; n <= shortLastDay; n++) rows.push(callRow(a, n, day(n)));
  const csv = rows.map((r) => r.join(',')).join('\n');
  const logPath = path.join(logDir, `${COHORT_KEY.replace('|', '__')}.csv`);
  fs.writeFileSync(logPath, `${csv}\n`);

  const mkDayFolders = (n) => Array.from({ length: n }, (_, i) => ({ day: i + 1, date: day(i + 1) }));
  const planBooks = [LONG, SHORT].map((b) => ({
    book: b.book, campaign: 'prex', loadDate: S, days: b.days, dayFolders: mkDayFolders(b.days),
  }));

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({
    month: MONTH,
    stages: {
      '01': { books, statusFiles },
      '02': { plan: { books: planBooks, cohorts: [{ campaign: 'prex', startDate: S, endDate: day(5), books: [LONG.book, SHORT.book] }], totals: {}, warnings: [] } },
      '04': { collected: { [COHORT_KEY]: { path: logPath, repairedOk: true } } },
    },
  }, null, 1));
}

function stage(extraArgs = []) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(REPO, 'scripts/pipeline/run.mjs'),
      '--stage', '05', '--month', MONTH, '--json', ...extraArgs], { cwd: REPO, env: { ...process.env } });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => {
      let json = null;
      for (const l of out.trim().split('\n').reverse()) { try { json = JSON.parse(l); break; } catch {  } }
      resolve({ code, json, stderr: err });
    });
  });
}

console.log('\n══ STAGE 05 · DAY-COUNT DRIFT IN A SHARED COHORT ══');

console.log('\n── a cohort holding a 5-day book and a 3-day book ──\n');
{
  buildFixture({ shortLastDay: SHORT.days });
  const r = await stage();
  eq('both books assemble', r.json?.booksBuilt, 2);
  eq('no gaps', r.json?.booksGapped, 0);
  ok('the 3-day book is NOT flagged for the 5-day book\'s calls',
    (r.json?.driftFindings ?? []).length === 0,
    JSON.stringify(r.json?.driftFindings ?? []).slice(0, 400));
  eq('so the stage completes', r.code, 0);
}

console.log('\n── the short book\'s OWN accounts called past its final day ──\n');
{
  buildFixture({ shortLastDay: 5 });
  const r = await stage();
  const drift = r.json?.driftFindings ?? [];
  eq('genuine drift is still caught', drift.length, 1);
  eq('and it names the right book', drift[0]?.book, SHORT.book);
  ok('measured on the book\'s own last call', String(drift[0]?.actualLastCall ?? '').startsWith(day(5)),
    `actualLastCall ${drift[0]?.actualLastCall}`);
  eq('and it stops for a person', r.code, 10);
  ok('the reason says which verbs answer it', /accept-drift/.test(r.json?.reason ?? ''), r.json?.reason);
}

console.log('\n── accept-drift ──\n');
{
  const bad = await stage(['--apply-rulings', JSON.stringify([{ book: SHORT.book, ruling: 'accept-drift' }])]);
  eq('a drift ruling with no reason is rejected', bad.code, 2);
  ok('and says why', /reason is required/.test(JSON.stringify(bad.json ?? {})), JSON.stringify(bad.json ?? {}).slice(0, 300));

  const wrongVerb = await stage(['--apply-rulings', JSON.stringify([{ book: SHORT.book, ruling: 'build-partial', reason: 'x' }])]);
  eq('a GAP verb does not answer a DRIFT finding', wrongVerb.code, 2);
  ok('and says which verbs would', /accept-drift/.test(JSON.stringify(wrongVerb.json ?? {})),
    JSON.stringify(wrongVerb.json ?? {}).slice(0, 300));

  const good = await stage(['--apply-rulings', JSON.stringify([{ book: SHORT.book, ruling: 'accept-drift', reason: 'RBL extended this cycle to 5 days from Sept — confirmed with ops 2099-09-11' }]),
    '--decided-by', 'stress_assemble']);
  eq('a reasoned accept-drift lets the month complete', good.code, 0);
  const ruled = good.json?.ruledDrift ?? [];
  eq('the finding stays on the record', ruled.length, 1);
  eq('with the verb', ruled[0]?.ruling, 'accept-drift');
  ok('the reason', /extended this cycle/.test(ruled[0]?.reason ?? ''), JSON.stringify(ruled[0] ?? {}).slice(0, 300));
  ok('and who decided it', ruled[0]?.decidedBy === 'stress_assemble', JSON.stringify(ruled[0]?.decidedBy));
  ok('drift is not silently erased — it is still reported', (good.json?.driftFindings ?? []).length === 1,
    JSON.stringify(good.json?.driftFindings ?? []).slice(0, 200));
}

console.log('\n── the console card and the exit code must agree ──\n');
{
  const { DECISIONS } = await import('../src/lib/console/runner.mjs');
  const itemsOf = (result) => DECISIONS['05'].items(result);

  buildFixture({ shortLastDay: 5 });
  const blocked = await stage();
  eq('a month with unruled drift stops', blocked.code, 10);
  const asked = itemsOf(blocked.json);
  const gating = (blocked.json?.unresolvedGaps ?? []).length + (blocked.json?.unresolvedDrift ?? []).length;
  eq('the card asks about exactly what gates the exit code', asked.length, gating);
  eq('which here is the one drifting book', asked.length, 1);

  const ruled = await stage(['--apply-rulings', JSON.stringify([{ book: SHORT.book, ruling: 'accept-drift', reason: 'window confirmed extended with ops' }])]);
  eq('a ruled month completes', ruled.code, 0);
  ok('the finding is still on the record', (ruled.json?.driftFindings ?? []).length === 1,
    JSON.stringify(ruled.json?.driftFindings ?? []).slice(0, 200));
  eq('but the card asks about nothing', itemsOf(ruled.json).length, 0);
  eq('matching the exit code, which is no longer blocked',
    (ruled.json?.unresolvedGaps ?? []).length + (ruled.json?.unresolvedDrift ?? []).length, 0);
  ok('reading driftFindings instead would have re-asked a settled question',
    (ruled.json?.driftFindings ?? []).length === 1 && itemsOf(ruled.json).length === 0);
}

console.log('\n── the ruling vocabulary has a single definition ──\n');
{
  const stageMod = await import('../scripts/pipeline/05_assemble.mjs');
  const runnerMod = await import('../src/lib/console/runner.mjs');
  eq('the console exports the stage\'s list, not a copy', runnerMod.RULINGS, stageMod.RULINGS);
  ok('accept-drift is in it', stageMod.RULINGS.includes('accept-drift'), stageMod.RULINGS.join(', '));

  eq('a drift item allows accept-drift', stageMod.rulingsForItem({ lastExpected: '2099-09-08' }), stageMod.DRIFT_RULINGS);
  eq('a gap item does not', stageMod.rulingsForItem({ reason: 'missing status file' }), stageMod.GAP_RULINGS);
  ok('and the two sets differ', String(stageMod.GAP_RULINGS) !== String(stageMod.DRIFT_RULINGS));
}

fs.rmSync(RAW, { recursive: true, force: true });
fs.rmSync(ASSEMBLED, { recursive: true, force: true });
fs.rmSync(STATE, { force: true });

console.log(`\n${checks} checks · ${failures} failure(s)\n`);
process.exit(failures ? 1 : 0);
