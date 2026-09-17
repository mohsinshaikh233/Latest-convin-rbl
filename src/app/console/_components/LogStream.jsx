'use client';

import { useEffect, useRef, useState } from 'react';

const NEAR_BOTTOM_PX = 40;

function toneOf(line) {
  if (/^\s*✔|ALL PASS|complete\b/.test(line)) return 'cx-n';
  if (/^\s*⚠|WARNING|warning:/i.test(line)) return 'cx-w';
  if (/^\s*✘|✖|error|failed|FAIL/i.test(line)) return 'cx-w';
  if (/^\s*(CACHED|DRY RUN)/.test(line)) return 'cx-g';
  if (/^\s*[─═-]{6,}\s*$/.test(line)) return 'cx-dim';
  return '';
}

export default function LogStream({ lines = [], stage, height = 300 }) {
  const box = useRef(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (!follow || !box.current) return;
    box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
  };

  return (
    <div className="cx-panel cx-console" style={{ height }}>
      <div className="cx-ctop">
        <span className="cx-dot" aria-hidden />
        <span className="cx-dot" aria-hidden />
        <span className="cx-dot" aria-hidden />
        <p>{stage ? `stage ${stage} · stderr` : 'stderr'}</p>
        <span className="cx-live">
          {!follow && (
            <button
              type="button"
              className="cx-btn cx-ghost cx-sm"
              style={{ padding: '3px 10px', fontSize: 10 }}
              onClick={() => { setFollow(true); if (box.current) box.current.scrollTop = box.current.scrollHeight; }}
            >
              jump to newest
            </button>
          )}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{lines.length.toLocaleString('en-IN')} lines</span>
        </span>
      </div>

      {}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {stage ? `Stage ${stage} running, ${lines.length} log lines.` : `${lines.length} log lines.`}
      </div>

      <div ref={box} onScroll={onScroll} tabIndex={0} role="log" aria-label="Pipeline output" className="cx-log">
        {!lines.length && (
          <div className="cx-ln"><span className="cx-m" style={{ color: 'var(--content-quaternary)' }}>Nothing yet — the pipeline writes here as it works.</span></div>
        )}
        {lines.map((l) => (
          <div key={l.seq} className={`cx-ln ${l.marker ? 'cx-w' : toneOf(l.line)}`.trim()}>
            <span className="cx-t">{l.stage ?? '··'}</span>
            <span className="cx-m">{l.line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
