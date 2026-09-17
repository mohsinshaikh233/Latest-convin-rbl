import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4762;
const BASE = `http://127.0.0.1:${PORT}`;
const BUCKET = 'rbl-collections';

const MONTH = '2099-04';
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

const REAL = '/Users/rosh/Downloads/RBL';
let SEED = fs.existsSync(path.join(REAL, 'Calling File')) ? REAL : null;
let temp = null;
if (!SEED) {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-s3-seed-'));
  fs.mkdirSync(path.join(temp, 'books'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'status'), { recursive: true });
  for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(temp, 'books', `BOOK ${String(i).padStart(2, '0')}.xlsx`), Buffer.alloc(2048, i));
  for (let i = 1; i <= 8; i++) fs.writeFileSync(path.join(temp, 'status', `Bucket Status ${i + 13} Aug_26.xlsx`), Buffer.alloc(1024, i));
  SEED = temp;
  console.log(`\n  (no ${REAL} — using a synthetic seed; shapes are real, contents are not)`);
}

const EXPECT_BOOKS = fs.readdirSync(path.join(SEED, fs.existsSync(path.join(SEED, 'Calling File')) ? 'Calling File' : 'books')).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$')).length;
const EXPECT_STATUS = fs.readdirSync(path.join(SEED, fs.existsSync(path.join(SEED, 'Status Files')) ? 'Status Files' : 'status')).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$')).length;

const fake = spawn(process.execPath, ['evals/fakes/s3.mjs', '--port', String(PORT), '--seed', SEED, '--page-size', '5'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
const fakeLog = [];
fake.stderr.on('data', (d) => fakeLog.push(String(d)));
const cleanup = () => {
  try { fake.kill('SIGKILL'); } catch {  }
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(STATE, { force: true });
  fs.rmSync(path.join(REPO, '.pipeline-data', 'raw', MONTH), { recursive: true, force: true });
};
process.on('exit', cleanup);

const api = async (p, opts) => (await fetch(`${BASE}${p}`, opts)).json();
const setModes = (modes, extra = {}) => api('/__mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modes, ...extra }) });
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch {  } await new Promise((r) => setTimeout(r, 120)); }
  return false;
};

function runStage(extraEnv = {}) {
  fs.rmSync(STATE, { force: true });
  fs.rmSync(path.join(REPO, '.pipeline-data', 'raw', MONTH), { recursive: true, force: true });
  const r = spawnSync(process.execPath, ['scripts/pipeline/run.mjs', '--stage', '01', '--month', MONTH, '--json'], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...process.env,
      S3_ENDPOINT: BASE,
      S3_REGION: 'ap-south-1',
      S3_ACCESS_KEY_ID: 'fake',
      S3_SECRET_ACCESS_KEY: 'fake',
      S3_BUCKET: BUCKET,
      S3_PREFIX_BOOKS: 'books/',
      S3_PREFIX_STATUS: 'status/',
      S3_PREFIX_ARCHIVE: '',
      ...extraEnv,
    },
  });
  const line = String(r.stdout ?? '').trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return { code: r.status, json: line ? JSON.parse(line) : null, stderr: String(r.stderr ?? '') };
}

const raw = (rel) => path.join(REPO, '.pipeline-data', 'raw', MONTH, rel);

if (!await until(async () => (await api('/__state')).objects !== undefined)) {
  console.error('the fake did not start:\n', fakeLog.join(''));
  process.exit(1);
}
console.log('\n══ STAGE 01 AGAINST A REAL-BEHAVING S3 ══');
console.log(`   seed: ${SEED}  (${EXPECT_BOOKS} books, ${EXPECT_STATUS} status sheets)\n`);

console.log('── the ContinuationToken loop, which has never run ──\n');
await setModes(['paginate']);
await api('/__reset');
{
  const r = runStage();
  t('the fetch succeeds', r.code, 0);
  t('every book arrives', r.json?.books, EXPECT_BOOKS);
  t('every status sheet arrives', r.json?.statusFiles, EXPECT_STATUS);
  const st = await api('/__state');
  const pages = st.lists.length;
  ok('and it took multiple LIST pages to get them', pages > 2, `${pages} LIST calls at 5 keys per page`);
  ok('the loop terminated — the last page is not truncated',
    st.lists[st.lists.length - 1]?.truncated === false, JSON.stringify(st.lists.slice(-2)));
  const onDisk = fs.existsSync(raw('books')) ? fs.readdirSync(raw('books')).length : 0;
  t('and the files are on disk', onDisk, EXPECT_BOOKS);
}

if (temp === null) {
  console.log('\n── the dates 05_assemble indexes by ──\n');
  const { parseStatusDate } = await import('../scripts/pipeline/dates.mjs');
  const files = fs.readdirSync(raw('status'));
  const bad = files.filter((f) => !parseStatusDate(f));
  t('every real status filename yields an as-of date', bad, []);
}

console.log('\n── a key listed, then gone ──\n');
await setModes(['paginate', 'vanishing-key']);
await api('/__reset');
{
  const victim = (await api('/__state')).victim;
  const r = runStage();
  ok('the run does NOT report success with a book missing', r.code !== 0, `exit ${r.code}`);
  ok('and the failure names the key that vanished',
    r.stderr.includes(path.basename(victim)) || r.stderr.includes('NoSuchKey'),
    r.stderr.split('\n').filter((l) => /NoSuchKey|crashed/.test(l))[0] ?? r.stderr.slice(-200));

  const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
  ok('and nothing records the month as fetched',
    !st?.stages?.['01']?.books || Object.keys(st.stages['01'].books).length === 0,
    `state recorded ${Object.keys(st?.stages?.['01']?.books ?? {}).length} books`);
}

console.log('\n── a truncated download ──\n');
await setModes(['paginate', 'truncated-body']);
await api('/__reset');
{
  const victim = (await api('/__state')).victim;
  const r = runStage();
  ok('a short body is a failure, not a shrug', r.code !== 0, `exit ${r.code}`);

  const dest = raw(path.join('books', path.basename(victim)));
  const short = fs.existsSync(dest) ? fs.statSync(dest).size : null;
  const full = (await api('/__state')).objects && fs.statSync(path.join(SEED, fs.existsSync(path.join(SEED, 'Calling File')) ? 'Calling File' : 'books', path.basename(victim))).size;
  ok('no truncated file is left on disk claiming to be the book',
    short === null || short === full,
    short === null ? 'nothing written ✔' : `${short} of ${full} bytes written`);
}

console.log('\n── AccessDenied, which must name the prefix ──\n');
await setModes(['paginate', 'denied-prefix'], { deniedPrefix: 'status/' });
await api('/__reset');
{
  const r = runStage();
  ok('the run stops', r.code !== 0, `exit ${r.code}`);
  ok('and the error names the prefix, not "fetch failed"',
    /status\//.test(r.stderr) || /AccessDenied/.test(r.stderr),
    r.stderr.split('\n').filter((l) => /Denied|status\//.test(l))[0] ?? r.stderr.slice(-200));
}

console.log('\n── re-running a month already fetched ──\n');
await setModes(['paginate']);
{
  const first = runStage();
  t('first run fetches everything', first.json?.fetched, EXPECT_BOOKS + EXPECT_STATUS);
  await api('/__reset');

  const r = spawnSync(process.execPath, ['scripts/pipeline/run.mjs', '--stage', '01', '--month', MONTH, '--json'], {
    cwd: REPO, encoding: 'utf8',
    env: { ...process.env, S3_ENDPOINT: BASE, S3_REGION: 'ap-south-1', S3_ACCESS_KEY_ID: 'f', S3_SECRET_ACCESS_KEY: 'f', S3_BUCKET: BUCKET, S3_PREFIX_BOOKS: 'books/', S3_PREFIX_STATUS: 'status/', S3_PREFIX_ARCHIVE: '' },
  });
  const j = JSON.parse(String(r.stdout).trim().split('\n').filter((l) => l.startsWith('{')).pop());

  t('the second run downloads NOTHING', j.fetched, 0);
  t('and skips every object it already had', j.skipped, EXPECT_BOOKS + EXPECT_STATUS);

  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  ok('the ledger survives the round trip',
    Object.keys(st.stages?.['01']?.raw?.objects ?? {}).length === EXPECT_BOOKS + EXPECT_STATUS,
    `stages.01.raw.objects has ${Object.keys(st.stages?.['01']?.raw?.objects ?? {}).length}`);

  const st2 = await api('/__state');
  ok('and the second run issued no GETs at all',
    st2.gets.length === 0, `${st2.gets.length} GETs — it should have listed only`);
}

console.log('\n── --dry-run lists but never downloads ──\n');
await api('/__reset');
{
  fs.rmSync(STATE, { force: true });
  fs.rmSync(path.join(REPO, '.pipeline-data', 'raw', MONTH), { recursive: true, force: true });
  const r = spawnSync(process.execPath, ['scripts/pipeline/run.mjs', '--stage', '01', '--month', MONTH, '--json', '--dry-run'], {
    cwd: REPO, encoding: 'utf8',
    env: { ...process.env, S3_ENDPOINT: BASE, S3_REGION: 'ap-south-1', S3_ACCESS_KEY_ID: 'f', S3_SECRET_ACCESS_KEY: 'f', S3_BUCKET: BUCKET, S3_PREFIX_BOOKS: 'books/', S3_PREFIX_STATUS: 'status/', S3_PREFIX_ARCHIVE: '' },
  });
  const j = JSON.parse(String(r.stdout).trim().split('\n').filter((l) => l.startsWith('{')).pop());
  t('it reports what it would fetch', j.wouldFetch, EXPECT_BOOKS + EXPECT_STATUS);
  const st = await api('/__state');
  t('and issues zero GETs', st.gets.length, 0);
  ok('it listed, though — a dry run proves the credentials and the prefixes', st.lists.length > 0, `${st.lists.length} LISTs`);
  ok('and wrote no state that a later run would skip on',
    !fs.existsSync(STATE) || !JSON.parse(fs.readFileSync(STATE, 'utf8')).stages?.['01']?.books,
    'a dry run recording objects as fetched would make the real run skip them');
}

cleanup();
console.log(`\n${fails ? '✘' : '✔'} ${checks - fails}/${checks} checks passed\n`);
process.exit(fails ? 1 : 0);
