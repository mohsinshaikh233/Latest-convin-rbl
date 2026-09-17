import { gunzipSync } from 'node:zlib';
import { statusDateOf, planDays, sliceCallLog, shortDate } from '../src/lib/bulk.mjs';
import { parseStatusDate } from '../scripts/pipeline/dates.mjs';
import { uploadDays, uploadFiles } from '../src/lib/upload_client.mjs';
import { bySlot } from '../src/lib/dayunion.mjs';

let checks = 0; let failures = 0;
const ok = (label, cond, detail = '') => {
  checks += 1;
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
};
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
const throwsWith = async (label, fn, re) => {
  try { await fn(); ok(label, false, 'did not throw'); } catch (e) { ok(label, re.test(String(e.message || e)), `threw: ${e.message}`); }
};

console.log('\n── the date in the name ──\n');

eq('RBL\'s own form',                      statusDateOf('Status File 05 July_26.xlsx'), '2026-07-05');
eq('the Bucket form',                      statusDateOf("Bucket Status 17 Aug'26.xlsx"), '2026-08-17');
eq('an ISO date is accepted too',          statusDateOf('prex-status_2026-08-17.xlsx'), '2026-08-17');
eq('an impossible ISO month is refused',   statusDateOf('status_2026-13-17.xlsx'), null);
eq('no date is null, never a guess',       statusDateOf('status.xlsx'), null);
eq('the pipeline reads the same parser',   parseStatusDate('Status File 05 July_26.xlsx'), statusDateOf('Status File 05 July_26.xlsx'));
eq('shortDate for the screen',             shortDate('2026-08-05'), '5 Aug 2026');

console.log('\n── the plan: which file is which day ──\n');

{
  const files = [
    { name: 'Status File 10 July_26.xlsx', date: '2026-07-10' },
    { name: 'Status File 08 July_26.xlsx', date: '2026-07-08' },
    { name: 'Status File 09 July_26.xlsx', date: '2026-07-09' },
  ];
  const { days, problems } = planDays(files, 1);
  eq('days follow the date, not the drop order', days.map((d) => d.day), [1, 2, 3]);
  eq('…with the earliest snapshot as Day 1', days.map((d) => d.date), ['2026-07-08', '2026-07-09', '2026-07-10']);
  eq('no problems on a clean batch', problems, []);
}
{
  const { days } = planDays([{ name: 'a 08 Jul 26.xlsx', date: '2026-07-08' }, { name: 'b 09 Jul 26.xlsx', date: '2026-07-09' }], 3);
  eq('a batch can start at Day 3 (Days 1–2 already uploaded)', days.map((d) => d.day), [3, 4]);
}
{
  const { days, problems } = planDays([{ name: 'b 09 Jul 26.xlsx', date: '2026-07-09' }, { name: 'nodate.xlsx', date: null }], 1);
  eq('an undated file sorts last', days.map((d) => d.name), ['b 09 Jul 26.xlsx', 'nodate.xlsx']);
  ok('…and is a problem, with the file named', problems.length === 1 && /"nodate.xlsx" has no date/.test(problems[0]), problems.join(' | '));
}
{
  const { problems } = planDays([
    { name: "Prex Status 17 Aug'26.xlsx", date: '2026-08-17' },
    { name: "Bucket Status 17 Aug'26.xlsx", date: '2026-08-17' },
  ], 1);
  ok('two files on one date is a problem (a PreX and a Bucket file for the same day)', problems.length === 1 && /2 status files are dated 17 Aug 2026/.test(problems[0]), problems.join(' | '));
}
{
  const { problems } = planDays([{ name: 'nodate.xlsx', date: null }], 1);
  eq('ONE undated file is fine — the single-day upload never needed a date', problems, []);
}
{
  const { problems } = planDays([{ name: 'a', date: '2026-07-08' }, { name: 'b', date: '2026-07-09' }], '0');
  ok('a first day below 1 is a problem', problems.some((p) => /first day must be a whole number/.test(p)), problems.join(' | '));
  const { days } = planDays([{ name: 'a', date: '2026-07-08' }, { name: 'b', date: '2026-07-09' }], '2');
  eq('the first day arrives as a string from an <input> and is still a number', days.map((d) => d.day), [2, 3]);
}

console.log('\n── the cut: Day N keeps the calls through Day N ──\n');

const H = ['External ID', 'Attempt Number', 'Call Timestamp', 'Call Answered Timestamp', 'Call Duration (Seconds)', 'Call Status', 'Sense Disposition L1', 'Sense Disposition L2', 'From Phone Num'];
const call = (acct, n, ts, answered = '') => [`${acct}_04072026`, String(n), ts, answered, answered ? '60' : '', answered ? 'answered' : 'no answer', '', '', '9100006392'];
const LOG = [
  H,
  call('0007470810015105461', 1, '2026-07-05 09:10:00'),
  call('0007470810015105461', 2, '2026-07-05 23:59:59', '2026-07-05 23:59:59'),
  call('0007470810015105461', 3, '2026-07-06 00:00:01'),
  call('0007470810015105462', 1, '2026-07-06 12:00:00', '2026-07-06 12:00:00'),
  call('0007470810015105462', 2, '2026-07-07 12:00:00'),
  call('0007470810015105463', 1, '07/07/2026 15:00', '07/07/2026 15:00'),
  call('0007470810015105463', 2, '2026-07-09 15:00:00'),
  call('0007470810015105464', 1, 'not a date'),
];

{
  const d1 = sliceCallLog(LOG, '2026-07-05');
  eq('Day 1 keeps both calls on 5 July, including 23:59:59', d1.kept, 2);
  eq('…and the header', d1.rows[0], H);
  eq('…drops the calls after it', d1.dropped, 5);
  eq('…and counts, never places, the undated one', d1.undated, 1);
  eq('…knows where the log starts and ends', [d1.firstInLog, d1.lastInLog], ['2026-07-05', '2026-07-09']);

  const d2 = sliceCallLog(LOG, '2026-07-06');
  eq('Day 2 is cumulative — it contains Day 1', d2.kept, 4);
  ok('…and every Day 1 row is in Day 2', d1.rows.slice(1).every((r) => d2.rows.includes(r)));

  const d3 = sliceCallLog(LOG, '2026-07-07');
  eq('Day 3 reads a D/M/Y timestamp correctly', d3.kept, 6);
  eq('a call after the last day is cut from every day', d3.dropped, 1);

  const all = sliceCallLog(LOG, '2026-07-09');
  eq('cut at the last call date = the whole dated log', all.kept, LOG.length - 1 - 1);
  eq('…with nothing dropped', all.dropped, 0);
}
{
  const noTs = [['External ID', 'Attempt Number', 'Call Answered Timestamp'], ['1_04072026', '1', '']];
  await throwsWith('a log with no Call Timestamp column cannot be cut, and says so', () => sliceCallLog(noTs, '2026-07-05'), /no "Call Timestamp" column/);
  await throwsWith('a cutoff that is not a date is refused', () => sliceCallLog(LOG, '5 July'), /not a date/);
}

console.log('\n── uploadDays(): what the server actually receives ──\n');

const csv = (rows) => rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n') + '\n';
const file = (name, rows) => new File([csv(rows)], name, { type: 'text/csv' });

const ACCTS = ['0007470810015105461', '0007470810015105462', '0007470810015105463', '0007470810015105464'];
const CYC = file('CYC 14 PDD+1 Convin.csv', [
  ['Account No', 'Customer Name', 'Total Outstanding', 'Curr Bal Band', 'Region', 'Bill Cycle'],
  ...ACCTS.map((a, i) => [a, `Person ${i + 1}`, String(10000 * (i + 1)), '5K-15K', 'North', '14']),
]);

const statusFile = (name, resolved) => file(name, [['account_no', 'status'], ...ACCTS.map((a) => [a, resolved.includes(a) ? 'Resolved' : 'Unresolved'])]);
const S1 = statusFile('Status File 05 July_26.csv', []);
const S2 = statusFile('Status File 06 July_26.csv', [ACCTS[0]]);
const S3 = statusFile('Status File 07 July_26.csv', [ACCTS[0], ACCTS[2]]);
const CALLS = file('lead-2026-07-04_calls-to-2026-07-09.csv', LOG);

function fakeServer({ failOn = () => false } = {}) {
  const posts = [];
  globalThis.fetch = async (url, { body, headers }) => {
    const raw = headers['x-gzip'] === '1' ? gunzipSync(Buffer.from(body)).toString('utf8') : String(body);
    const payload = JSON.parse(raw);
    posts.push({ url, ...payload });
    if (failOn(payload, posts)) return { ok: false, status: 500, json: async () => ({ error: 'the database went away' }) };
    const batchId = payload.batchId || `${payload.reportDate}__u${payload.slot}`;
    const reply = payload.phase === 'begin' ? { ok: true, batchId }
      : payload.phase === 'chunk' ? { ok: true, received: payload.rows.length }
        : { ok: true, batchId, rowCount: posts.filter((p) => p.phase === 'chunk' && p.batchId === batchId).reduce((n, p) => n + p.rows.length, 0) };
    return { ok: true, status: 200, json: async () => reply };
  };
  return posts;
}
const dayOf = (statusFileObj, slot, cutoff) => ({ slot, file: statusFileObj, cutoff });

{
  const posts = fakeServer();
  const notes = [];
  const res = await uploadDays(
    { cyc: CYC, callLog: CALLS, extras: [] },
    [dayOf(S1, 1, '2026-07-05'), dayOf(S2, 2, '2026-07-06'), dayOf(S3, 3, '2026-07-07')],
    { reportDate: '2026-07-04' },
    (p) => notes.push(p),
  );

  eq('three days built', res.built, 3);
  eq('every day carries the whole book', res.days.map((d) => d.rowCount), [4, 4, 4]);
  eq('batch ids are the slots under the report date', res.days.map((d) => d.batchId), ['2026-07-04__u1', '2026-07-04__u2', '2026-07-04__u3']);

  const seq = posts.map((p) => `${p.phase}:${(p.batchId || `${p.reportDate}__u${p.slot}`).split('__u')[1]}`);
  eq('days go up one at a time, ascending', seq, ['begin:1', 'chunk:1', 'commit:1', 'begin:2', 'chunk:2', 'commit:2', 'begin:3', 'chunk:3', 'commit:3']);
  ok('every post went to the chunk route', posts.every((p) => p.url === '/convin/api/ingest/chunk'));

  const rowsOf = (slot) => posts.find((p) => p.phase === 'chunk' && p.batchId === `2026-07-04__u${slot}`).rows;
  const acct = (slot, a) => rowsOf(slot).find((r) => r.account_no === a);
  eq('Day 1: …461 has its 2 calls through 5 July', acct(1, ACCTS[0]).ai_attempts, 2);
  eq('Day 2: …461 has all 3 (cumulative)', acct(2, ACCTS[0]).ai_attempts, 3);
  eq('Day 1: …462 was not yet called', acct(1, ACCTS[1]).ai_attempts, 0);
  eq('Day 2: …462 has 1 call', acct(2, ACCTS[1]).ai_attempts, 1);
  eq('Day 3: …462 has 2 calls', acct(3, ACCTS[1]).ai_attempts, 2);
  eq('Day 3: …463\'s 9 July call is beyond every day', acct(3, ACCTS[2]).ai_attempts, 1);
  eq('the undated call lands on no day', [1, 2, 3].map((s) => acct(s, ACCTS[3]).ai_attempts), [0, 0, 0]);

  eq('Day 1: nothing resolved yet', rowsOf(1).filter((r) => r.status === 'Resolved').length, 0);
  eq('Day 2: one resolved', rowsOf(2).filter((r) => r.status === 'Resolved').length, 1);
  eq('Day 3: two resolved', rowsOf(3).filter((r) => r.status === 'Resolved').length, 2);

  const logSource = (slot) => posts.find((p) => p.phase === 'commit' && p.batchId === `2026-07-04__u${slot}`).sources.find((s) => s.detected === 'calllog');
  eq('Day 1\'s commit records the cut', logSource(1).through, '2026-07-05');
  eq('Day 3\'s commit records its cut', logSource(3).through, '2026-07-07');
  eq('…and the rows that survived it', [logSource(1).rows, logSource(3).rows], [2, 6]);
  eq('the CYC is the primary on every day', [1, 2, 3].map((s) => posts.find((p) => p.phase === 'commit' && p.batchId === `2026-07-04__u${s}`).filename), Array(3).fill('CYC 14 PDD+1 Convin.csv'));

  eq('per-day call stats carry the cut', res.days.map((d) => d.callStats.through), ['2026-07-05', '2026-07-06', '2026-07-07']);
  eq('per-day attempts through the cut', res.days.map((d) => d.callStats.attempts), [2, 4, 6]);
  ok('the tail beyond the last day is reported once', res.warnings.filter((w) => /runs to 9 Jul 2026, after the last day \(Day 3, 7 Jul 2026\)\. 1 call attempt placed after/.test(w)).length === 1, res.warnings.join(' | '));
  ok('the undated attempt is reported once', res.warnings.filter((w) => /1 call attempt has no readable Call Timestamp/.test(w)).length === 1, res.warnings.join(' | '));
  ok('progress reached 100', notes[notes.length - 1].pct === 100 && notes.every((n) => n.pct === undefined || (n.pct >= 0 && n.pct <= 100)));
  ok('progress names the day it is on', notes.some((n) => /^Day 2 \(2 of 3\)/.test(n.note)), notes.map((n) => n.note).join(' | '));
  ok('progress never goes backwards', notes.filter((n) => n.pct !== undefined).every((n, i, a) => i === 0 || n.pct >= a[i - 1].pct), notes.map((n) => n.pct).join(','));
}

{
  const posts = fakeServer();
  const WRONG = file('Status File 06 July_26.csv', [['account_no', 'status'], ['999999', 'Resolved']]);
  await throwsWith('a status file that joins to nothing stops the batch, naming the day',
    () => uploadDays({ cyc: CYC, callLog: CALLS }, [dayOf(S1, 1, '2026-07-05'), dayOf(WRONG, 2, '2026-07-06')], { reportDate: '2026-07-04' }),
    /^Nothing was uploaded\. Day 2 \("Status File 06 July_26\.csv"\): .*did not match a single account/);
  eq('…and the server received NOTHING — not even Day 1', posts.length, 0);
}
{
  const posts = fakeServer();
  await throwsWith('a day dated before calling began is a date problem, not a file problem',
    () => uploadDays({ cyc: CYC, callLog: CALLS }, [dayOf(S1, 1, '2026-07-01'), dayOf(S2, 2, '2026-07-06')], { reportDate: '2026-07-04' }),
    /Day 1 .*not one call .* on or before 1 Jul 2026 — the log starts on 5 Jul 2026/);
  eq('…nothing sent', posts.length, 0);
}
{
  const posts = fakeServer();
  await throwsWith('the call log in the CYC slot is refused', () => uploadDays({ cyc: CALLS, callLog: null }, [dayOf(S1, 1, '2026-07-05'), dayOf(S2, 2, '2026-07-06')], { reportDate: '2026-07-04' }), /is the AI call log, not the CYC/);
  await throwsWith('a status file in the CYC slot is refused', () => uploadDays({ cyc: S1, callLog: null }, [dayOf(S2, 1, '2026-07-06'), dayOf(S3, 2, '2026-07-07')], { reportDate: '2026-07-04' }), /looks like a status file/);
  await throwsWith('the CYC in a day slot is refused', () => uploadDays({ cyc: CYC, callLog: null }, [dayOf(S1, 1, '2026-07-05'), dayOf(CYC, 2, '2026-07-06')], { reportDate: '2026-07-04' }), /Day 2: .* is a CYC \/ PDD book/);
  await throwsWith('a status file where the call log should be is refused', () => uploadDays({ cyc: CYC, callLog: S3 }, [dayOf(S1, 1, '2026-07-05'), dayOf(S2, 2, '2026-07-06')], { reportDate: '2026-07-04' }), /does not look like the AI call log/);
  await throwsWith('a day with no date is refused', () => uploadDays({ cyc: CYC, callLog: CALLS }, [dayOf(S1, 1, '2026-07-05'), dayOf(S2, 2, null)], { reportDate: '2026-07-04' }), /Day 2 .* has no date/);
  await throwsWith('descending days are refused', () => uploadDays({ cyc: CYC, callLog: CALLS }, [dayOf(S2, 2, '2026-07-06'), dayOf(S1, 1, '2026-07-05')], { reportDate: '2026-07-04' }), /ascending order/);
  await throwsWith('one day is not a batch', () => uploadDays({ cyc: CYC, callLog: CALLS }, [dayOf(S1, 1, '2026-07-05')], { reportDate: '2026-07-04' }), /at least two/);
  eq('none of those reached the server', posts.length, 0);
}

{
  const posts = fakeServer({ failOn: (p) => p.phase === 'commit' && p.batchId === '2026-07-04__u2' });
  await throwsWith('a failure on Day 2 names Day 1 as built and Day 3 as not started',
    () => uploadDays({ cyc: CYC, callLog: CALLS }, [dayOf(S1, 1, '2026-07-05'), dayOf(S2, 2, '2026-07-06'), dayOf(S3, 3, '2026-07-07')], { reportDate: '2026-07-04' }),
    /^Day 1 was built\. Day 2 failed while sending: the database went away Day 3 was not started\. Re-upload from Day 2/);
  eq('Day 1 committed, Day 2 tried twice (one retry), Day 3 never began',
    posts.filter((p) => p.phase === 'commit').map((p) => p.batchId), ['2026-07-04__u1', '2026-07-04__u2', '2026-07-04__u2']);
  ok('no post for Day 3', !posts.some((p) => (p.batchId || '').endsWith('__u3') || p.slot === 3));
}

{
  const posts = fakeServer();
  const res = await uploadDays({ cyc: CYC, callLog: null }, [dayOf(S1, 1, '2026-07-05'), dayOf(S2, 2, '2026-07-06')], { reportDate: '2026-07-04' });
  eq('two days, no call log', res.built, 2);
  eq('…no call stats', res.days.map((d) => d.callStats), [null, null]);
  eq('…no warnings about a log that was never given', res.warnings, []);
  ok('…rows carry zero attempts, not undefined', posts.find((p) => p.phase === 'chunk').rows.every((r) => r.ai_attempts === 0));
}

console.log('\n── uploadFiles(): the single-day path, exactly as before ──\n');
{
  const posts = fakeServer();
  const res = await uploadFiles([CYC, S1, CALLS], { reportDate: '2026-07-04', slot: 1 });
  eq('one day, one batch', res.batchId, '2026-07-04__u1');
  eq('begin / chunk / commit', posts.map((p) => p.phase), ['begin', 'chunk', 'commit']);
  const row = posts[1].rows.find((r) => r.account_no === ACCTS[0]);
  eq('the whole log is used — NOT cut — on a single day', row.ai_attempts, 3);
  eq('…so …463\'s 9 July call counts', posts[1].rows.find((r) => r.account_no === ACCTS[2]).ai_attempts, 2);
  eq('…and the undated attempt still counts, as it always has', posts[1].rows.find((r) => r.account_no === ACCTS[3]).ai_attempts, 1);
  ok('no "through" on an uncut log', !posts[2].sources.find((s) => s.detected === 'calllog').through);
  eq('callStats shape is unchanged', Object.keys(res.callStats).sort(), ['attempts', 'connected', 'dates', 'file', 'logAccounts', 'matched', 'maxAttempt', 'notCalled', 'notInBook', 'voicemail']);
}

console.log('\n── day order is numeric ──\n');
{
  const ids = ['2026-07-04__u10', '2026-07-04__u2', '2026-07-04__u1', '2026-07-04__u9'];
  eq('ids sort by slot, not as strings', [...ids].sort(bySlot), ['2026-07-04__u1', '2026-07-04__u2', '2026-07-04__u9', '2026-07-04__u10']);
  eq('…and so do the local batch files', ['d__u10.canon.json', 'd__u2.canon.json'].sort(bySlot), ['d__u2.canon.json', 'd__u10.canon.json']);
  eq('string order was the defect', [...ids].sort((a, b) => a.localeCompare(b))[1], '2026-07-04__u10');
  eq('anything without a slot keeps string order', ['b', 'a', 'x__u2', 'x__u1'].sort(bySlot), ['a', 'b', 'x__u1', 'x__u2']);
  eq('a Day Total id is not a slot', ['d__u3', 'd__daytotal'].sort(bySlot), ['d__daytotal', 'd__u3']);
}

console.log(`\n${checks} checks, ${failures} failures\n`);
process.exit(failures ? 1 : 0);
