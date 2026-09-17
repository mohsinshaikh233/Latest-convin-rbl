import fs from 'node:fs';
import path from 'node:path';

const STATE_DIR = path.join(process.cwd(), 'state');

export function statePath(month) {
  return path.join(STATE_DIR, `${month}.json`);
}

export function loadState(month) {
  const p = statePath(month);
  if (!fs.existsSync(p)) {
    return { month, stages: {}, cohorts: {}, books: {} };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function saveState(month, state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const p = statePath(month);
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, p);
  return p;
}

export function markStage(month, stage, patch) {
  const state = loadState(month);
  state.stages[stage] = { ...(state.stages[stage] ?? {}), ...patch, at: new Date().toISOString() };
  saveState(month, state);
  return state;
}

export function loadCampaignCache() {
  const p = path.join(STATE_DIR, 'campaigns.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function saveCampaignCache(cache) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const p = path.join(STATE_DIR, 'campaigns.json');
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 1));
  fs.renameSync(tmp, p);
  return p;
}
