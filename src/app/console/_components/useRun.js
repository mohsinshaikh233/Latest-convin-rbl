'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { withBase } from '../../../lib/basepath.mjs';

const LOG_CAP = 4000;

const HEARTBEAT_MS = 15_000;
const STALE_MS = 26_000;

const EMPTY = {
  runId: null, month: null, mode: null, dryRun: false, inputDir: null, status: null, startedBy: null,
  startedAt: null, finishedAt: null,
  order: [], stages: {}, cohorts: [], books: [], metrics: {},
  decisions: [], pending: null, error: null, lock: null, notices: [],
};

export function useRun(runId) {
  const [run, setRun] = useState(EMPTY);
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const lastSeq = useRef(0);
  const fresh = useRef(true);

  const lastMessageAt = useRef(0);

  const apply = useCallback((ev) => {
    lastMessageAt.current = Date.now();
    lastSeq.current = Math.max(lastSeq.current, ev.seq ?? 0);

    if (ev.type === 'log') {
      setLogs((prev) => {
        const next = [...prev, { seq: ev.seq, stage: ev.stage, cohort: ev.cohort, line: ev.line, marker: ev.marker }];
        return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
      });
      return;
    }

    setRun((r) => {
      switch (ev.type) {
        case 'run:start':
          return { ...r, runId: ev.runId, month: ev.month, mode: ev.mode, dryRun: !!ev.dryRun, inputDir: ev.inputDir, order: ev.order, startedBy: ev.startedBy, startedAt: ev.startedAt, lock: ev.lock, status: 'running' };
        case 'stage:start':
          return { ...r, status: 'running', pending: null, stages: { ...r.stages, [ev.stage]: { ...r.stages[ev.stage], status: 'running', stalled: false, silentFor: null } } };
        case 'stage:done':
          return { ...r, stages: { ...r.stages, [ev.stage]: { ...r.stages[ev.stage], status: 'done', code: ev.code, ms: ev.ms, result: ev.result } } };
        case 'stage:stalled':

          return { ...r, stages: { ...r.stages, [ev.stage]: { ...r.stages[ev.stage], stalled: true, silentFor: ev.seconds } } };
        case 'stage:failed':
          return {
            ...r,
            status: 'failed',
            stages: { ...r.stages, [ev.stage]: { ...r.stages[ev.stage], status: 'failed', code: ev.code } },
            error: { stage: ev.stage, name: r.order.find((o) => o.stage === ev.stage)?.name, code: ev.code, signal: ev.signal, tail: ev.tail, command: ev.command, reason: ev.reason },
          };
        case 'cohort:list':
          return { ...r, cohorts: ev.cohorts };
        case 'cohort:start':
          return { ...r, cohorts: r.cohorts.map((c) => (c.key === ev.key ? { ...c, status: ev.stage === '03' ? 'exporting' : 'collecting' } : c)) };
        case 'cohort:done':
          return {
            ...r,
            cohorts: r.cohorts.map((c) => (c.key === ev.key
              ? {
                ...c,
                status: ev.stage === '04' ? 'done' : ev.dryRun ? 'would-export' : 'exported',
                cached: ev.cached ?? c.cached,
                rows: ev.result?.repair?.rows ?? c.rows,
                membershipPct: ev.result?.match?.membershipPct ?? c.membershipPct,
                source: ev.result?.source ?? c.source,

                sourceFile: ev.result?.source ? ev.result.source.split('/').pop() : c.sourceFile,
                wouldFire: ev.result?.wouldFire ?? c.wouldFire,
              }
              : c)),
          };
        case 'books':
          return { ...r, books: ev.books };
        case 'metrics':
          return { ...r, metrics: ev.metrics };
        case 'decision:required':
          return { ...r, status: 'awaiting-decision', pending: ev, stages: { ...r.stages, [ev.stage]: { ...r.stages[ev.stage], status: 'stopped' } } };
        case 'decision:submitted':
          return { ...r, decisions: [...r.decisions, ev] };
        case 'notice':
          return { ...r, notices: [...r.notices, { level: ev.level, text: ev.text, t: ev.t }] };
        case 'run:done':
          return { ...r, status: ev.status ?? 'done', pending: null, finishedAt: new Date(ev.t).toISOString() };
        case 'run:failed':
          return { ...r, status: 'failed', pending: null };
        case 'run:aborted':
          return { ...r, status: 'aborted', pending: null };
        case 'lock:released':
          return { ...r, lock: { ...r.lock, released: ev.released } };
        default:
          return r;
      }
    });
  }, []);

  const applySnapshot = useCallback((snap) => {
    if (!snap) return;
    setRun((r) => ({
      ...r,
      runId: snap.runId, month: snap.month, mode: snap.mode, dryRun: !!snap.dryRun, inputDir: snap.inputDir,
      status: snap.status, startedBy: snap.startedBy, startedAt: snap.startedAt, finishedAt: snap.finishedAt,
      order: snap.order ?? r.order,
      stages: snap.stages ?? r.stages,
      cohorts: snap.cohorts ?? r.cohorts,
      books: snap.books ?? r.books,
      metrics: snap.metrics ?? r.metrics,
      decisions: snap.decisions ?? r.decisions,
      pending: snap.pending ?? null,
      error: snap.error ?? null,
      lock: snap.lock ?? r.lock,
    }));
  }, []);

  useEffect(() => {
    fresh.current = true;
    if (!runId) { lastSeq.current = 0; return undefined; }

    lastSeq.current = 0;

    let es;
    let stopped = false;

    const open = () => {
      if (stopped) return;

      es = new EventSource(withBase(`/api/console/stream?runId=${encodeURIComponent(runId)}&after=${lastSeq.current}`));

      es.addEventListener('open', () => { lastMessageAt.current = Date.now(); setConnected(true); });
      es.addEventListener('error', () => setConnected(false));

      es.addEventListener('replay', (e) => {
        const { events } = JSON.parse(e.data);

        if (fresh.current) { setRun({ ...EMPTY, runId }); setLogs([]); fresh.current = false; }
        for (const ev of events) apply(ev);
        setConnected(true);
      });
      es.addEventListener('snapshot', (e) => applySnapshot(JSON.parse(e.data)));
      es.addEventListener('batch', (e) => { for (const ev of JSON.parse(e.data).events) apply(ev); });
      es.addEventListener('heartbeat', () => { lastMessageAt.current = Date.now(); setConnected(true); });
      es.addEventListener('closed', () => { es.close(); setConnected(false); });

      for (const type of ['run:start', 'stage:start', 'stage:done', 'stage:failed', 'log', 'cohort:list',
        'cohort:start', 'cohort:done', 'books', 'metrics', 'decision:required', 'decision:submitted',
        'decision:rejected', 'notice', 'run:done', 'run:failed', 'run:aborted', 'lock:released', 'stage:stalled']) {
        es.addEventListener(type, (e) => apply(JSON.parse(e.data)));
      }
    };

    open();

    const watch = setInterval(() => {
      if (lastMessageAt.current && Date.now() - lastMessageAt.current > STALE_MS) setConnected(false);
    }, HEARTBEAT_MS / 3);

    return () => { stopped = true; clearInterval(watch); es?.close(); setConnected(false); };
  }, [runId, apply, applySnapshot]);

  return { run, logs, connected };
}
