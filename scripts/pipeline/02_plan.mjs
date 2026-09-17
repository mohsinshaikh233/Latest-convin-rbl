import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadCampaignCache, saveCampaignCache } from './state.mjs';
import { rawDir } from './paths.mjs';

const PREX_DAYS = { 1: 5, 2: 4, 4: 3, 5: 2, 7: 4 };

export function cacheKey(bookName) {
  return bookName
    .replace(/\.(xlsx|xls|csv)$/i, '')
    .replace(/-[0-9a-f]{6,}$/i, '')
    .replace(/\s+(convin|conv|convi)$/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function runPlanMonth(manifestPath, booksDir) {
  return new Promise((resolve, reject) => {
    const args = ['scripts/plan_month.mjs', '--manifest', manifestPath, '--json'];
    if (booksDir) args.push('--books', booksDir);
    const p = spawn('node', args, { cwd: process.cwd() });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`plan_month.mjs exited ${code}: ${err || out}`));
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      if (!line) return reject(new Error(`plan_month.mjs produced no JSON line: ${out}\n${err}`));
      resolve(JSON.parse(line));
    });
  });
}

function applyAssignments(ctx, cache, books) {
  const argv = process.argv;
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const raw = flag('apply-assignments');

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (e) {
    return { error: `--apply-assignments payload is not valid JSON: ${e.message}` };
  }
  if (!Array.isArray(entries) || !entries.length) return { error: '--apply-assignments expects a non-empty JSON array of {book, campaign, days?}' };

  const known = new Map(books.map((b) => [cacheKey(b.name), b.name]));
  const applied = []; const rejected = [];
  const decidedBy = flag('decided-by') || 'n8n-form';
  const decidedAt = new Date().toISOString();

  for (const e of entries) {
    const bookName = String(e.book ?? '').trim();
    if (!bookName) { rejected.push({ entry: e, why: 'no book name' }); continue; }
    const key = cacheKey(bookName);
    if (!known.has(key)) {
      rejected.push({ book: bookName, why: `not one of this month's books — nothing would have matched key ${JSON.stringify(key)}` });
      continue;
    }
    const campaign = String(e.campaign ?? '').trim().toLowerCase();
    if (campaign !== 'prex' && campaign !== 'bucket') {
      rejected.push({ book: bookName, why: `campaign must be "prex" or "bucket", got ${JSON.stringify(e.campaign ?? null)}` });
      continue;
    }
    const days = e.days === undefined || e.days === null || e.days === '' ? undefined : Number(e.days);
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 31)) {
      rejected.push({ book: bookName, why: `days must be a whole number of days, got ${JSON.stringify(e.days)}` });
      continue;
    }

    const why = String(e.reason ?? '').trim();
    cache[key] = {
      ...(cache[key] ?? {}),
      campaign,
      ...(days !== undefined ? { days } : {}),
      ...(why ? { reason: why } : {}),
      confirmedAt: decidedAt,
      confirmedFrom: `${ctx.month} (form)`,
      decidedBy,
      decidedAt,
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    };
    applied.push({ book: known.get(key), key, campaign, ...(days !== undefined ? { days } : {}) });
  }

  if (rejected.length) return { error: `${rejected.length} assignment(s) rejected — nothing was written`, rejected, applied: [] };
  saveCampaignCache(cache);
  return { applied, decidedBy, decidedAt };
}

const fetchedBooks = (state) => state.stages?.['01']?.books ?? state.raw?.books ?? null;

export async function run(ctx) {
  const { month, state } = ctx;
  const rawBooks = fetchedBooks(state);
  if (!rawBooks || !Object.keys(rawBooks).length) {
    return {
      code: 10,
      result: { ok: false, reason: 'stage 01 has not fetched any books for this month yet — run stage 01 first', month },
    };
  }

  const cache = loadCampaignCache();

  let appliedAssignments = null;
  if (process.argv.includes('--apply-assignments')) {
    const booksForApply = Object.entries(rawBooks).map(([name, b]) => ({ name, ...b }));
    const res = applyAssignments(ctx, cache, booksForApply);
    if (res.error) {
      ctx.log(`  ✘ ${res.error}`);
      for (const r of res.rejected ?? []) ctx.log(`      ${r.book ?? JSON.stringify(r.entry)} — ${r.why}`);
      return { code: 2, result: { ok: false, month, reason: res.error, rejected: res.rejected ?? [] } };
    }
    appliedAssignments = res;
    ctx.log(`  applied ${res.applied.length} assignment(s) from the form (decidedBy ${res.decidedBy}) — re-planning`);
  }
  const books = Object.entries(rawBooks).map(([name, b]) => ({ name, ...b }));
  const unassigned = [];
  const manifest = books.map(({ name, file, loadDate }) => {
    const key = cacheKey(name);
    const cached = cache[key];
    const m = { file, loadDate };
    if (cached?.campaign) m.campaign = cached.campaign;
    if (cached?.days) m.days = cached.days;
    return { ...m, _name: name, _key: key, _cached: !!cached };
  });

  const root = rawDir(month);
  const manifestPath = path.join(root, 'manifest.json');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest.map(({ _name, _key, _cached, ...m }) => m)));
  const booksDir = path.join(root, 'books');

  const plan = await runPlanMonth(manifestPath, fs.existsSync(booksDir) ? booksDir : undefined);

  for (const [i, b] of plan.books.entries()) {
    const src = manifest[i];
    if (b.days == null) {
      unassigned.push({
        book: src._name, loadDate: b.loadDate, key: src._key,
        inference: b.campaign ?? null, needs: 'days',
        reason: `no verified day-count for PDD+${b.n} — not in the table (${Object.keys(PREX_DAYS).map((k) => `+${k}`).join(', ')})`,
        suggestion: 'add {"days": N} for this book to state/campaigns.json under key ' + JSON.stringify(src._key),
      });
    } else if (!src._cached && !b.campaignGiven) {
      unassigned.push({
        book: src._name, loadDate: b.loadDate, key: src._key,
        inference: b.campaign, needs: 'campaign',
        reason: `campaign not confirmed — plan_month inferred "${b.campaign}" from the name`,
        suggestion: `add {"campaign": "${b.campaign}"} (or "prex"/"bucket") for this book to state/campaigns.json under key ${JSON.stringify(src._key)}, or accept the inference by re-running with --confirm-inferred`,
      });
    }
  }

  const confirmInferred = process.argv.includes('--confirm-inferred');
  if (unassigned.length && !confirmInferred) {
    return {
      code: 10,
      result: {
        ok: false, month,
        unassigned,
        note: 'edit state/campaigns.json (or re-run with --confirm-inferred to accept plan_month\'s inference for the campaign-only items) and re-run stage 02',
      },
    };
  }

  let grew = 0;
  for (const [i, b] of plan.books.entries()) {
    const src = manifest[i];
    if (b.days == null) continue;
    if (!cache[src._key]) {
      cache[src._key] = { campaign: b.campaign, days: b.days, confirmedAt: new Date().toISOString(), confirmedFrom: month };
      grew++;
    }
  }
  if (grew) saveCampaignCache(cache);

  const result = {
    ok: true, month,
    totals: plan.totals,
    cohorts: plan.cohorts.length,
    warnings: plan.warnings,
    cacheGrew: grew,
    ...(appliedAssignments ? { appliedAssignments: appliedAssignments.applied, decidedBy: appliedAssignments.decidedBy } : {}),
    state: { plan, ...(appliedAssignments ? { assignments: appliedAssignments.applied, decidedBy: appliedAssignments.decidedBy, decidedAt: appliedAssignments.decidedAt } : {}) },
  };
  ctx.log(`  ${plan.totals.books} books · ${plan.totals.exports} cohorts to export · ${plan.warnings.length} warning(s) · cache grew by ${grew}`);
  return { code: 0, result };
}
