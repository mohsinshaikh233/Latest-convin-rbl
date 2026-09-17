import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ORDER, WORK_STAGES, stageName } from '../../../scripts/pipeline/stages.mjs';
import { pipelineRoot } from '../../../scripts/pipeline/paths.mjs';

import { RULINGS, rulingsForItem, isDriftItem } from '../../../scripts/pipeline/05_assemble.mjs';

const MAX_EVENTS = 5000;
const KEEP_HEAD = 1000;
const MAX_LINE = 2000;
const TAIL_LINES = 20;
const LOCK_HEARTBEAT_MS = 10 * 60_000;

const STALL_MS = 3 * 60_000;

const REPO = process.cwd();
const ENV_FILE = path.join(REPO, '.env.local');

const runsDir = () => path.join(pipelineRoot(), 'console', 'runs');

const KEY = '__rblConsoleRunner';
function registry() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = { runs: new Map(), byMonth: new Map(), listeners: new Map() };
  }
  return globalThis[KEY];
}

export class LockedError extends Error {
  constructor(message, holder) {
    super(message);
    this.name = 'LockedError';
    this.holder = holder;
  }
}

const shq = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);
export const commandLine = (args) => ['node', ...args].map(shq).join(' ');

function stageArgs(stage, month, extra = []) {
  return [
    ...(fs.existsSync(ENV_FILE) ? [`--env-file=${path.relative(REPO, ENV_FILE)}`] : []),
    'scripts/pipeline/run.mjs',
    '--stage', stage,
    '--month', month,
    '--json',
    ...extra,
  ];
}

function runStage({ args, onLine, onChild, onStall, env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', args, { cwd: REPO, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    onChild?.(child);

    let lastOutput = Date.now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (stalled || Date.now() - lastOutput < STALL_MS) return;
      stalled = true;
      onStall?.(Math.round((Date.now() - lastOutput) / 1000));
    }, 15_000);
    if (watchdog.unref) watchdog.unref();

    let out = '';
    let errBuf = '';
    const tail = [];

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; lastOutput = Date.now(); });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      lastOutput = Date.now();
      errBuf += d;
      let nl;
      while ((nl = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, nl).replace(/\r$/, '').slice(0, MAX_LINE);
        errBuf = errBuf.slice(nl + 1);
        tail.push(line);
        if (tail.length > TAIL_LINES) tail.shift();
        onLine?.(line);
      }
    });

    const finish = (code, signal, spawnError) => {
      clearInterval(watchdog);
      if (errBuf.length) {
        const line = errBuf.slice(0, MAX_LINE);
        tail.push(line);
        if (tail.length > TAIL_LINES) tail.shift();
        onLine?.(line);
        errBuf = '';
      }
      resolve({
        code: code ?? (signal ? 137 : 1),
        signal: signal ?? null,
        result: lastJson(out),
        stdout: out,
        tail: [...tail],
        ms: Date.now() - started,
        pid: child.pid ?? null,
        stalled,
        spawnError: spawnError ?? null,
      });
    };

    child.on('error', (e) => finish(1, null, e.message));
    child.on('close', (code, signal) => finish(code, signal, null));
  });
}

export function lastJson(stdout) {
  const lines = String(stdout ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || (line[0] !== '{' && line[0] !== '[')) continue;
    try { return JSON.parse(line); } catch {  }
  }
  return null;
}

function persist(run) {
  try {
    fs.mkdirSync(runsDir(), { recursive: true });
    const p = path.join(runsDir(), `${run.runId}.json`);
    const tmp = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(publicRun(run, true)));
    fs.renameSync(tmp, p);
  } catch {
  }
}

export function publicRun(run, withEvents = false) {
  return {
    runId: run.runId,
    month: run.month,
    mode: run.mode,
    dryRun: run.dryRun,
    scratchDate: run.scratchDate,
    dryRunForced: !!run.dryRunForced,
    dryFrom: run.dryFrom,
    inputDir: run.inputDir,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    startedBy: run.startedBy,
    status: run.status,
    order: run.order,
    stages: run.stages,
    cohorts: run.cohorts,
    books: run.books,
    metrics: run.metrics,
    decisions: run.decisions,
    pending: run.pending,
    error: run.error,
    lock: run.lock,
    ...(withEvents ? { events: run.events } : {}),
  };
}

function emit(run, type, data = {}) {
  const ev = { seq: ++run.seq, t: Date.now(), type, ...data };
  run.events.push(ev);
  if (run.events.length > MAX_EVENTS) {
    const dropped = run.events.length - MAX_EVENTS;
    const marker = { seq: ev.seq, t: Date.now(), type: 'log', stage: null, line: `── ${dropped + 1} earlier line(s) dropped to stay inside the ${MAX_EVENTS}-event buffer ──`, marker: true };
    run.events = [...run.events.slice(0, KEEP_HEAD), marker, ...run.events.slice(KEEP_HEAD + dropped + 1)];
  }
  for (const fn of registry().listeners.get(run.runId) ?? []) {
    try { fn(ev); } catch {  }
  }
  return ev;
}

async function lockOp(month, extra, runId) {
  const args = stageArgs('lock', month, [...extra, '--run-id', runId]);
  const r = await runStage({ args });
  return { ...r, command: commandLine(args) };
}

export const DECISIONS = {
  '02': {
    kind: 'assignments',
    flag: '--apply-assignments',
    title: 'Which campaign does this book belong to?',
    why: 'plan_month infers the campaign from the book name and is right most of the time. "Most of the time" is the failure this stop exists to close: a wrong campaign renders every number, and every number is wrong.',
    items: (result) => result?.unassigned ?? [],
  },
  '05': {
    kind: 'rulings',
    flag: '--apply-rulings',
    title: 'A book has a gap. What should happen to it?',
    why: 'A missing status file is not a fact the pipeline can rule on. July\'s Bucket Status 26 July was never produced by RBL at all — only a person can say whether that means build short, wait, or drop the book.',

    items: (result) => [...(result?.unresolvedGaps ?? []), ...(result?.unresolvedDrift ?? [])],
  },
};

export { RULINGS, rulingsForItem, isDriftItem };

export function liveDryRunDone(month) {
  return listRuns(200).some((r) => r.month === month && r.mode === 'live' && r.dryRun === true
    && ['done', 'dry-run-complete'].includes(r.status));
}

export function dryRunPlan({ mode, requested = null, proven = false }) {
  if (mode !== 'live') return { dryRun: requested === true, forced: false };
  if (!proven) return { dryRun: true, forced: true };
  return { dryRun: requested === true, forced: false };
}

export const DRY_FROM = '03';
export const isDryStage = (dryFrom, stage) => !!dryFrom && Number(stage) >= Number(dryFrom);

function scratchDateFor(runId) {
  let h = 0;
  for (let i = 0; i < runId.length; i++) h = (h * 31 + runId.charCodeAt(i)) >>> 0;
  const d = new Date(Date.UTC(2099, 0, 1) + (h % 365) * 86400000);
  return d.toISOString().slice(0, 10);
}

function newRun({ month, mode, inputDir, startedBy, dryRun }) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  return {
    runId,
    month,
    mode,
    dryRun: !!dryRun,

    scratchDate: scratchDateFor(runId),

    dryFrom: dryRun ? DRY_FROM : null,
    inputDir: inputDir || null,
    startedBy: startedBy || 'operator',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    seq: 0,
    order: ORDER.map((s) => ({ stage: s, name: stageName(s) })),
    stages: Object.fromEntries(ORDER.map((s) => [s, { stage: s, name: stageName(s), status: 'idle' }])),
    cohorts: [],
    books: [],
    metrics: {},
    decisions: [],
    pending: null,
    error: null,
    lock: null,
    events: [],
    _resume: null,
    _aborted: false,
    _child: null,
    _heartbeat: null,
  };
}

export function scopeFor(mode) {
  return WORK_STAGES.filter((s) => (mode === 'replay' ? Number(s) >= 5 : true));
}

function extraArgsFor(run, stage) {
  const extra = ['--run-id', run.runId];

  if (isDryStage(run.dryFrom, stage)) extra.push('--dry-run');
  if (run.mode === 'replay') {
    if (stage === '00') extra.push('--stages', scopeFor(run.mode).join(','));
    if (stage === '01' && run.inputDir) extra.push('--from-dir', run.inputDir);
    if (stage === '03') {
      extra.push('--use-cached');
      if (run.inputDir) extra.push('--cached-from', run.inputDir);
    }
  }
  return extra;
}

async function invoke(run, stage, extra, { cohort = null } = {}) {
  const args = stageArgs(stage, run.month, extra);
  const command = commandLine(args);
  const r = await runStage({
    args,
    env: { PIPELINE_SCRATCH_DATE: run.scratchDate },
    onLine: (line) => emit(run, 'log', { stage, cohort, line }),

    onChild: (child) => { run._child = child; },
    onStall: (seconds) => {
      markStage(run, stage, { stalled: true, silentFor: seconds });
      emit(run, 'stage:stalled', { stage, cohort, seconds, command });
      emit(run, 'notice', {
        level: 'warn',
        text: `Stage ${stage} has printed nothing for ${Math.round(seconds / 60)} minute(s). It may still be working — stage 03 polls Convin for up to 20 — or it may be stuck. Stop will end it.`,
      });
    },
  });
  run._child = null;
  return { ...r, command };
}

function markStage(run, stage, patch) {
  run.stages[stage] = { ...run.stages[stage], ...patch };
}

function park(run) {
  return new Promise((resolve) => { run._resume = resolve; });
}

function fail(run, stage, r, extraFields = {}) {
  markStage(run, stage, { status: 'failed', code: r.code, ms: r.ms, tail: r.tail, command: r.command });
  run.status = 'failed';
  run.finishedAt = new Date().toISOString();
  run.error = {
    stage,
    name: stageName(stage),
    code: r.code,
    signal: r.signal,
    tail: r.tail,
    command: r.command,
    result: r.result,
    reason: r.result?.reason ?? r.spawnError ?? (r.signal ? `killed by ${r.signal}` : `stage ${stage} exited ${r.code}`),
    ...extraFields,
  };
  emit(run, 'stage:failed', { stage, code: r.code, signal: r.signal, ms: r.ms, tail: r.tail, command: r.command, reason: run.error.reason });
  emit(run, 'run:failed', { reason: run.error.reason, stage });
}

async function cohortLoop(run) {
  markStage(run, '03', { status: 'running', startedAt: new Date().toISOString() });
  emit(run, 'stage:start', { stage: '03' });

  const listed = await invoke(run, '03', ['--list-cohorts', '--run-id', run.runId]);
  if (listed.code !== 0) { fail(run, '03', listed); return false; }

  const cohorts = listed.result?.cohorts ?? [];
  run.cohorts = cohorts.map((c) => ({ ...c, status: c.collected ? 'done' : 'idle' }));
  emit(run, 'cohort:list', { cohorts: run.cohorts });

  const todo = run.cohorts.filter((c) => !c.collected);
  if (!todo.length) emit(run, 'notice', { level: 'info', text: `all ${run.cohorts.length} cohort(s) are already collected — nothing to export` });

  for (const c of todo) {
    if (run._aborted) return false;

    setCohort(run, c.key, { status: 'exporting' });
    emit(run, 'cohort:start', { stage: '03', key: c.key });
    const exArgs = ['--cohort', c.key, ...extraArgsFor(run, '03')];
    let ex = await invoke(run, '03', exArgs, { cohort: c.key });
    if (ex.code === 10) {
      ex = await stop(run, '03', ex, { baseArgs: exArgs, cohort: c.key });
      if (!ex) return false;
    }
    if (run._aborted) return false;
    if (ex.code !== 0) { setCohort(run, c.key, { status: 'failed' }); fail(run, '03', ex, { cohort: c.key }); return false; }
    const cached = ex.result?.mode === 'cache';
    setCohort(run, c.key, {
      status: run.dryRun ? 'would-export' : 'exported',
      cached,
      exportMode: ex.result?.mode ?? null,
      source: ex.result?.source ?? null,
      sourceFile: ex.result?.source ? ex.result.source.split('/').pop() : null,
      membershipPct: ex.result?.match?.membershipPct ?? null,
      wouldFire: ex.result?.wouldFire ?? null,
    });
    emit(run, 'cohort:done', { stage: '03', key: c.key, code: 0, ms: ex.ms, cached, dryRun: run.dryRun, result: ex.result });

    if (run.dryRun) {
      setCohort(run, c.key, { status: 'would-export' });
      continue;
    }
    if (run.stages['04'].status !== 'running') {
      markStage(run, '04', { status: 'running', startedAt: new Date().toISOString() });
      emit(run, 'stage:start', { stage: '04' });
    }
    setCohort(run, c.key, { status: 'collecting' });
    emit(run, 'cohort:start', { stage: '04', key: c.key });
    const colArgs = ['--cohort', c.key, '--run-id', run.runId];
    let col = await invoke(run, '04', colArgs, { cohort: c.key });
    if (col.code === 10) {
      col = await stop(run, '04', col, { baseArgs: colArgs, cohort: c.key });
      if (!col) return false;
    }
    if (run._aborted) return false;
    if (col.code !== 0) { setCohort(run, c.key, { status: 'failed' }); fail(run, '04', col, { cohort: c.key }); return false; }
    setCohort(run, c.key, { status: 'done', rows: col.result?.repair?.rows ?? null });
    emit(run, 'cohort:done', { stage: '04', key: c.key, code: 0, ms: col.ms, result: col.result });
  }

  const done = run.dryRun ? ['03'] : ['03', '04'];
  for (const s of done) {
    markStage(run, s, {
      status: 'done', code: 0, endedAt: new Date().toISOString(),
      result: {
        cohorts: run.cohorts.length,
        collected: run.cohorts.filter((c) => c.status === 'done').length,
        ...(run.dryRun ? { dryRun: true, wouldExport: run.cohorts.filter((c) => c.status === 'would-export').length } : {}),
        ...(run.cohorts.some((c) => c.cached) ? { servedFromCache: run.cohorts.filter((c) => c.cached).length } : {}),
      },
    });
    emit(run, 'stage:done', { stage: s, code: 0, result: run.stages[s].result, ms: 0 });
  }
  return true;
}

function setCohort(run, key, patch) {
  run.cohorts = run.cohorts.map((c) => (c.key === key ? { ...c, ...patch } : c));
}

async function stop(run, stage, r, { baseArgs = [], cohort = null } = {}) {
  markStage(run, stage, { status: 'stopped', code: 10, ms: r.ms, result: r.result, command: r.command });

  let question = r;
  for (;;) {
    const parked = park(run);
    setPending(run, stage, question, cohort);
    persist(run);

    const answer = await parked;
    if (!answer || run._aborted) return null;

    const retry = await invoke(run, stage, [...answer.extraArgs, ...baseArgs], { cohort });

    if (retry.code === 2) {
      emit(run, 'decision:rejected', { stage, reason: retry.result?.reason ?? 'rejected', rejected: retry.result?.rejected ?? [] });
      answer.settle({ ok: false, status: 400, error: retry.result?.reason ?? 'the pipeline rejected this answer', rejected: retry.result?.rejected ?? [], command: retry.command });
      continue;
    }

    record(run, { stage, kind: answer.kind, entries: answer.entries, reason: answer.reason, by: answer.by, command: retry.command, accepted: true });
    answer.settle({ ok: true, status: 200, code: retry.code, result: retry.result, command: retry.command });

    if (retry.code === 10) {
      question = retry;
      continue;
    }

    run.pending = null;
    run.status = 'running';
    return retry;
  }
}

function setPending(run, stage, r, cohort) {
  const spec = DECISIONS[stage];
  run.status = 'awaiting-decision';
  run.pending = {
    stage,
    name: stageName(stage),
    cohort,
    kind: spec?.kind ?? 'acknowledge',
    title: spec?.title ?? `Stage ${stage} · ${stageName(stage)} stopped for a person`,
    why: spec?.why ?? 'This stop has no form: the pipeline is telling you something it cannot decide. Say what you checked and re-run the stage.',
    reason: r.result?.reason ?? r.result?.note ?? null,

    items: spec ? spec.items(r.result).map((i) => (spec.kind === 'rulings'
      ? { ...i, rulings: rulingsForItem(i), findingKind: isDriftItem(i) ? 'drift' : 'gap' }
      : i)) : [],
    result: r.result,
    command: r.command,
    tail: r.tail,
  };
  emit(run, 'decision:required', { ...run.pending });
}

async function loop(run) {
  emit(run, 'run:start', {
    runId: run.runId, month: run.month, mode: run.mode, dryRun: run.dryRun, dryFrom: run.dryFrom,
    inputDir: run.inputDir,
    order: run.order, startedBy: run.startedBy, startedAt: run.startedAt, lock: run.lock,
  });
  emit(run, 'notice', {
    level: 'info',
    text: `Reports build on scratch date ${run.scratchDate}, unique to this run — so a previous run that was killed cannot block this one.`,
  });
  if (run.dryRun) {
    emit(run, 'notice', {
      level: 'info',
      text: 'DRY RUN — the first LIVE run of a month never fires an export. Stages 00-02 run for real against S3 and the plan; stage 03 reports what it would fire and reaches no network.',
    });
  }

  for (const stage of ORDER) {
    if (run._aborted) break;
    if (run.stages[stage].status === 'done') continue;

    if (run.dryRun && Number(stage) >= 4) {
      run.status = 'dry-run-complete';
      run.finishedAt = new Date().toISOString();
      emit(run, 'notice', { level: 'info', text: `Dry run complete. ${run.cohorts.length} cohort(s) would be exported. Nothing was fired and no mailbox was opened — run again to do it for real.` });
      emit(run, 'run:done', { status: run.status, metrics: run.metrics, dryRun: true });
      return;
    }

    if (stage === '03') {
      const ok = await cohortLoop(run);
      if (!ok) return;
      continue;
    }

    markStage(run, stage, { status: 'running', startedAt: new Date().toISOString() });
    emit(run, 'stage:start', { stage });

    const base = extraArgsFor(run, stage);
    let r = await invoke(run, stage, base);

    if (r.code === 10) {
      r = await stop(run, stage, r, { baseArgs: base });
      if (!r) return;
    }

    if (run._aborted) return;
    if (r.code !== 0) { fail(run, stage, r); return; }

    markStage(run, stage, { status: 'done', code: 0, ms: r.ms, result: r.result, command: r.command, endedAt: new Date().toISOString() });
    absorb(run, stage, r.result);
    emit(run, 'stage:done', { stage, code: 0, ms: r.ms, result: r.result });
    persist(run);
  }

  run.status = run._aborted ? 'aborted' : 'done';
  run.finishedAt = new Date().toISOString();
  emit(run, run._aborted ? 'run:aborted' : 'run:done', { status: run.status, metrics: run.metrics });
}

function absorb(run, stage, result) {
  if (!result) return;
  if (stage === '02') {
    run.metrics = { ...run.metrics, books: result.totals?.books ?? null, cohorts: result.totals?.exports ?? null, warnings: result.warnings?.length ?? 0 };
  }
  if (stage === '05') {
    run.books = (result.state?.assembled?.books ?? []).map((b) => ({ book: b.book, days: b.days, cohortRows: b.total, status: 'assembled' }));
    run.metrics = { ...run.metrics, assembled: result.booksBuilt ?? null, gaps: result.booksGapped ?? null };
    emit(run, 'books', { books: run.books, statusWarnings: result.statusWarnings ?? [] });
  }
  if (stage === '06') {
    const reports = result.reports ?? [];
    run.books = run.books.length
      ? run.books.map((b) => { const r = reports.find((x) => x.book === b.book); return r ? { ...b, status: 'built', accounts: r.accounts, attempts: r.attempts, pdf: r.pdf } : b; })
      : reports.map((r) => ({ book: r.book, status: 'built', accounts: r.accounts, attempts: r.attempts, pdf: r.pdf }));
    run.metrics = {
      ...run.metrics,
      built: result.built ?? null,
      accounts: reports.reduce((a, r) => a + (r.accounts || 0), 0),
      attempts: reports.reduce((a, r) => a + (r.attempts || 0), 0),
    };
    emit(run, 'books', { books: run.books });
  }
  if (stage === '07') {
    run.metrics = { ...run.metrics, verified: result.ok === true, booksChecked: result.booksChecked ?? null };
  }
  if (stage === '08') {
    run.metrics = { ...run.metrics, clientDocs: (result.documents ?? result.docs ?? []).length || null };
  }
  emit(run, 'metrics', { metrics: run.metrics });
}

export async function startRun({ month, mode = 'live', inputDir = null, startedBy = 'operator', dryRun = null }) {
  if (!/^\d{4}-\d{2}$/.test(String(month ?? ''))) throw new Error('month must be YYYY-MM');
  if (mode !== 'live' && mode !== 'replay') throw new Error('mode must be "live" or "replay"');

  const { dryRun: isDry, forced } = dryRunPlan({ mode, requested: dryRun, proven: liveDryRunDone(month) });

  const reg = registry();
  const running = reg.byMonth.get(month);
  if (running && reg.runs.get(running) && ['running', 'awaiting-decision'].includes(reg.runs.get(running).status)) {
    const other = reg.runs.get(running);
    throw new LockedError(`month ${month} is already running in this console as ${other.runId}, started ${other.startedAt}`, { runId: other.runId, since: other.startedAt, inProcess: true });
  }

  const run = newRun({ month, mode, inputDir, startedBy, dryRun: isDry });
  run.dryRunForced = forced;

  const acq = await lockOp(month, ['--acquire'], run.runId);
  if (acq.code === 10) {
    const h = acq.result?.holder ?? {};
    throw new LockedError(acq.result?.reason ?? `month ${month} is locked`, { runId: h.runId ?? null, since: h.acquiredAt ?? null, host: h.host ?? null, pid: h.pid ?? null });
  }
  if (acq.code !== 0) throw new Error(`could not take the month lock (exit ${acq.code}): ${acq.tail.join(' ') || acq.result?.reason || 'unknown'}`);
  run.lock = { runId: run.runId, acquiredAt: acq.result?.lock?.acquiredAt ?? new Date().toISOString(), tookFrom: acq.result?.tookFrom ?? null };

  reg.runs.set(run.runId, run);
  reg.byMonth.set(month, run.runId);

  run._heartbeat = setInterval(() => { lockOp(month, ['--acquire'], run.runId).catch(() => {}); }, LOCK_HEARTBEAT_MS);
  if (run._heartbeat.unref) run._heartbeat.unref();

  loop(run)
    .catch((e) => {
      run.status = 'failed';
      run.finishedAt = new Date().toISOString();
      run.error = { stage: null, code: null, reason: `the runner itself failed: ${e.message}`, tail: [], command: null };
      emit(run, 'run:failed', { reason: run.error.reason });
    })
    .finally(async () => {
      clearInterval(run._heartbeat);
      if (['running', 'awaiting-decision'].includes(run.status)) {
        run.status = 'aborted';
        run.finishedAt = new Date().toISOString();
        run.pending = null;
        emit(run, 'run:aborted', { status: 'aborted' });
      }
      const rel = await lockOp(month, ['--release'], run.runId).catch(() => null);
      run.lock = { ...run.lock, released: rel?.result?.released ?? false, releasedAt: new Date().toISOString() };
      emit(run, 'lock:released', { released: run.lock.released });
      persist(run);
      if (registry().byMonth.get(month) === run.runId) registry().byMonth.delete(month);
    });

  return run;
}

export const getRun = (runId) => registry().runs.get(runId) ?? null;

export function listRuns(limit = 25) {
  const live = [...registry().runs.values()].map((r) => publicRun(r));
  const seen = new Set(live.map((r) => r.runId));
  let onDisk = [];
  try {
    onDisk = fs.readdirSync(runsDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir(), f), 'utf8')); } catch { return null; } })
      .filter((r) => r && !seen.has(r.runId))
      .map(({ events: _events, ...rest }) => rest);
  } catch {  }
  return [...live, ...onDisk].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, limit);
}

export function loadRun(runId) {
  const live = getRun(runId);
  if (live) return publicRun(live, true);
  try {
    return JSON.parse(fs.readFileSync(path.join(runsDir(), `${String(runId).replace(/[^A-Za-z0-9._-]/g, '')}.json`), 'utf8'));
  } catch { return null; }
}

export function subscribe(runId, fn) {
  const reg = registry();
  const set = reg.listeners.get(runId) ?? new Set();
  set.add(fn);
  reg.listeners.set(runId, set);
  return () => { set.delete(fn); if (!set.size) reg.listeners.delete(runId); };
}

export function replayEvents(runId, afterSeq = 0) {
  const run = getRun(runId);
  if (run) return run.events.filter((e) => e.seq > afterSeq);
  const stored = loadRun(runId);
  return (stored?.events ?? []).filter((e) => e.seq > afterSeq);
}

export function submitDecision(runId, { entries, reason, by }) {
  const run = getRun(runId);
  if (!run) return Promise.resolve({ ok: false, status: 404, error: 'no such run in this process' });
  if (run.status !== 'awaiting-decision' || !run.pending) return Promise.resolve({ ok: false, status: 409, error: 'this run is not waiting for a decision' });

  const stage = run.pending.stage;
  const spec = DECISIONS[stage];

  const trimmedReason = String(reason ?? '').trim();
  if (!trimmedReason) {
    return Promise.resolve({ ok: false, status: 400, error: 'a reason is required — a decision with no reason cannot be audited later' });
  }

  let extraArgs = [];
  let payload = [];

  if (spec) {
    if (!Array.isArray(entries) || !entries.length) {
      return Promise.resolve({ ok: false, status: 400, error: `${spec.flag} expects a non-empty array of answers` });
    }
    payload = entries.map((e) => (spec.kind === 'rulings'
      ? { book: e.book, ruling: e.ruling, reason: String(e.reason ?? '').trim() || trimmedReason }
      : { book: e.book, campaign: e.campaign, ...(e.days === undefined || e.days === null || e.days === '' ? {} : { days: Number(e.days) }), reason: trimmedReason }));
    extraArgs = [spec.flag, JSON.stringify(payload), '--decided-by', by || 'console'];
  }

  return new Promise((settle) => {
    const resolveLoop = run._resume;
    run._resume = null;
    if (!resolveLoop) { settle({ ok: false, status: 409, error: 'nothing is parked on this decision' }); return; }
    resolveLoop({ extraArgs, entries: payload, reason: trimmedReason, by: by || 'console', kind: spec?.kind ?? 'acknowledge', settle });
  });
}

function record(run, d) {
  const entry = { ...d, at: new Date().toISOString() };
  run.decisions.push(entry);
  emit(run, 'decision:submitted', entry);
  persist(run);
}

export function abortRun(runId, by) {
  const run = getRun(runId);
  if (!run) return { ok: false, status: 404, error: 'no such run' };
  if (!['running', 'awaiting-decision'].includes(run.status)) return { ok: false, status: 409, error: `run is ${run.status}` };

  run._aborted = true;
  const child = run._child;

  emit(run, 'notice', {
    level: 'warn',
    text: child
      ? `Stop requested by ${by || 'operator'} — ending the stage in flight (pid ${child.pid}).`
      : `Stop requested by ${by || 'operator'} — the run stops at the next stage.`,
  });

  if (child && child.exitCode === null && !child.killed) {
    try { child.kill('SIGTERM'); } catch {  }
    const hard = setTimeout(() => {
      try { if (child.exitCode === null) child.kill('SIGKILL'); } catch {  }
    }, 4000);
    if (hard.unref) hard.unref();
  }

  const resolveLoop = run._resume;
  run._resume = null;
  resolveLoop?.(null);
  return { ok: true, status: 200 };
}
