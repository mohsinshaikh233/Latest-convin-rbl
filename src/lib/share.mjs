import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { hasDb, getPool } from './db.mjs';

const DATA = () => path.join(process.cwd(), 'src', 'data');
const FILE = () => path.join(DATA(), 'shares.json');

export const newToken = () => randomBytes(32).toString('base64url');

export function sanitizeForShare(payload) {
  const p = JSON.parse(JSON.stringify(payload));

  if (p.meta) p.meta.sources = [];

  delete p.rows;
  p.shared = true;
  return p;
}

async function readLocal() {
  try { return JSON.parse(await readFile(FILE(), 'utf8')); } catch { return []; }
}
async function writeLocal(list) {
  await mkdir(DATA(), { recursive: true });
  await writeFile(FILE(), JSON.stringify(list, null, 2));
}

export async function createShare({ batchId, reportDate, label, days = 0, scope = 'date' }) {
  const sc = scope === 'batch' ? 'batch' : 'date';
  const token = newToken();
  const now = new Date();
  const n = Number(days) || 0;
  const expiresAt = n > 0 ? new Date(now.getTime() + n * 86400_000) : null;
  const row = {
    token,
    batch_id: batchId,
    report_date: reportDate,
    scope: sc,
    label: String(label || '').slice(0, 80),
    created_at: now.toISOString(),
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    revoked: false,
    views: 0,
    last_viewed_at: null,
  };

  if (hasDb()) {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO share_links (token, batch_id, report_date, label, expires_at, scope)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [token, batchId, reportDate, row.label, expiresAt, sc],
    );
  } else {
    const list = await readLocal();
    list.unshift(row);
    await writeLocal(list);
  }
  return row;
}

export async function resolveShare(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;

  if (hasDb()) {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT token, batch_id, to_char(report_date,'YYYY-MM-DD') AS report_date,
              label, expires_at, revoked, scope
       FROM share_links WHERE token = $1`, [t],
    );
    const r = rows[0];
    if (!r || r.revoked) return null;
    if (r.expires_at && new Date(r.expires_at) < new Date()) return null;

    pool.query('UPDATE share_links SET views = views + 1, last_viewed_at = now() WHERE token = $1', [t])
      .catch(() => {});
    return { token: r.token, batchId: r.batch_id, reportDate: r.report_date, label: r.label, expiresAt: r.expires_at, scope: r.scope || 'batch' };
  }

  const list = await readLocal();
  const r = list.find((x) => constantTimeEq(x.token, t));
  if (!r || r.revoked) return null;
  if (r.expires_at && new Date(r.expires_at) < new Date()) return null;
  r.views = (r.views || 0) + 1;
  r.last_viewed_at = new Date().toISOString();
  await writeLocal(list);

  return { token: r.token, batchId: r.batch_id, reportDate: r.report_date, label: r.label, expiresAt: r.expires_at, scope: r.scope || 'batch' };
}

export async function listShares() {
  if (hasDb()) {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT token, batch_id, to_char(report_date,'YYYY-MM-DD') AS report_date, label,
              created_at, expires_at, revoked, views, last_viewed_at, scope
       FROM share_links ORDER BY created_at DESC LIMIT 100`,
    );
    return rows.map((r) => ({ ...r, batchId: r.batch_id, reportDate: r.report_date, scope: r.scope || 'batch' }));
  }
  return readLocal();
}

export async function revokeShare(token) {
  if (hasDb()) {
    const pool = await getPool();
    await pool.query('UPDATE share_links SET revoked = true WHERE token = $1', [String(token)]);
    return true;
  }
  const list = await readLocal();
  const r = list.find((x) => x.token === token);
  if (r) { r.revoked = true; await writeLocal(list); }
  return !!r;
}

function constantTimeEq(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
