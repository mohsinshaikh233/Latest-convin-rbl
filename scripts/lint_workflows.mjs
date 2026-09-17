#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { STAGES } from './pipeline/stages.mjs';

const WF_DIR = path.join(process.cwd(), 'n8n');

const LEGACY = new Set(['rbl-reports.workflow.json']);
const PENDING_ERROR_WORKFLOW = new Set([]);

const IS_ERROR_WORKFLOW = new Set(['rbl-error-handler.workflow.json']);

const TRIGGER_TYPES = /trigger$|\.webhook$|\.formTrigger$/i;

const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|authorization|bearer|access[_-]?key/i;
const SECRET_VALUE = [
  { name: 'postgres URL with a password', re: /postgres(ql)?:\/\/[^\s:]+:[^\s@]+@/i },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'bearer/JWT literal', re: /\beyJ[A-Za-z0-9_-]{20,}\./ },
];

const findings = [];
const add = (file, rule, message) => findings.push({ file, rule, message });

function* strings(value, keyPath = []) {
  if (typeof value === 'string') { yield [keyPath, value]; return; }
  if (Array.isArray(value)) { for (const [i, v] of value.entries()) yield* strings(v, [...keyPath, String(i)]); return; }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, [...keyPath, k]);
}

const isExpression = (s) => s.trimStart().startsWith('=') || s.includes('{{');

function lintWorkflow(file, wf) {
  const nodes = wf.nodes ?? [];
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const connections = wf.connections ?? {};

  if (!nodes.length) { add(file, 'empty', 'workflow has no nodes'); return; }

  const targeted = new Set();
  for (const [from, outputs] of Object.entries(connections)) {
    if (!byName.has(from)) add(file, 'dangling-connection', `connections reference "${from}", which is not a node`);
    for (const branch of Object.values(outputs ?? {})) {
      for (const conns of branch ?? []) {
        for (const c of conns ?? []) {
          targeted.add(c.node);
          if (!byName.has(c.node)) add(file, 'dangling-connection', `"${from}" connects to "${c.node}", which is not a node`);
        }
      }
    }
  }

  const triggers = nodes.filter((n) => TRIGGER_TYPES.test(n.type));
  if (!triggers.length) add(file, 'no-trigger', 'workflow has no trigger node — nothing can start it');
  const reachable = new Set(triggers.map((n) => n.name));
  const queue = [...reachable];
  while (queue.length) {
    const name = queue.shift();
    for (const branch of Object.values(connections[name] ?? {})) {
      for (const conns of branch ?? []) {
        for (const c of conns ?? []) if (byName.has(c.node) && !reachable.has(c.node)) { reachable.add(c.node); queue.push(c.node); }
      }
    }
  }
  for (const n of nodes) {
    if (n.disabled) continue;

    if (/\.stickyNote$/i.test(n.type)) continue;
    if (!reachable.has(n.name)) add(file, 'orphan-node', `"${n.name}" (${n.type}) is not reachable from any trigger`);
  }

  for (const n of nodes) {
    if (!/\.(if|switch)$/i.test(n.type) || n.disabled) continue;
    const main = connections[n.name]?.main ?? [];
    const wired = main.filter((b) => Array.isArray(b) && b.length > 0).length;
    const needed = /\.if$/i.test(n.type) ? 2 : Math.max(2, main.length);
    if (wired < needed) add(file, 'if-branch', `"${n.name}" has ${wired} of ${needed} output branches wired`);
  }

  for (const n of nodes) {
    if (!/\.executeWorkflow$/i.test(n.type) || n.disabled) continue;
    const wid = n.parameters?.workflowId;
    const named = typeof wid === 'object' ? (wid.cachedResultName ?? wid.value) : wid;
    if (!named) { add(file, 'execute-workflow', `"${n.name}" does not name a workflow`); continue; }
    if (isExpression(String(named))) continue;
    if (!KNOWN_WORKFLOW_NAMES.has(String(named)) && !KNOWN_WORKFLOW_IDS.has(String(named))) {
      add(file, 'execute-workflow', `"${n.name}" calls "${named}", which is not a workflow in n8n/`);
    }
  }

  for (const n of nodes) {
    if (!/\.executeCommand$/i.test(n.type) || n.disabled) continue;
    const command = String(n.parameters?.command ?? '');

    const EMITS_SENTINEL = /printf\s+'__EXIT__|echo\s+"__EXIT__|__EXIT__\$\?/;
    const builtByExpression = isExpression(command);
    const covered = EMITS_SENTINEL.test(command)
      || (builtByExpression && nodes.some((c) => /\.code$/i.test(c.type) && EMITS_SENTINEL.test(String(c.parameters?.jsCode ?? ''))));
    if (!covered) {
      add(file, 'exit-sentinel', `"${n.name}" does not carry the __EXIT__ sentinel — on a non-zero exit this node drops exitCode AND stdout, so an exit 10 (a human must decide) is reported as a crash. Wrap the command: ( <cmd> ); printf '__EXIT__%s\\n' "$?"`);
    }

    if (!command.includes('--stage')) continue;
    for (const m of command.matchAll(/--stage\s+('?)([^\s'"]+)\1/g)) {
      const stage = m[2];
      if (stage.includes('{{') || stage.includes('$json') || stage.includes('$vars')) continue;
      if (!(stage in STAGES)) add(file, 'unknown-stage', `"${n.name}" runs --stage ${stage}, which run.mjs does not implement (known: ${Object.keys(STAGES).join(', ')})`);
    }
  }

  for (const n of nodes) {
    for (const [keyPath, value] of strings(n.parameters ?? {})) {
      if (!value || isExpression(value)) continue;
      const key = keyPath[keyPath.length - 1] ?? '';
      if (SECRET_KEY.test(key) && value.length > 3 && !/^\s*$/.test(value)) {
        add(file, 'inline-credential', `"${n.name}" has a literal in parameters.${keyPath.join('.')} — use an n8n credential`);
      }
      for (const { name, re } of SECRET_VALUE) {
        if (re.test(value)) add(file, 'inline-credential', `"${n.name}" contains what looks like a ${name} in parameters.${keyPath.join('.')}`);
      }
    }

    for (const [slot, cred] of Object.entries(n.credentials ?? {})) {
      const extra = Object.keys(cred ?? {}).filter((k) => k !== 'id' && k !== 'name');
      if (extra.length) add(file, 'inline-credential', `"${n.name}" credentials.${slot} carries ${extra.join(', ')} — only id/name belong in an exported workflow`);
    }
  }

  const runsStages = nodes.some((n) => /\.executeCommand$/i.test(n.type) && !n.disabled
    && /--stage\s+'?0\d/.test(String(n.parameters?.command ?? '')));
  const buildsStageCommands = nodes.some((n) => /\.code$/i.test(n.type)
    && /--stage\s*'?\s*\+/.test(String(n.parameters?.jsCode ?? '')));
  const touchesLock = JSON.stringify(nodes).includes('--stage lock');

  const canStartAlone = nodes.some((n) => !n.disabled && /\.(manualTrigger|scheduleTrigger|webhook|cron|interval)$/i.test(n.type));
  if (canStartAlone && (runsStages || buildsStageCommands) && !touchesLock) {
    add(file, 'month-lock', 'runs pipeline stages but never acquires the month lock — a concurrent run would write the same month with nothing to warn either of them');
  }

  if (!wf.settings?.errorWorkflow) {
    add(file, 'error-workflow', 'settings.errorWorkflow is not set — a crash runs no handler, so nobody is told and any month lock the run holds is never released');
  }
}

if (!fs.existsSync(WF_DIR)) {
  console.error(`no n8n/ directory at ${WF_DIR}`);
  process.exit(1);
}
const files = fs.readdirSync(WF_DIR).filter((f) => f.endsWith('.workflow.json')).sort();
const loaded = [];
for (const f of files) {
  try {
    loaded.push([f, JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8'))]);
  } catch (e) {
    add(f, 'parse', `does not parse: ${e.message}`);
  }
}
const KNOWN_WORKFLOW_NAMES = new Set(loaded.map(([, w]) => w.name).filter(Boolean));
const KNOWN_WORKFLOW_IDS = new Set(loaded.map(([, w]) => w.id).filter(Boolean));

for (const [f, w] of loaded) lintWorkflow(f, w);

const bar = '─'.repeat(76);
console.log(`\n${bar}\n  WORKFLOW LINT — ${files.length} workflow(s) in n8n/\n${bar}`);

let hard = 0; let soft = 0;
for (const f of files) {
  const mine = findings.filter((x) => x.file === f);
  const legacy = LEGACY.has(f);
  const ewExempt = PENDING_ERROR_WORKFLOW.has(f) || IS_ERROR_WORKFLOW.has(f);
  const counted = mine.filter((x) => !legacy && !(ewExempt && x.rule === 'error-workflow'));
  const excused = mine.filter((x) => !counted.includes(x));
  hard += counted.length; soft += excused.length;

  const tag = legacy ? ' (legacy — findings not enforced, deleted when the new set lands)' : '';
  console.log(`\n  ${counted.length === 0 ? '✔' : '✘'} ${f}${tag}`);
  for (const x of counted) console.log(`      ✘ [${x.rule}] ${x.message}`);
  for (const x of excused) console.log(`      · [${x.rule}] ${x.message}  ← excused`);
}

console.log(`\n${bar}`);
if (hard) {
  console.log(`  ✘ ${hard} finding(s) to fix${soft ? `, ${soft} excused` : ''}\n`);
  process.exit(1);
}
console.log(`  ✔ clean${soft ? ` (${soft} excused finding(s) in legacy / pending files)` : ''}\n`);
