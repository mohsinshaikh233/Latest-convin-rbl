import { NextResponse } from 'next/server';
import { hasDb } from '../../../lib/db.mjs';
import { readSheet, detectSheetKind } from '../../../lib/sheet.mjs';
import { buildCanonicalRows } from '../../../lib/merge.mjs';
import { ingestUpload } from '../../../lib/ingest.mjs';
import { ingestLocalUpload } from '../../../lib/ingest_local.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function readPart(part) {
  if (!part || typeof part === 'string') return null;
  const buf = Buffer.from(await part.arrayBuffer());
  const rows = readSheet(buf, part.name || '');
  return { name: part.name || 'sheet', rows, kind: detectSheetKind(rows[0]) };
}

const VERCEL_BODY_LIMIT = 4.5 * 1024 * 1024;

export async function POST(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const onVercel = !!process.env.VERCEL;
  const declared = Number(request.headers.get('content-length') || 0);
  if (onVercel && declared > VERCEL_BODY_LIMIT) {
    return NextResponse.json({
      error:
        `These files total ${(declared / 1048576).toFixed(1)} MB. The hosting platform refuses any upload over 4.5 MB — `
        + `that is a hard limit of serverless functions, not a setting we can raise.\n\n`
        + `Push them from your machine instead. It is one command, it is faster, and it writes to the same database:\n\n`
        + `    npm run push -- "CYC.xlsx" "Status.xlsx" "LeadOutcome.csv" --date ${new Date().toISOString().slice(0, 10)}\n\n`
        + `The dashboard will show it immediately — no redeploy needed.`,
      tooLarge: true,
    }, { status: 413 });
  }

  try {
    const form = await request.formData();

    const cycPart = form.get('cyc');
    const statusPart = form.get('status');
    const leadsPart = form.get('leads') || form.get('file');
    const legacyExtras = form.getAll('extra').filter((f) => f && typeof f !== 'string');

    const primaryPart = (cycPart && typeof cycPart !== 'string') ? cycPart : leadsPart;
    if (!primaryPart || typeof primaryPart === 'string') {
      return NextResponse.json(
        { error: 'Add the CYC / PDD file — it is the book RBL gave us to work, and it decides which accounts are in this report.' },
        { status: 400 },
      );
    }
    const usingCycSpine = primaryPart === cycPart;

    const primary = await readPart(primaryPart);
    const extras = [];
    const extraNames = [];
    const sheetInfo = [{
      slot: usingCycSpine ? 'CYC / PDD (primary)' : 'Merged sheet',
      name: primary.name, rows: Math.max(0, primary.rows.length - 1), detected: primary.kind,
    }];

    const lookups = usingCycSpine
      ? [['Status', statusPart], ['Lead outcome', leadsPart]]
      : [['Status', statusPart]];
    for (const [slotName, part] of lookups) {
      const s = await readPart(part);
      if (!s) continue;
      extras.push(s.rows);
      extraNames.push(s.name);
      sheetInfo.push({ slot: slotName, name: s.name, rows: Math.max(0, s.rows.length - 1), detected: s.kind });
    }
    for (const f of legacyExtras) {
      const s = await readPart(f);
      if (!s) continue;
      extras.push(s.rows);
      extraNames.push(s.name);
      sheetInfo.push({ slot: 'Additional', name: s.name, rows: Math.max(0, s.rows.length - 1), detected: s.kind });
    }

    const reportDate = (form.get('report_date') || '').toString() || new Date().toISOString().slice(0, 10);
    const slot = Math.max(1, parseInt((form.get('slot') || '1').toString(), 10) || 1);
    const uploadTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    let mapping = null;
    const rawMap = form.get('mapping');
    if (rawMap) { try { mapping = JSON.parse(rawMap.toString()); } catch { mapping = null; } }

    const { rows, stats, warnings } = buildCanonicalRows(primary.rows, extras, mapping, extraNames);

    const opts = { reportDate, slot, filename: primary.name, uploadTime, sources: sheetInfo };
    const res = hasDb() ? await ingestUpload(rows, opts) : await ingestLocalUpload(rows, opts);

    return NextResponse.json({ ok: true, reportDate, ...res, stats, warnings, sheets: sheetInfo });
  } catch (e) {
    console.error('ingest error', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
