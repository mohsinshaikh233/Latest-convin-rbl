import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const MONTH = flag('month', '2099-08');
const FROM = flag('from', '01');
const STOP = flag('stop', '07');

const SCRATCH_DATE = flag('scratch-date', '2099-08-01');
const FIXTURE = path.join(ROOT, '.pipeline-data', 'fixture-august');
const CONVIN_OUT = path.join(ROOT, '.pipeline-data', 'fake-convin');

const S3_PORT = 4598, CONVIN_PORT = 4599;

const IMAP_PORT = 14993;
const BUCKET = 'rbl-collections';
const PREX_ID = 'prex-campaign', BUCKET_ID = 'bucket-campaign';

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
  return ok;
};
const ta = (label, cond, detail = '') => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}${cond ? '' : `\n        ${detail}`}`);
  cond ? pass++ : fail++;
  return cond;
};
const say = (...a) => console.log(...a);

const baseEnv = () => ({
  ...process.env,
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`,
  S3_REGION: 'ap-south-1',
  S3_ACCESS_KEY_ID: 'fixture',
  S3_SECRET_ACCESS_KEY: 'fixture',
  S3_BUCKET: BUCKET,
  S3_PREFIX_BOOKS: 'books/',
  S3_PREFIX_STATUS: 'status/',
  S3_PREFIX_ARCHIVE: '',
  CONVIN_API_BASE: `http://127.0.0.1:${CONVIN_PORT}`,
  CONVIN_TENANT: 'rbl',
  CONVIN_TOKEN: 'fixture-token',
  CONVIN_CAMPAIGN_PREX: PREX_ID,
  CONVIN_CAMPAIGN_BUCKET: BUCKET_ID,
  IMAP_HOST: '127.0.0.1',
  IMAP_PORT: String(IMAP_PORT),
  IMAP_USER: 'ops@example.com',
  IMAP_PASSWORD: 'not-a-real-password',
  PIPELINE_SCRATCH_DATE: SCRATCH_DATE,
});

function stage(args, { env = {}, quiet = true } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/pipeline/run.mjs'), ...args], {
      cwd: ROOT, env: { ...baseEnv(), ...env },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; if (!quiet) process.stderr.write(d); });
    child.on('close', (code) => {
      let json = null;
      for (const line of out.trim().split('\n').reverse()) {
        try { json = JSON.parse(line); break; } catch {  }
      }
      resolve({ code, json, stderr: err, stdout: out });
    });
  });
}

const get = (port, p) => fetch(`http://127.0.0.1:${port}${p}`).then((r) => r.json());

async function main() {
  if (!fs.existsSync(path.join(FIXTURE, 'manifest.json'))) {
    console.error(`no fixture at ${FIXTURE} — run: node evals/fixtures/august_month.mjs --seed ~/Downloads/RBL`);
    process.exit(1);
  }

  const CAMPAIGNS = path.join(ROOT, 'state', 'campaigns.json');
  const campaignsBefore = fs.existsSync(CAMPAIGNS) ? fs.readFileSync(CAMPAIGNS) : null;
  const restoreCampaigns = () => {
    if (campaignsBefore !== null) fs.writeFileSync(CAMPAIGNS, campaignsBefore);
    else fs.rmSync(CAMPAIGNS, { force: true });
  };
  process.on('exit', restoreCampaigns);

  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'manifest.json'), 'utf8'));
  say(`\nMonth at scale — ${manifest.totals.books} books · ${manifest.totals.cohorts} cohorts · ${manifest.totals.accounts} accounts`);
  say(`  ${manifest.real.statusFiles} real status files · ${manifest.synthetic.statusFiles} SYNTHESISED`);
  say(`  month ${MONTH} · stages ${FROM}→${STOP}\n`);

  for (const [name, port] of [['S3', S3_PORT], ['Convin', CONVIN_PORT]]) {
    const busy = await fetch(`http://127.0.0.1:${port}/__state`).then(() => true).catch(() => false);
    if (busy) {
      console.error(`[month] port ${port} is already serving — a fake ${name} from an earlier run is still up.`);
      console.error(`[month] kill it first:  pkill -f 'evals/fakes/'`);
      process.exit(1);
    }
  }

  const s3 = spawn(process.execPath, [path.join(ROOT, 'evals/fakes/s3.mjs'),
    '--port', String(S3_PORT), '--seed', FIXTURE, '--bucket', BUCKET,
    '--dates', path.join(FIXTURE, 's3-dates.json'), '--modes', 'paginate'], { cwd: ROOT });
  const convin = spawn(process.execPath, [path.join(ROOT, 'evals/fakes/convin.mjs'),
    '--port', String(CONVIN_PORT), '--out', CONVIN_OUT,
    '--modes', 'tenant-lock,dup-columns,id-shapes'], { cwd: ROOT, env: baseEnv() });
  const s3Log = [], convinLog = [];
  s3.stderr.on('data', (d) => s3Log.push(String(d)));
  convin.stderr.on('data', (d) => convinLog.push(String(d)));
  const cleanup = () => { try { s3.kill(); } catch {} try { convin.kill(); } catch {} };
  process.on('exit', cleanup);

  for (const [name, child, logbuf] of [['S3', s3, s3Log], ['Convin', convin, convinLog]]) {
    child.on('error', (e) => { console.error(`[month] fake ${name} failed to start: ${e.message}`); cleanup(); process.exit(1); });
    child.on('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL') return;
      console.error(`[month] fake ${name} exited ${code ?? signal} mid-run. Its last output:`);
      console.error(logbuf.join('').split('\n').slice(-12).join('\n'));
      cleanup();
      process.exit(1);
    });
  }

  await new Promise((r) => setTimeout(r, 1200));
  const s3state = await get(S3_PORT, '/__state').catch(() => null);
  ta('fake S3 is serving the fixture', s3state?.objects === 36 + 30, `objects=${s3state?.objects}`);

  const results = { cohorts: [], stages: {} };

  if (FROM <= '01') {
    say('01 fetch — from the fake bucket, 66 objects at page size 5');
    const r = await stage(['--stage', '01', '--month', MONTH, '--json']);
    results.stages['01'] = r;
    t('  stage 01 exits 0', r.code, 0);
    const lists = (await get(S3_PORT, '/__state')).lists;
    ta('  the ContinuationToken loop actually ran', lists.filter((l) => l.truncated).length > 0,
      `${lists.length} LIST call(s), none truncated`);
    ta('  every book arrived', (r.json?.books ?? 0) === 36, `books=${r.json?.books}`);
    ta('  every status file arrived', (r.json?.statusFiles ?? 0) === 30, `statusFiles=${r.json?.statusFiles}`);
  }

  if (FROM <= '02') {
    say('\n02 plan — 36 books, campaigns inferred from names');
    const r = await stage(['--stage', '02', '--month', MONTH, '--json', '--confirm-inferred']);
    results.stages['02'] = r;
    t('  stage 02 exits 0 once the inference is confirmed', r.code, 0);
    t('  it plans exactly 19 cohorts', r.json?.cohorts, 19);
    t('  covering all 36 books', r.json?.totals?.books, 36);
  }

  const listed = await stage(['--stage', '03', '--month', MONTH, '--json', '--list-cohorts']);
  const cohorts = listed.json?.cohorts ?? [];
  ta(`  --list-cohorts reports all 19`, cohorts.length === 19, `got ${cohorts.length}`);

  fs.writeFileSync(path.join(ROOT, '.pipeline-data', 'month_at_scale_cohorts.json'), JSON.stringify(cohorts, null, 2));

  const byDate = new Map();
  for (const c of cohorts) {
    const key = typeof c === 'string' ? c : c.key;
    const [camp, date] = key.split('|');
    byDate.set(date, (byDate.get(date) ?? []).concat(camp));
  }
  const shared = [...byDate.entries()].filter(([, v]) => v.length > 1).map(([d]) => d);
  ta(`  six load dates carry both campaigns (${shared.join(', ')})`, shared.length === 6, `shared=${shared.length}`);

  const EXPORTS = path.join(CONVIN_OUT, 'exports');
  const seen = { exports: new Set(), rowsPerCohort: {} };
  if (FROM <= '03' && STOP >= '03') {
    say(`\n03 export + 04 collect — ${cohorts.length} cohorts, sequentially`);
    const { start: startImap, message } = await import('./fakes/imap.mjs');

    for (let i = 0; i < cohorts.length; i++) {
      const c = cohorts[i];
      const key = typeof c === 'string' ? c : c.key;
      const [camp, startDate] = key.split('|');
      const endDate = (typeof c === 'object' && c.endDate) || null;
      const campaignId = camp === 'prex' ? PREX_ID : BUCKET_ID;

      const r3 = await stage(['--stage', '03', '--month', MONTH, '--json', '--cohort', key]);
      if (r3.code !== 0) { ta(`  ${key} · stage 03`, false, `exit ${r3.code}: ${(r3.json?.reason ?? r3.stderr.slice(-400))}`); continue; }

      const csvPath = path.join(EXPORTS, `${campaignId}__${startDate}.csv`);
      if (!fs.existsSync(csvPath)) { ta(`  ${key} · export written`, false, `no ${path.basename(csvPath)}`); continue; }
      const csv = fs.readFileSync(csvPath, 'utf8');
      const rows = csv.trim().split('\n').length - 1;
      seen.exports.add(path.basename(csvPath));
      seen.rowsPerCohort[key] = rows;

      const port = IMAP_PORT + i;
      const subject = `Your AI Call Log export ${startDate} to ${endDate ?? startDate} is ready`;
      const imap = await startImap({ port, messages: [message({ subject, csv })] });

      const r4 = await stage(['--stage', '04', '--month', MONTH, '--json', '--cohort', key], { env: { IMAP_PORT: String(port) } });
      await imap.close();

      const okc = r4.code === 0;
      say(`  ${okc ? 'ok  ' : 'FAIL'} ${key.padEnd(22)} ${String(rows).padStart(6)} rows → ${okc ? `collected ${r4.json?.repair?.rows ?? r4.json?.rows ?? path.basename(r4.json?.path ?? '?')}` : `exit ${r4.code}: ${r4.json?.reason ?? r4.stderr.slice(-300)}`}`);
      okc ? pass++ : fail++;
      results.cohorts.push({ key, rows, collected: r4.json?.rows ?? null, code: r4.code });
    }

    ta(`  all ${cohorts.length} cohorts collected`, results.cohorts.filter((c) => c.code === 0).length === cohorts.length,
      `${results.cohorts.filter((c) => c.code === 0).length}/${cohorts.length}`);
    ta('  every cohort got its OWN export file', seen.exports.size === cohorts.length, `${seen.exports.size} distinct export file(s) for ${cohorts.length} cohorts`);

    const cst = await get(CONVIN_PORT, '/__state');
    ta('  the tenant lock was taken and released, never overlapped', (cst.maxConcurrent ?? 1) <= 1, `maxConcurrent=${cst.maxConcurrent}`);
    say(`  Convin saw ${cst.requests?.length ?? 0} trigger request(s)`);
  }

  if (FROM <= '05' && STOP >= '05') {
    say('\n05 assemble — 36 books against 30 status files');
    const r = await stage(['--stage', '05', '--month', MONTH, '--json'], { quiet: false });
    results.stages['05'] = r;
    t('  stage 05 exits 0', r.code, 0);
    ta('  all 36 books assembled', r.json?.booksBuilt === 36, `booksBuilt=${JSON.stringify(r.json?.booksBuilt)}`);

    ta('  no day-count drift once measured per book', (r.json?.driftFindings ?? []).length === 0,
      JSON.stringify(r.json?.driftFindings ?? []).slice(0, 300));
    if (r.json?.gaps?.length) say(`  gaps: ${JSON.stringify(r.json.gaps)}`);
  }

  if (FROM <= '06' && STOP >= '06') {
    say('\n06 build — 36 reports (this is the slow one)');
    const t0 = Date.now();
    const r = await stage(['--stage', '06', '--month', MONTH, '--json'], { quiet: false });
    results.stages['06'] = r;
    t('  stage 06 exits 0', r.code, 0);
    say(`  took ${Math.round((Date.now() - t0) / 1000)}s`);
  }

  if (FROM <= '07' && STOP >= '07') {
    say('\n07 verify');
    const r = await stage(['--stage', '07', '--month', MONTH, '--json'], { quiet: false });
    results.stages['07'] = r;
    t('  stage 07 exits 0', r.code, 0);
    ta('  every check passes', r.json?.ok === true, JSON.stringify(r.json?.summary ?? r.json).slice(0, 400));

    ta('  no cohort over-claims attempts (guard #4)', (r.json?.overCounts ?? []).length === 0,
      JSON.stringify(r.json?.overCounts ?? []).slice(0, 300));
    ta('  and all 36 books were checked', r.json?.booksChecked === 36, `booksChecked=${r.json?.booksChecked}`);
  }

  fs.writeFileSync(path.join(ROOT, '.pipeline-data', `month_at_scale_${MONTH}.json`),
    JSON.stringify({ month: MONTH, cohorts: results.cohorts, rowsPerCohort: seen.rowsPerCohort }, null, 2));

  say(`\n${pass} passed · ${fail} failed`);
  console.log(JSON.stringify({ ok: fail === 0, pass, fail, cohorts: cohorts.length }));
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
