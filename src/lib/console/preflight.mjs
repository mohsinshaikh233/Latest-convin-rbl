import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { commandLine, lastJson, scopeFor } from './runner.mjs';

const REPO = process.cwd();
const ENV_FILE = path.join(REPO, '.env.local');

function run(args) {
  return new Promise((resolve) => {
    const child = spawn('node', args, { cwd: REPO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ code: 1, result: null, stderr: e.message }));
    child.on('close', (code) => resolve({ code, result: lastJson(out), stderr: err }));
  });
}

const base = () => (fs.existsSync(ENV_FILE) ? [`--env-file=${path.relative(REPO, ENV_FILE)}`] : []);

export { scopeFor };

export async function preflight(month, mode = 'live') {
  const scope = scopeFor(mode);

  const flightArgs = [...base(), 'scripts/pipeline/run.mjs', '--stage', '00', '--month', month, '--json', '--stages', scope.join(',')];
  const lockArgs = [...base(), 'scripts/pipeline/run.mjs', '--stage', 'lock', '--month', month, '--status', '--json'];

  const [flight, lock] = await Promise.all([run(flightArgs), run(lockArgs)]);

  return {
    scope,
    scopeNote: mode === 'replay'
      ? `REPLAY reaches no external system before stage 05, so preflight checks stages ${scope.join(', ')} — the ones that will actually use Chrome, Postgres and the disk.`
      : `LIVE runs every stage, so preflight checks all of ${scope.join(', ')}.`,

    code: flight.code,
    ok: flight.code === 0,
    blocked: flight.code === 1 || flight.code === 3,
    stopped: flight.code === 10,
    reason: flight.result?.reason ?? (flight.stderr.trim().split('\n').slice(-3).join(' ') || null),
    checks: flight.result?.checks ?? [],
    warnings: flight.result?.warnings ?? [],
    command: commandLine(flightArgs),
    lock: lock.result ?? null,
  };
}
