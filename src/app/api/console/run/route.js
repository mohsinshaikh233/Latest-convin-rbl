import { NextResponse } from 'next/server';
import { requireAuth, operator } from '../../../../lib/console/auth.mjs';
import { startRun, publicRun, listRuns, loadRun, abortRun, LockedError } from '../../../../lib/console/runner.mjs';
import { resolveInRoot, OutsideRootError } from '../../../../lib/console/browse.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const runId = new URL(request.url).searchParams.get('runId');
  if (!runId) return NextResponse.json({ runs: listRuns() });

  const run = loadRun(runId);
  return run ? NextResponse.json(run) : NextResponse.json({ error: 'no such run' }, { status: 404 });
}

export async function POST(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  if (body.action === 'abort') {
    const r = abortRun(body.runId, operator(request));
    return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.status });
  }

  const month = String(body.month ?? '');
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  const mode = body.mode === 'replay' ? 'replay' : 'live';

  let inputDir = null;
  if (body.inputDir) {
    try {
      inputDir = resolveInRoot(String(body.inputDir));
    } catch (e) {
      const outside = e instanceof OutsideRootError;
      return NextResponse.json({ error: outside ? 'That folder is outside the browse root.' : e.message }, { status: outside ? 403 : 400 });
    }
  }
  if (mode === 'replay' && !inputDir) {
    return NextResponse.json({ error: 'REPLAY reads its sources from a folder on disk — pick one before starting.' }, { status: 400 });
  }

  try {
    const run = await startRun({ month, mode, inputDir, startedBy: operator(request), dryRun: body.dryRun === true ? true : body.dryRun === false ? false : null });
    return NextResponse.json(publicRun(run), { status: 202 });
  } catch (e) {
    if (e instanceof LockedError) {
      return NextResponse.json({ error: e.message, locked: true, holder: e.holder }, { status: 409 });
    }
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
