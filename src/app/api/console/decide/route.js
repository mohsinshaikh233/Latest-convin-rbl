import { NextResponse } from 'next/server';
import { requireAuth, operator } from '../../../../lib/console/auth.mjs';
import { submitDecision } from '../../../../lib/console/runner.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }
  if (!body.runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 });

  const r = await submitDecision(body.runId, {
    entries: body.entries,
    reason: body.reason,
    by: operator(request),
  });

  const { ok, status, ...rest } = r;
  return NextResponse.json(ok ? { ok: true, ...rest } : rest, { status });
}
