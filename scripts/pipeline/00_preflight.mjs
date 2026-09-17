import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check } from './config.mjs';
import { pipelineRoot } from './paths.mjs';
import { statePath } from './state.mjs';
import { WORK_STAGES } from './stages.mjs';
import { readLock, isStale, lockAgeHours, LOCK_STALE_HOURS } from './lock.mjs';
import { findChrome, CHROME_CANDIDATES } from './chrome.mjs';

const MIN_FREE_GB = Number(process.env.PIPELINE_MIN_FREE_GB || 20);

const NEEDS = {
  '01': { config: ['s3'], deps: ['@aws-sdk/client-s3'], disk: true, archive: true },
  '02': {},
  '03': { config: ['convin'], convinAuth: true },
  '04': { config: ['imap'], deps: ['imapflow'], archive: true },
  '05': { disk: true },
  '06': { config: ['db'], chrome: true, db: true, disk: true },
  '07': {},

  '08': { chrome: true, disk: true },
};

function resolveScope({ stages, only, from }) {
  if (stages) {
    const wanted = String(stages).split(',').map((s) => s.trim()).filter(Boolean);
    return wanted.filter((s) => WORK_STAGES.includes(s));
  }
  if (only) return WORK_STAGES.filter((s) => s === String(only));
  if (from) {
    const i = WORK_STAGES.indexOf(String(from));
    return i >= 0 ? WORK_STAGES.slice(i) : WORK_STAGES;
  }
  return [...WORK_STAGES];
}

const mk = (id, label, status, kind, detail, fix) => ({ id, label, status, kind, detail, ...(fix ? { fix } : {}) });

function freeBytes(dir) {
  let d = path.resolve(dir);
  while (!fs.existsSync(d)) {
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  const s = fs.statfsSync(d);
  return { free: s.bsize * s.bavail, at: d };
}

async function checkDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return mk('db.connect', 'DATABASE_URL reachable', 'skip', 'env', 'DATABASE_URL is not set — reported by the config check above');
  let client;
  try {
    const { default: pg } = await import('pg');
    client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await client.connect();
    await client.query('SELECT 1');
    const host = (() => { try { return new URL(url).host; } catch { return 'the configured host'; } })();
    return mk('db.connect', 'DATABASE_URL reachable', 'pass', 'env', `SELECT 1 succeeded against ${host}`);
  } catch (e) {
    return mk('db.connect', 'DATABASE_URL reachable', 'fail', 'env', `could not query: ${e.message}`,
      'Check the host is up and the URL is the pooler (port 6543) on a deployment, direct (5432) locally.');
  } finally {
    try { await client?.end(); } catch {  }
  }
}

function checkLock(month, runId) {
  const lock = readLock(month);
  if (!lock) return mk('state.lock', 'month lock', 'pass', 'state', 'no lock held');
  if (lock.corrupt) {
    return mk('state.lock', 'month lock', 'fail', 'state', `the lock file exists but does not parse: ${lock.error}`,
      'Delete it if no run is active — a corrupt lock blocks every future run.');
  }
  if (runId && lock.runId === runId) {
    return mk('state.lock', 'month lock', 'pass', 'state', `held by this run (${runId})`);
  }
  const ageH = lockAgeHours(lock);
  const who = `runId ${lock.runId ?? '?'} on ${lock.host ?? '?'} (pid ${lock.pid ?? '?'})`;
  if (isStale(lock)) {
    return mk('state.lock', 'month lock', 'stop', 'state',
      `held by ${who}, last heartbeat ${Number.isFinite(ageH) ? `${ageH.toFixed(1)}h` : 'never'} ago — stale (over ${LOCK_STALE_HOURS}h), so that run is presumed dead`,
      'Take it with --stage lock --acquire, which will report that it took a stale one.');
  }
  return mk('state.lock', 'month lock', 'stop', 'state',
    `held by ${who}, heartbeat ${ageH.toFixed(2)}h ago — that run is alive`,
    'Wait for it, or stop it and release the lock. Two runs on one month will fight over state/<month>.json.');
}

function checkPrevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const p = statePath(prev);
  if (!fs.existsSync(p)) {
    return mk('state.prevMonth', `previous month (${prev}) verified`, 'skip', 'state', 'no state file — nothing ran that month on this machine');
  }
  try {
    const st = JSON.parse(fs.readFileSync(p, 'utf8'));
    const s07 = st.stages?.['07'];
    if (s07 && s07.code === 0) return mk('state.prevMonth', `previous month (${prev}) verified`, 'pass', 'state', `07 verify passed ${s07.at ?? ''}`.trim());
    return mk('state.prevMonth', `previous month (${prev}) verified`, 'warn', 'state',
      s07 ? `07 verify exited ${s07.code} — ${prev} was never signed off` : `${prev} has no record of stage 07 — it was never verified`,
      `Re-run: npm run pipeline -- --stage 07 --month ${prev}`);
  } catch (e) {
    return mk('state.prevMonth', `previous month (${prev}) verified`, 'warn', 'state', `${p} does not parse: ${e.message}`);
  }
}

export async function run(ctx) {
  const { month } = ctx;
  const scope = resolveScope(ctx);
  const checks = [];

  ctx.log(`  preflight for ${month} — checking stages ${scope.join(', ') || '(none in scope)'}`);

  const groupsNeeded = new Map();
  for (const s of scope) for (const g of NEEDS[s]?.config ?? []) {
    groupsNeeded.set(g, [...(groupsNeeded.get(g) ?? []), s]);
  }
  for (const [group, stages] of groupsNeeded) {
    const { ok, missing } = check(group);
    checks.push(ok
      ? mk(`env.${group}`, `${group} config (stage ${stages.join(', ')})`, 'pass', 'config', 'all set')
      : mk(`env.${group}`, `${group} config (stage ${stages.join(', ')})`, 'fail', 'config', `missing: ${missing.join(', ')}`,
        'Add these to .env.local — see "Config to add to .env.local" in HANDOFF_AUTOMATION.md.'));
  }

  if (scope.some((s) => NEEDS[s]?.convinAuth)) {
    const hasToken = !!process.env.CONVIN_TOKEN?.trim();
    const hasLogin = !!process.env.CONVIN_EMAIL?.trim() && !!process.env.CONVIN_PASSWORD?.trim();
    checks.push(hasToken || hasLogin
      ? mk('env.convinAuth', 'Convin auth (stage 03)', 'pass', 'config', hasToken ? 'CONVIN_TOKEN set (API path)' : 'CONVIN_EMAIL + CONVIN_PASSWORD set (Playwright path)')
      : mk('env.convinAuth', 'Convin auth (stage 03)', 'fail', 'config', 'neither CONVIN_TOKEN nor CONVIN_EMAIL + CONVIN_PASSWORD is set',
        'A write-capable token is CONVIN_ESCALATION.md ask #2 — with it, stage 03 is one HTTP call instead of a browser.'));
  }

  if (scope.some((s) => NEEDS[s]?.archive)) {
    const stages = scope.filter((s) => NEEDS[s]?.archive).join(', ');
    const prefix = process.env.S3_PREFIX_ARCHIVE?.trim();
    checks.push(prefix
      ? mk('archive', `source archiving (stage ${stages})`, 'pass', 'config', `S3_PREFIX_ARCHIVE=${prefix}`)
      : mk('archive', `source archiving (stage ${stages})`, 'warn', 'config',
        'S3_PREFIX_ARCHIVE is not set — the books, status files and call logs this month is built from will NOT be kept. ' +
        'July and August 2026 are permanently unauditable for exactly this reason (PIPELINE_BUILD_RESULT.md).',
        'Set S3_PREFIX_ARCHIVE in .env.local, and put a lifecycle rule on that prefix to expire anything older than the previous month.'));
  }

  const depsNeeded = new Map();
  for (const s of scope) for (const d of NEEDS[s]?.deps ?? []) {
    depsNeeded.set(d, [...(depsNeeded.get(d) ?? []), s]);
  }

  const declared = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
      return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    } catch {
      return null;
    }
  })();

  for (const [dep, stages] of depsNeeded) {
    const where = `${dep} (stage ${stages.join(', ')})`;
    const pinned = declared?.[dep];
    let importable = true;
    try { await import(dep); } catch { importable = false; }

    if (importable && pinned) {
      checks.push(mk(`dep.${dep}`, where, 'pass', 'dep', `installed and pinned at ${pinned}`));
    } else if (importable && declared && !pinned) {
      checks.push(mk(`dep.${dep}`, where, 'fail', 'dep',
        'importable, but NOT declared in package.json — it resolves only as another package\'s transitive dependency and will disappear without warning when that package changes',
        `npm install --save-exact ${dep}`));
    } else if (!importable && pinned) {
      checks.push(mk(`dep.${dep}`, where, 'fail', 'dep',
        `declared at ${pinned} but not installed — stage ${stages.join('/')} lazy-imports it and would fail at the moment it is first needed`,
        'npm ci'));
    } else {
      checks.push(mk(`dep.${dep}`, where, 'fail', 'dep',
        `not installed and NOT declared in package.json — stage ${stages.join('/')} lazy-imports it, so npm ci will not fix this on any machine`,
        `npm install --save-exact ${dep}`));
    }
  }

  if (scope.some((s) => NEEDS[s]?.chrome)) {
    const found = findChrome();
    checks.push(found
      ? mk('chrome', 'Chrome for PDF rendering (stage 06)', 'pass', 'env', found)
      : mk('chrome', 'Chrome for PDF rendering (stage 06)', 'fail', 'env',
        'no browser at any path build_book_reports.mjs looks in',
        "Install Google Chrome. Playwright's bundled Chromium does not count — findChrome() only looks at system install paths."));
  }

  if (scope.some((s) => NEEDS[s]?.db)) checks.push(await checkDb());

  if (scope.some((s) => NEEDS[s]?.disk)) {
    const root = pipelineRoot();
    try {
      const f = freeBytes(root);
      const gb = f ? f.free / 1e9 : null;
      checks.push(gb === null
        ? mk('disk', 'disk headroom under PIPELINE_ROOT', 'skip', 'env', `could not resolve an existing ancestor of ${root}`)
        : gb >= MIN_FREE_GB
          ? mk('disk', 'disk headroom under PIPELINE_ROOT', 'pass', 'env', `${gb.toFixed(1)} GB free at ${f.at} (need ${MIN_FREE_GB})`)
          : mk('disk', 'disk headroom under PIPELINE_ROOT', 'fail', 'env', `${gb.toFixed(1)} GB free at ${f.at}, below the ${MIN_FREE_GB} GB floor`,
            'Free space, or point PIPELINE_ROOT at a data volume. Raise the floor with PIPELINE_MIN_FREE_GB.'));
    } catch (e) {
      checks.push(mk('disk', 'disk headroom under PIPELINE_ROOT', 'skip', 'env', `statfs failed: ${e.message}`));
    }
  }

  const sp = statePath(month);
  if (!fs.existsSync(sp)) {
    checks.push(mk('state.parse', `state/${month}.json`, 'pass', 'state', 'does not exist yet — it will be created by the first stage that completes'));
  } else {
    try {
      JSON.parse(fs.readFileSync(sp, 'utf8'));
      checks.push(mk('state.parse', `state/${month}.json`, 'pass', 'state', 'parses'));
    } catch (e) {
      checks.push(mk('state.parse', `state/${month}.json`, 'fail', 'state', `does not parse: ${e.message}`,
        'Every stage reads this to decide what to skip. A corrupt file must be repaired or removed before anything runs.'));
    }
  }
  checks.push(checkLock(month, ctx.runId));
  checks.push(checkPrevMonth(month));

  const failed = checks.filter((c) => c.status === 'fail');
  const stops = checks.filter((c) => c.status === 'stop');
  const warnings = checks.filter((c) => c.status === 'warn');

  for (const c of checks) {
    const mark = { pass: '✔', fail: '✘', stop: '⏸', warn: '⚠', skip: '·' }[c.status];
    ctx.log(`  ${mark} ${c.label}: ${c.detail}`);
  }

  let code = 0;
  let reason;
  if (failed.length) {
    code = failed.every((c) => c.kind === 'config' || c.kind === 'dep') ? 3 : 1;
    reason = `${failed.length} preflight check(s) failed: ${failed.map((c) => c.id).join(', ')}`;
  } else if (stops.length) {
    code = 10;

    reason = stops.map((c) => `${c.label}: ${c.detail}`).join('; ');
  } else {
    reason = `all ${checks.filter((c) => c.status !== 'skip').length} checks passed for stages ${scope.join(', ')}`;
  }

  return {
    code,
    result: {
      ok: code === 0,
      month,
      scope,
      dryRun: !!ctx.dryRun,
      host: os.hostname(),
      reason,
      checks,
      failed: failed.map((c) => c.id),
      stopped: stops.map((c) => c.id),
      warnings: warnings.map((c) => ({ id: c.id, detail: c.detail, fix: c.fix })),
      state: {
        preflight: {
          ok: code === 0, scope, failed: failed.map((c) => c.id), warnings: warnings.map((c) => c.id),
        },
      },
    },
  };
}
