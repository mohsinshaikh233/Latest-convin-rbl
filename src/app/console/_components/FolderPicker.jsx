'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { withBase } from '../../../lib/basepath.mjs';
import { fmtInt } from '../../aurum';

function prettyPath(full, root) {
  if (!full) return 'reading…';
  let p = full;
  const home = root && full.startsWith(root) ? root : null;
  if (home && full === home) return '~';
  if (home) p = `…/${full.slice(home.length + 1)}`;
  if (p.length <= 46) return p;
  const parts = p.split('/').filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p.slice(-46);
}

function Counts({ counts }) {
  if (!counts) return null;
  const { xlsx = 0, csv = 0, dirs = 0, unreadable, truncated } = counts;
  if (unreadable) return <span className="cx-fmeta">unreadable</span>;
  const bits = [];
  if (xlsx) bits.push(`${fmtInt(xlsx)} xlsx`);
  if (csv) bits.push(`${fmtInt(csv)} csv`);
  if (!xlsx && !csv && dirs) bits.push(`${fmtInt(dirs)} folder${dirs === 1 ? '' : 's'}`);
  return <span className="cx-fmeta">{bits.length ? bits.join(' · ') : 'empty'}{truncated ? ' +' : ''}</span>;
}

export default function FolderPicker({ selected, onSelect, disabled }) {
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(true);
  const rowsRef = useRef(null);

  const load = useCallback(async (path) => {
    try {
      const r = await fetch(withBase(`/api/console/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`));
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Could not read that folder.'); return; }
      setListing(j);
      setCursor(0);
    } catch {
      setError('The server did not answer. Is the dev server still running?');
    } finally { setBusy(false); }
  }, []);

  const go = useCallback((path) => { setBusy(true); setError(''); return load(path); }, [load]);

  useEffect(() => { (async () => { await load(null); })(); }, [load]);

  useEffect(() => {
    rowsRef.current?.querySelector('[data-cursor="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, listing]);

  const dirs = listing?.dirs ?? [];

  const onKeyDown = (e) => {
    if (!listing || disabled) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(dirs.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (dirs[cursor]) go(dirs[cursor].path); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (listing.parent) go(listing.parent); }
    else if (e.key === 'Enter') { e.preventDefault(); onSelect?.(listing.path, listing.counts); }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
    else if (e.key === 'End') { e.preventDefault(); setCursor(Math.max(0, dirs.length - 1)); }
  };

  const chosen = selected === listing?.path;

  return (
    <div className="cx-panel cx-fwin">
      {}
      <div className="cx-fbar">
        <span className="cx-dot" aria-hidden />
        <span className="cx-dot" aria-hidden />
        <span className="cx-dot" aria-hidden />
        <p title={listing?.path}>{prettyPath(listing?.path, listing?.root)}</p>
      </div>

      <div
        ref={rowsRef}
        role="listbox"
        aria-label="Folders"
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ maxHeight: 260, overflowY: 'auto' }}
      >
        {listing?.parent && (
          <button type="button" className="cx-frow" onClick={() => go(listing.parent)} disabled={disabled}>
            <span className="cx-fico" style={{ opacity: .5 }} aria-hidden />
            <span className="cx-fn" style={{ color: 'var(--content-tertiary)' }}>..</span>
            <span className="cx-fmeta">up</span>
          </button>
        )}
        {busy && !listing && <div style={{ padding: 16, fontSize: 13, color: 'var(--content-tertiary)' }}>Reading…</div>}
        {listing && !dirs.length && (
          <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6, color: 'var(--content-tertiary)' }}>
            No sub-folders here. Press ⏎ to use this folder as it is.
          </div>
        )}
        {dirs.map((d, i) => (
          <button
            key={d.path}
            type="button"
            data-cursor={i === cursor ? '1' : '0'}
            role="option"
            aria-selected={i === cursor}
            disabled={disabled}
            onClick={() => setCursor(i)}
            onDoubleClick={() => go(d.path)}
            className={`cx-frow${i === cursor ? ' cx-cursor' : ''}`}
          >
            <span className="cx-fico" aria-hidden />
            <span className="cx-fn">{d.name}{d.link ? ' ↗' : ''}</span>
            <Counts counts={d.counts} />
            <span
              role="presentation"
              onClick={(e) => { e.stopPropagation(); go(d.path); }}
              style={{ marginLeft: 8, color: 'var(--content-quaternary)', fontSize: 13, cursor: 'pointer' }}
              aria-hidden
            >
              →
            </span>
          </button>
        ))}
      </div>

      {}
      <div
        className={`cx-frow${chosen ? ' cx-sel' : ''}`}
        style={{ borderTop: '1px solid var(--stroke-hairline)', borderBottom: 0, cursor: 'default' }}
      >
        <span className="cx-fchk" aria-hidden />
        <span className="cx-fn" style={{ minWidth: 0 }}>
          {chosen ? 'This folder is the run’s source' : 'Use this folder'}
        </span>
        <button
          type="button"
          className="cx-btn cx-ghost cx-sm"
          style={{ marginLeft: 'auto' }}
          disabled={!listing || disabled}
          onClick={() => listing && onSelect?.(listing.path, listing.counts)}
        >
          {chosen ? 'Chosen' : 'Choose'}
        </button>
      </div>

      <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--stroke-hairline)' }}>
        <div className="cx-rmeta">↑↓ move · → enter · ← up · ⏎ choose</div>
        {listing?.blockedLinks > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--content-quaternary)' }}>
            {listing.blockedLinks} shortcut{listing.blockedLinks === 1 ? '' : 's'} here point outside the
            browse root and {listing.blockedLinks === 1 ? 'is' : 'are'} not shown.
          </div>
        )}
        {selected && !chosen && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--content-quaternary)', wordBreak: 'break-all' }}>
            chosen: {selected}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--sig-abort)' }}>
            <b>Refused.</b> {error}
          </div>
        )}
      </div>
    </div>
  );
}
