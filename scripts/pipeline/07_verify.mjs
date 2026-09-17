import fs from 'node:fs';
import { readSheet } from '../../src/lib/sheet.mjs';
import { autoMap, accountKey } from '../../src/lib/normalize.mjs';

function countBookAccounts(bookPath) {
  const rows = readSheet(fs.readFileSync(bookPath), bookPath);
  const headers = rows[0];
  const mapping = autoMap(headers);
  const seen = new Set(); let corrupt = 0;
  for (let r = 1; r < rows.length; r++) {
    const rec = Object.fromEntries(headers.map((h, i) => [h, rows[r][i]]));
    const { key, corrupt: c } = accountKey(rec, mapping);
    if (c) { corrupt++; continue; }
    if (key) seen.add(key);
  }
  return { accounts: seen.size, corrupt };
}

function checkPdf(pdfPath) {
  if (!fs.existsSync(pdfPath)) return { ok: false, reason: 'file does not exist' };
  const buf = fs.readFileSync(pdfPath);
  const head = buf.subarray(0, 5).toString('latin1');
  const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString('latin1');
  const ok = head === '%PDF-' && /%%EOF\s*$/.test(tail);
  return { ok, reason: ok ? null : `bad header/trailer (head="${head}", tail ends ${JSON.stringify(tail.slice(-20))})`, bytes: buf.length };
}

export async function run(ctx) {
  const { month, state } = ctx;
  const built = state.stages?.['06']?.built ?? state.stages?.['06'];
  const plan = state.stages?.['02']?.plan;
  const rawBooks = state.stages?.['01']?.books ?? {};
  const assembled = state.stages?.['05']?.assembled?.books ?? [];
  if (!built?.reports) return { code: 10, result: { ok: false, reason: 'stage 06 has not built anything yet — run it first', month } };

  const accountMismatches = []; const pdfFailures = []; const zeroAttemptFindings = [];
  const cohortOf = new Map((plan?.books ?? []).map((b) => [b.book, `${b.campaign}|${b.loadDate}`]));
  const cohortTotals = new Map(assembled.map((a) => [cohortOf.get(a.book), a.total]));

  for (const r of built.reports) {
    const raw = rawBooks[r.book];
    if (raw?.path && fs.existsSync(raw.path)) {
      const { accounts: actual, corrupt } = countBookAccounts(raw.path);
      if (actual !== r.accounts) {
        accountMismatches.push({ book: r.book, reported: r.accounts, actualInBookFile: actual, corrupt });
      }
    }

    const pdf = checkPdf(r.pdf);
    if (!pdf.ok) pdfFailures.push({ book: r.book, pdf: r.pdf, reason: pdf.reason });

    if (r.attempts === 0) {
      const cohortTotal = cohortTotals.get(cohortOf.get(r.book));
      zeroAttemptFindings.push({
        book: r.book,
        cohortRowsAvailable: cohortTotal ?? null,
        likely: cohortTotal > 0
          ? 'ACCOUNT-KEY MISMATCH — the cohort log has rows but none joined to this book. This is the 22 PDD+1 Convin signature. Do not ship without checking the join key (External ID delimiter, leading zeros).'
          : cohortTotal === 0
            ? 'genuinely uncalled — the cohort log itself has zero rows for this window'
            : 'cohort total unknown (stage 05 did not run for this book/month in this state) — cannot classify',
      });
    }
  }

  const byCohort = new Map();
  for (const r of built.reports) {
    const k = cohortOf.get(r.book);
    if (!k) continue;
    byCohort.set(k, (byCohort.get(k) ?? 0) + r.attempts);
  }
  const overCounts = [];
  for (const [k, sum] of byCohort) {
    const avail = cohortTotals.get(k);
    if (avail != null && sum > avail) overCounts.push({ cohort: k, claimedAttempts: sum, cohortRows: avail });
  }

  const failed = built.failures?.length ? built.failures : [];
  const ok = accountMismatches.length === 0 && pdfFailures.length === 0 && overCounts.length === 0
    && zeroAttemptFindings.every((z) => !z.likely.startsWith('ACCOUNT-KEY')) && failed.length === 0;

  const result = {
    ok, month,
    booksChecked: built.reports.length,
    accountMismatches, pdfFailures, overCounts, zeroAttemptFindings,
    buildFailures: failed,
    state: { verify: { ok, accountMismatches, pdfFailures, overCounts, zeroAttemptFindings } },
  };
  if (!ok) {
    const reasons = [];
    if (accountMismatches.length) reasons.push(`${accountMismatches.length} account-count mismatch(es)`);
    if (pdfFailures.length) reasons.push(`${pdfFailures.length} invalid PDF(s)`);
    if (overCounts.length) reasons.push(`${overCounts.length} cohort(s) over-claiming attempts`);
    if (zeroAttemptFindings.some((z) => z.likely.startsWith('ACCOUNT-KEY'))) reasons.push('a zero-attempt book with a non-empty source cohort (join defect signature)');
    if (failed.length) reasons.push(`${failed.length} book(s) failed to build`);
    result.reason = reasons.join('; ');
  }
  ctx.log(`  ${built.reports.length} book(s) checked — ${ok ? 'ALL PASS' : result.reason}`);
  return { code: ok ? 0 : 1, result };
}
