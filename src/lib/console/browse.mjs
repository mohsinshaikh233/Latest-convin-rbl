import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const COUNT_CAP = 4000;
const CHILD_CAP = 400;

export const browseRoot = () => fs.realpathSync(path.resolve(process.env.CONSOLE_BROWSE_ROOT || os.homedir()));

export class OutsideRootError extends Error {
  constructor(requested, root) {
    super(`refused: ${requested} is outside the browse root ${root}`);
    this.name = 'OutsideRootError';
  }
}

export function resolveInRoot(requested, root = browseRoot()) {
  const target = requested ? path.resolve(root, String(requested)) : root;

  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    if (target !== root && !target.startsWith(root + path.sep)) throw new OutsideRootError(target, root);
    const e = new Error(`no such directory: ${target}`);
    e.code = 'ENOENT';
    throw e;
  }

  if (real !== root && !real.startsWith(root + path.sep)) throw new OutsideRootError(real, root);
  return real;
}

const WALK_DEPTH = 2;

export function countSheets(dir) {
  let xlsx = 0; let csv = 0; let dirs = 0; let scanned = 0; let truncated = false;

  const walk = (d, depth) => {
    if (truncated) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++scanned > COUNT_CAP) { truncated = true; return; }
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      if (e.isDirectory()) {
        if (depth === 0) dirs++;
        if (depth < WALK_DEPTH) walk(path.join(d, e.name), depth + 1);
        continue;
      }
      if (/\.xlsx?$/i.test(e.name)) xlsx++;
      else if (/\.csv$/i.test(e.name)) csv++;
    }
  };

  try { fs.accessSync(dir); } catch { return { xlsx: 0, csv: 0, dirs: 0, unreadable: true }; }
  walk(dir, 0);
  return { xlsx, csv, dirs, ...(truncated ? { truncated: true } : {}) };
}

export function listDir(requested) {
  const root = browseRoot();
  const dir = resolveInRoot(requested, root);

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {
    const err = new Error(`cannot read ${dir}: ${e.message}`);
    err.code = 'EACCES';
    throw err;
  }

  const dirs = [];
  let hidden = 0;
  let blockedLinks = 0;
  for (const e of entries) {
    if (dirs.length >= CHILD_CAP) break;
    if (e.name.startsWith('.')) { if (e.isDirectory() || e.isSymbolicLink()) hidden++; continue; }

    const full = path.join(dir, e.name);

    if (e.isSymbolicLink()) {
      let target;
      try { target = resolveInRoot(full, root); } catch { blockedLinks++; continue; }
      try { if (!fs.statSync(target).isDirectory()) continue; } catch { continue; }
      dirs.push({ name: e.name, path: target, counts: countSheets(target), link: true });
      continue;
    }

    if (!e.isDirectory()) continue;
    dirs.push({ name: e.name, path: full, counts: countSheets(full) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    root,
    path: dir,

    parent: dir === root ? null : path.dirname(dir),
    atRoot: dir === root,
    breadcrumb: crumbs(dir, root),
    counts: countSheets(dir),
    dirs,
    hiddenDirs: hidden,
    blockedLinks,
    truncated: dirs.length >= CHILD_CAP,
  };
}

function crumbs(dir, root) {
  const out = [{ name: path.basename(root) || root, path: root }];
  if (dir === root) return out;
  const rest = dir.slice(root.length + 1).split(path.sep);
  let acc = root;
  for (const seg of rest) { acc = path.join(acc, seg); out.push({ name: seg, path: acc }); }
  return out;
}
