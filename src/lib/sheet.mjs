import * as XLSX from 'xlsx';
import { parseCsv } from './csv.mjs';

export function readSheet(buf, filename = '') {
  const isExcel = /\.xlsx?$/i.test(filename)

    || (buf?.length > 1 && buf[0] === 0x50 && buf[1] === 0x4B);

  if (!isExcel) {
    const text = typeof buf === 'string' ? buf : Buffer.from(buf).toString('utf8');
    return parseCsv(text);
  }

  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error(`"${filename}" has no sheets in it.`);

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
}

export function detectSheetKind(headers) {
  const h = new Set((headers || []).map((x) => String(x ?? '').trim().toLowerCase()));
  const hasAll = (...ks) => ks.every((k) => h.has(k));

  if (h.has('external id') && h.has('attempt number')
    && (h.has('call answered timestamp') || h.has('call timestamp'))) return 'calllog';

  if (h.has('status') && (h.has('account_no') || h.has('account no')) && h.size <= 4) return 'status';

  if (hasAll('total ai call attempts') || h.has('ai connected seconds')) return 'leads';

  if (h.has('bill cycle') || h.has('curr bal band') || h.has('portfolio(pdd)')) return 'cyc';
  return 'unknown';
}
