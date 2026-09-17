import fs from 'node:fs';
import os from 'node:os';
import { statePath, loadState, saveState } from './state.mjs';

export const LOCK_STALE_HOURS = 2;

export const lockPath = (month) => statePath(month).replace(/\.json$/, '.lock.json');

export function readLock(month) {
  const p = lockPath(month);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { corrupt: true, error: e.message, raw: fs.readFileSync(p, 'utf8').slice(0, 400) };
  }
}

export function lockAgeHours(lock) {
  const t = Date.parse(lock?.heartbeatAt ?? lock?.acquiredAt ?? '');
  return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : Infinity;
}

export const isStale = (lock) => lockAgeHours(lock) > LOCK_STALE_HOURS;

const describe = (lock) => `runId ${lock?.runId ?? '?'} on ${lock?.host ?? '?'} (pid ${lock?.pid ?? '?'})`;

function write(month, lock) {
  fs.mkdirSync(statePath(month).replace(/\/[^/]+$/, ''), { recursive: true });
  const p = lockPath(month);
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(lock, null, 1));
  fs.renameSync(tmp, p);
  return p;
}

function recordCrash(month, crashJson, runId) {
  let crash;
  try {
    crash = JSON.parse(crashJson);
  } catch (e) {
    crash = { message: `--crash payload did not parse (${e.message})`, raw: String(crashJson).slice(0, 500) };
  }
  const state = loadState(month);
  state.lastCrash = {
    crashedAt: new Date().toISOString(),
    runId: runId ?? crash.runId ?? null,
    node: crash.node ?? null,
    message: crash.message ?? null,
    stage: crash.stage ?? null,
    executionUrl: crash.executionUrl ?? null,
    stderrTail: typeof crash.stderrTail === 'string' ? crash.stderrTail.slice(-2000) : null,
  };
  saveState(month, state);
  return state.lastCrash;
}

const newRunId = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;

export async function run(ctx) {
  const argv = process.argv;
  const has = (f) => argv.includes(`--${f}`);
  const flag = (f) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };

  const { month } = ctx;
  const force = has('force');
  const crashPayload = flag('crash');
  const existing = readLock(month);

  const crash = crashPayload ? recordCrash(month, crashPayload, ctx.runId) : null;

  if (has('status') || (!has('acquire') && !has('release'))) {
    const held = !!existing;
    return {
      code: 0,
      result: {
        ok: true, month, action: 'status', held,
        stale: held ? isStale(existing) : false,
        ageHours: held ? Number(lockAgeHours(existing).toFixed(3)) : null,
        lock: existing, crash,
      },
    };
  }

  if (has('acquire')) {
    const runId = ctx.runId ?? newRunId();
    const now = new Date().toISOString();

    if (existing && !existing.corrupt) {
      if (existing.runId === runId) {
        write(month, { ...existing, heartbeatAt: now });
        return { code: 0, result: { ok: true, month, action: 'acquire', acquired: true, alreadyOurs: true, runId, lock: { ...existing, heartbeatAt: now }, crash } };
      }
      if (!isStale(existing) && !force) {
        return {
          code: 10,
          result: {
            ok: false, month, action: 'acquire', acquired: false, runId,
            reason: `month ${month} is locked by ${describe(existing)}, heartbeat ${lockAgeHours(existing).toFixed(2)}h ago — that run is alive`,
            holder: existing, crash,
          },
        };
      }

      const lock = { runId, pid: process.pid, host: os.hostname(), acquiredAt: now, heartbeatAt: now };
      write(month, lock);
      return {
        code: 0,
        result: {
          ok: true, month, action: 'acquire', acquired: true, runId, lock, crash,
          tookFrom: existing,
          reason: force
            ? `took the lock by --force from ${describe(existing)}`
            : `took a STALE lock from ${describe(existing)} — its last heartbeat was ${lockAgeHours(existing).toFixed(1)}h ago, so that run is presumed dead`,
        },
      };
    }

    const lock = { runId, pid: process.pid, host: os.hostname(), acquiredAt: now, heartbeatAt: now };
    write(month, lock);
    return { code: 0, result: { ok: true, month, action: 'acquire', acquired: true, runId, lock, crash, ...(existing?.corrupt ? { replacedCorruptLock: existing } : {}) } };
  }

  if (!existing) {
    return { code: 0, result: { ok: true, month, action: 'release', released: false, reason: 'no lock was held', crash } };
  }
  const ours = ctx.runId && existing.runId === ctx.runId;
  if (!ours && !isStale(existing) && !force && !existing.corrupt) {
    return {
      code: 10,
      result: {
        ok: false, month, action: 'release', released: false,
        reason: `refusing to release a live lock held by ${describe(existing)} — this run is ${ctx.runId ?? 'unidentified'}. ` +
          'Releasing another run\'s lock leaves two writers on one month with nothing to warn either of them. Use --force only if that run is known to be gone.',
        holder: existing, crash,
      },
    };
  }
  fs.unlinkSync(lockPath(month));
  return {
    code: 0,
    result: {
      ok: true, month, action: 'release', released: true, crash,
      wasOurs: !!ours,
      ...(ours ? {} : { reason: existing.corrupt ? 'released a corrupt lock' : isStale(existing) ? `released a stale lock from ${describe(existing)}` : `released by --force from ${describe(existing)}` }),
      lock: existing,
    },
  };
}
