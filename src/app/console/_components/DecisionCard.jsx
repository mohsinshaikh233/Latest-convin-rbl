'use client';

import { useState } from 'react';
import { C, T, NUM } from '../../aurum';

const GAP_RULINGS = [
  { id: 'build-partial', label: 'Build it short', why: 'Build the days that exist, knowing the report is short.' },
  { id: 'wait-for-file', label: 'Wait for the file', why: 'The file is coming. This deliberately keeps blocking.' },
  { id: 'exclude-book', label: 'Drop the book', why: 'This book is not in this month\'s reporting at all.' },
];
const DRIFT_RULINGS = [
  { id: 'accept-drift', label: 'Accept the drift', why: 'The calling window really did change. Build it, and keep the finding on the record with your reason.' },
  { id: 'exclude-book', label: 'Drop the book', why: 'This book is not in this month\'s reporting at all.' },
];
const ALL_RULINGS = [...GAP_RULINGS, ...DRIFT_RULINGS];

const rulingsFor = (item) => {
  const ids = item?.rulings ?? (item?.lastExpected ? DRIFT_RULINGS.map((r) => r.id) : GAP_RULINGS.map((r) => r.id));
  return ids.map((id) => ALL_RULINGS.find((r) => r.id === id)).filter(Boolean);
};

export default function DecisionCard({ pending, onSubmit, onAbort, busy, error, rejected }) {
  const items = pending?.items ?? [];
  const [answers, setAnswers] = useState(() => Object.fromEntries(items.map((i) => [
    i.book,
    pending.kind === 'rulings' ? { ruling: '' } : { campaign: i.inference || '', days: i.needs === 'days' ? '' : undefined },
  ])));
  const [reason, setReason] = useState('');

  const set = (book, patch) => setAnswers((a) => ({ ...a, [book]: { ...a[book], ...patch } }));

  const complete = pending.kind === 'acknowledge'
    ? true
    : items.every((i) => (pending.kind === 'rulings'
      ? !!answers[i.book]?.ruling
      : !!answers[i.book]?.campaign && (i.needs !== 'days' || String(answers[i.book]?.days ?? '') !== '')));
  const canSubmit = complete && reason.trim().length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    const entries = pending.kind === 'acknowledge' ? [] : items.map((i) => (pending.kind === 'rulings'
      ? { book: i.book, ruling: answers[i.book].ruling, reason: reason.trim() }
      : { book: i.book, campaign: answers[i.book].campaign, ...(answers[i.book].days ? { days: Number(answers[i.book].days) } : {}) }));
    onSubmit?.({ entries, reason: reason.trim() });
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={pending.title}

      className="cx-panel cx-raised"
      style={{
        border: `2px solid ${C.caution}`,
        background: `linear-gradient(150deg, ${C.warn(0.07)}, rgba(var(--ink-rgb), .014))`,
        padding: 26,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        {}
        <span className="cx-badge cx-wait" style={{ marginTop: 0 }}>
          <span className="cx-pulse" aria-hidden />stopped · a person must decide
        </span>
        <span style={{ ...T.micro, ...NUM, color: C.tertiary }}>stage {pending.stage} · {pending.name}{pending.cohort ? ` · ${pending.cohort}` : ''}</span>
      </div>

      <h3 className="cx-h2" style={{ fontSize: 22, margin: '14px 0 8px' }}>{pending.title}</h3>
      {pending.why && <p className="cx-lede" style={{ fontSize: 13.5 }}>{pending.why}</p>}

      {pending.reason && (
        <div style={{ ...T.footnote, color: C.secondary, marginTop: 14, padding: 12, background: C.quiet, borderRadius: 'var(--radius-sm)' }}>
          {pending.reason}
        </div>
      )}

      <div style={{ height: 1, background: C.hairline, margin: '20px 0' }} />

      {}
      {pending.kind === 'assignments' && items.map((i) => (
        <div key={i.book} style={{ marginBottom: 20 }}>
          <div style={{ ...T.headline, color: C.primary }}>{i.book}</div>
          <div style={{ ...T.caption, color: C.tertiary, marginTop: 4 }}>
            {i.reason}
            {i.loadDate && <> · load date <span style={NUM}>{i.loadDate}</span></>}
          </div>

          {i.needs === 'campaign' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {['prex', 'bucket'].map((c) => (
                <button
                  key={c}
                  type="button"
                  className="cx-btn cx-ghost cx-sm"
                  style={answers[i.book]?.campaign === c
                    ? { borderColor: 'var(--content-primary)', color: 'var(--content-primary)', background: 'var(--fill-quiet)' }
                    : undefined}
                  onClick={() => set(i.book, { campaign: c })}
                  aria-pressed={answers[i.book]?.campaign === c}
                >
                  {c === 'prex' ? 'PreX' : 'Bucket'}
                  {i.inference === c && <span style={{ ...T.micro, color: C.tertiary, marginLeft: 6 }}>inferred</span>}
                </button>
              ))}
            </div>
          )}

          {i.needs === 'days' && (
            <div style={{ marginTop: 12 }}>
              <div className="cx-mk" style={{ marginTop: 0 }}>How many days did this book run?</div>
              <input
                type="number"
                min="1"
                max="31"
                value={answers[i.book]?.days ?? ''}
                onChange={(e) => set(i.book, { days: e.target.value })}
                aria-label={`Day count for ${i.book}`}
                style={{
                  width: 120, height: 44, padding: '0 20px', marginTop: 8,
                  ...T.callout, ...NUM,
                  borderRadius: 'var(--radius-capsule)',
                  border: `1px solid ${C.rim}`, background: C.quiet, color: C.primary, outline: 'none',
                }}
              />
            </div>
          )}
        </div>
      ))}

      {pending.kind === 'rulings' && items.map((i) => (
        <div key={i.book} style={{ marginBottom: 20 }}>
          <div style={{ ...T.headline, color: C.primary }}>{i.book}</div>
          <div style={{ ...T.caption, color: C.tertiary, marginTop: 4 }}>
            {i.reason}
            {i.dates?.length ? <> · missing <span style={NUM}>{i.dates.join(', ')}</span></> : null}
            {i.actualLastCall && <> · last actual call <span style={NUM}>{String(i.actualLastCall).slice(0, 10)}</span>, expected through <span style={NUM}>{i.lastExpected}</span></>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {rulingsFor(i).map((r) => (
              <button
                key={r.id}
                type="button"
                className="cx-btn cx-ghost cx-sm"
                style={answers[i.book]?.ruling === r.id
                  ? { borderColor: 'var(--content-primary)', color: 'var(--content-primary)', background: 'var(--fill-quiet)' }
                  : undefined}
                onClick={() => set(i.book, { ruling: r.id })}
                title={r.why}
                aria-pressed={answers[i.book]?.ruling === r.id}
              >
                {r.label}
              </button>
            ))}
          </div>
          {answers[i.book]?.ruling && (
            <div style={{ ...T.caption, color: C.tertiary, marginTop: 8 }}>
              {ALL_RULINGS.find((r) => r.id === answers[i.book].ruling)?.why}
            </div>
          )}
        </div>
      ))}

      {pending.kind === 'acknowledge' && (
        <div style={{ ...T.footnote, color: C.secondary, marginBottom: 20 }}>
          This stop has no form — the pipeline is telling you something only a person can act on.
          Say what you checked, and the stage will be run again exactly as it was.
        </div>
      )}

      {}
      <div style={{ marginTop: 4 }}>
        <div className="cx-mk" style={{ marginTop: 0 }}>Why — required</div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Checked the Bucket status series; RBL never produced 26 July. Building short."
          aria-label="Reason for this decision"
          style={{
            width: '100%', marginTop: 8, padding: '12px 16px',
            ...T.callout,
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${reason.trim() ? C.rim : C.warn(0.5)}`,
            background: C.quiet, color: C.primary, outline: 'none', resize: 'vertical',
            fontFamily: 'var(--font-text)',
          }}
        />
        <div style={{ ...T.caption, color: C.tertiary, marginTop: 6 }}>
          Recorded with your name and the time, in the run history and in the pipeline&rsquo;s own state.
        </div>
      </div>

      {(error || rejected?.length > 0) && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 'var(--radius-sm)', background: C.bad(0.1), border: `1px solid ${C.bad(0.35)}` }}>
          <div style={{ ...T.footnote, color: C.abort, fontWeight: 600 }}>The pipeline refused this answer — nothing was written.</div>
          {error && <div style={{ ...T.footnote, color: C.secondary, marginTop: 6 }}>{error}</div>}
          {rejected?.map((r, i) => (
            <div key={i} style={{ ...T.caption, color: C.secondary, marginTop: 6 }}>
              {r.book ?? JSON.stringify(r.entry)} — {r.why}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
        {}
        <button type="button" className="cx-btn" onClick={submit} disabled={!canSubmit}>
          {busy ? 'Applying…' : pending.kind === 'acknowledge' ? 'Record this and run the stage again' : 'Apply and carry on'}
        </button>
        <button type="button" className="cx-btn cx-ghost" onClick={onAbort}>Stop the run</button>
        {!reason.trim() && <span style={{ ...T.caption, color: C.caution }}>A reason is required.</span>}
        {reason.trim() && !complete && <span style={{ ...T.caption, color: C.caution }}>Answer every book above.</span>}
      </div>

      {pending.command && (
        <div style={{ marginTop: 18 }}>
          <div className="cx-mk" style={{ marginTop: 0 }}>The command that stopped</div>
          <div style={{ ...T.mono, fontSize: 12, color: C.tertiary, marginTop: 6, wordBreak: 'break-all' }}>{pending.command}</div>
        </div>
      )}
    </div>
  );
}
