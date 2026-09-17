#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { STAGES } from '../scripts/pipeline/stages.mjs';

const REPO = process.cwd();
const SCRATCH_MONTH = '2099-12';
const results = [];
const bar = '─'.repeat(76);

const record = (n, name, status, detail) => {
  results.push({ n, name, status, detail });
  const mark = { PASS: '✔', FAIL: '✘', PARTIAL: '◑', BLOCKED: '⊘' }[status];
  console.log(`\n  ${mark} ${n} · ${name} — ${status}`);
  for (const line of String(detail).split('\n')) console.log(`      ${line}`);
};

const statePath = (m) => path.join(REPO, 'state', `${m}.json`);
const cleanState = (m) => { fs.rmSync(statePath(m), { force: true }); fs.rmSync(statePath(m).replace('.json', '.lock.json'), { force: true }); };

function pipeline(args) {
  try {
    const stdout = execSync(`npm run pipeline --silent -- ${args}`, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

console.log(`\n${bar}\n  ACCEPTANCE — n8n/HANDOFF_N8N_MAX.md §5\n${bar}`);

try {
  execFileSync('node', ['scripts/lint_workflows.mjs'], { cwd: REPO, stdio: 'pipe' });
  const files = fs.readdirSync(path.join(REPO, 'n8n')).filter((f) => f.endsWith('.workflow.json'));
  record(1, 'Graph lint', 'PASS', `${files.length} workflow(s) clean: no orphan nodes, no dangling connections, both IF branches wired, every Execute Workflow and Execute Command target exists, no inline credentials, errorWorkflow set.\nWired into npm run test:all.`);
} catch (e) {
  record(1, 'Graph lint', 'FAIL', String(e.stdout ?? e.message).slice(-1500));
}

{
  const july = statePath('2026-07');
  const assembled = path.join(REPO, '.pipeline-data', 'assembled', '2026-07');
  const evidence = [
    `state/2026-07.json exists: ${fs.existsSync(july)}`,
    `.pipeline-data/assembled/2026-07 exists: ${fs.existsSync(assembled)}`,
  ];
  const hadJulyState = fs.existsSync(july);
  const res = pipeline('--month 2026-07 --from 05 --dry-run');
  const line = res.stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
  const reason = line ? (JSON.parse(line).reason ?? '') : '(no JSON)';

  if (!hadJulyState) cleanState('2026-07');
  record(2, 'July replay — 32 books · 30,954 accounts · 403,682 attempts', 'BLOCKED',
    [`The source data is gone. ~/Downloads/July 2026 holds only the 40 delivered PDFs`,
      `(32 PreX + 8 Bucket); there is no assembled tree and no cohort call logs.`,
      ...evidence,
      `Replay attempt exits ${res.code}: "${reason}"`,
      ``,
      `The reference numbers therefore remain UNREPRODUCED. This is the same loss`,
      `AUGUST_BUILD_RESULT.md called its largest finding, now true of July as well.`].join('\n'));
}

{
  cleanState(SCRATCH_MONTH);
  const bad = []; const seen = [];
  for (const stage of Object.keys(STAGES)) {
    const res = pipeline(`--stage ${stage} --month ${SCRATCH_MONTH} --json`);
    const lines = res.stdout.split('\n').filter((l) => l.trim() !== '');
    const jsonLines = lines.filter((l) => l.trim().startsWith('{'));
    const last = jsonLines[jsonLines.length - 1];

    let parsed = null;
    if (last) { try { parsed = JSON.parse(last); } catch (e) { bad.push(`stage ${stage}: last JSON line does not parse (${e.message})`); } }

    const isCrash = res.code !== 0 && res.code !== 10;

    if (!isCrash && !parsed) bad.push(`stage ${stage}: exited ${res.code} with no parseable JSON line on stdout`);

    const noise = lines.filter((l) => !l.trim().startsWith('{'));
    if (noise.length) bad.push(`stage ${stage}: ${noise.length} non-JSON line(s) on stdout — progress must go to stderr: ${JSON.stringify(noise[0].slice(0, 60))}`);

    seen.push(`${stage}→${res.code}${parsed ? '+json' : ''}`);
  }
  cleanState(SCRATCH_MONTH);
  record(3, 'Contract conformance across every stage',
    bad.length ? 'FAIL' : 'PASS',
    bad.length ? bad.join('\n') : `${Object.keys(STAGES).length} stages checked: ${seen.join(' ')}\nLast stdout line parses as JSON whenever the stage claims to have finished; exit codes are only 0, 10 or a crash class; no progress output reached stdout.`);
}

{
  cleanState(SCRATCH_MONTH);
  const notes = []; const bad = [];

  const child = spawn('node', ['-e', `
    import('${path.join(REPO, 'scripts/pipeline/state.mjs').replace(/\\/g, '/')}').then(({ markStage }) => {
      for (let i = 0; i < 1e6; i++) markStage('${SCRATCH_MONTH}', '05', { round: i, blob: 'x'.repeat(4000) });
    });
  `], { cwd: REPO, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 200));

  const sp = statePath(SCRATCH_MONTH);
  if (!fs.existsSync(sp)) bad.push('no state file was written before the kill — the test proved nothing');
  else {
    try {
      const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
      notes.push(`state survived SIGKILL mid-write and parses (last recorded round ${st.stages?.['05']?.round ?? '?'})`);
    } catch (e) {
      bad.push(`state/${SCRATCH_MONTH}.json is CORRUPT after SIGKILL: ${e.message} — the atomic write does not hold`);
    }
  }
  const strays = fs.readdirSync(path.join(REPO, 'state')).filter((f) => f.includes('.tmp.'));
  if (strays.length) notes.push(`${strays.length} .tmp file(s) left behind (harmless, but they accumulate): ${strays.join(', ')}`);
  for (const f of strays) fs.rmSync(path.join(REPO, 'state', f), { force: true });

  fs.writeFileSync(sp, JSON.stringify({
    month: SCRATCH_MONTH,
    stages: {
      '02': { code: 0, plan: { cohorts: [
        { campaign: 'prex', startDate: '2099-12-05', endDate: '2099-12-09', books: ['A'] },
        { campaign: 'bucket', startDate: '2099-12-12', endDate: '2099-12-16', books: ['B'] },
      ] } },
      '04': { code: 0, collected: { 'prex|2099-12-05': { repairedOk: true } } },
    },
    cohorts: {}, books: {},
  }));
  const listed = pipeline(`--stage 03 --month ${SCRATCH_MONTH} --list-cohorts --json`);
  const cohorts = JSON.parse(listed.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop()).cohorts;
  const done = cohorts.filter((c) => c.collected).map((c) => c.key);
  const todo = cohorts.filter((c) => !c.collected).map((c) => c.key);
  if (done.length !== 1 || todo.length !== 1) bad.push(`resume filter wrong: collected=${JSON.stringify(done)} outstanding=${JSON.stringify(todo)}`);
  else notes.push(`resume filter holds: ${done[0]} skipped, ${todo[0]} still outstanding`);

  cleanState(SCRATCH_MONTH);
  record(4, 'Kill and resume', bad.length ? 'FAIL' : 'PARTIAL',
    bad.length ? bad.join('\n')
      : [...notes,
        '',
        'PARTIAL: the mid-cohort SIGKILL the spec asks for needs a cohort that runs',
        'long enough to interrupt, which needs Convin credentials. What is proven here',
        'is the property that test rests on — state survives an abrupt kill, and a',
        'collected cohort is never re-attempted.'].join('\n'));
}

{
  cleanState(SCRATCH_MONTH);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbl-acc-'));
  const bad = []; const notes = [];

  const bookAccounts = Array.from({ length: 20 }, (_, i) => `00074768000${String(100000 + i)}`);
  const otherAccounts = Array.from({ length: 20 }, (_, i) => `00074768000${String(900000 + i)}`);
  const bookCsv = ['Account No,Customer Name,Outstanding', ...bookAccounts.map((a) => `${a},REDACTED,1000`)].join('\n');
  const statusCsv = ['Account No,Status', ...otherAccounts.map((a, i) => `${a},${i % 2 ? 'Resolved' : 'Unresolved'}`)].join('\n');

  const bookPath = path.join(dir, 'CYC 99 Convin.xlsx');
  const statusPath = path.join(dir, 'PreX Status 05 Dec 99.xlsx');
  fs.writeFileSync(bookPath, bookCsv);
  fs.writeFileSync(statusPath, statusCsv);
  fs.writeFileSync(path.join(dir, 'log.csv'), 'External ID,Call Time\n');

  fs.writeFileSync(statePath(SCRATCH_MONTH), JSON.stringify({
    month: SCRATCH_MONTH,
    stages: {
      '01': { code: 0, books: { 'CYC 99 Convin': { file: 'CYC 99 Convin.xlsx', path: bookPath, loadDate: '2099-12-04' } },
        statusFiles: [{ file: 'PreX Status 05 Dec 99.xlsx', path: statusPath, loadDate: '2099-12-05' }] },
      '02': { code: 0, plan: { books: [{ book: 'CYC 99 Convin', campaign: 'prex', loadDate: '2099-12-04', days: 1,
        dayFolders: [{ day: 1, date: '2099-12-05' }] }], cohorts: [] } },
      '04': { code: 0, collected: { 'prex|2099-12-04': { path: path.join(dir, 'log.csv'), repairedOk: true } } },
    },
    cohorts: {}, books: {},
  }));

  const asm = pipeline(`--stage 05 --month ${SCRATCH_MONTH} --json`);
  const line = asm.stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
  const out = line ? JSON.parse(line) : null;
  const finding = out?.campaignFindings?.[0];

  if (!finding) bad.push(`guard #4 did NOT fire on a Bucket book stated as PreX. Stage 05 exited ${asm.code}; findings=${JSON.stringify(out?.campaignFindings ?? null)}`);
  else {
    notes.push(`guard #4 fired: ${finding.reason}`);
    if (asm.code === 0) bad.push('guard #4 fired but the stage still exited 0 — a contradicted campaign must not pass');
    else notes.push(`stage 05 exited ${asm.code} (crash class — a campaign contradicted by its own data is a fault, not a question)`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  cleanState(SCRATCH_MONTH);
  record(5, 'Form round-trip — a wrong campaign is caught downstream',
    bad.length ? 'FAIL' : 'PARTIAL',
    bad.length ? bad.join('\n')
      : [...notes,
        '',
        'PARTIAL: the wrong campaign is injected directly into the plan rather than',
        'through the n8n form, because n8n is not running on this machine. The half',
        'that matters — a stated campaign contradicted by real status-file data is',
        'caught and refused downstream — is exercised for real. The form half is',
        'covered separately by the --apply-assignments validation tests.'].join('\n'));
}

{
  const wf = JSON.parse(fs.readFileSync(path.join(REPO, 'n8n', 'rbl-notify.workflow.json'), 'utf8'));
  const js = wf.nodes.find((n) => n.name === 'Format').parameters.jsCode;
  const fmt = (severity) => new Function('$input', '$vars', '$', js)(
    { first: () => ({ json: { severity, month: '2099-12', runId: 'r', title: 't', body: 'b' } }) }, {}, () => {},
  )[0].json;

  const stop = fmt('stop'); const fail = fmt('fail'); const info = fmt('info');
  const bad = [];
  if (stop.colour !== '#E8A33D') bad.push(`a stop is ${stop.colour}, expected amber #E8A33D`);
  if (fail.colour !== '#D14343') bad.push(`a crash is ${fail.colour}, expected red #D14343`);
  if (stop.colour === fail.colour) bad.push('a stop and a crash render identically — the distinction is lost at the last step');
  if (!/awaiting a decision/.test(JSON.stringify(stop.slackPayload))) bad.push('a stop does not say "awaiting a decision"');
  if (/awaiting a decision/.test(JSON.stringify(fail.slackPayload))) bad.push('a crash claims to be awaiting a decision');

  record(6, 'Notification severity — a 10 is amber, a crash is red',
    bad.length ? 'FAIL' : 'PARTIAL',
    bad.length ? bad.join('\n')
      : [`stop  → ${stop.colour} · "${stop.emailSubject}"`,
        `fail  → ${fail.colour} · "${fail.emailSubject}"`,
        `info  → ${info.colour}`,
        '',
        'PARTIAL: asserted against the workflow\'s real Format code rather than by',
        'screenshotting a live n8n, which is not running here. The screenshots §5',
        'asks for should be taken on the first real run and pasted into n8n/README.md.'].join('\n'));
}

const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${bar}`);
console.log(`  ${count('PASS')} pass · ${count('PARTIAL')} partial · ${count('BLOCKED')} blocked · ${count('FAIL')} fail`);
for (const r of results) console.log(`    ${r.status.padEnd(8)} ${r.n} · ${r.name}`);
console.log(bar + '\n');
process.exit(count('FAIL') ? 1 : 0);
