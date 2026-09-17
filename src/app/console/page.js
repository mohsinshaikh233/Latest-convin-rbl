'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { withBase } from '../../lib/basepath.mjs';
import { fmtInt } from '../aurum';
import './console.css';
import Graph from './_components/Graph';
import LogStream from './_components/LogStream';
import FolderPicker from './_components/FolderPicker';
import DecisionCard from './_components/DecisionCard';
import ErrorPanel from './_components/ErrorPanel';
import Connections from './_components/Connections';
import { useRun } from './_components/useRun';

const MODES = {
  replay: {
    label: 'REPLAY',
    line: 'Every stage real except the Convin call.',
    touches: 'Reaches nothing outside this machine before stage 05. Sources come from the folder you pick; stage 03 is served from a call log already on disk. Stages 04–08 do their actual work and the PDFs at the end are real.',
  },
  live: {
    label: 'LIVE',
    line: 'The whole month, for real.',
    touches: 'Reaches S3 for the books and status files, Convin’s export queue, the IMAP mailbox, Postgres and Chrome.',
  },
};

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four'];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

function Section({ eyebrow, title, lede, children, id }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('cx-in')),
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section className="cx-section" id={id}>
      <div className="cx-rise" ref={ref}>
        <div className="cx-eyebrow">{eyebrow}</div>
        <h2 className="cx-h2">{title}</h2>
        {lede && <p className="cx-lede">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

export default function ConsolePage() {
  const [authed, setAuthed] = useState(null);
  const [month, setMonth] = useState(thisMonth);
  const [mode, setMode] = useState('replay');
  const [folder, setFolder] = useState(null);
  const [folderCounts, setFolderCounts] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [runId, setRunId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const [decideBusy, setDecideBusy] = useState(false);
  const [decideError, setDecideError] = useState(null);
  const [rejected, setRejected] = useState([]);
  const [expand, setExpand] = useState(undefined);
  const [artifacts, setArtifacts] = useState(null);
  const [history, setHistory] = useState([]);
  const [elapsed, setElapsed] = useState(0);

  const reduced = useReducedMotion();
  const { run, logs, connected } = useRun(runId);

  useEffect(() => {
    (async () => {
      try { setAuthed((await fetch(withBase('/api/me'))).ok); } catch { setAuthed(false); }
    })();
  }, []);

  const loadPreflight = useCallback(async () => {
    try {
      const r = await fetch(withBase(`/api/console/preflight?month=${encodeURIComponent(month)}&mode=${mode}`));
      if (r.status === 401) { setAuthed(false); return; }
      setPreflight(await r.json());
    } catch { setPreflight(null); }
  }, [month, mode]);

  useEffect(() => { (async () => { if (authed) await loadPreflight(); })(); }, [authed, loadPreflight]);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(withBase('/api/console/run'));
      if (!r.ok) return;
      const { runs } = await r.json();
      setHistory(runs);

      const alive = runs.find((x) => ['running', 'awaiting-decision'].includes(x.status));
      const show = alive ?? runs[0];
      if (show) setRunId((cur) => cur ?? show.runId);
    } catch {  }
  }, []);

  useEffect(() => { (async () => { if (authed) await loadHistory(); })(); }, [authed, loadHistory]);

  const live = ['running', 'awaiting-decision'].includes(run.status);

  useEffect(() => {
    if (!run.month || live) return;
    (async () => {
      try {
        const r = await fetch(withBase(`/api/console/artifacts?month=${encodeURIComponent(run.month)}`));
        if (r.ok) setArtifacts(await r.json());
      } catch {  }
    })();
  }, [run.month, run.status, live]);

  useEffect(() => { (async () => { if (run.status && !live) await loadHistory(); })(); }, [run.status, live, loadHistory]);

  useEffect(() => {
    if (!run.startedAt || run.finishedAt) return undefined;
    const started = new Date(run.startedAt).getTime();
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(t);
  }, [run.startedAt, run.finishedAt]);

  const elapsedShown = run.startedAt && run.finishedAt
    ? (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
    : elapsed;

  const start = async () => {
    setStarting(true); setStartError(null); setArtifacts(null); setExpand(undefined);
    try {
      const r = await fetch(withBase('/api/console/run'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, mode, inputDir: folder }),
      });
      const j = await r.json();
      if (!r.ok) { setStartError(j); return; }
      setRunId(j.runId);
    } catch (e) {
      setStartError({ error: `Could not reach the server: ${e.message}` });
    } finally { setStarting(false); }
  };

  const decide = async ({ entries, reason }) => {
    setDecideBusy(true); setDecideError(null); setRejected([]);
    try {
      const r = await fetch(withBase('/api/console/decide'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, entries, reason }),
      });
      const j = await r.json();
      if (!r.ok) { setDecideError(j.error || 'The pipeline refused this answer.'); setRejected(j.rejected ?? []); }
    } catch (e) {
      setDecideError(`Could not reach the server: ${e.message}`);
    } finally { setDecideBusy(false); }
  };

  const abort = async () => {
    try {
      await fetch(withBase('/api/console/run'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'abort', runId }),
      });
    } catch {  }
  };

  const modeInfo = preflight?.modes?.[mode];
  const canStart = !!month && !starting && !live && (mode !== 'replay' || !!folder) && (mode !== 'live' || modeInfo?.available !== false);
  const willDryRun = mode === 'live' && preflight?.liveDryRunDone === false;

  const autoExpand = run.stages['06']?.status === 'running' && run.books.length ? '06'
    : run.stages['03']?.status === 'running' && run.cohorts.length ? '03'
      : run.books.length ? '06'
        : run.cohorts.length ? '03' : null;
  const shownExpand = expand === undefined ? autoExpand : expand;

  const sourceFiles = useMemo(
    () => [...new Set(run.cohorts.filter((c) => c.cached && c.sourceFile).map((c) => c.sourceFile))],
    [run.cohorts],
  );
  const activeStage = useMemo(
    () => run.order.find((o) => run.stages[o.stage]?.status === 'running')?.stage ?? null,
    [run.order, run.stages],
  );
  const liveCount = useMemo(() => {
    if (!preflight) return null;
    const g = (n) => preflight.groups?.find((x) => x.group === n)?.ok;
    return [g('s3'), g('db'), g('imap'), preflight.convinAuth?.ok].filter(Boolean).length;
  }, [preflight]);
  const verified = run.stages['07']?.status === 'done' && run.metrics.verified === true;
  const v7 = run.stages['07']?.result ?? {};

  if (authed === false) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="cx-void" aria-hidden />
        <div className="cx-panel" style={{ maxWidth: 460, padding: 32, textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <h2 className="cx-h2" style={{ fontSize: 26 }}>Sign in first</h2>
          <p className="cx-lede" style={{ margin: '0 auto 22px' }}>
            The console runs a real pipeline over a bank&rsquo;s data. It sits behind the same sign-in as the dashboard.
          </p>
          <Link href="/" className="cx-btn" style={{ textDecoration: 'none', display: 'inline-block' }}>Go to sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="cx-void" aria-hidden />
      <div className="cx-wrap">

        {}
        <header className="cx-header">
          <div className="cx-brand">
            <div className="cx-mark" aria-hidden />
            <div>
              <h1>Month Console</h1>
              <p>Convin × RBL Bank</p>
            </div>
          </div>
          <div className="cx-hstat">
            <div className="cx-hs">
              <b>{run.metrics.books != null ? `${run.metrics.built ?? 0} / ${fmtInt(run.metrics.books)}` : '—'}</b>
              <i>books</i>
            </div>
            <div className="cx-hs">
              <b>{run.metrics.attempts != null ? fmtInt(run.metrics.attempts) : '—'}</b>
              <i>call records</i>
            </div>
            <div className="cx-hs">
              <b>{run.startedAt ? `${elapsedShown.toFixed(1)}s` : '—'}</b>
              <i>elapsed</i>
            </div>
            {runId && (
              <div className="cx-hs">
                <b style={{ color: connected ? 'var(--sig-nominal)' : 'var(--sig-caution)' }}>{connected ? '●' : '○'}</b>
                <i>{connected ? 'live' : 'retry'}</i>
              </div>
            )}
          </div>
        </header>

        {}
        <Section
          eyebrow="Step one · Source"
          title="Point it at a folder."
          lede="The month begins as files on a disk — RBL’s calling books and their daily status sheets. Nothing is typed in. The console reads what is there and the pipeline works out the rest."
        >
          <div className="cx-picker" style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 22, marginTop: 30 }}>
            <FolderPicker
              selected={folder}
              onSelect={(p, counts) => { setFolder(p); setFolderCounts(counts); }}
              disabled={live}
            />
            <div className="cx-panel cx-detect">
              <h4>Detected on open</h4>
              {folderCounts ? (
                <>
                  <div className={`cx-dline${folderCounts.xlsx ? '' : ' cx-none'}`}>
                    <b>{fmtInt(folderCounts.xlsx || 0)}</b>
                    <span>Excel files — the calling books and their status sheets</span>
                  </div>
                  <div className={`cx-dline${folderCounts.csv ? '' : ' cx-none'}`}>
                    <b>{fmtInt(folderCounts.csv || 0)}</b>
                    <span>call logs — one per cohort, read by stage 03</span>
                  </div>
                  <div className={`cx-dline${folderCounts.dirs ? '' : ' cx-none'}`}>
                    <b>{fmtInt(folderCounts.dirs || 0)}</b>
                    <span>sub-folders, walked two levels deep</span>
                  </div>
                  <div style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.6, color: 'var(--content-quaternary)' }}>
                    Counted from disk the moment you chose the folder. Stage 01 takes the Excel files as
                    books and status sheets; a CSV is a call log and is stage 03&rsquo;s business.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--content-tertiary)' }}>
                  Choose a folder on the left. Its real contents appear here, counted from disk, before
                  anything runs.
                </div>
              )}
            </div>
          </div>
        </Section>

        {}
        <Section
          eyebrow="Step two · Access"
          title={liveCount == null
            ? 'Four connections.'
            : `Four connections. ${WORDS[liveCount]} ${liveCount === 1 ? 'is' : 'are'} live.`}
          lede="Every external system the month touches, and its state right now. The pipeline refuses to start until each one it needs answers — a missing key stops the run rather than producing a report with a hole in it."
        >
          <Connections preflight={preflight} mode={mode} />
          {}
          <div style={{ marginTop: 16 }}>
            <Link href="/console/credentials" className="cx-btn cx-ghost cx-sm" style={{ textDecoration: 'none' }}>
              Set or test credentials →
            </Link>
            <span className="cx-rmeta" style={{ marginLeft: 12 }}>
              real round trips · exact remedies · values never leave the server
            </span>
          </div>
        </Section>

        {}
        <Section
          eyebrow="Step three · Run"
          title="Nine stages, from real output."
          lede="Each stage is its own node process. The graph moves when one of them exits, and at no other time — there is no timer anywhere in the progress path."
        >
          <div className="cx-runbar">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="cx-rmeta">month</span>
              <input
                type="month" value={month} disabled={live}
                onChange={(e) => setMonth(e.target.value)}
                aria-label="Month to run"
                style={{
                  height: 40, padding: '0 14px', borderRadius: 10,
                  border: '1px solid var(--stroke-rim)', background: 'var(--fill-quiet)',
                  color: 'var(--content-primary)', fontFamily: 'var(--font-mono)', fontSize: 12.5, outline: 'none',
                }}
              />
            </label>

            {Object.entries(MODES).map(([id, m]) => (
              <button
                key={id} type="button" disabled={live}
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                className="cx-btn cx-ghost cx-sm"

                style={mode === id
                  ? { borderColor: 'var(--content-primary)', color: 'var(--content-primary)', background: 'var(--fill-quiet)' }
                  : undefined}
              >
                {m.label}
              </button>
            ))}

            {}
            <button type="button" className="cx-btn" onClick={start} disabled={!canStart}>
              {starting ? 'Starting…' : live ? 'Running' : willDryRun ? 'Dry run — fire nothing' : `Run ${month}`}
            </button>

            {live && <button type="button" className="cx-btn cx-danger cx-sm" onClick={abort}>Stop</button>}

            {}
            <span className="cx-rmeta" data-run-status={run.status ?? 'idle'} data-run-id={run.runId ?? ''}>
              {run.runId
                ? `${run.month} · ${MODES[run.mode]?.label ?? run.mode}${run.dryRun ? ' · dry run' : ''} · ${run.status}`
                : MODES[mode].line}
            </span>
          </div>

          <p className="cx-lede" style={{ fontSize: 12.5, marginTop: 12, maxWidth: '76ch', color: 'var(--content-tertiary)' }}>
            {MODES[mode].touches}
          </p>

          {mode === 'replay' && !folder && (
            <div className="cx-note" style={{ marginTop: 18 }}>
              <b>Pick a folder first.</b> REPLAY reads this month&rsquo;s sources from disk, so it needs to know where.
            </div>
          )}
          {willDryRun && (
            <div className="cx-note" style={{ marginTop: 18 }}>
              <b>The first LIVE run of a month always reports instead of firing.</b> Stages 00&ndash;02 run
              for real against S3 and the plan; stage 03 says what it would export and reaches no network.
              Firing an export takes Convin&rsquo;s global per-tenant lock for 4&ndash;6 minutes, and a hung
              one has held it for over 100.
            </div>
          )}
          {modeInfo?.missing?.length > 0 && (
            <div className="cx-note" style={{ marginTop: 18 }}>
              <b>{MODES[mode].label} cannot run.</b> Not set:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{modeInfo.missing.join('  ')}</span>
            </div>
          )}
          {startError && (
            <div className="cx-note" style={{ marginTop: 18 }}>
              <b>{startError.locked ? 'That month is locked.' : 'Could not start.'}</b> {startError.error}
              {startError.holder && (
                <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  held by run {startError.holder.runId ?? '?'}
                  {startError.holder.since ? ` since ${new Date(startError.holder.since).toLocaleString('en-GB')}` : ''}
                  {startError.holder.host ? ` on ${startError.holder.host}` : ''}
                </div>
              )}
            </div>
          )}

          {run.order.length > 0 && (
            <div className="cx-panel" style={{ marginTop: 26, padding: '18px 12px 6px' }}>
              <Graph
                order={run.order} stages={run.stages}
                cohorts={run.cohorts} books={run.books}
                expand={shownExpand} onExpand={setExpand} reduced={reduced}
              />
              {run.cohorts.some((c) => c.cached) && (
                <div style={{ textAlign: 'center', padding: '2px 0 14px' }}>
                  {}
                  <span
                    style={{
                      display: 'inline-block', padding: '5px 12px', borderRadius: 'var(--radius-capsule)',
                      border: '2px solid var(--stroke-rim)', background: 'var(--fill-quiet)',
                      fontSize: 11.5, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase',
                      color: 'var(--content-primary)',
                    }}
                  >
                    Stage 03 served from disk — Convin not called
                    {sourceFiles.length === 1 ? ` · ${sourceFiles[0]}` : sourceFiles.length ? ` · ${sourceFiles.length} files` : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <LogStream lines={logs} stage={activeStage} height={300} />
          </div>

          {run.cohorts.length > 0 && (
            <div className="cx-cmap">
              {run.cohorts.map((c) => (
                <div key={c.key} className="cx-coh">
                  <b>{c.key}</b>
                  <span>{c.startDate} → {c.endDate}</span>
                  <em>{c.cached ? `disk · ${c.membershipPct ?? '—'}% match` : c.status === 'idle' ? 'waiting' : c.status}</em>
                  {c.sourceFile && (
                    <em style={{ textTransform: 'none', letterSpacing: 0, marginTop: 3, wordBreak: 'break-all' }}>{c.sourceFile}</em>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {}
        {(run.pending || run.decisions.length > 0) && (
          <Section
            eyebrow="Step four · The decision"
            title={run.pending ? 'It stopped to ask.' : 'It stopped to ask, and a person answered.'}
            lede="Exit code 10 is the pipeline working correctly. Rather than guess at a missing status file or an unconfirmed campaign, it halts and puts the question to a person — recording who answered, when, and why."
          >
            {run.pending && (
              <div style={{ marginTop: 24 }}>
                <DecisionCard
                  key={`${run.pending.stage}-${run.pending.items?.length}-${run.pending.reason ?? ''}`}
                  pending={run.pending}
                  onSubmit={decide} onAbort={abort}
                  busy={decideBusy} error={decideError} rejected={rejected}
                />
              </div>
            )}
            {run.decisions.map((d, i) => (
              <div key={i} className="cx-panel" style={{ marginTop: 14, padding: '18px 20px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="cx-rmeta">stage {d.stage}</span>
                  <b style={{ fontSize: 13.5, color: 'var(--content-primary)' }}>
                    {d.entries?.length
                      ? d.entries.map((e) => `${e.book} → ${e.campaign ?? e.ruling}${e.days ? ` (${e.days} days)` : ''}`).join(' · ')
                      : 'acknowledged and re-run'}
                  </b>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: 'var(--content-secondary)' }}>&ldquo;{d.reason}&rdquo;</div>
                <div className="cx-rmeta" style={{ marginTop: 6 }}>{d.by} · {new Date(d.at).toLocaleString('en-GB')}</div>
              </div>
            ))}
          </Section>
        )}

        {}
        {(run.metrics.accounts != null || run.metrics.books != null || run.error) && (
          <Section
            eyebrow="Step five · Proof"
            title={run.error ? 'It refused to finish.'
              : verified ? 'It marks its own homework, then checks the marking.'
                : 'What the month produced.'}
            lede={run.error
              ? 'A stage exited non-zero and the run stopped there. Every failure carries the stage, the real exit code, the last lines it printed, and the exact command to reproduce it in a terminal.'
              : 'Stage 07 recomputes the printed figures from the source files and compares. A book claiming more call attempts than its cohort log contains does not pass — which is how a defect that inflated every total by 3× was caught.'}
          >
            {run.error && <div style={{ marginTop: 24 }}><ErrorPanel error={run.error} /></div>}

            {!run.error && (
              <>
                <div className="cx-metrics">
                  <div className="cx-panel cx-met">
                    <div className="cx-mv">{run.metrics.books != null ? fmtInt(run.metrics.books) : '—'}</div>
                    <div className="cx-mk">books</div>
                    <div className="cx-ms">{run.metrics.built != null ? `${run.metrics.built} built` : 'from the plan'}</div>
                  </div>
                  <div className="cx-panel cx-met">
                    <div className="cx-mv">{run.metrics.accounts != null ? fmtInt(run.metrics.accounts) : '—'}</div>
                    <div className="cx-mk">accounts</div>
                    <div className="cx-ms">joined, per book</div>
                  </div>
                  {}
                  <div className="cx-panel cx-met cx-hero">
                    <div className="cx-mv">{run.metrics.attempts != null ? fmtInt(run.metrics.attempts) : '—'}</div>
                    <div className="cx-mk">call attempts</div>
                    <div className="cx-ms">per book, from joined rows</div>
                  </div>
                  <div className="cx-panel cx-met">
                    <div className="cx-mv">{run.metrics.cohorts != null ? fmtInt(run.metrics.cohorts) : '—'}</div>
                    <div className="cx-mk">cohorts</div>
                    <div className="cx-ms">one export each, never in parallel</div>
                  </div>
                </div>

                {run.stages['07']?.status === 'done' && (
                  <div className="cx-vgrid">
                    <div className={`cx-panel cx-vc${verified ? '' : ' cx-bad'}`}>
                      <b>{verified ? 'ALL PASS' : 'FINDINGS'}</b>
                      <span>{fmtInt(run.metrics.booksChecked ?? 0)} book(s) checked, independently of the builder</span>
                    </div>
                    <div className="cx-panel cx-vc"><b>{fmtInt((v7.overCounts ?? []).length)}</b><span>cohorts over-claiming attempts</span></div>
                    <div className="cx-panel cx-vc"><b>{fmtInt((v7.accountMismatches ?? []).length)}</b><span>account counts disagreeing with the book file</span></div>
                    <div className="cx-panel cx-vc"><b>{fmtInt((v7.pdfFailures ?? []).length)}</b><span>invalid PDFs</span></div>
                  </div>
                )}

                {run.books.length > 0 && (
                  <div className="cx-books">
                    {run.books.map((b) => (
                      <div key={b.book} className={`cx-bk${b.status === 'built' ? ' cx-built' : ''}`}>
                        <div className="cx-bn">{b.book}</div>
                        <div className="cx-bd">
                          {b.accounts != null
                            ? `${fmtInt(b.accounts)} acc · ${fmtInt(b.attempts ?? 0)} calls`
                            : `${b.days ?? '—'} day(s) assembled`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Section>
        )}

        {}
        {artifacts && (
          <Section eyebrow="Delivered" title="What lands at the end of the month." lede="Real files on disk. Open one.">
            {artifacts.count ? (
              <>
                <div className="cx-outs">
                  {artifacts.pdfs.map((p) => (
                    <a
                      key={p.path}
                      className="cx-panel cx-out"
                      href={withBase(`/api/console/artifacts?month=${encodeURIComponent(run.month)}&file=${encodeURIComponent(p.path)}`)}
                      target="_blank" rel="noreferrer"
                    >
                      <span className="cx-oico" data-kind="PDF" aria-hidden />
                      <span style={{ minWidth: 0 }}>
                        <b>{p.name}</b>
                        <span>{(p.bytes / 1048576).toFixed(2)} MB</span>
                      </span>
                    </a>
                  ))}
                </div>
                <div className="cx-rmeta" style={{ marginTop: 16, wordBreak: 'break-all' }}>{artifacts.reportsDir}</div>
              </>
            ) : (
              <div className="cx-note" style={{ marginTop: 24 }}>
                <b>Nothing here yet.</b> Stage 06 writes the PDFs; if the run did not reach that far, the
                failure above says why.
              </div>
            )}
          </Section>
        )}

        {}
        {history.length > 0 && (
          <Section eyebrow="History" title="Every run this machine has made.">
            <div className="cx-panel" style={{ marginTop: 22, overflow: 'hidden' }}>
              {history.slice(0, 8).map((h) => (
                <button key={h.runId} type="button" className="cx-frow" onClick={() => setRunId(h.runId)}>
                  <span
                    className="cx-pulse"
                    style={{
                      animation: 'none',
                      color: h.status === 'done' ? 'var(--sig-nominal)'
                        : h.status === 'failed' ? 'var(--sig-abort)'
                          : h.status === 'awaiting-decision' ? 'var(--sig-caution)' : 'var(--content-quaternary)',
                    }}
                    aria-hidden
                  />
                  <span className="cx-fn" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{h.month}</span>
                  <span className="cx-rmeta">{String(h.mode ?? '').toUpperCase()}{h.dryRun ? ' · DRY' : ''}</span>
                  <span className="cx-rmeta">{String(h.status).toUpperCase()}</span>
                  <span className="cx-fmeta">{new Date(h.startedAt).toLocaleString('en-GB')}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        <footer className="cx-footer">
          <span>Every figure on this page came out of a process. Nothing is simulated.</span>
          <Link href="/" style={{ color: 'var(--content-tertiary)' }}>Dashboard</Link>
        </footer>
      </div>
    </>
  );
}
