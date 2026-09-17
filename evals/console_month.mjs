import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MONTH = '2099-08';
const FIXTURE = path.join(ROOT, '.pipeline-data', 'fixture-august');
const CONVIN_OUT = path.join(ROOT, '.pipeline-data', 'fake-convin');
const S3_PORT = 4598, CONVIN_PORT = 4599, IMAP_PORT = 14993;
const BUCKET = 'rbl-collections';
const PREX_ID = 'prex-campaign', BUCKET_ID = 'bucket-campaign';

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? '✔' : '✘'} ${label.padEnd(56)} ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
};
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${cond ? '' : `\n      ${detail}`}`);
  cond ? pass++ : fail++;
};

Object.assign(process.env, {
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`, S3_REGION: 'ap-south-1',
  S3_ACCESS_KEY_ID: 'fixture', S3_SECRET_ACCESS_KEY: 'fixture', S3_BUCKET: BUCKET,
  S3_PREFIX_BOOKS: 'books/', S3_PREFIX_STATUS: 'status/', S3_PREFIX_ARCHIVE: '',
  CONVIN_API_BASE: `http://127.0.0.1:${CONVIN_PORT}`, CONVIN_TENANT: 'rbl',
  CONVIN_TOKEN: 'fixture-token', CONVIN_CAMPAIGN_PREX: PREX_ID, CONVIN_CAMPAIGN_BUCKET: BUCKET_ID,
  IMAP_HOST: '127.0.0.1', IMAP_PORT: String(IMAP_PORT),
  IMAP_USER: 'ops@example.com', IMAP_PASSWORD: 'not-a-real-password',
});

const { startRun, subscribe, getRun, abortRun, submitDecision } = await import('../src/lib/console/runner.mjs');
const { start: startImap, message } = await import('./fakes/imap.mjs');

const CAMPAIGNS = path.join(ROOT, 'state', 'campaigns.json');
const campaignsBefore = fs.existsSync(CAMPAIGNS) ? fs.readFileSync(CAMPAIGNS) : null;
process.on('exit', () => {
  if (campaignsBefore !== null) fs.writeFileSync(CAMPAIGNS, campaignsBefore);
  else fs.rmSync(CAMPAIGNS, { force: true });
});

const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'manifest.json'), 'utf8'));

console.log('\n══ THE CONSOLE, DRIVEN THROUGH A WHOLE MONTH ══');
console.log(`   ${manifest.totals.books} books · ${manifest.totals.cohorts} cohorts · ${manifest.totals.accounts} accounts\n`);

for (const [name, port] of [['S3', S3_PORT], ['Convin', CONVIN_PORT]]) {
  if (await fetch(`http://127.0.0.1:${port}/__state`).then(() => true).catch(() => false)) {
    console.error(`port ${port} is already serving — a fake ${name} is still up. pkill -f 'evals/fakes/'`);
    process.exit(1);
  }
}
const s3 = spawn(process.execPath, [path.join(ROOT, 'evals/fakes/s3.mjs'), '--port', String(S3_PORT),
  '--seed', FIXTURE, '--bucket', BUCKET, '--dates', path.join(FIXTURE, 's3-dates.json'), '--modes', 'paginate'], { cwd: ROOT });
const convin = spawn(process.execPath, [path.join(ROOT, 'evals/fakes/convin.mjs'), '--port', String(CONVIN_PORT),
  '--out', CONVIN_OUT, '--modes', 'tenant-lock,dup-columns,id-shapes'], { cwd: ROOT, env: process.env });
s3.stderr.resume(); convin.stderr.resume();
await new Promise((r) => setTimeout(r, 1200));

const msgs = [];
for (const c of manifest.cohorts) {
  const campaignId = c.campaign === 'prex' ? PREX_ID : BUCKET_ID;
  const p = path.join(CONVIN_OUT, 'exports', `${campaignId}__${c.startDate}.csv`);
  if (!fs.existsSync(p)) { console.error(`missing export ${path.basename(p)} — run: node evals/month_at_scale.mjs --month ${MONTH} --stop 04`); process.exit(1); }

  const label = c.campaign === 'prex' ? 'PreX' : 'Bucket';
  msgs.push({ campaign: c.campaign, m: message({
    subject: `Your ${label} AI Call Log export ${c.startDate} to ${c.endDate} is ready`,
    csv: fs.readFileSync(p, 'utf8'),
    date: new Date(`${c.startDate}T10:00:00Z`),
  }) });
}
const imap = await startImap({ port: IMAP_PORT, messages: msgs.map((x) => x.m) });
console.log(`   fakes up · mailbox holds ${msgs.length} cohort notifications\n`);

const cleanup = async () => { try { s3.kill(); } catch {} try { convin.kill(); } catch {} try { await imap.close(); } catch {} };

process.on('uncaughtException', async (e) => {
  console.error(`\n[console_month] ${e.message}`);
  await cleanup();
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/pipeline/run.mjs'),
      '--stage', 'lock', '--month', MONTH, '--release', '--force', '--json'], { cwd: ROOT, stdio: 'ignore' });
    console.error(`[console_month] released the ${MONTH} scratch lock`);
  } catch {  }
  process.exit(1);
});

for (const d of ['raw', 'assembled', 'reports']) fs.rmSync(path.join(ROOT, '.pipeline-data', d, MONTH), { recursive: true, force: true });
fs.rmSync(path.join(ROOT, 'state', `${MONTH}.json`), { force: true });

const terminal = (s) => ['done', 'dry-run-complete', 'failed', 'aborted', 'awaiting-decision'].includes(s);

function answerFor(pending) {
  const items = pending?.items ?? [];
  if (pending.kind === 'assignments') {
    return items.map((i) => ({ book: i.book, campaign: i.inference ?? 'prex', ...(i.needs === 'days' ? { days: i.days ?? 5 } : {}) }));
  }
  if (pending.kind === 'rulings') {
    return items.map((i) => ({ book: i.book, ruling: i.lastExpected ? 'accept-drift' : 'build-partial' }));
  }
  return [];
}

async function drive(label, opts, { answer = true, maxAnswers = 6 } = {}) {
  const events = [];
  const run = await startRun(opts);
  const unsub = subscribe(run.runId, (ev) => events.push(ev));
  const t0 = Date.now();
  const answered = [];

  for (let round = 0; round <= maxAnswers; round++) {
    while (!terminal(getRun(run.runId)?.status ?? 'running')) await new Promise((r) => setTimeout(r, 500));
    const cur = getRun(run.runId);
    if (cur.status !== 'awaiting-decision' || !answer) break;
    const pending = cur.pending;
    const entries = answerFor(pending);
    console.log(`   ${label}: answering stage ${pending.stage} (${pending.kind}) for ${pending.items?.length ?? 0} book(s)`);
    const res = await submitDecision(run.runId, {
      entries,
      reason: `month-scale fixture: accepting the pipeline's own reading for ${entries.length} book(s)`,
      by: 'month-scale-eval',
    });
    answered.push({ stage: pending.stage, kind: pending.kind, items: pending.items?.length ?? 0, ok: res?.ok !== false, error: res?.error ?? null });
    if (res?.ok === false) { console.log(`   ${label}: decision REJECTED — ${res.error}`); break; }
    await new Promise((r) => setTimeout(r, 500));
  }

  unsub();
  const final = getRun(run.runId);
  console.log(`   ${label}: ${final.status} in ${Math.round((Date.now() - t0) / 1000)}s · ${events.length} events · ${answered.length} decision(s) answered`);
  return { run: final, events, answered };
}

console.log('── the dry run the console insists on ──\n');
const dry = await drive('dry run', { month: MONTH, mode: 'live', startedBy: 'month-scale-eval' });
ok('the dry run answered every form it was shown', dry.answered.every((a) => a.ok),
  JSON.stringify(dry.answered));
ok('a LIVE month is forced through a dry run first', dry.run.dryRun === true, `dryRun=${dry.run.dryRun}`);
t('and it reaches a terminal state', terminal(dry.run.status), true);

console.log('\n── the real thing ──\n');
const live = await drive('live run', { month: MONTH, mode: 'live', startedBy: 'month-scale-eval', dryRun: false });

console.log('\n── the event stream ──\n');
{
  const seqs = live.events.map((e) => e.seq);
  const gaps = [];
  for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1) gaps.push([seqs[i - 1], seqs[i]]);
  const markers = live.events.filter((e) => e.marker);
  console.log(`   ${live.events.length} events, seq ${seqs[0]}..${seqs.at(-1)}`);
  ok('the sequence is gapless — no event was silently dropped',
    gaps.length === markers.length,
    `${gaps.length} gap(s) ${JSON.stringify(gaps.slice(0, 4))} against ${markers.length} labelled drop(s)`);
  ok('seq is strictly increasing', seqs.every((s, i) => i === 0 || s > seqs[i - 1]), 'a client cannot dedupe otherwise');
  if (markers.length) console.log(`   cap marker: ${markers[0].line}`);

  const perType = {};
  for (const e of live.events) perType[e.type] = (perType[e.type] ?? 0) + 1;
  console.log(`   by type: ${Object.entries(perType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(' · ')}`);

  const booksEv = live.events.filter((e) => e.type === 'books').pop();
  const cohortsEv = live.events.filter((e) => e.type === 'cohort:list').pop();

  t('the graph is handed 36 book nodes', booksEv?.books?.length ?? null, 36);
  t('and 19 cohort nodes', cohortsEv?.cohorts?.length ?? null, 19);

  const done = live.events.filter((e) => e.type === 'cohort:done');
  t('every cohort reported done', new Set(done.map((e) => e.key)).size, 19);

  const metrics = live.run.metrics ?? {};
  t('the metric strip reports 36 built', metrics.built, 36);
  t('and 47,050 accounts', metrics.accounts, 47050);

  t('and attempts equal to the source rows, not a multiple of them', metrics.attempts, 117488);
  ok('stage 07 verified the month', metrics.verified === true, JSON.stringify(metrics));
}

console.log('\n── the month lock ──\n');
if (live.run.status === 'awaiting-decision') {
  ok('a parked run keeps the month lock', !live.run.lock?.released, JSON.stringify(live.run.lock));
} else {
  ok('the lock is released when the run ends', live.run.lock?.released === true, JSON.stringify(live.run.lock));
}
t('the month ran to completion', live.run.status, 'done');
ok('and the run reached a terminal status', terminal(live.run.status), `status=${live.run.status}`);
console.log(`   final status: ${live.run.status}${live.run.error ? ` — ${live.run.error.reason}` : ''}`);

if (live.run.status === 'awaiting-decision') {
  console.log('\n── standing the parked run down ──\n');
  abortRun(live.run.runId, 'month-scale-eval');
  const until = Date.now() + 30_000;
  while (Date.now() < until && !['aborted', 'failed', 'done'].includes(getRun(live.run.runId)?.status)) {
    await new Promise((r) => setTimeout(r, 250));
  }
  const after = getRun(live.run.runId);
  ok('aborting a parked run releases the month lock', after?.lock?.released === true,
    `status=${after?.status} lock=${JSON.stringify(after?.lock)}`);
}

await cleanup();
console.log(`\n${fail === 0 ? '✔' : '✘'} ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
