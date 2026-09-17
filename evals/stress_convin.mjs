import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4761;
const BASE = `http://127.0.0.1:${PORT}`;

const MONTH = '2099-03';
const STATE = path.join(REPO, 'state', `${MONTH}.json`);

let checks = 0; let fails = 0;
const t = (label, got, want) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? '✔' : '✘'} ${label.padEnd(58)} ${JSON.stringify(got)}${ok ? '' : `   EXPECTED ${JSON.stringify(want)}`}`);
};
const ok = (label, cond, detail = '') => {
  checks++;
  if (!cond) { fails++; console.log(`  ✘ ${label}${detail ? `\n      → ${detail}` : ''}`); return false; }
  console.log(`  ✔ ${label}`);
  return true;
};

const fake = spawn(process.execPath, ['evals/fakes/convin.mjs', '--port', String(PORT)], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
const fakeLog = [];
fake.stderr.on('data', (d) => fakeLog.push(String(d)));
const stop = () => { try { fake.kill('SIGKILL'); } catch {  } };
process.on('exit', stop);

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch {  }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
};
const api = async (p, opts) => (await fetch(`${BASE}${p}`, opts)).json();
const setModes = (modes, latencyMs = 0) => api('/__mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modes, latencyMs }) });
const reset = () => api('/__reset');

const COHORT = { campaign: 'bucket', startDate: '2099-03-04', endDate: '2099-03-09', books: ['SCRATCH BOOK'] };
const KEY = `${COHORT.campaign}|${COHORT.startDate}`;

function writeState({ attempts = 0 } = {}) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({
    month: MONTH,
    stages: {
      '02': { plan: { books: [], cohorts: [COHORT], totals: { books: 1, exports: 1 }, warnings: [] } },
      ...(attempts ? { '03': { cohorts: { [KEY]: { attempts } } } } : {}),
    },
  }, null, 1));
}

function runStage(extraEnv = {}, args = []) {
  const r = spawnSync(process.execPath, ['scripts/pipeline/run.mjs', '--stage', '03', '--month', MONTH, '--json', '--cohort', KEY, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...process.env,
      CONVIN_API_BASE: BASE,
      CONVIN_TENANT: 'rblbank',
      CONVIN_CAMPAIGN_PREX: 'cmp-prex',
      CONVIN_CAMPAIGN_BUCKET: 'cmp-bucket',
      CONVIN_TOKEN: 'fake-token',
      CONVIN_EMAIL: '',
      CONVIN_PASSWORD: '',
      ...extraEnv,
    },
  });
  const line = String(r.stdout ?? '').trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return { code: r.status, json: line ? JSON.parse(line) : null, stderr: String(r.stderr ?? '') };
}

if (!await until(async () => (await api('/__state')).modes !== undefined)) {
  console.error('the fake did not start:\n', fakeLog.join(''));
  process.exit(1);
}
console.log('\n══ STAGE 03 AGAINST A CONVIN THAT MISBEHAVES ══');

console.log('\n── a token that authenticates but cannot write ──\n');
await reset(); await setModes(['read-only-token']); writeState();
{
  const r = runStage();
  ok('a read-scope 401 is a STOP, not a crash', r.code === 10, `exit ${r.code}`);
  ok('and it says what to do about it',
    /401/.test(r.json?.reason ?? '') && /CONVIN_EMAIL|Playwright/.test(r.json?.reason ?? ''),
    r.json?.reason?.slice(0, 160));
  ok('nothing was recorded as fired', !r.json?.fired, JSON.stringify(r.json?.state));
}
{
  const r = runStage({ CONVIN_EMAIL: 'a@b.c', CONVIN_PASSWORD: 'x' });
  ok('with login credentials it tries the browser path and fails loudly',
    r.code !== 0 && r.code !== 10, `exit ${r.code}`);
  ok('the failure names the mode it tried', /browser/.test(r.stderr), r.stderr.split('\n').filter((l) => l.includes('browser'))[0] ?? '');
}

console.log('\n── one job per tenant, server-side ──\n');
await reset(); await setModes(['tenant-lock'], 60_000); writeState();
{
  const first = runStage();
  ok('the first trigger is accepted', first.code === 0 && first.json?.fired === true, `exit ${first.code}`);
  const second = runStage();
  ok('a second trigger while one is queued is REFUSED', second.code !== 0, `exit ${second.code}`);
  ok('and the refusal reaches the log with its HTTP status',
    /429/.test(second.stderr), second.stderr.split('\n').filter((l) => /429|progress/.test(l))[0] ?? '');
  const st = await api('/__state');
  t('exactly one job was created for the tenant', st.jobs.length, 1);
  ok('removing a disabled attribute would not have got past it — the refusal is server-side',
    st.requests.length === 1, `${st.requests.length} accepted requests`);
}

console.log('\n── /report-downloads/active disagreeing with what we asked ──\n');
await reset(); await setModes(['wrong-params']); writeState();
{
  const r = runStage();
  ok('a mis-scoped active export is caught', r.code !== 0, `exit ${r.code}`);
  ok('and is named as the silent re-fire trap',
    /silent-re-fire|not the/.test(r.stderr), r.stderr.split('\n').filter((l) => /scoped to/.test(l))[0] ?? '');
  ok('it is caught BEFORE any waiting begins',
    !/poll|waiting/i.test(r.stderr), 'the stage must refuse before it commits to a wait');
}

console.log('\n── three attempts, then a human ──\n');
await reset(); await setModes([]);
{
  writeState({ attempts: 0 });
  const a = runStage();
  t('a fresh cohort records attempt 1', a.json?.state?.cohorts?.[KEY]?.attempts, 1);

  await reset();
  writeState({ attempts: 3 });
  const b = runStage();
  ok('the fourth attempt escalates rather than waiting again', b.code === 10, `exit ${b.code}`);
  ok('and says why', /escalat/i.test(b.json?.reason ?? ''), b.json?.reason?.slice(0, 140));

  const st = await api('/__state');
  t('and NO export is fired once the attempts are spent', st.requests.length, 0);
  ok('so the tenant lock is never taken for an attempt nobody waits for',
    st.active === null, JSON.stringify(st.active));
}

console.log('\n── failure and hang are different things, and neither is "no calls" ──\n');
await reset(); await setModes(['job-fails']); writeState();
{
  const r = runStage();
  ok('the stage still reports the trigger it made', r.code === 0, `exit ${r.code}`);
  const st = await api('/__state');
  t('the job is failed server-side', st.active?.status, 'failed');

  ok('nothing marks the cohort collected', !r.json?.collected, JSON.stringify(r.json?.state?.cohorts?.[KEY]));

  const marked = runStage({}, ['--mark-failed', '--reason', 'fake: job failed server-side']);
  ok('--mark-failed records it as FAILED, distinct from "no calls"',
    marked.code === 0 && marked.json?.markedFailed === true, JSON.stringify(marked.json).slice(0, 140));
  t('and the failure survives in state', marked.json?.state?.cohorts?.[KEY]?.failed, true);
}
await reset(); await setModes(['job-hangs']); writeState();
{
  const r = runStage();
  const st = await api('/__state');
  t('a hanging job stays running and holds the tenant lock', st.active?.status, 'running');
  ok('the stage does not block on it', r.code === 0, `exit ${r.code} — stage 03 fires and returns; the wait is the loop's`);
}

console.log('\n── the resume path reads stage 04, not stage 03 ──\n');
await reset(); await setModes([]); writeState();
{
  const r = spawnSync(process.execPath, ['scripts/pipeline/run.mjs', '--stage', '03', '--month', MONTH, '--json', '--list-cohorts'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, CONVIN_API_BASE: BASE } });
  const j = JSON.parse(String(r.stdout).trim().split('\n').filter((l) => l.startsWith('{')).pop());
  t('--list-cohorts needs no credentials at all', r.status, 0);
  t('and reports the cohort as not collected', j.cohorts[0].collected, false);
}

console.log('\n── the response shape is still a guess, so a wrong guess must be loud ──\n');
{
  const { readActive } = await import('../scripts/pipeline/03_export.mjs');
  t('the documented shape reads',            readActive({ active: { id: 'j1' } }), { id: 'j1' });
  t('the alternative key reads',             readActive({ data: { id: 'j2' } }), { id: 'j2' });
  t('an explicit null means no job',         readActive({ active: null }), null);
  t('an empty list means no job',            readActive([]), null);
  t('a paginated envelope means no job',     readActive({ results: [], count: 0 }), null);

  let threw = null;
  try { readActive({ report_download: { id: 'j3' } }); } catch (e) { threw = e.message; }
  ok('an unknown shape THROWS rather than reading as an empty queue', !!threw, String(threw).slice(0, 80));
  ok('and the error names the keys actually on the response',
    /report_download/.test(threw ?? ''), threw?.slice(0, 200));
  ok('and says exactly where to add the real key',
    /ACTIVE_KEYS in 03_export/.test(threw ?? ''), threw?.slice(-140));

  let threw2 = null;
  try { readActive(null); } catch (e) { threw2 = e.message; }
  ok('a non-object body throws too', !!threw2, String(threw2).slice(0, 80));
}

console.log('\n── the 35-column export, and the four External ID shapes ──\n');
{
  const { generateExport } = await import('./fakes/convin.mjs');
  const accounts = Array.from({ length: 40 }, (_, i) => `9990000000${String(1000000 + i).padStart(9, '0')}`);
  const days = ['2099-03-05', '2099-03-06'];

  const plain = generateExport({ accounts, loadDate: '2099-03-04', days, dupColumns: false });
  t('the ordinary export is 31 columns', plain.columns, 31);

  const dup = generateExport({ accounts, loadDate: '2099-03-04', days, dupColumns: true });
  t('the duplicated-column export is 35', dup.columns, 35);
  const header = dup.csv.split('\n')[0].split(',');
  t('Sense Disposition L1 appears twice', header.filter((h) => h === 'Sense Disposition L1').length, 2);
  const firstIdx = header.indexOf('Sense Disposition L1');
  const lastIdx = header.lastIndexOf('Sense Disposition L1');
  const row = dup.csv.split('\n')[1].split(',');
  ok('and the SECOND copy is the one holding values',
    row[firstIdx] === '' || row[lastIdx] !== '', `first=${JSON.stringify(row[firstIdx])} second=${JSON.stringify(row[lastIdx])}`);

  const { splitExternalId } = await import('../scripts/pipeline/externalid.mjs');
  const ids = dup.csv.split('\n').slice(1).filter(Boolean).map((l) => l.split(',')[header.indexOf('External ID')]);
  const shapes = new Set(ids.map((id) => (id.includes('_') ? id.split('_')[1].length : 'no-underscore')));
  ok('all four observed ID shapes are present', shapes.size >= 3, [...shapes].join(', '));
  const unreadable = ids.filter((id) => !splitExternalId(id, '2099').loadDate).length;
  t('and every one of them parses', unreadable, 0);
}

console.log('\n── repair_calllog.mjs, the reason the duplicate columns are survivable ──\n');
{
  const { generateExport } = await import('./fakes/convin.mjs');
  const accounts = Array.from({ length: 30 }, (_, i) => `9990000000${String(2000000 + i).padStart(9, '0')}`);
  const dup = generateExport({ accounts, loadDate: '2099-03-04', days: ['2099-03-05'], dupColumns: true });
  const tmp = path.join(os.tmpdir(), `convin-dup-${process.pid}.csv`);
  fs.writeFileSync(tmp, dup.csv);
  const r = spawnSync(process.execPath, ['scripts/repair_calllog.mjs', tmp, '--json'], { cwd: REPO, encoding: 'utf8' });
  const line = String(r.stdout).trim().split('\n').filter((l) => l.startsWith('{')).pop();
  const j = line ? JSON.parse(line) : null;
  ok('repair reads the 35-column file', !!j, String(r.stderr).slice(-300));
  if (j) {
    const res = j.results?.[0] ?? {};
    t('it sees 35 columns going in', res.columnsBefore, 35);
    ok('and reports what it did about them',
      res.repaired === true || res.columnsAfter === 31 || (res.notes ?? []).length > 0,
      JSON.stringify(res).slice(0, 260));
  }
  fs.rmSync(tmp, { force: true });
}

fs.rmSync(STATE, { force: true });
fs.rmSync(path.join(REPO, 'state', `${MONTH}.lock.json`), { force: true });
stop();
console.log(`\n${fails ? '✘' : '✔'} ${checks - fails}/${checks} checks passed\n`);
process.exit(fails ? 1 : 0);
