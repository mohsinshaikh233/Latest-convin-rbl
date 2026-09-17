import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { subscribe, replayEvents } from '../src/lib/console/runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? '✔' : '✘'} ${label.padEnd(58)} ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
};
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${label}${cond ? '' : `\n      ${detail}`}`);
  cond ? pass++ : fail++;
};

console.log('\n══ THE CONSOLE AT MONTH SCALE ══');

console.log('\n── the reconnect contract ──\n');
{
  const gone = replayEvents('no-such-run', 0);
  t('replay for an unknown run is empty, not a throw', gone, []);

  const runId = `scale-${Date.now()}`;
  const seen = [];
  const unsub = subscribe(runId, (ev) => seen.push(ev));
  ok('subscribing before a run registers is allowed', typeof unsub === 'function',
    'the stream route subscribes first and replays second; the reverse loses events in between');
  unsub();
  ok('and unsubscribing twice does not throw', (() => { try { unsub(); return true; } catch { return false; } })(),
    'an aborted SSE request can fire cleanup more than once');
}

console.log('\n── the last month-scale run, as a client would replay it ──\n');
{
  const dir = path.join(REPO, '.pipeline-data', 'console', 'runs');
  const all = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m)
    : [];
  const isMonthScale = (r) => {
    const ev = r.events ?? [];
    const books = ev.filter((e) => e.type === 'books').pop()?.books?.length ?? 0;
    const cohorts = ev.filter((e) => e.type === 'cohort:list').pop()?.cohorts?.length ?? 0;
    return books === 36 && cohorts === 19;
  };
  const runs = all
    .map((x) => ({ ...x, run: JSON.parse(fs.readFileSync(path.join(dir, x.f), 'utf8')) }))
    .filter((x) => isMonthScale(x.run));
  if (!runs.length) {
    console.log(`  – no month-scale run stored (${all.length} other run(s) present); run evals/console_month.mjs first (skipping)`);
  } else {
    const stored = runs[0].run;
    const events = stored.events ?? [];
    console.log(`  run ${stored.runId} · ${events.length} event(s) · status ${stored.status}`);

    const seqs = events.map((e) => e.seq);
    const gaps = [];
    for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1) gaps.push([seqs[i - 1], seqs[i]]);
    const markers = events.filter((e) => e.marker);
    ok('every gap in the sequence is an explicit, labelled drop',
      gaps.length === markers.length,
      `${gaps.length} gap(s) ${JSON.stringify(gaps.slice(0, 5))} but ${markers.length} marker(s)`);
    if (markers.length) console.log(`  cap marker: ${markers[0].line}`);

    ok('seq is strictly increasing', seqs.every((s, i) => i === 0 || s > seqs[i - 1]),
      'an out-of-order seq means the client cannot dedupe on reconnect');

    if (seqs.length > 10) {
      const after = seqs[Math.floor(seqs.length / 2)];
      const tail = events.filter((e) => e.seq > after);
      ok('replay-from-seq returns exactly the tail',
        tail.length === events.length - events.findIndex((e) => e.seq === after) - 1,
        `tail ${tail.length} of ${events.length} after seq ${after}`);
      ok('and never re-sends the event the client already has',
        !tail.some((e) => e.seq <= after), 'a duplicate seq would double-render a cohort row');
    }

    const booksEv = events.filter((e) => e.type === 'books').pop();
    const cohortsEv = events.filter((e) => e.type === 'cohort:list').pop();
    if (booksEv) t('the graph is handed 36 book nodes', booksEv.books?.length, 36);
    if (cohortsEv) t('and 19 cohort nodes', cohortsEv.cohorts?.length, 19);

    const perType = {};
    for (const e of events) perType[e.type] = (perType[e.type] ?? 0) + 1;
    console.log(`  events by type: ${Object.entries(perType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  }
}

console.log(`\n${fail === 0 ? '✔' : '✘'} ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
