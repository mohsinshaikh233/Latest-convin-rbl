import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lastJson, commandLine, DECISIONS, RULINGS, rulingsForItem, scopeFor, dryRunPlan, isDryStage, DRY_FROM } from '../src/lib/console/runner.mjs';
import { ORDER } from '../scripts/pipeline/stages.mjs';
import { splitExternalId, loadDateHistogram } from '../scripts/pipeline/externalid.mjs';
import { parseStatusDate } from '../scripts/pipeline/dates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

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

console.log('\n══ THE STAGE RESULT IS THE LAST JSON LINE ON STDOUT ══\n');

t('a bare JSON line',                       lastJson('{"ok":true,"books":3}'),                          { ok: true, books: 3 });
t('the LAST line wins, not the first',      lastJson('{"ok":false}\n{"ok":true}'),                      { ok: true });
t('noise before the line is ignored',       lastJson('starting…\nworking…\n{"ok":true,"n":9}'),         { ok: true, n: 9 });
t('a trailing newline does not break it',   lastJson('{"ok":true}\n'),                                  { ok: true });
t('trailing blank lines do not break it',   lastJson('{"ok":true}\n\n\n'),                              { ok: true });
t('an array result is accepted',            lastJson('[1,2,3]'),                                        [1, 2, 3]);
t('no JSON at all → null, never a guess',   lastJson('crashed with no output'),                         null);
t('empty stdout → null',                    lastJson(''),                                               null);
t('undefined stdout → null',                lastJson(undefined),                                        null);

t('a truncated tail falls back to the last GOOD line', lastJson('{"ok":true,"n":1}\n{"ok":tr'),         { ok: true, n: 1 });
t('a line that merely starts with { is not enough',    lastJson('{not json}'),                          null);

console.log('\n══ THE REPRODUCE COMMAND SURVIVES REAL BOOK NAMES ══\n');
const cmd = commandLine(['scripts/pipeline/run.mjs', '--stage', '05', '--apply-rulings', '[{"book":"CYC 18 PDD+7"}]']);
ok('a book name with a space is quoted', cmd.includes("'[{\"book\":\"CYC 18 PDD+7\"}]'"), cmd);
ok("an apostrophe cannot break out of the quoting", commandLine(["it's"]).includes(`'it'\\''s'`), commandLine(["it's"]));

console.log('\n══ A STAGE THAT LOGS JSON TO STDERR ══\n');

function runNode(source) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `console-eval-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
    fs.writeFileSync(file, source);
    const child = spawn(process.execPath, [file], { cwd: REPO });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => { fs.rmSync(file, { force: true }); resolve({ code, out, err }); });
  });
}

{
  const r = await runNode(`
    console.error('  collecting …');
    console.error(JSON.stringify({ ok: true, rows: 999999, imposter: 'this is the repair script talking' }));
    console.error('  repaired.');
    console.log(JSON.stringify({ ok: true, rows: 42, cohort: 'bucket|2026-08-11' }));
  `);
  const result = lastJson(r.out);
  t('the result comes from stdout', result, { ok: true, rows: 42, cohort: 'bucket|2026-08-11' });
  ok('the stderr JSON is nowhere in the result', result.rows === 42 && !('imposter' in result), JSON.stringify(result));
  ok('stderr did carry JSON, so this was a real test', r.err.includes('imposter'), r.err);
}

{
  const r = await runNode(`
    console.log('this should have gone to stderr');
    console.log(JSON.stringify({ ok: true, n: 7 }));
  `);
  t('a stray stdout line does not shadow the result', lastJson(r.out), { ok: true, n: 7 });
}

console.log('\n══ EXIT 10 ══\n');

ok('exactly two stages have a decision form', Object.keys(DECISIONS).join(',') === '02,05', Object.keys(DECISIONS).join(','));
t('stage 02 applies answers with --apply-assignments', DECISIONS['02'].flag, '--apply-assignments');
t('stage 05 applies answers with --apply-rulings',     DECISIONS['05'].flag, '--apply-rulings');
t('stage 02 reads its question from result.unassigned',
  DECISIONS['02'].items({ unassigned: [{ book: 'CYC 31 PDD+2' }] }).map((i) => i.book), ['CYC 31 PDD+2']);

t('stage 05 asks about unresolved gaps AND unresolved drift',
  DECISIONS['05'].items({
    unresolvedGaps: [{ book: 'A' }],
    unresolvedDrift: [{ book: 'B', lastExpected: '2026-08-19' }],
    driftFindings: [{ book: 'B', lastExpected: '2026-08-19' }, { book: 'C', lastExpected: '2026-08-21' }],
  }).map((i) => i.book), ['A', 'B']);
t('and NOT about a finding already ruled on',
  DECISIONS['05'].items({
    unresolvedGaps: [], unresolvedDrift: [],
    driftFindings: [{ book: 'C', lastExpected: '2026-08-21' }],
  }), []);
t('accept-drift is in the vocabulary the console offers', RULINGS.includes('accept-drift'), true);
t('a drift item may only be answered with a drift verb',
  rulingsForItem({ book: 'C', lastExpected: '2026-08-21' }), ['accept-drift', 'exclude-book']);
t('and a gap item with a gap verb',
  rulingsForItem({ book: 'A', reason: 'missing status file' }), ['build-partial', 'wait-for-file', 'exclude-book']);
t('a stage with no question yields no items',          DECISIONS['02'].items({}), []);

{
  const month = '2099-01';
  fs.rmSync(path.join(REPO, 'state', `${month}.json`), { force: true });
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/pipeline/run.mjs', '--stage', '02', '--month', month, '--json'], { cwd: REPO });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
  ok('a stage with nothing to plan exits 10, not 1', r.code === 10, `exit ${r.code}: ${r.err.slice(-300)}`);
  const res = lastJson(r.out);
  ok('and still prints its single JSON line', res && res.ok === false && typeof res.reason === 'string', JSON.stringify(res));
  ok('10 is classified as a decision, never as failure', r.code === 10 && r.code !== 0 && !(r.code !== 0 && r.code !== 10),
    'exit 10 must not fall into the "any other non-zero" branch');
  fs.rmSync(path.join(REPO, 'state', `${month}.json`), { force: true });
}

console.log('\n══ THE FOLDER PICKER IS BOUNDED ══\n');

{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'console-browse-'));
  const root = path.join(sandbox, 'root');
  const outside = path.join(sandbox, 'outside');
  fs.mkdirSync(path.join(root, 'books'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'books', 'CYC 12 Convin.xlsx'), 'x');
  fs.writeFileSync(path.join(root, 'books', 'log.csv'), 'x');
  fs.writeFileSync(path.join(outside, 'secrets.txt'), 'x');

  fs.symlinkSync(outside, path.join(root, 'escape-hatch'));

  fs.mkdirSync(`${root}-evil`, { recursive: true });

  process.env.CONSOLE_BROWSE_ROOT = root;
  const { listDir, resolveInRoot, OutsideRootError, countSheets } = await import('../src/lib/console/browse.mjs');

  const refuses = (label, p) => {
    checks++;
    try {
      resolveInRoot(p);
      fails++;
      console.log(`  ✘ ${label} — it was ALLOWED`);
    } catch (e) {
      const right = e instanceof OutsideRootError;
      if (!right) fails++;
      console.log(`  ${right ? '✔' : '✘'} ${label}${right ? '' : ` — refused, but as ${e.name}: ${e.message}`}`);
    }
  };

  refuses('".." is refused', '..');
  refuses('"../.." is refused', '../..');
  refuses('a deep "../" chain is refused', 'books/../../../../../../etc');
  refuses('an absolute path outside the root is refused', '/etc');
  refuses('an absolute /etc/passwd is refused', '/etc/passwd');
  refuses('a symlink pointing out of the root is refused', 'escape-hatch');
  refuses('a path THROUGH that symlink is refused', 'escape-hatch/secrets.txt');
  refuses('a sibling sharing the root prefix is refused', `${root}-evil`);

  checks++;
  try { resolveInRoot('..%2f..%2fetc'); fails++; console.log('  ✘ an encoded "..%2f" resolved to something'); }
  catch (e) { const right = e.code === 'ENOENT'; if (!right) fails++; console.log(`  ${right ? '✔' : '✘'} an encoded "..%2f" stays a literal name inside the root`); }

  checks++;
  const inside = resolveInRoot('books');
  if (inside === fs.realpathSync(path.join(root, 'books'))) console.log('  ✔ a folder inside the root IS allowed');
  else { fails++; console.log(`  ✘ a folder inside the root was refused: ${inside}`); }

  checks++;
  try { resolveInRoot('no-such-folder'); fails++; console.log('  ✘ a missing folder inside the root should raise ENOENT'); }
  catch (e) { const right = e.code === 'ENOENT'; if (!right) fails++; console.log(`  ${right ? '✔' : '✘'} a missing folder inside the root is ENOENT, not a silent fallback`); }

  const listing = listDir(null);
  t('the root lists its child folders', listing.dirs.map((d) => d.name).includes('books'), true);
  t('the root reports no parent', listing.parent, null);
  t('per-folder sheet counts are real', countSheets(path.join(root, 'books')), { xlsx: 1, csv: 1, dirs: 0 });

  fs.mkdirSync(path.join(root, 'deep', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'deep', 'a.xlsx'), 'x');
  fs.writeFileSync(path.join(root, 'deep', 'nested', 'b.xlsx'), 'x');
  fs.writeFileSync(path.join(root, 'deep', 'nested', 'c.csv'), 'x');
  t('the count reaches two levels down, as stage 01 does',
    countSheets(path.join(root, 'deep')), { xlsx: 2, csv: 1, dirs: 1 });
  t('and the root sees everything the run would index',
    (({ xlsx, csv }) => ({ xlsx, csv }))(countSheets(root)), { xlsx: 3, csv: 2 });
  ok('a symlink pointing out of the root is not even listed',
    !listing.dirs.some((d) => d.name === 'escape-hatch'),
    `listed: ${listing.dirs.map((d) => d.name).join(', ')}`);
  t('and it is counted, so the boundary is visible rather than silent', listing.blockedLinks, 1);

  fs.symlinkSync(path.join(root, 'books'), path.join(root, 'books-link'));
  const listing2 = listDir(null);
  ok('a symlink that stays inside the root IS listed',
    listing2.dirs.some((d) => d.name === 'books-link'),
    `listed: ${listing2.dirs.map((d) => d.name).join(', ')}`);

  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(`${root}-evil`, { recursive: true, force: true });
}

console.log('\n══ THE CONSOLE READS THE REAL REGISTRY ══\n');

t('ORDER is the numeric stages, in run order', ORDER, ['00', '01', '02', '03', '04', '05', '06', '07', '08']);
ok('the lock is dispatchable but never a step of the month', !ORDER.includes('lock'), ORDER.join(','));
t('LIVE preflight scopes every work stage',  scopeFor('live'),   ['01', '02', '03', '04', '05', '06', '07', '08']);

t('REPLAY preflight scopes only 05-08',      scopeFor('replay'), ['05', '06', '07', '08']);

console.log('\n══ NOBODY HAS TO REMEMBER TO DRY-RUN ══\n');

t('an unproven month is forced to dry-run',        dryRunPlan({ mode: 'live', proven: false }), { dryRun: true, forced: true });
t('asking for a real run does NOT get past it',    dryRunPlan({ mode: 'live', requested: false, proven: false }), { dryRun: true, forced: true });
t('asking for a dry run is honoured either way',   dryRunPlan({ mode: 'live', requested: true, proven: false }), { dryRun: true, forced: true });
t('once proven, a real run is allowed',            dryRunPlan({ mode: 'live', requested: false, proven: true }), { dryRun: false, forced: false });
t('once proven, the default is still a real run',  dryRunPlan({ mode: 'live', proven: true }), { dryRun: false, forced: false });
t('a proven month can still be dry-run on request', dryRunPlan({ mode: 'live', requested: true, proven: true }), { dryRun: true, forced: false });

t('REPLAY is never forced into a dry run',         dryRunPlan({ mode: 'replay', proven: false }), { dryRun: false, forced: false });
t('REPLAY honours an explicit dry run',            dryRunPlan({ mode: 'replay', requested: true, proven: false }), { dryRun: true, forced: false });

t('the dry run begins at stage 03',                DRY_FROM, '03');
t('stage 00 is real on a dry run',                 isDryStage(DRY_FROM, '00'), false);
t('stage 01 is real on a dry run',                 isDryStage(DRY_FROM, '01'), false);
t('stage 02 is real on a dry run',                 isDryStage(DRY_FROM, '02'), false);
t('stage 03 is dry',                               isDryStage(DRY_FROM, '03'), true);
t('stage 06 would be dry too',                     isDryStage(DRY_FROM, '06'), true);
t('no dryFrom means nothing is dry',               isDryStage(null, '03'), false);

console.log('\n══ A STATUS FILE NAMES ITS OWN AS-OF DATE ══\n');

t('the underscore form every real August file uses', parseStatusDate('Bucket Status 17 Aug_26.xlsx'), '2026-08-17');
t('the apostrophe form the header documents',        parseStatusDate("Bucket Status 14 Aug'26.xlsx"), '2026-08-14');
t('the curly apostrophe',                            parseStatusDate('Bucket Status 14 Aug\u201926.xlsx'), '2026-08-14');
t('a plain space',                                   parseStatusDate('Bucket Aug SOC status File 15th Aug 26.xlsx'), '2026-08-15');
t('a hyphen',                                        parseStatusDate('Bucket Status 17 Aug-26.xlsx'), '2026-08-17');
t('a full stop',                                     parseStatusDate('Bucket Status 17 Aug.26.xlsx'), '2026-08-17');
t('a four-digit year',                               parseStatusDate('Status 5 Sep 2026.xlsx'), '2026-09-05');
t('July spelled out',                                parseStatusDate("Status File 17 July'26.xlsx"), '2026-07-17');

t('no date at all is null, never a guess',           parseStatusDate('no date here.xlsx'), null);
t('day 45 is refused',                               parseStatusDate('Bucket Status 45 Aug_26.xlsx'), null);
t('a word between month and year is refused',        parseStatusDate('14 Aug backup 26.xlsx'), null);

console.log('\n══ THREE SHAPES, OR ~5% OF A MONTH IS DROPPED ══\n');

t('the ordinary 8-digit suffix',        splitExternalId('0007476780006975616_11082026').loadDate, '2026-08-11');
t('a stray digit at position 2',        splitExternalId('0007476780006975616_110082026').loadDate, '2026-08-11');
t('a truncated year',                   splitExternalId('0007476780006975616_1708206').loadDate,   '2026-08-17');
t('no underscore at all',               splitExternalId('000747678000697561611082026').loadDate,   '2026-08-11');
t('a trailing hash is not a date',      splitExternalId('0007476780006975616_11082026#').loadDate, null);
t('the account survives the split',     splitExternalId('0007476780006975616_11082026').account,   '0007476780006975616');
t('an unreadable id yields null, never a date', splitExternalId('nonsense').loadDate,              null);
t('an empty id yields null',            splitExternalId('').loadDate,                              null);

t('day 45 is not a date',               splitExternalId('123_45082026').loadDate,                   null);
t('month 19 is not a date',             splitExternalId('123_11192026').loadDate,                   null);

{
  const hist = loadDateHistogram([
    '1_11082026', '2_110082026', '3_1108206', '411082026',
    '5_12082026',
    'junk',
  ]);
  t('the histogram finds the majority cohort', hist.dates[0], { date: '2026-08-11', rows: 4 });
  t('a minority cohort is reported, not merged', hist.dates[1], { date: '2026-08-12', rows: 1 });
  t('unreadable rows are counted, never rounded away', hist.unreadable, 1);
}

console.log(`\n${fails ? '✘' : '✔'} ${checks - fails}/${checks} checks passed\n`);
process.exit(fails ? 1 : 0);
