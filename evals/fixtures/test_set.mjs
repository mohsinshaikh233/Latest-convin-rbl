import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const expand = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(p));

const OUT = expand(flag('out', '~/Downloads/RBL Test Set'));
const N = Number(flag('accounts', 240));
const LOAD = flag('load', '2026-09-08');
const CYCLE = Number(LOAD.slice(-2));
const BOOK = `CYC ${String(CYCLE).padStart(2, '0')} Test`;
const DAYS = 5;

let seed = 0x9e3779b9;
const rnd = () => { seed ^= seed << 13; seed |= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0; return ((seed >>> 0) % 1e6) / 1e6; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const ddmmyyyy = (isoDate) => `${isoDate.slice(8, 10)}${isoDate.slice(5, 7)}${isoDate.slice(0, 4)}`;

const serial = (isoDate) => Math.round((new Date(`${isoDate}T00:00:00Z`).getTime() - Date.UTC(1899, 11, 30)) / 86400000);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const accounts = [];
const seen = new Set();
while (accounts.length < N) {
  const a = '000' + String(between(10_000_000_000, 99_999_999_999));
  if (!seen.has(a)) { seen.add(a); accounts.push(a); }
}

const FIRST = ['Aarav', 'Vihaan', 'Diya', 'Ananya', 'Rohan', 'Priya', 'Kabir', 'Meera', 'Arjun', 'Isha', 'Dev', 'Nisha', 'Rahul', 'Sneha', 'Karan', 'Pooja'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Singh', 'Iyer', 'Nair', 'Reddy', 'Mehta', 'Joshi', 'Kulkarni', 'Das', 'Bose', 'Khan', 'Gupta', 'Rao', 'Menon'];
const CITY = [['MUMBAI', 'West'], ['DELHI', 'North'], ['BENGALURU', 'South'], ['CHENNAI', 'South'], ['KOLKATA', 'East'], ['PUNE', 'West'], ['HYDERABAD', 'South'], ['JAIPUR', 'North'], ['LUCKNOW', 'North'], ['AHMEDABAD', 'West']];
const SEGMENT = ['AI+Agency', 'AI Only', 'AI+Agency', 'AI+Agency'];

const CYC_HEADER = ['Account No#', 'Bucket', 'Bill Cycle', 'Agency', 'Total Outstanding', 'Principle Balance', 'Total Accounts with customer', 'Account Open Date', 'Minimum Amount Due', 'Past Due Amount - (Stab for B-1)', 'Due date', 'Last Payment Date', 'Last Payment Amount', 'Stab Amount -D30 (Stab for B-2)', 'Stab Amount -D60(Stab for B-3)', 'Months on Book', 'Card Number (Last 4 digits)', 'Title', 'Customer Name', 'GENDER', 'Age', 'Residence City', 'Region', 'Residence Contact', 'Mobile Number -1', 'Mobile Number -2', 'alternate_no1', 'alternate_no2', 'alternate_no3', 'Permanent Contact Number', 'Employer Contact no', 'CIBIL Score Band', 'calling expiry date', 'SEGMENT', 'Contacted_L3M_Flag'];

const book = [CYC_HEADER];
const profile = new Map();
for (const a of accounts) {
  const outstanding = Math.round((between(8_000, 250_000) + rnd()) * 100) / 100;
  const mad = Math.round(outstanding * (0.05 + rnd() * 0.12) * 100) / 100;
  const gender = rnd() < 0.62 ? 'M' : 'F';
  const name = `${pick(FIRST)} ${pick(LAST)}`.toUpperCase();
  const [city, region] = pick(CITY);
  const mobile = 9_000_000_000 + between(0, 999_999_999);
  const opened = addDays(LOAD, -between(200, 2400));
  const lastPay = addDays(LOAD, -between(3, 40));
  profile.set(a, { outstanding, mad, mobile, name });
  book.push([
    a, 1, CYCLE, 'Convin', outstanding, 0, `RBL${between(100_000, 999_999)}`, serial(opened), mad,
    Math.round(mad * 0.5 * 100) / 100, serial(LOAD), serial(lastPay), pick([500, 1000, 2000, 2500, 0]),
    0, 0, between(6, 84), `xx${String(between(1000, 9999))}`, gender === 'M' ? 'MR.' : 'MS.', name, gender,
    between(23, 61), city, region, '', mobile, '', '', '', '', '', '', pick(['', '', 'A', 'B', 'C']),
    serial(addDays(LOAD, 16)), pick(SEGMENT), rnd() < 0.3 ? 'Yes' : 'No',
  ]);
}

const fate = new Map();
for (const a of accounts) {
  const u = rnd();
  const outcome = u < 0.86 ? 'Unresolved' : u < 0.94 ? 'Normalisation' : u < 0.99 ? 'STAB' : 'RB';
  fate.set(a, { outcome, settleDay: between(1, DAYS) });
}
const statusFiles = [];
for (let n = 1; n <= DAYS; n++) {
  const day = addDays(LOAD, n);
  const rows = [['account_no', 'status']];
  for (const a of accounts) {
    const f = fate.get(a);
    rows.push([a, f.outcome !== 'Unresolved' && n >= f.settleDay ? f.outcome : 'Unresolved']);
  }

  const name = `Bucket Status ${Number(day.slice(8, 10))} ${MON[Number(day.slice(5, 7)) - 1]}_${day.slice(2, 4)}.xlsx`;
  statusFiles.push({ name, rows, day });
}

const LOG_HEADER = ['To Phone Num', 'Call Attempt ID', 'Call Direction', 'From Phone Num', 'Campaign Name', 'Campaign ID', 'Campaign Created Date', 'External ID', 'Lead ID', 'Lead Name', 'Lead Link', 'Lead Creation Timestamp', 'Call Status', 'Telephony Disposition', 'Sense Disposition L1', 'Sense Disposition L2', 'Sense Disposition L3', 'Sense Disposition Reason', 'Call Timestamp', 'Call Answered Timestamp', 'Call End Timestamp', 'Call Duration (Seconds)', 'Call Pulse Unit', 'Call Pulse Count', 'Attempt Number', 'Disconnect Reason Key', 'Call Disconnected By', 'DND Identifier', 'Tool Executions', 'Tool Execution Success', 'Tool Execution Failures'];

const CAMPAIGN_ID = 'test-0000-0000-0000-000000000001';
const CAMPAIGN_NAME = `Collections- ${MON[Number(LOAD.slice(5, 7)) - 1]} Bucket (TEST)`;
const L1 = ['Promise to Pay', 'Already Paid', 'Dispute', 'Callback Requested', 'Financial Difficulty', 'Wrong Number'];
const L2 = { 'Promise to Pay': 'Will pay this week', 'Already Paid': 'Paid via app', 'Dispute': 'Amount disputed', 'Callback Requested': 'Call later', 'Financial Difficulty': 'Job loss', 'Wrong Number': 'Not the customer' };

const uuid = () => [8, 4, 4, 4, 12].map((len) => Array.from({ length: len }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('')).join('-');
const ts = (isoDate, h, m, s) => `${isoDate} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const CALL_DAYS = Array.from({ length: DAYS }, (_, i) => addDays(LOAD, i));
const log = [LOG_HEADER];
let attemptsTotal = 0, connectedTotal = 0;
accounts.forEach((a, i) => {
  const p = profile.get(a);
  const leadId = uuid();
  const n = between(1, 6);
  const created = ts(LOAD, 9, between(0, 59), between(0, 59));
  for (let k = 1; k <= n; k++) {
    const day = CALL_DAYS[Math.min(DAYS - 1, Math.floor(((k - 1) / n) * DAYS + rnd() * 0.6))];
    const h = between(9, 18), m = between(0, 59), s = between(0, 59);
    const answered = rnd() < 0.4;
    const dur = answered ? between(12, 240) : 0;
    const placed = ts(day, h, m, s);
    const ans = answered ? ts(day, h, m, Math.min(59, s + between(3, 8))) : '';
    const end = answered ? ts(day, h, m + Math.floor((s + dur) / 60), (s + dur) % 60) : ts(day, h, m, Math.min(59, s + between(15, 30)));
    const l1 = answered ? pick(L1) : '';
    attemptsTotal++; if (answered) connectedTotal++;
    log.push([
      `+91${p.mobile}`, uuid(), 'Outbound', '+918000000001', CAMPAIGN_NAME, CAMPAIGN_ID, created,
      `${a}_${ddmmyyyy(LOAD)}`, leadId, p.name.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' '),
      `https://example.invalid/tenant/test/campaigns/${CAMPAIGN_ID}/leads/${leadId}`, created,
      answered ? 'answered' : 'no_answer', answered ? 'ANSWERED' : 'NO_ANSWER',
      l1, answered ? L2[l1] : '', '', answered ? 'test' : '',
      placed, ans, end, dur, 60, answered ? Math.ceil(dur / 60) : 0, k,
      answered ? 'normal_clearing' : 'no_answer', answered ? pick(['customer', 'system']) : 'system', 'N', 0, 0, 0,
    ]);
  }
});

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['Calling File', 'Status Files', 'Call Logs']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const wbBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbBook, XLSX.utils.aoa_to_sheet(book), 'Sheet1');
XLSX.writeFile(wbBook, path.join(OUT, 'Calling File', `${BOOK}.xlsx`));

for (const s of statusFiles) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), 'Sheet1');
  XLSX.writeFile(wb, path.join(OUT, 'Status Files', s.name));
}

const logName = `bucket__${LOAD}.csv`;
fs.writeFileSync(path.join(OUT, 'Call Logs', logName), `${log.map((r) => r.map(csvCell).join(',')).join('\n')}\n`);

fs.writeFileSync(path.join(OUT, 'loaddates.json'), `${JSON.stringify({
  _why: 'The load date S for this book, stated rather than guessed. Without it stage 01 falls back to the file mtime, which is when this set was generated, not when the book was "loaded".',
  _synthetic: 'Every account, name, phone and balance in this set is invented. Only the column shapes are real.',
  [`${BOOK}.xlsx`]: LOAD,
}, null, 2)}\n`);

const settled = accounts.filter((a) => fate.get(a).outcome !== 'Unresolved').length;
fs.writeFileSync(path.join(OUT, 'README.md'), `# RBL Test Set — SYNTHETIC

Every account, name, phone number and balance here is invented. None of it is,
or was derived from, real customer data. What is real is the SHAPE — the exact
column headers, the file naming, the External ID format and the day arithmetic
— so the platform treats this exactly as it would a real month.

| | |
|---|---|
| Book | \`Calling File/${BOOK}.xlsx\` — ${N} accounts, the 35-column Bucket header |
| Load date | **${LOAD}** (in \`loaddates.json\`) — Bucket, so cycle day ${CYCLE} |
| Status | ${DAYS} files, ${addDays(LOAD, 1)} → ${addDays(LOAD, DAYS)}, Bucket vocabulary |
| Call log | \`Call Logs/${logName}\` — ${attemptsTotal} attempts, ${connectedTotal} answered, calling ${CALL_DAYS[0]} → ${CALL_DAYS[DAYS - 1]} |
| Settles | ${settled} of ${N} accounts leave Unresolved by day ${DAYS} |

**Expected figures** (what a correct run should report on the final day):

- accounts **${N}**
- call attempts **${attemptsTotal}**
- connected **${connectedTotal}**
- resolved (non-Unresolved on ${addDays(LOAD, DAYS)}) **${settled}**

## Using it

**Console:** point the folder picker at this folder, REPLAY mode, month ${LOAD.slice(0, 7)}.
**Dashboard upload:** the three files go in the three slots — CYC, Status, AI Call Log.

Regenerate identically with:

    node evals/fixtures/test_set.mjs --out "${OUT}"
`);

console.error(`[test-set] ${BOOK} · ${N} accounts · ${statusFiles.length} status days · ${attemptsTotal} attempts (${connectedTotal} answered) · ${settled} settle`);
console.error(`[test-set] → ${OUT}`);
console.log(JSON.stringify({ ok: true, out: OUT, book: BOOK, load: LOAD, accounts: N, attempts: attemptsTotal, connected: connectedTotal, resolved: settled, statusDays: DAYS }));
