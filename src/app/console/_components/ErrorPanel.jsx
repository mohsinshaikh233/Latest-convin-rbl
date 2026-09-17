'use client';

import { useState } from 'react';
import { C, T, NUM } from '../../aurum';

export default function ErrorPanel({ error }) {
  const [copied, setCopied] = useState(false);
  if (!error) return null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(error.command); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div
      role="alert"
      className="cx-panel"
      style={{
        border: `2px solid ${C.abort}`,
        background: `linear-gradient(150deg, ${C.bad(0.07)}, rgba(var(--ink-rgb), .014))`,
        padding: 26,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {}
        <span className="cx-badge" style={{ marginTop: 0, color: C.abort, background: C.bad(0.12), border: `1px solid ${C.bad(0.3)}` }}>failed</span>
        <span style={{ ...T.micro, ...NUM, color: C.tertiary }}>
          stage {error.stage ?? '—'} · {error.name ?? 'runner'}
          {error.cohort ? ` · ${error.cohort}` : ''}
        </span>
        <span style={{ ...T.micro, ...NUM, color: C.abort, fontWeight: 600 }}>
          exit {error.code ?? '?'}{error.signal ? ` · killed by ${error.signal}` : ''}
        </span>
      </div>

      <h3 className="cx-h2" style={{ fontSize: 20, margin: '14px 0 0' }}>{error.reason}</h3>

      {error.tail?.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="cx-mk" style={{ marginTop: 0 }}>The last {error.tail.length} line{error.tail.length === 1 ? '' : 's'} it printed</div>
          <div
            className="cx-panel"
            style={{
              marginTop: 8, padding: '12px 14px',
              background: C.canvas, border: `1px solid ${C.hairline}`,
              maxHeight: 220, overflow: 'auto',
            }}
          >
            {error.tail.map((l, i) => (
              <div key={i} style={{ ...T.mono, fontSize: 12, lineHeight: '17px', color: C.secondary, whiteSpace: 'pre' }}>{l}</div>
            ))}
          </div>
        </div>
      )}

      {error.command && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <div className="cx-mk" style={{ marginTop: 0 }}>Run this in a terminal to reproduce it</div>
            <button type="button" className="cx-btn cx-ghost cx-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <div
            className="cx-panel"
            style={{
              ...T.mono, fontSize: 12, color: C.secondary,
              marginTop: 8, padding: '12px 14px',
              background: C.canvas, border: `1px solid ${C.hairline}`,
              wordBreak: 'break-all',
            }}
          >
            {error.command}
          </div>
        </div>
      )}
    </div>
  );
}
