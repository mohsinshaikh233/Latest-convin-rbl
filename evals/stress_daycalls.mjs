let checks = 0; let failures = 0;
const ok = (label, cond, detail = '') => {
  checks += 1;
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
};

const cumulativeDays = (perDay) => perDay.map((_, i) =>
  perDay.slice(0, i + 1).reduce((a, b) => a + b, 0));

const fixed  = (days) => days.reduce((_, d) => d, 0);
const broken = (days) => days.reduce((a, d) => a + d, 0);

console.log('\nPer-book attempts across cumulative day folders\n');

{
  const days = cumulativeDays([100, 100, 100, 100, 100]);
  ok('5-day book: true total is the last day', fixed(days) === 500, `got ${fixed(days)}`);
  ok('5-day book: summing inflates exactly 3.0x', broken(days) / fixed(days) === 3,
    `ratio ${broken(days) / fixed(days)}`);
}

{
  const days = cumulativeDays([80, 80, 80, 80]);
  ok('4-day book: true total is the last day', fixed(days) === 320, `got ${fixed(days)}`);
  ok('4-day book: summing inflates exactly 2.5x', broken(days) / fixed(days) === 2.5,
    `ratio ${broken(days) / fixed(days)}`);
}

for (const n of [1, 2, 3, 5, 7]) {
  const days = cumulativeDays(Array(n).fill(10));
  const ratio = broken(days) / fixed(days);
  ok(`N=${n}: inflation is (N+1)/2 = ${(n + 1) / 2}`, Math.abs(ratio - (n + 1) / 2) < 1e-9,
    `ratio ${ratio}`);
}

{
  const days = cumulativeDays([500, 0, 0, 12, 3]);
  ok('uneven days: last day is still the whole truth', fixed(days) === 515, `got ${fixed(days)}`);
  ok('uneven days: summing still over-claims', broken(days) > fixed(days),
    `${broken(days)} vs ${fixed(days)}`);
}

{
  const days = cumulativeDays([250]);
  ok('1-day book: the two agree, so one-day fixtures cannot catch this',
    fixed(days) === broken(days) && fixed(days) === 250);
}

{
  const cohortRows = 800;
  const bookA = cumulativeDays([100, 100, 100, 100, 100]);
  const bookB = cumulativeDays([60, 60, 60, 60, 60]);
  ok('guard #4 passes with the fix', fixed(bookA) + fixed(bookB) <= cohortRows,
    `${fixed(bookA) + fixed(bookB)} vs ${cohortRows}`);
  ok('guard #4 failed the month before the fix', broken(bookA) + broken(bookB) > cohortRows,
    `${broken(bookA) + broken(bookB)} vs ${cohortRows}`);
}

{
  const { rollUpCallLog, applyCallLog } = await import('../src/lib/calllog.mjs');

  const HEAD = ['External ID', 'Attempt Number', 'Call Timestamp', 'Call Answered Timestamp',
    'Call Duration (Seconds)', 'Call Status', 'Sense Disposition L1', 'Sense Disposition L2', 'From Phone Num'];

  const bookA = ['50100200301', '50100200302', '50100200303'];
  const bookB = ['50100900801', '50100900802'];
  const rowsFor = (acct, n) => Array.from({ length: n }, (_, i) => [
    `${acct}_04052099`, String(i + 1), '2099-05-05 10:00:00', '2099-05-05 10:00:05', '30', 'answered', 'CONNECTED', '', '+915000000001',
  ]);
  const cohortSheet = [HEAD,
    ...bookA.flatMap((a) => rowsFor(a, 2)),
    ...bookB.flatMap((a) => rowsFor(a, 3)),
  ];

  const log = rollUpCallLog(cohortSheet);
  const canonical = (accts) => accts.map((a) => ({ account_no: a }));

  const rowsA = canonical(bookA);
  applyCallLog(rowsA, log, { name: 'cohort export' });
  const rowsB = canonical(bookB);
  applyCallLog(rowsB, log, { name: 'cohort export' });

  const sumAttempts = (rows) => rows.reduce((n, r) => n + (Number(r.ai_attempts) || 0), 0);
  const cohortTotal = cohortSheet.length - 1;

  ok('the cohort export holds both books\' rows', cohortTotal === 12, `got ${cohortTotal}`);
  ok('log.stats.attempts is the COHORT total, not a book\'s',
    log.stats.attempts === cohortTotal, `${log.stats.attempts} vs ${cohortTotal}`);

  ok('book A\'s own rows sum to 6', sumAttempts(rowsA) === 6, `got ${sumAttempts(rowsA)}`);
  ok('book B\'s own rows sum to 6', sumAttempts(rowsB) === 6, `got ${sumAttempts(rowsB)}`);

  ok('the old line would have given EACH book 12', log.stats.attempts === 12);
  ok('i.e. it over-stated by exactly the book count (2x here)',
    log.stats.attempts / sumAttempts(rowsA) === 2,
    `ratio ${log.stats.attempts / sumAttempts(rowsA)}`);

  ok('guard #4 passes when each book counts its own rows',
    sumAttempts(rowsA) + sumAttempts(rowsB) <= cohortTotal,
    `${sumAttempts(rowsA) + sumAttempts(rowsB)} vs ${cohortTotal}`);
  ok('guard #4 would have failed the month before the fix',
    log.stats.attempts * 2 > cohortTotal, `${log.stats.attempts * 2} vs ${cohortTotal}`);

  const soloSheet = [HEAD, ...bookA.flatMap((a) => rowsFor(a, 2))];
  const soloLog = rollUpCallLog(soloSheet);
  const soloRows = canonical(bookA);
  applyCallLog(soloRows, soloLog, { name: 'cohort export' });
  ok('a SINGLE-book cohort agrees either way — which is why CYC 12 passed',
    soloLog.stats.attempts === sumAttempts(soloRows), `${soloLog.stats.attempts} vs ${sumAttempts(soloRows)}`);
}

console.log(`\n${checks} checks · ${failures} failure(s)\n`);
process.exit(failures ? 1 : 0);
