import { NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { beginBatch, appendChunk, commitBatch } from '../../../../lib/ingest_chunked.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = Buffer.from(await request.arrayBuffer());
    const gz = request.headers.get('x-gzip') === '1';
    const body = JSON.parse((gz ? gunzipSync(raw) : raw).toString('utf8'));

    const { phase, reportDate, slot = 1, filename = '', sources = [], rows = [], batchId } = body;

    if (phase === 'begin') {
      if (!reportDate) return NextResponse.json({ error: 'reportDate is required' }, { status: 400 });
      const id = await beginBatch({ reportDate, slot });
      return NextResponse.json({ ok: true, batchId: id });
    }

    if (phase === 'chunk') {
      if (!batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
      const n = await appendChunk({ batchId, reportDate, rows });
      return NextResponse.json({ ok: true, received: n });
    }

    if (phase === 'commit') {
      if (!batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
      const uploadTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const res = await commitBatch({ batchId, reportDate, slot, filename, uploadTime, sources });
      return NextResponse.json({ ok: true, ...res });
    }

    return NextResponse.json({ error: `unknown phase: ${phase}` }, { status: 400 });
  } catch (e) {
    console.error('chunk ingest', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
