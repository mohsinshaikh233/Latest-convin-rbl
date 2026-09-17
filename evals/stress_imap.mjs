import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start, message, SUBJECT_SHAPES, USER, PASS } from './fakes/imap.mjs';
import { matchesCohort } from '../scripts/pipeline/04_collect.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4994;

const MONTH = '2099-05';
const STATE = path.join(REPO, 'state', `${MONTH}.json`);

let checks = 0; let fails = 0;
const t = (label, got, want) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? '✔' : '✘'} ${label.padEnd(56)} ${JSON.stringify(got)}${ok ? '' : `   EXPECTED ${JSON.stringify(want)}`}`);
};
const ok = (label, cond, detail = '') => {
  checks++;
  if (!cond) { fails++; console.log(`  ✘ ${label}${detail ? `\n      → ${detail}` : ''}`); return false; }
  console.log(`  ✔ ${label}`);
  return true;
};

const COHORT = { campaign: 'bucket', startDate: '2099-05-04', endDate: '2099-05-09', books: ['SCRATCH BOOK'] };
const KEY = `${COHORT.campaign}|${COHORT.startDate}`;
const CSV = ['External ID,Lead Creation Timestamp,Call Timestamp',
  `A100_04052099,2099-05-04 08:00:00,2099-05-05 10:00:00`,
  `A101_04052099,2099-05-04 08:00:00,2099-05-06 11:00:00`].join('\n');

const TWIN = { campaign: 'prex', startDate: COHORT.startDate, endDate: COHORT.endDate, books: ['TWIN BOOK'] };
function writeState({ twin = false } = {}) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({
    month: MONTH,
    stages: { '02': { plan: { books: [], cohorts: twin ? [COHORT, TWIN] : [COHORT], totals: {}, warnings: [] } } },
  }, null, 1));
}

function run(args, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, {
      cwd: REPO,
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        S3_PREFIX_ARCHIVE: '',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => {
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      resolve({ code, json: line ? JSON.parse(line) : null, stderr: err });
    });
  });
}

function runStage(extra = {}, stateOpts = {}) {
  fs.rmSync(STATE, { force: true });
  writeState(stateOpts);
  fs.rmSync(path.join(REPO, '.pipeline-data', 'raw', MONTH), { recursive: true, force: true });
  return run(['scripts/pipeline/run.mjs', '--stage', '04', '--month', MONTH, '--json', '--cohort', KEY],
    { IMAP_HOST: '127.0.0.1', IMAP_PORT: String(PORT), IMAP_USER: USER, IMAP_PASSWORD: PASS, ...extra });
}

const collected = () => path.join(REPO, '.pipeline-data', 'raw', MONTH, 'calllogs', `${KEY.replace('|', '__')}.csv`);

console.log('\n══ STAGE 04 AGAINST A REAL IMAP SERVER ══');

console.log('\n── matchesCohort() is a guess. This is what it accepts ──\n');
{
  const accepted = [];
  for (const shape of SUBJECT_SHAPES) {
    const subject = shape.subject(COHORT);
    const m = matchesCohort({ subject }, COHORT);
    if (m) accepted.push(shape.id);
    console.log(`  ${m ? '✓ MATCHES ' : '✗ ignored '} ${shape.id.padEnd(14)} ${JSON.stringify(subject).slice(0, 68)}`);
    console.log(`               ${shape.note}`);
  }
  console.log();

  ok('the ISO shape is accepted', accepted.includes('iso-range'), accepted.join(', '));
  ok('the human-date shape is accepted', accepted.includes('human-dates'), accepted.join(', '));
  ok('the slash-date shape is accepted', accepted.includes('slash-dates'), accepted.join(', '));

  ok('a subject with no date at all is still refused', !accepted.includes('campaign-only'), accepted.join(', '));
  ok('and a subject with nothing to match on is refused', !accepted.includes('generic'), accepted.join(', '));
}

console.log('── a matching email with an attachment ──\n');
{
  const srv = await start({ port: PORT, messages: [message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: CSV })] });
  const r = await runStage();

  t('the stage collects it', r.code, 0);
  ok('and a file lands where stage 05 will look for it', fs.existsSync(collected()), collected());
  ok('no TypeError from the cleanup block', !/reading 'catch'/.test(r.stderr),
    r.stderr.split('\n').filter((l) => /TypeError/.test(l))[0] ?? '');

  if (fs.existsSync(collected())) {
    const body = fs.readFileSync(collected(), 'utf8');

    const first = body.split('\n')[0].trim();
    ok('the FIRST LINE is the CSV header, not "From:"',
      first.startsWith('External ID') && !/^From:/.test(first),
      `first line: ${JSON.stringify(first.slice(0, 70))}`);
    ok('and no MIME framing survived into the file',
      !/Content-Type:\s*multipart/i.test(body) && !/^--/m.test(body),
      'a boundary line in a CSV is a row that parses as garbage');
  }
  await srv.close();
}

console.log('\n── nothing to collect ──\n');
{
  const srv = await start({ port: PORT, messages: [message({ subject: 'Something unrelated', csv: CSV })] });
  const r = await runStage();
  t('a missing email is a STOP, not a crash', r.code, 10);
  ok('and it reports the pattern as the likely cause',
    /matchesCohort/.test(r.json?.reason ?? ''), r.json?.reason?.slice(0, 150));

  ok('and lists every subject it examined and rejected',
    (r.json?.examinedSubjects ?? []).includes('Something unrelated'),
    JSON.stringify(r.json?.examinedSubjects));
  ok('which is in the log too', /Something unrelated/.test(r.stderr), 'operators read the log, not the JSON');
  ok('no file is left behind', !fs.existsSync(collected()), collected());
  await srv.close();
}

console.log('\n── two emails for the same cohort ──\n');
{
  const older = message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: 'External ID,Lead Creation Timestamp,Call Timestamp\nOLD_04052099,2099-05-04 08:00:00,2099-05-05 10:00:00', date: new Date('2099-05-09T08:00:00Z') });
  const newer = message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: 'External ID,Lead Creation Timestamp,Call Timestamp\nNEW_04052099,2099-05-04 08:00:00,2099-05-05 10:00:00', date: new Date('2099-05-09T18:00:00Z') });
  const srv = await start({ port: PORT, messages: [older, newer] });
  const r = await runStage();
  t('it still collects', r.code, 0);
  if (fs.existsSync(collected())) {
    const body = fs.readFileSync(collected(), 'utf8');

    ok('the NEWEST of the two wins', body.includes('NEW_04052099') && !body.includes('OLD_04052099'),
      body.includes('OLD_04052099') ? 'it took the older one' : 'neither found');
  }
  await srv.close();
}

console.log('\n── a notification with nothing attached ──\n');
{
  const srv = await start({ port: PORT, messages: [message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: CSV, attach: false })] });
  const r = await runStage();

  t('a matching email with no attachment is a STOP for a person', r.code, 10);
  ok('and it says so, with the subject that matched',
    /no attachment/i.test(r.json?.reason ?? ''), r.json?.reason?.slice(0, 130));
  ok('nothing is written', !fs.existsSync(collected()), collected());
  await srv.close();
}

console.log('\n── a cohort already collected ──\n');
{
  const srv = await start({ port: PORT, messages: [message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: CSV })] });
  await runStage();
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));

  const withCollected = { ...st, stages: { ...st.stages, '04': { collected: { [KEY]: { path: collected(), repairedOk: true } } } } };
  fs.writeFileSync(STATE, JSON.stringify(withCollected, null, 1));
  const r = await run(['scripts/pipeline/run.mjs', '--stage', '04', '--month', MONTH, '--json', '--cohort', KEY],
    { IMAP_HOST: '127.0.0.1', IMAP_PORT: '1', IMAP_USER: 'x', IMAP_PASSWORD: 'y' });
  t('an already-collected cohort is skipped', r.json?.alreadyDone, true);
  ok('and the mailbox is never opened — port 1 would refuse instantly',
    r.code === 0, `exit ${r.code}: it did not try to connect`);
  await srv.close();
}

console.log('\n── marked collected, but the file is gone ──\n');
{
  const srv = await start({ port: PORT, messages: [message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: CSV })] });
  await runStage();
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const withCollected = { ...st, stages: { ...st.stages, '04': { collected: { [KEY]: { path: collected(), repairedOk: true } } } } };
  fs.writeFileSync(STATE, JSON.stringify(withCollected, null, 1));

  fs.rmSync(collected(), { force: true });

  const r = await run(['scripts/pipeline/run.mjs', '--stage', '04', '--month', MONTH, '--json', '--cohort', KEY],
    { IMAP_HOST: '127.0.0.1', IMAP_PORT: String(PORT), IMAP_USER: USER, IMAP_PASSWORD: PASS });
  t('a cohort whose file has vanished is NOT skipped', r.json?.alreadyDone, undefined);
  ok('it collects again rather than trusting the ledger', r.code === 0, `exit ${r.code}: ${r.json?.reason ?? r.stderr.slice(-300)}`);
  ok('and the call log is back on disk', fs.existsSync(collected()) && fs.statSync(collected()).size > 0,
    `${collected()} still missing or empty`);
  ok('and it says WHY it re-collected', /marked collected but .* is missing or empty/.test(r.stderr),
    r.stderr.split('\n').filter((l) => l.includes(KEY)).join(' | ').slice(0, 300));

  fs.writeFileSync(collected(), '');
  fs.writeFileSync(STATE, JSON.stringify(withCollected, null, 1));
  const r2 = await run(['scripts/pipeline/run.mjs', '--stage', '04', '--month', MONTH, '--json', '--cohort', KEY],
    { IMAP_HOST: '127.0.0.1', IMAP_PORT: String(PORT), IMAP_USER: USER, IMAP_PASSWORD: PASS });
  t('a zero-byte call log is not accepted as collected', r2.json?.alreadyDone, undefined);
  ok('and the re-collected file has rows again', fs.statSync(collected()).size > 0, 'still zero bytes');

  await srv.close();
}

console.log('\n── two emails that fit the same cohort equally well ──\n');
{
  const neighbour = message({
    subject: `Your AI Call Log export ${COHORT.endDate} to 2099-05-14 is ready`,
    csv: 'External ID,Lead Creation Timestamp,Call Timestamp\nWRONG_04052099,2099-05-04 08:00:00,2099-05-12 10:00:00\n',
    date: new Date('2099-05-09T12:00:00Z'),
  });
  const mine = message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: CSV, date: new Date('2099-05-04T09:00:00Z') });

  const srv = await start({ port: PORT, messages: [mine, neighbour] });
  const r = await runStage();
  t('the neighbouring cohort\'s export does NOT win on being newer', r.code, 0);
  ok('the cohort collects its OWN export', fs.readFileSync(collected(), 'utf8').includes('A100_04052099'),
    `collected: ${fs.readFileSync(collected(), 'utf8').split('\n')[1] ?? '(empty)'}`);
  ok('and the log says what else was in the running',
    /also considered/.test(r.stderr), r.stderr.split('\n').filter((l) => /matched|considered/.test(l)).join(' | ').slice(0, 300));
  await srv.close();

  const twinA = message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: CSV, date: new Date('2099-05-04T09:00:00Z') });
  const twinB = message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: CSV, date: new Date('2099-05-04T11:00:00Z') });
  const srv2 = await start({ port: PORT, messages: [twinA, twinB] });
  const r2 = await runStage({}, { twin: true });
  t('two identical subjects stop for a person', r2.code, 10);
  ok('and it does not pick one anyway', !fs.existsSync(collected()), `wrote ${collected()}`);
  ok('and it shows BOTH candidate subjects', (r2.json?.candidateSubjects ?? []).length === 2,
    JSON.stringify(r2.json?.candidateSubjects ?? r2.json?.reason ?? null).slice(0, 260));
  await srv2.close();

  const namedMine = message({ subject: `Your ${COHORT.campaign} AI Call Log export ${COHORT.startDate} to ${COHORT.endDate} is ready`, csv: CSV });
  const namedOther = message({ subject: `Your prex AI Call Log export ${COHORT.startDate} to ${COHORT.endDate} is ready`, csv: 'External ID,Lead Creation Timestamp,Call Timestamp\nWRONG_04052099,2099-05-04 08:00:00,2099-05-05 10:00:00\n', date: new Date('2099-05-09T12:00:00Z') });
  const srv3 = await start({ port: PORT, messages: [namedMine, namedOther] });
  const r3 = await runStage();
  t('naming the campaign breaks the tie', r3.code, 0);
  ok('and the OTHER campaign\'s export is vetoed, however new it is',
    fs.readFileSync(collected(), 'utf8').includes('A100_04052099'),
    `collected: ${fs.readFileSync(collected(), 'utf8').split('\n')[1] ?? '(empty)'}`);
  await srv3.close();
}

console.log('\n── the server goes away mid-collect ──\n');
{
  const srv = await start({ port: PORT, messages: [message({ subject: SUBJECT_SHAPES[0].subject(COHORT), csv: CSV })] });
  await srv.close();
  const r = await runStage();
  ok('an unreachable mailbox fails loudly', r.code !== 0, `exit ${r.code}`);
  ok('and does not leave a half-written cohort file',
    !fs.existsSync(collected()) || fs.statSync(collected()).size > 0,
    'a zero-byte file would read downstream as a cohort with no calls');
}

fs.rmSync(STATE, { force: true });
fs.rmSync(path.join(REPO, '.pipeline-data', 'raw', MONTH), { recursive: true, force: true });
console.log(`\n${fails ? '✘' : '✔'} ${checks - fails}/${checks} checks passed\n`);
process.exit(fails ? 1 : 0);
