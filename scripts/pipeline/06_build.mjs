import { spawn } from 'node:child_process';
import { assembledDir, reportsDir } from './paths.mjs';

function runReports(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', ['--env-file=.env.local', 'scripts/build_book_reports.mjs', ...args], { cwd: process.cwd() });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; process.stderr.write(d); });
    p.stderr.on('data', (d) => { err += d; process.stderr.write(d); });
    p.on('close', (code) => {
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      if (!line) return reject(new Error(`build_book_reports.mjs produced no JSON line (exit ${code}): ${err.slice(-2000)}`));
      resolve({ code, json: JSON.parse(line) });
    });
  });
}

export async function run(ctx) {
  const { month, state } = ctx;
  const assembled = state.stages?.['05'];
  if (!assembled) return { code: 10, result: { ok: false, reason: 'stage 05 has not assembled anything yet — run it first', month } };

  const allowGaps = process.argv.includes('--allow-gaps');
  const allGaps = assembled.assembled?.gaps ?? assembled.gaps ?? [];

  const rulings = assembled.rulings ?? {};
  const gaps = allGaps.filter((g) => {
    const r = rulings[g.book];
    return !r || r.ruling === 'wait-for-file';
  });
  const excluded = allGaps.filter((g) => rulings[g.book]?.ruling === 'exclude-book').map((g) => g.book);
  const partial = allGaps.filter((g) => rulings[g.book]?.ruling === 'build-partial').map((g) => g.book);

  if (gaps.length && !allowGaps) {
    return {
      code: 10,
      result: {
        ok: false, month,
        reason: `stage 05 recorded ${gaps.length} book(s) with an unruled gap — refusing to build until resolved (guard #5). ` +
          'build_book_reports.mjs cannot see this on its own: it only checks that each day folder it finds is ' +
          '3/3 complete, not that all expected days exist. Rule on them (--stage 05 --apply-rulings, or the ' +
          'decision form), or re-run this stage with --allow-gaps to knowingly build the partial books.',
        gaps,
        rulings,
      },
    };
  }

  const root = assembled.assembled?.outDir ?? assembledDir(month);
  const out = reportsDir(month);
  const scratch = process.env.PIPELINE_SCRATCH_DATE || '2026-08-27';

  const assembledBooks = (assembled.assembled?.books ?? []).map((b) => b.book);
  const wanted = assembledBooks.filter((b) => !excluded.includes(b));
  if (excluded.length && !wanted.length) {
    return { code: 10, result: { ok: false, month, reason: `every assembled book was ruled exclude-book (${excluded.join(', ')}) — there is nothing to build`, excluded } };
  }

  const { code, json } = await runReports([
    '--root', root, '--out', out, '--date', scratch, '--json',
    ...(allowGaps || partial.length ? ['--incomplete'] : []),
    ...(excluded.length ? wanted.flatMap((b) => ['--only', b]) : []),
    ...(ctx.dryRun ? ['--dry-run'] : []),
  ]);

  const result = {
    ok: code === 0 && json.ok,
    month,
    built: json.built, failedCount: json.failedCount, skippedCount: json.skippedCount,
    outDir: json.outDir, scratchDate: json.scratchDate,
    zeroCallWarning: json.zeroCallWarning,
    reports: json.reports, failures: json.failures, skipped: json.skipped,
    ...(ctx.dryRun ? { dryRun: true, wouldBuild: json.wouldBuild } : {}),
    ...(partial.length ? { builtPartial: partial } : {}),
    ...(excluded.length ? { excludedByRuling: excluded } : {}),

    state: ctx.dryRun ? { dryRun: true } : { built: json },
  };
  if (json.zeroCallWarning?.length) {
    result.reason = `${json.zeroCallWarning.length} book(s) built with ZERO call attempts — the call-log-as-lookup signature (accounts/outstanding/recovered still render correctly). Confirm this is real before shipping.`;
  } else if (json.failedCount) {
    result.reason = `${json.failedCount} book(s) failed to build — see failures`;
  }
  ctx.log(`  ${json.built} built, ${json.failedCount} failed, ${json.skippedCount} skipped${json.zeroCallWarning?.length ? `, ${json.zeroCallWarning.length} ZERO-CALL WARNING` : ''}`);
  return { code: result.ok ? 0 : 1, result };
}
