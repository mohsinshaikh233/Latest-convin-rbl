import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hasDb, insertRows, deleteBatch, upsertBatch, forEachRowOfDate } from './db.mjs';
import { Aggregator } from './aggregate.mjs';
import { unionByAccount, bySlot } from './dayunion.mjs';
import { isResolved } from './normalize.mjs';

const DATA = () => path.join(process.cwd(), 'src', 'data');
const BATCHES = () => path.join(DATA(), 'batches');

const displayDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

const displayRow = (r) => [
  r.account_no, r.customer_name, r.status, r.disp_l1 || '—', r.region || '—', r.primary_state || '—',
  r.curr_bal_band, r.total_outstanding, isResolved(r) ? r.total_outstanding : 0,
  r.ai_attempts, r.ai_connected_calls, r.payment_mode || '—', r.promise_flag === 'YES' ? 'Yes' : '—',
  r.mobile || '—', r.lead_link || '',
];

const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => writeFile(p, JSON.stringify(o));

export async function beginBatch({ reportDate, slot }) {
  const batchId = `${reportDate}__u${slot}`;
  if (hasDb()) {
    await deleteBatch(batchId);
  } else {
    await mkdir(BATCHES(), { recursive: true });
    for (const suffix of ['.json', '.rows.json', '.canon.json', '.sources.json']) {
      try { await unlink(path.join(BATCHES(), batchId + suffix)); } catch {  }
    }
  }
  return batchId;
}

export async function appendChunk({ batchId, reportDate, rows }) {
  if (!rows || !rows.length) return 0;
  if (hasDb()) {
    await insertRows(rows, batchId, reportDate);
  } else {
    const f = path.join(BATCHES(), `${batchId}.canon.json`);
    const existing = await readJson(f, []);
    existing.push(...rows);
    await writeJson(f, existing);
  }
  return rows.length;
}

export async function commitBatch({ batchId, reportDate, slot, filename, uploadTime, sources }) {
  const disp = displayDate(reportDate);

  const canon = [];
  if (hasDb()) {
    await forEachRowOfBatch(batchId, (r) => canon.push(r));
  } else {
    canon.push(...await readJson(path.join(BATCHES(), `${batchId}.canon.json`), []));
  }
  if (!canon.length) throw new Error('No rows were received. The upload did not complete.');

  const agg = new Aggregator();
  for (const r of canon) agg.add(r);
  const payload = agg.payload(disp, sources || []);

  if (hasDb()) {
    await upsertBatch(
      { id: batchId, reportDate, filename, rowCount: canon.length, kind: 'upload', label: `Day ${slot}`, uploadTime },
      payload,
    );
    await recomputeDayTotalDb(reportDate);
  } else {
    await writeJson(path.join(BATCHES(), `${batchId}.json`), payload);
    await writeJson(path.join(BATCHES(), `${batchId}.rows.json`), canon.map(displayRow));
    await writeJson(path.join(BATCHES(), `${batchId}.sources.json`), sources || []);
    await recomputeDayTotalLocal(reportDate, disp, { batchId, slot, filename, uploadTime, rowCount: canon.length });
  }

  return { batchId, rowCount: canon.length };
}

async function recomputeDayTotalDb(reportDate) {
  const byAccount = new Map();
  await forEachRowOfDate(reportDate, (r) => {
    const k = String(r.account_no ?? '').trim();
    if (k) byAccount.set(k, r);
  });
  const agg = new Aggregator();
  for (const r of byAccount.values()) agg.add(r);

  const { getPool } = await import('./db.mjs');
  const pool = await getPool();
  const { rows: batches } = await pool.query(
    `SELECT payload->'meta'->'sources' AS sources FROM batches
      WHERE report_date = $1 AND kind = 'upload' ORDER BY id`, [reportDate],
  );
  const daySources = batches.flatMap((b) => b.sources || []);

  await upsertBatch(
    { id: `${reportDate}__daytotal`, reportDate, filename: '', rowCount: byAccount.size, kind: 'daytotal', label: 'Day Total', uploadTime: '' },
    agg.payload(displayDate(reportDate), daySources),
  );
}

async function recomputeDayTotalLocal(iso, disp, entry) {
  const { readdir } = await import('node:fs/promises');

  const files = (await readdir(BATCHES())).filter((f) => f.startsWith(`${iso}__u`) && f.endsWith('.canon.json')).sort(bySlot);

  const chunks = [];
  const daySources = [];
  for (const f of files) {
    chunks.push(await readJson(path.join(BATCHES(), f), []));
    const su = await readJson(path.join(BATCHES(), f.replace('.canon.json', '.sources.json')), []);
    for (const x of su) daySources.push({ ...x, upload: f.replace(`${iso}__`, '').replace('.canon.json', '') });
  }
  const union = unionByAccount(chunks);

  const dayAgg = new Aggregator();
  for (const r of union.rows) dayAgg.add(r);
  const dt = `${iso}__daytotal`;
  await writeJson(path.join(BATCHES(), `${dt}.json`), dayAgg.payload(disp, daySources));
  await writeJson(path.join(BATCHES(), `${dt}.rows.json`), union.rows.map(displayRow));

  const manPath = path.join(DATA(), 'manifest.json');
  const man = await readJson(manPath, { dates: [], latest: null });
  let d = man.dates.find((x) => x.date === iso);
  if (!d) { d = { date: iso, display: disp, dayTotal: dt, uploads: [], rowCount: 0 }; man.dates.push(d); }
  d.display = disp; d.dayTotal = dt; d.rowCount = union.rows.length;

  const u = { id: entry.batchId, label: `Day ${entry.slot}`, time: entry.uploadTime, filename: entry.filename, rowCount: entry.rowCount };
  const i = d.uploads.findIndex((x) => x.id === entry.batchId);
  if (i >= 0) d.uploads[i] = u; else d.uploads.push(u);
  d.uploads.sort((a, b) => bySlot(a.id, b.id));

  man.dates.sort((a, b) => (a.date < b.date ? 1 : -1));
  man.latest = man.dates[0]?.date || null;
  await writeJson(manPath, man);
}

async function forEachRowOfBatch(batchId, onRow) {
  const { getPool, DATA_COLS } = await import('./db.mjs');
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT ${DATA_COLS.join(',')} FROM account_rows WHERE batch_id = $1`, [batchId]);
  for (const r of rows) onRow(r);
}
