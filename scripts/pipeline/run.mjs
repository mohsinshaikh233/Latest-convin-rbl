#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, markStage } from './state.mjs';
import { ConfigError } from './config.mjs';
import { STAGES, ORDER, stageName } from './stages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = {
    json: argv.includes('--json'),
    resume: argv.includes('--resume'),
    listCohorts: argv.includes('--list-cohorts'),
    dryRun: argv.includes('--dry-run'),
  };
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  a.stage = flag('stage');
  a.month = flag('month');
  a.cohort = flag('cohort');
  a.from = flag('from');
  a.only = flag('only');
  a.stages = flag('stages');
  a.runId = flag('run-id');
  return a;
}

function usage() {
  console.error([
    'usage:',
    '  node scripts/pipeline/run.mjs --stage NN --month YYYY-MM [--json] [--cohort KEY] [--list-cohorts]',
    '  node scripts/pipeline/run.mjs --month YYYY-MM [--from NN] [--only NN] [--resume]',
    '',
    `stages: ${ORDER.map((n) => `${n} ${stageName(n)}`).join(', ')}`,
  ].join('\n'));
}

async function runOne(stageNo, args) {
  const file = STAGES[stageNo];
  if (!file) {
    console.error(`unknown --stage ${stageNo}. Known stages: ${ORDER.join(', ')}`);
    return 2;
  }
  const mod = await import(path.join(__dirname, file));
  const ctx = {
    month: args.month,
    cohort: args.cohort,
    listCohorts: args.listCohorts,
    state: loadState(args.month),
    log: (...m) => console.error(...m),

    from: args.from,
    only: args.only,
    stages: args.stages,
    dryRun: args.dryRun,
    runId: args.runId,
  };
  let code; let result;
  try {
    ({ code, result } = await mod.run(ctx));
  } catch (e) {
    console.error(`\n✘ stage ${stageNo} crashed: ${e.message}`);
    if (e.stack) console.error(e.stack);
    if (e instanceof ConfigError) {
      return 3;
    }
    return 1;
  }
  markStage(args.month, stageNo, { code, ...(result?.state ?? {}) });

  console.log(JSON.stringify(result ?? {}));
  return code;
}

async function runMonth(args) {
  const from = args.from ?? ORDER[0];
  const only = args.only;
  const stages = only ? [only] : ORDER.slice(ORDER.indexOf(from));
  for (const s of stages) {
    console.error(`\n── stage ${s} ${'─'.repeat(60)}`);
    const code = await runOne(s, { ...args, json: true });
    if (code === 10) {
      console.error(`\n⏸ stopped at stage ${s} — awaiting a human decision (see the JSON line above). Not a failure.`);
      return 10;
    }
    if (code !== 0) {
      console.error(`\n✘ stage ${s} failed (exit ${code}). Fix and re-run — completed work will not repeat.`);
      return code;
    }
  }
  console.error(`\n✔ month ${args.month} complete through stage ${stages[stages.length - 1]}.`);
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.month || !/^\d{4}-\d{2}$/.test(args.month)) {
    usage();
    process.exit(2);
  }
  if (args.stage) {
    if (!STAGES[args.stage]) { usage(); process.exit(2); }
    process.exit(await runOne(args.stage, args));
  } else {
    process.exit(await runMonth(args));
  }
}

main();
