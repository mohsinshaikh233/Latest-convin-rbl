import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { parseCsvLine } from '../../src/lib/csv.mjs';
import { parseStatusDate } from './dates.mjs';
import { assembledDir } from './paths.mjs';
import { readSheet } from '../../src/lib/sheet.mjs';
import { autoMap, accountKey, normalizeAccount } from '../../src/lib/normalize.mjs';
import { splitExternalId } from './externalid.mjs';

const EXPECTED_CALLLOG_COLUMNS = 31;

const EXPECTED_BOOK_COLUMNS = { prex: [38, 39, 40], bucket: [33, 34, 35, 36] };

const VOCAB = {
  prex: new Set(['resolved', 'unresolved']),
  bucket: new Set(['unresolved', 'normalisation', 'stab', 'rb']),
};
const MEMBERSHIP_FLOOR_PCT = 70;

function statusCampaignOf(filename) {
  if (/bucket/i.test(filename)) return 'bucket';
  if (/prex/i.test(filename)) return 'prex';
  return 'prex';
}

function indexStatusFiles(statusFiles) {
  const index = {}; const warnings = [];
  for (const f of statusFiles) {
    const date = parseStatusDate(f.file);
    if (!date) { warnings.push(`could not read an as-of date out of status filename "${f.file}" — skipped`); continue; }
    const campaign = statusCampaignOf(f.file);
    if (!/bucket|prex/i.test(f.file)) warnings.push(`"${f.file}" names no campaign — assumed prex (July's convention). Confirm if this is a Bucket file.`);
    const key = `${campaign}|${date}`;
    if (index[key] && index[key].path !== f.path) {
      warnings.push(`two status files both resolve to ${key}: "${path.basename(index[key].path)}" and "${f.file}" — kept the first, check for a duplicate upload`);
      continue;
    }
    index[key] = f;
  }
  return { index, warnings };
}

function stringifyCsvLine(fields) {
  return fields.map((v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

async function sliceCallLog(csvPath, dayFolders, outPaths, bookAccounts = null) {
  const rl = readline.createInterface({ input: fs.createReadStream(csvPath), crlfDelay: Infinity });
  let header = null; let tsIdx = -1; let extIdx = -1;
  const writers = dayFolders.map((d, i) => ({
    cutoff: new Date(`${d.date}T23:59:59.999Z`).getTime(),
    stream: fs.createWriteStream(outPaths[i]),
    rows: 0,
  }));

  let total = 0; let undated = 0; let colMismatch = 0;
  let maxTs = -Infinity; let maxTsBook = -Infinity; let bookRows = 0;

  const idYear = String(dayFolders[0]?.date ?? '').slice(0, 4) || undefined;
  for await (const line of rl) {
    if (line === '') continue;
    const fields = parseCsvLine(line);
    if (!header) {
      header = fields;
      tsIdx = header.findIndex((h) => h.trim().toLowerCase() === 'call timestamp');
      extIdx = header.findIndex((h) => h.trim().toLowerCase() === 'external id');
      if (header.length !== EXPECTED_CALLLOG_COLUMNS) colMismatch = header.length;
      for (const w of writers) w.stream.write(`${stringifyCsvLine(header)}\n`);
      continue;
    }
    total++;
    const raw = fields[tsIdx];
    const t = raw ? new Date(raw.replace(' ', 'T') + 'Z').getTime() : NaN;
    if (Number.isNaN(t)) { undated++; continue; }
    if (t > maxTs) maxTs = t;

    if (bookAccounts && extIdx >= 0) {
      const { account } = splitExternalId(fields[extIdx] ?? '', idYear);
      if (account && bookAccounts.has(normalizeAccount(account))) {
        bookRows++;
        if (t > maxTsBook) maxTsBook = t;
      }
    }
    const line2 = `${stringifyCsvLine(fields)}\n`;
    for (const w of writers) {
      if (t <= w.cutoff) { w.stream.write(line2); w.rows++; }
    }
  }
  await Promise.all(writers.map((w) => new Promise((res) => w.stream.end(res))));
  return {
    total, undated, colMismatch, bookRows,
    maxTimestamp: Number.isFinite(maxTs) ? new Date(maxTs).toISOString() : null,

    maxTimestampForBook: Number.isFinite(maxTsBook) ? new Date(maxTsBook).toISOString() : null,
    perDay: writers.map((w, i) => ({ day: dayFolders[i].day, rows: w.rows })),
  };
}

function checkDayCountDrift(book, maxTimestampIso) {
  if (!maxTimestampIso) return { ok: true };
  const lastExpected = book.dayFolders[book.dayFolders.length - 1]?.date;
  if (!lastExpected) return { ok: true };
  const lastExpectedEnd = new Date(`${lastExpected}T23:59:59.999Z`).getTime();
  const actualMax = new Date(maxTimestampIso).getTime();
  const ok = actualMax <= lastExpectedEnd;
  return {
    ok, lastExpected, actualLastCall: maxTimestampIso,
    reason: ok ? null : `calling ran past this book's expected final day (${lastExpected}) — the day-count table (PREX_DAYS / Bucket=5) may be stale for this book family. Confirm before trusting the report as complete.`,
  };
}

function bookAccountSet(bookPath) {
  try {
    const rows = readSheet(fs.readFileSync(bookPath), bookPath);
    const header = rows[0] ?? [];
    const map = autoMap(header);
    const set = new Set();
    for (let r = 1; r < rows.length; r++) {
      const rec = Object.fromEntries(header.map((h, i) => [h, rows[r][i]]));
      const { key } = accountKey(rec, map);
      if (key) set.add(key);
    }
    return set;
  } catch {
    return null;
  }
}

function checkBookShape(bookPath, campaign) {
  const rows = readSheet(fs.readFileSync(bookPath), bookPath);
  const columns = (rows[0] || []).length;
  const expected = EXPECTED_BOOK_COLUMNS[campaign] ?? [];
  return { columns, expected, ok: expected.includes(columns) };
}

function crossCheckCampaign(statusPath, bookPath, campaign) {
  const statusRows = readSheet(fs.readFileSync(statusPath), statusPath);
  const bookRows = readSheet(fs.readFileSync(bookPath), bookPath);
  const sH = statusRows[0]; const bH = bookRows[0];
  const sMap = autoMap(sH); const bMap = autoMap(bH);
  const statusColIdx = sH.findIndex((h) => /status/i.test(String(h ?? '')));

  const vocabFound = new Set();
  for (let r = 1; r < statusRows.length; r++) {
    const v = statusRows[r][statusColIdx];
    if (v) vocabFound.add(String(v).trim().toLowerCase());
  }
  const expectedVocab = VOCAB[campaign] ?? new Set();
  const vocabOk = [...vocabFound].some((v) => expectedVocab.has(v));

  const statusAccounts = new Set();
  for (let r = 1; r < statusRows.length; r++) {
    const rec = Object.fromEntries(sH.map((h, i) => [h, statusRows[r][i]]));
    const { key } = accountKey(rec, sMap);
    if (key) statusAccounts.add(key);
  }
  let matched = 0; let total = 0;
  for (let r = 1; r < bookRows.length; r++) {
    const rec = Object.fromEntries(bH.map((h, i) => [h, bookRows[r][i]]));
    const { key } = accountKey(rec, bMap);
    if (!key) continue;
    total++;
    if (statusAccounts.has(key)) matched++;
  }
  const membershipPct = total ? Math.round((1000 * matched) / total) / 10 : 0;
  const ok = vocabOk && membershipPct >= MEMBERSHIP_FLOOR_PCT;
  return {
    ok, vocabFound: [...vocabFound], vocabOk, membershipPct, matched, total,
    reason: ok ? null
      : !vocabOk
        ? `the status file's outcome values (${[...vocabFound].join(', ') || 'none found'}) don't match "${campaign}"'s vocabulary at all — wrong status file, or wrong campaign`
        : `only ${membershipPct}% of this book's accounts appear in the "${campaign}" status file (floor is ${MEMBERSHIP_FLOOR_PCT}%) — the stated campaign may be wrong, or the wrong status file matched`,
  };
}

export const RULINGS = ['build-partial', 'wait-for-file', 'exclude-book', 'accept-drift'];

export const GAP_RULINGS = ['build-partial', 'wait-for-file', 'exclude-book'];
export const DRIFT_RULINGS = ['accept-drift', 'exclude-book'];

export const isDriftItem = (item) => !!item?.lastExpected;

export const rulingsForItem = (item) => (isDriftItem(item) ? DRIFT_RULINGS : GAP_RULINGS);

function applyRulings(ctx, gapsFromState, driftFromState = []) {
  const argv = process.argv;
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

  let entries;
  try {
    entries = JSON.parse(flag('apply-rulings'));
  } catch (e) {
    return { error: `--apply-rulings payload is not valid JSON: ${e.message}` };
  }
  if (!Array.isArray(entries) || !entries.length) return { error: '--apply-rulings expects a non-empty JSON array of {book, ruling, reason}' };

  const gapped = new Set(gapsFromState.map((g) => g.book));
  const drifted = new Set(driftFromState.map((d) => d.book));
  const decidedBy = flag('decided-by') || 'n8n-form';
  const decidedAt = new Date().toISOString();
  const rulings = {}; const rejected = [];

  for (const e of entries) {
    const book = String(e.book ?? '').trim();
    if (!book) { rejected.push({ entry: e, why: 'no book name' }); continue; }
    const isGapped = gapped.has(book);
    const isDrifted = drifted.has(book);
    if (!isGapped && !isDrifted) {
      rejected.push({ book, why: `not one of the books this month reported a gap (${[...gapped].join(', ') || 'none'}) or day-count drift (${[...drifted].join(', ') || 'none'}) for` });
      continue;
    }
    const ruling = String(e.ruling ?? '').trim();
    if (!RULINGS.includes(ruling)) { rejected.push({ book, why: `ruling must be one of ${RULINGS.join(' | ')}, got ${JSON.stringify(e.ruling ?? null)}` }); continue; }

    const allowed = isGapped && isDrifted ? RULINGS : (isGapped ? GAP_RULINGS : DRIFT_RULINGS);
    if (!allowed.includes(ruling)) {
      rejected.push({ book, why: `"${ruling}" does not answer this book's finding — it has ${isGapped ? 'a gap' : 'day-count drift'}, so the ruling must be one of ${allowed.join(' | ')}` });
      continue;
    }
    const reason = String(e.reason ?? '').trim();
    if (!reason) { rejected.push({ book, why: 'a reason is required — a ruling with no reason cannot be audited later' }); continue; }
    rulings[book] = { ruling, reason, decidedBy, decidedAt, ...(ctx.runId ? { runId: ctx.runId } : {}) };
  }

  if (rejected.length) return { error: `${rejected.length} ruling(s) rejected — nothing was written`, rejected };
  return { rulings, decidedBy, decidedAt };
}

export async function run(ctx) {
  const { month, state } = ctx;
  const plan = state.stages?.['02']?.plan;
  if (!plan) return { code: 10, result: { ok: false, reason: 'stage 02 has not produced a plan yet — run it first', month } };

  let appliedRulings = null;
  if (process.argv.includes('--apply-rulings')) {
    const priorGaps = state.stages?.['05']?.assembled?.gaps ?? state.stages?.['05']?.gaps ?? [];
    const priorDrift = state.stages?.['05']?.assembled?.driftFindings ?? state.stages?.['05']?.driftFindings ?? [];
    if (!priorGaps.length && !priorDrift.length) {
      return { code: 2, result: { ok: false, month, reason: 'there are no recorded gaps or drift findings to rule on — run stage 05 first' } };
    }
    const res = applyRulings(ctx, priorGaps, priorDrift);
    if (res.error) {
      ctx.log(`  ✘ ${res.error}`);
      for (const r of res.rejected ?? []) ctx.log(`      ${r.book ?? JSON.stringify(r.entry)} — ${r.why}`);
      return { code: 2, result: { ok: false, month, reason: res.error, rejected: res.rejected ?? [] } };
    }
    appliedRulings = { ...(state.stages?.['05']?.rulings ?? {}), ...res.rulings };
    ctx.log(`  applied ${Object.keys(res.rulings).length} ruling(s) from the form (decidedBy ${res.decidedBy}) — re-assembling`);
  }
  const rawBooks = state.stages?.['01']?.books ?? {};
  const rawStatus = state.stages?.['01']?.statusFiles ?? [];
  const collected = state.stages?.['04']?.collected ?? {};

  const { index: statusIndex, warnings: statusWarnings } = indexStatusFiles(rawStatus);
  const out = assembledDir(month);
  const gaps = []; const built = []; const colMismatches = [];
  const driftFindings = []; const bookShapeWarnings = []; const campaignFindings = [];

  for (const b of plan.books) {
    if (!b.dayFolders?.length) continue;
    const bookRaw = rawBooks[b.book];
    if (!bookRaw) { gaps.push({ book: b.book, reason: 'book file was never fetched by stage 01' }); continue; }

    const shape = checkBookShape(bookRaw.path, b.campaign);
    if (!shape.ok) bookShapeWarnings.push({ book: b.book, ...shape });

    const cohortKey = `${b.campaign}|${b.loadDate}`;
    const cohort = collected[cohortKey];
    if (!cohort) { gaps.push({ book: b.book, reason: `cohort ${cohortKey} has not been collected by stage 04 yet` }); continue; }

    const dayDirs = b.dayFolders.map((d) => path.join(out, b.book, `Day ${d.day} - ${d.date}`));
    for (const d of dayDirs) fs.mkdirSync(d, { recursive: true });

    for (const d of dayDirs) fs.copyFileSync(bookRaw.path, path.join(d, `2 - ${b.book}.xlsx`));

    const missingDays = []; let lastStatusPath = null;
    b.dayFolders.forEach((df, i) => {
      const key = `${b.campaign}|${df.date}`;
      const status = statusIndex[key];
      if (!status) { missingDays.push(df.date); fs.rmSync(dayDirs[i], { recursive: true, force: true }); return; }
      const label = b.campaign === 'bucket' ? 'Bucket' : 'PreX';
      fs.copyFileSync(status.path, path.join(dayDirs[i], `3 - ${label} Status ${df.date}.xlsx`));
      lastStatusPath = status.path;
    });
    if (missingDays.length) gaps.push({ book: b.book, reason: 'missing status file', dates: missingDays });

    if (lastStatusPath) {
      const cc = crossCheckCampaign(lastStatusPath, bookRaw.path, b.campaign);
      if (!cc.ok) campaignFindings.push({ book: b.book, campaign: b.campaign, statusFile: path.basename(lastStatusPath), ...cc });
    }

    const survivingIdx = b.dayFolders.map((_, i) => i).filter((i) => fs.existsSync(dayDirs[i]));
    const survivingFolders = survivingIdx.map((i) => b.dayFolders[i]);
    const survivingPaths = survivingIdx.map((i) => path.join(dayDirs[i], '1 - AI Call Log.csv'));
    if (survivingFolders.length) {
      const sliceResult = await sliceCallLog(cohort.path, survivingFolders, survivingPaths, bookAccountSet(bookRaw.path));
      if (sliceResult.colMismatch) colMismatches.push({ book: b.book, cohort: cohortKey, columns: sliceResult.colMismatch, expected: EXPECTED_CALLLOG_COLUMNS });

      const drift = checkDayCountDrift(b, sliceResult.maxTimestampForBook ?? sliceResult.maxTimestamp);
      if (!drift.ok) driftFindings.push({ book: b.book, ...drift });
      built.push({ book: b.book, days: survivingFolders.length, ...sliceResult });
    }
  }

  const hardFaults = colMismatches.length || campaignFindings.length;

  const rulings = appliedRulings ?? state.stages?.['05']?.rulings ?? {};
  const unresolvedGaps = gaps.filter((g) => {
    const r = rulings[g.book];
    return !r || r.ruling === 'wait-for-file';
  });
  const ruledGaps = gaps.filter((g) => !unresolvedGaps.includes(g));

  const unresolvedDrift = driftFindings.filter((d) => {
    const r = rulings[d.book];
    return !r || !DRIFT_RULINGS.includes(r.ruling);
  });
  const ruledDrift = driftFindings.filter((d) => !unresolvedDrift.includes(d));

  const code = hardFaults ? 1 : ((unresolvedGaps.length || unresolvedDrift.length) ? 10 : 0);
  const result = {
    ok: code === 0,
    month,
    booksBuilt: built.length,
    booksGapped: gaps.length,
    gaps,
    unresolvedGaps,
    ruledGaps: ruledGaps.map((g) => ({ ...g, ...rulings[g.book] })),
    unresolvedDrift,

    ruledDrift: ruledDrift.map((d) => ({ ...d, ...rulings[d.book] })),
    ...(Object.keys(rulings).length ? { rulings } : {}),
    colMismatches,
    driftFindings,
    campaignFindings,
    bookShapeWarnings,
    statusWarnings,
    outDir: out,
    state: {
      assembled: { books: built, gaps, driftFindings, outDir: out },
      ...(Object.keys(rulings).length ? { rulings } : {}),
    },
  };
  const reasons = [];
  if (colMismatches.length) reasons.push(`call-log column count changed on ${colMismatches.length} cohort(s) — guard #3`);
  if (campaignFindings.length) reasons.push(`${campaignFindings.length} book(s) contradict their stated campaign against real status-file data — guard #4`);
  if (unresolvedGaps.length) reasons.push(`${unresolvedGaps.length} book(s) have an unruled gap (missing status file or uncollected cohort) — guard #5`);
  if (ruledGaps.length) reasons.push(`${ruledGaps.length} gap(s) already ruled on: ${ruledGaps.map((g) => `${g.book} → ${rulings[g.book].ruling}`).join(', ')}`);
  if (unresolvedDrift.length) reasons.push(`${unresolvedDrift.length} book(s) show calling past their expected final day — guard #1 (day-count drift). Rule with accept-drift (reason required) or exclude-book.`);
  if (ruledDrift.length) reasons.push(`${ruledDrift.length} drift finding(s) already ruled on: ${ruledDrift.map((d) => `${d.book} → ${rulings[d.book].ruling}`).join(', ')}`);
  if (reasons.length) result.reason = reasons.join('; ');
  ctx.log(`  ${built.length} book(s) assembled, ${gaps.length} gap(s), ${campaignFindings.length} campaign mismatch(es), ${driftFindings.length} drift finding(s)${ruledDrift.length ? ` (${ruledDrift.length} ruled)` : ''}${colMismatches.length ? `, ${colMismatches.length} COLUMN MISMATCH` : ''}${bookShapeWarnings.length ? ` (+${bookShapeWarnings.length} shape warning, advisory)` : ''}`);
  return { code, result };
}
