import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../../../../lib/console/auth.mjs';
import { reportsDir, assembledDir, pipelineRoot } from '../../../../../scripts/pipeline/paths.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LIST = 500;

function walkPdfs(dir, depth = 0, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_LIST) break;
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 3) walkPdfs(full, depth + 1, out); continue; }
    if (!/\.pdf$/i.test(e.name)) continue;
    try {
      const st = fs.statSync(full);
      out.push({ name: e.name, path: full, bytes: st.size, modified: st.mtime.toISOString() });
    } catch {  }
  }
  return out;
}

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });

  const root = fs.realpathSync(path.resolve(pipelineRoot()));
  const wanted = url.searchParams.get('file');

  if (wanted) {
    let real;
    try { real = fs.realpathSync(path.resolve(wanted)); } catch { return NextResponse.json({ error: 'no such file' }, { status: 404 }); }
    if (real !== root && !real.startsWith(root + path.sep)) {
      return NextResponse.json({ error: 'refused: that file is outside the pipeline root' }, { status: 403 });
    }
    if (!/\.pdf$/i.test(real)) {
      return NextResponse.json({ error: 'only PDFs are served here' }, { status: 403 });
    }
    const stat = fs.statSync(real);
    return new Response(fs.createReadStream(real), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${path.basename(real).replace(/["\\]/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const reports = reportsDir(month);
  const assembled = assembledDir(month);
  const pdfs = walkPdfs(reports);
  return NextResponse.json({
    month,
    reportsDir: reports,
    assembledDir: assembled,
    exists: fs.existsSync(reports),
    assembledExists: fs.existsSync(assembled),
    count: pdfs.length,
    truncated: pdfs.length >= MAX_LIST,
    bytes: pdfs.reduce((a, p) => a + p.bytes, 0),
    pdfs: pdfs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  });
}
