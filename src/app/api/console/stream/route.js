import { requireAuth } from '../../../../lib/console/auth.mjs';
import { subscribe, replayEvents, getRun, loadRun } from '../../../../lib/console/runner.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TICK_MS = 100;
const MAX_SINGLES_PER_TICK = 3;
const HEARTBEAT_MS = 15_000;

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const runId = url.searchParams.get('runId');
  const after = Number(url.searchParams.get('after') || 0) || 0;
  if (!runId) return new Response('runId is required', { status: 400 });

  const live = getRun(runId);
  if (!live && !loadRun(runId)) return new Response('no such run', { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe = null;
  let tick = null;
  let beat = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const queue = [];

      const send = (type, payload) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        clearInterval(tick);
        clearInterval(beat);
        try { controller.close(); } catch {  }
      };

      request.signal.addEventListener('abort', shutdown);

      const backlog = replayEvents(runId, after);
      send('replay', { runId, events: backlog, snapshot: live ? undefined : loadRun(runId) });

      const snap = loadRun(runId);
      if (snap) { const { events: _e, ...rest } = snap; send('snapshot', rest); }

      if (!live) { send('closed', { reason: 'this run is not active in this process' }); shutdown(); return; }

      unsubscribe = subscribe(runId, (ev) => { queue.push(ev); });

      tick = setInterval(() => {
        if (closed) return;
        if (!queue.length) return;
        const batch = queue.splice(0, queue.length);
        if (batch.length <= MAX_SINGLES_PER_TICK) for (const ev of batch) send(ev.type, ev);
        else send('batch', { events: batch });
      }, TICK_MS);

      beat = setInterval(() => send('heartbeat', { t: Date.now() }), HEARTBEAT_MS);
    },
    cancel() {
      unsubscribe?.();
      clearInterval(tick);
      clearInterval(beat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',

      'X-Accel-Buffering': 'no',
    },
  });
}
