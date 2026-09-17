import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { need, needConvinAuth, env } from './config.mjs';
import { cohortsDir } from './paths.mjs';
import { loadDateHistogram, splitExternalId } from './externalid.mjs';
import { parseCsvLine } from '../../src/lib/csv.mjs';
import { readSheet } from '../../src/lib/sheet.mjs';
import { autoMap, accountKey, normalizeAccount } from '../../src/lib/normalize.mjs';

const POLL_INTERVAL_MS = 30_000;
const POLL_CAP_MS = 20 * 60_000;
const MAX_RETRIES = 3;

function convinBase() {
  return `${env('CONVIN_API_BASE', 'https://api.convin.ai')}/v1/${env('CONVIN_TENANT', 'rblbank')}`;
}

function campaignId(campaign) {
  return campaign === 'bucket' ? env('CONVIN_CAMPAIGN_BUCKET') : env('CONVIN_CAMPAIGN_PREX');
}

async function triggerViaApi(cohort) {
  const url = `${convinBase()}/campaigns/${campaignId(cohort.campaign)}/ai-call-logs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('CONVIN_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: cohort.startDate, end_date: cohort.endDate }),
  });
  if (res.status === 401) return { ok: false, status: 401 };
  if (!res.ok) throw new Error(`Convin trigger POST ${url} → HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return { ok: true, body: await res.json().catch(() => ({})) };
}

async function triggerViaBrowser(cohort) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`https://activate.convin.ai/tenant/${env('CONVIN_TENANT', 'rblbank')}/campaigns/${campaignId(cohort.campaign)}`);
    if (env('CONVIN_EMAIL') && env('CONVIN_PASSWORD')) {
      await page.fill('input[type=email], input[name=email]', env('CONVIN_EMAIL'));
      await page.fill('input[type=password], input[name=password]', env('CONVIN_PASSWORD'));
      await page.click('button[type=submit]');
      await page.waitForLoadState('networkidle');
    }

    await page.fill('[data-testid=start-date]', cohort.startDate);
    await page.fill('[data-testid=end-date]', cohort.endDate);
    const apply = page.locator('button:has-text("Apply")');
    await apply.click();

    await apply.waitFor({ state: 'disabled', timeout: 15_000 });
    await page.click('button:has-text("Export CSV"), [data-testid=export-csv]');
    return { ok: true, body: {} };
  } finally {
    await browser.close();
  }
}

export function verifyRequestParams(active, cohort) {
  if (!active) return { ok: false, reason: 'no active export found on /report-downloads/active' };
  const got = { start: active.request_params?.start_date, end: active.request_params?.end_date };
  const want = { start: cohort.startDate, end: cohort.endDate };
  const ok = got.start === want.start && got.end === want.end;
  return { ok, got, want, reason: ok ? null : `active export is scoped to ${got.start}→${got.end}, not the ${want.start}→${want.end} we just fired — this is the silent-re-fire trap` };
}

const ACTIVE_KEYS = ['active', 'data'];

export function readActive(body) {
  if (body && typeof body === 'object') {
    for (const k of ACTIVE_KEYS) {
      if (k in body) return body[k] ?? null;
    }

    if (Array.isArray(body) && body.length === 0) return null;
    if ('results' in body && Array.isArray(body.results)) return body.results[0] ?? null;
    if ('count' in body && body.count === 0) return null;
  }
  throw new Error(
    'could not find the active export in Convin\'s /report-downloads/active response. '
    + `Expected one of ${ACTIVE_KEYS.map((k) => JSON.stringify(k)).join(' or ')} at the top level; `
    + `the response actually had ${body && typeof body === 'object' ? `keys [${Object.keys(body).map((k) => JSON.stringify(k)).join(', ')}]` : `type ${typeof body}`}. `
    + 'This shape has never been confirmed against the live API (see the file header) — '
    + 'add the real key to ACTIVE_KEYS in 03_export.mjs and the stage works. '
    + 'Refusing to treat an unrecognised shape as "no active export", because that reads as an empty queue and is not.',
  );
}

async function pollActive() {
  const res = await fetch(`${convinBase()}/report-downloads/active`, { headers: { Authorization: `Bearer ${env('CONVIN_TOKEN')}` } });
  if (!res.ok) throw new Error(`poll /report-downloads/active → HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  return readActive(body);
}

export function pollPlan(attemptsSoFar) {
  if (attemptsSoFar >= MAX_RETRIES) return { action: 'escalate', reason: `${attemptsSoFar} attempts each capped at ${POLL_CAP_MS / 60000}min — escalating rather than retrying forever` };
  return { action: 'retry', waitMs: POLL_INTERVAL_MS, capMs: POLL_CAP_MS };
}

function listCohorts(plan, state) {
  const fired = state?.stages?.['03']?.cohorts ?? {};
  const done = state?.stages?.['04']?.collected ?? {};
  return (plan?.cohorts ?? []).map((c) => {
    const key = `${c.campaign}|${c.startDate}`;
    return {
      key, campaign: c.campaign, startDate: c.startDate, endDate: c.endDate, books: c.books,
      collected: done[key]?.repairedOk === true,
      failed: fired[key]?.failed === true,
      attempts: fired[key]?.attempts ?? 0,
    };
  });
}

const CACHE_SCAN_ROWS = 4000;

const MEMBERSHIP_FLOOR_PCT = 70;

function cohortAccounts(state, cohort) {
  const books = state.stages?.['01']?.books ?? {};
  const set = new Set();
  const read = [];
  for (const name of cohort.books ?? []) {
    const b = books[name];
    if (!b?.path || !fs.existsSync(b.path)) continue;
    try {
      const rows = readSheet(fs.readFileSync(b.path), b.path);
      const header = rows[0] ?? [];
      const map = autoMap(header);
      for (let r = 1; r < rows.length; r++) {
        const rec = Object.fromEntries(header.map((h, i) => [h, rows[r][i]]));
        const { key } = accountKey(rec, map);
        if (key) set.add(key);
      }
      read.push(name);
    } catch {  }
  }
  return { set, read };
}

async function inspectCsv(file, accounts) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let idx = -1; let n = 0;
  const ids = [];
  try {
    for await (const line of rl) {
      if (!line) continue;
      const fields = parseCsvLine(line);
      if (idx < 0) {
        idx = fields.findIndex((h) => String(h ?? '').trim().toLowerCase() === 'external id');
        if (idx < 0) return null;
        continue;
      }
      ids.push(fields[idx]);
      if (++n >= CACHE_SCAN_ROWS) break;
    }
  } finally {
    rl.close();
  }
  if (!ids.length) return null;

  const { dates, unreadable } = loadDateHistogram(ids);
  if (!dates.length) return null;

  let inCohort = 0; let readable = 0;
  for (const raw of ids) {
    const { account } = splitExternalId(raw);
    if (!account) continue;
    readable++;
    if (accounts.has(normalizeAccount(account))) inCohort++;
  }
  return {
    loadDate: dates[0].date,
    rowsScanned: n,
    matched: dates[0].rows,
    otherDates: dates.slice(1),
    unreadable,
    membershipPct: readable ? Math.round((1000 * inCohort) / readable) / 10 : 0,
    inCohort,
    readable,
  };
}

async function serveFromCache(ctx, cohort, key) {
  const argv = process.argv;
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const dest = path.join(cohortsDir(ctx.month), `${key.replace('|', '__')}.csv`);

  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    ctx.log(`  CACHED — ${key} is already collected at ${dest}; Convin not called`);
    return {
      code: 0,
      result: {
        ok: true, month: ctx.month, cohort: key, mode: 'cache', fired: false, servedFromCache: true,
        source: dest, sourceKind: 'already-collected',
        state: { cohorts: { ...(ctx.state.stages?.['03']?.cohorts ?? {}), [key]: { fired: false, cached: true, mode: 'cache', source: dest, cachedAt: new Date().toISOString(), attempts: 0 } } },
      },
    };
  }

  const dir = flag('cached-from');
  if (!dir) {
    return {
      code: 10,
      result: {
        ok: false, month: ctx.month, cohort: key,
        reason: `--use-cached was given but there is no call log for ${key} at ${dest}, and no --cached-from folder to look in. ` +
          'REPLAY can only serve a cohort whose export already exists on disk.',
      },
    };
  }
  const root = path.resolve(dir);
  const csvs = [];
  const walk = (d, depth) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(full, depth + 1);
      else if (e.isFile() && /\.csv$/i.test(e.name)) csvs.push(full);
    }
  };
  walk(root, 0);

  const { set: accounts, read: booksRead } = cohortAccounts(ctx.state, cohort);
  if (!accounts.size) {
    return {
      code: 10,
      result: {
        ok: false, month: ctx.month, cohort: key,
        reason: `cannot identify ${key}'s call log: none of its books (${(cohort.books ?? []).join(', ') || 'none in the plan'}) could be read for their account numbers, ` +
          'so a candidate file cannot be checked against them. Without that check, a same-day cohort from the other campaign would match on the load date alone.',
      },
    };
  }

  const considered = [];
  for (const f of csvs) {
    const found = await inspectCsv(f, accounts).catch((e) => ({ error: e.message }));
    if (!found) { considered.push({ file: path.basename(f), why: 'no readable External ID column — not a call log' }); continue; }
    if (found.error) { considered.push({ file: path.basename(f), why: `could not be read: ${found.error}` }); continue; }
    considered.push({
      file: path.basename(f), path: f,
      loadDate: found.loadDate, rowsScanned: found.rowsScanned, unreadable: found.unreadable,
      membershipPct: found.membershipPct,
      dateMatches: found.loadDate === cohort.startDate,
    });
  }

  const eligible = considered
    .filter((c) => c.dateMatches && c.membershipPct >= MEMBERSHIP_FLOOR_PCT)
    .sort((a, b) => b.membershipPct - a.membershipPct);
  const best = eligible[0];

  if (!best) {
    const onDate = considered.filter((c) => c.dateMatches);
    return {
      code: 10,
      result: {
        ok: false, month: ctx.month, cohort: key,
        reason: onDate.length
          ? `${onDate.length} call log(s) under ${root} carry load date ${cohort.startDate}, but none holds enough of ${key}'s own accounts to be its export ` +
            `(best ${Math.max(...onDate.map((c) => c.membershipPct))}%, floor ${MEMBERSHIP_FLOOR_PCT}%). ` +
            'That is the signature of the other campaign\'s same-day cohort, not of this one — serving it would put the wrong campaign\'s calls on this book.'
          : `no call log under ${root} carries load date ${cohort.startDate} in its External IDs, so nothing can be served for ${key}. ` +
            'This is not "no calls" — it is a missing export. Add the file, or run this cohort live.',
        booksChecked: booksRead,
        cohortAccounts: accounts.size,
        considered,
      },
    };
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(best.path, dest);
  ctx.log(`  CACHED — ${best.file} → ${key}`);
  ctx.log(`     load date ${best.loadDate} read from its own External IDs · ${best.membershipPct}% of its accounts are in this cohort's ${booksRead.length} book(s) (floor ${MEMBERSHIP_FLOOR_PCT}%)`);
  if (eligible.length > 1) ctx.log(`     ${eligible.length - 1} other file(s) also cleared the floor; took the highest: ${eligible.slice(1).map((c) => `${c.file} ${c.membershipPct}%`).join(', ')}`);
  return {
    code: 0,
    result: {
      ok: true, month: ctx.month, cohort: key, mode: 'cache', fired: false, servedFromCache: true,
      source: best.path, sourceKind: 'matched-by-external-id-and-membership', dest,
      match: { loadDate: best.loadDate, rowsScanned: best.rowsScanned, unreadable: best.unreadable, membershipPct: best.membershipPct, floorPct: MEMBERSHIP_FLOOR_PCT, booksChecked: booksRead },
      considered,
      state: { cohorts: { ...(ctx.state.stages?.['03']?.cohorts ?? {}), [key]: { fired: false, cached: true, mode: 'cache', source: best.path, membershipPct: best.membershipPct, cachedAt: new Date().toISOString(), attempts: 0 } } },
    },
  };
}

export async function run(ctx) {
  const { month, state, cohort: cohortArg, listCohorts: wantList } = ctx;
  const plan = state.stages?.['02']?.plan;
  if (!plan) return { code: 10, result: { ok: false, reason: 'stage 02 has not produced a plan yet', month } };

  if (wantList) {
    const cohorts = listCohorts(plan, state);
    ctx.log(`  ${cohorts.length} cohort(s), ${cohorts.filter((c) => !c.collected).length} not yet collected`);
    return { code: 0, result: { ok: true, month, cohorts } };
  }

  if (process.argv.includes('--mark-failed')) {
    const i = process.argv.indexOf('--reason');
    const reason = i >= 0 ? process.argv[i + 1] : 'no reason given';
    if (!cohortArg) return { code: 2, result: { ok: false, month, reason: '--mark-failed requires --cohort <key>' } };
    const known = plan.cohorts.some((c) => `${c.campaign}|${c.startDate}` === cohortArg);
    if (!known) return { code: 2, result: { ok: false, month, reason: `cohort "${cohortArg}" is not in this month's plan — refusing to record a result for a cohort that does not exist` } };
    const prev = state.stages?.['03']?.cohorts?.[cohortArg] ?? {};
    const cohorts = {
      ...(state.stages?.['03']?.cohorts ?? {}),
      [cohortArg]: { ...prev, failed: true, failedAt: new Date().toISOString(), reason, attempts: prev.attempts ?? 0 },
    };
    ctx.log(`  marked ${cohortArg} FAILED — ${reason}`);
    return { code: 0, result: { ok: true, month, cohort: cohortArg, markedFailed: true, reason, state: { cohorts } } };
  }

  const useCached = process.argv.includes('--use-cached');
  if (useCached) {
    const cached = plan.cohorts.find((c) => `${c.campaign}|${c.startDate}` === cohortArg);
    if (!cached) return { code: 2, result: { ok: false, reason: `cohort "${cohortArg}" not found in this month's plan`, month } };
    return serveFromCache(ctx, cached, cohortArg);
  }

  need('convin');
  needConvinAuth();
  const cohort = plan.cohorts.find((c) => `${c.campaign}|${c.startDate}` === cohortArg);
  if (!cohort) return { code: 2, result: { ok: false, reason: `cohort "${cohortArg}" not found in this month's plan`, month } };

  const key = cohortArg;
  const attempts = (state.stages?.['03']?.cohorts?.[key]?.attempts ?? 0);

  if (ctx.dryRun) {
    ctx.log(`  DRY RUN — would fire ${key} (${cohort.startDate} → ${cohort.endDate}), attempt ${attempts + 1}`);
    return {
      code: 0,
      result: {
        ok: true, month, cohort: key, dryRun: true, fired: false,
        wouldFire: { campaign: cohort.campaign, start_date: cohort.startDate, end_date: cohort.endDate, attempt: attempts + 1 },
        state: { dryRun: true },
      },
    };
  }

  const plan03 = pollPlan(attempts);
  if (plan03.action === 'escalate') {
    ctx.log(`  ${plan03.reason}`);
    ctx.log('  NOT firing again — the tenant lock is not taken for an attempt nobody will wait for.');
    return {
      code: 10,
      result: { ok: false, month, cohort: key, fired: false, reason: plan03.reason, note: 'a human should check Convin\'s dashboard directly — the queue may be genuinely stuck' },
    };
  }

  let mode = 'api';
  let fired = await triggerViaApi(cohort).catch((e) => ({ ok: false, error: e.message }));
  if (!fired.ok && fired.status === 401) {
    if (!env('CONVIN_EMAIL') || !env('CONVIN_PASSWORD')) {
      return {
        code: 10,
        result: {
          ok: false, month, cohort: key,
          reason: 'direct API trigger got HTTP 401 and no CONVIN_EMAIL/CONVIN_PASSWORD is set for the Playwright fallback. ' +
            'Per HANDOFF_AUTOMATION.md step 2: capture the browser\'s own request headers once (patch ' +
            'XMLHttpRequest.prototype.setRequestHeader, click the CSV button, diff against what we sent) and either ' +
            'fix CONVIN_TOKEN or add CONVIN_EMAIL/CONVIN_PASSWORD so the Playwright path can log in.',
        },
      };
    }
    mode = 'browser';
    fired = await triggerViaBrowser(cohort).catch((e) => ({ ok: false, error: e.message }));
  }
  if (!fired.ok) {
    throw new Error(`stage 03 could not trigger cohort ${key} via ${mode}: ${fired.error ?? fired.status}`);
  }

  const active = await pollActive();
  const verified = verifyRequestParams(active, cohort);
  if (!verified.ok) {
    throw new Error(`stage 03 fired cohort ${key} but /report-downloads/active does not confirm it: ${verified.reason}`);
  }

  return {
    code: 0,
    result: {
      ok: true, month, cohort: key, mode, fired: true, verified: true,

      state: { cohorts: { ...(state.stages?.['03']?.cohorts ?? {}), [key]: { fired: true, mode, firedAt: new Date().toISOString(), attempts: attempts + 1 } } },
    },
  };
}
