import { Aggregator } from './aggregate.mjs';
import { insertRows, upsertBatch, deleteBatch, forEachRowOfDate } from './db.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function displayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export async function ingestUpload(canon, { reportDate, slot = 1, filename = '', uploadTime = '', sources = [] }) {
  if (!canon || !canon.length) throw new Error('No data rows found in file.');

  const iso = reportDate;
  const disp = displayDate(iso);
  const batchId = `${iso}__u${slot}`;
  await deleteBatch(batchId);

  const agg = new Aggregator();
  let buf = [];
  let count = 0;
  const CHUNK = 1000;
  for (const row of canon) {
    agg.add(row);
    buf.push(row);
    count++;
    if (buf.length >= CHUNK) { await insertRows(buf, batchId, iso); buf = []; }
  }
  if (buf.length) await insertRows(buf, batchId, iso);

  await upsertBatch({ id: batchId, reportDate: iso, filename, rowCount: count, kind: 'upload', label: `Day ${slot}`, uploadTime }, agg.payload(disp, sources));
  await recomputeDayTotal(iso);
  return { batchId, rowCount: count };
}

export async function recomputeDayTotal(iso) {
  const disp = displayDate(iso);

  const byAccount = new Map();
  await forEachRowOfDate(iso, (r) => {
    const k = String(r.account_no ?? '').trim();
    if (k) byAccount.set(k, r);
  });
  const agg = new Aggregator();
  for (const r of byAccount.values()) agg.add(r);
  const count = byAccount.size;
  await upsertBatch({ id: `${iso}__daytotal`, reportDate: iso, filename: '', rowCount: count, kind: 'daytotal', label: 'Day Total', uploadTime: '' }, agg.payload(disp));
}
