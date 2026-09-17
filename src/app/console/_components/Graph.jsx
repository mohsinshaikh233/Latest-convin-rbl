'use client';

import { C, T, NUM } from '../../aurum';

const W = 1180;
const H = 300;
const R = 26;
const TOP = 92;

const CIRC = 2 * Math.PI * (R + 6);

const TONE = {
  idle: { stroke: C.rim, fill: 'none', label: C.tertiary, word: 'waiting' },
  running: { stroke: C.accent, fill: C.gold(0.14), label: C.accent, word: 'running' },
  done: { stroke: C.accent, fill: C.accent, label: C.secondary, word: 'done' },
  stopped: { stroke: C.caution, fill: C.warn(0.16), label: C.caution, word: 'asks' },
  failed: { stroke: C.abort, fill: C.bad(0.16), label: C.abort, word: 'failed' },

  cached: { stroke: C.secondary, fill: C.quiet, label: C.secondary, word: 'from cache' },

  dry: { stroke: C.secondary, fill: 'none', label: C.secondary, word: 'would fire' },

  stalled: { stroke: C.caution, fill: C.warn(0.12), label: C.caution, word: 'no output' },
};

const Check = ({ x, y, tone = C.onAccent }) => (
  <path
    d={`M ${x - 7} ${y} l 5 5 l 9 -11`}
    fill="none" stroke={tone} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
    style={{ pointerEvents: 'none' }}
  />
);

const Cross = ({ x, y }) => (
  <path
    d={`M ${x - 6} ${y - 6} l 12 12 M ${x + 6} ${y - 6} l -12 12`}
    fill="none" stroke={C.abort} strokeWidth="2.4" strokeLinecap="round"
  />
);

const Disk = ({ x, y }) => (
  <g fill="none" stroke={C.secondary} strokeWidth="1.8" strokeLinecap="round">
    <ellipse cx={x} cy={y - 5} rx="9" ry="3.4" />
    <path d={`M ${x - 9} ${y - 5} v 9 a 9 3.4 0 0 0 18 0 v -9`} />
  </g>
);

const Query = ({ x, y }) => (
  <text x={x} y={y + 6} textAnchor="middle" style={{ ...T.headline, fontWeight: 700, fill: C.caution }}>?</text>
);

export default function Graph({ order = [], stages = {}, cohorts = [], books = [], expand, onExpand, reduced }) {
  if (!order.length) return null;

  const n = order.length;
  const pad = 70;
  const step = (W - pad * 2) / (n - 1);
  const xOf = (i) => pad + i * step;

  const rawStatus = (s) => stages[s]?.status ?? 'idle';

  const statusOf = (s) => {
    const st = rawStatus(s);

    if (st === 'running' && stages[s]?.stalled) return 'stalled';
    if (st !== 'done') return st;
    if (s === '03' && stages[s]?.result?.dryRun) return 'dry';
    if (s === '03' && stages[s]?.result?.servedFromCache) return 'cached';
    return st;
  };

  const idx = Object.fromEntries(order.map((o, i) => [o.stage, i]));

  const edgeDone = (i) => rawStatus(order[i].stage) === 'done';
  const edgeLive = (i) => rawStatus(order[i].stage) === 'done' && rawStatus(order[i + 1]?.stage) === 'running';

  const cohortsAt = idx['03'];
  const booksAt = idx['06'];
  const sourceFiles = [...new Set(cohorts.filter((c) => c.cached && c.sourceFile).map((c) => c.sourceFile))];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="group"
      aria-label="Pipeline stages"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        {}
        <linearGradient id="edge-live" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={C.gold(0.05)} />
          <stop offset="50%" stopColor={C.gold(0.85)} />
          <stop offset="100%" stopColor={C.gold(0.05)} />
          {!reduced && (
            <animate attributeName="x1" values="-1;1" dur="1.6s" repeatCount="indefinite" />
          )}
          {!reduced && (
            <animate attributeName="x2" values="0;2" dur="1.6s" repeatCount="indefinite" />
          )}
        </linearGradient>
      </defs>

      {}
      {order.slice(0, -1).map((o, i) => {
        const x1 = xOf(i) + R + 5;
        const x2 = xOf(i + 1) - R - 5;
        return (
          <g key={`e${o.stage}`}>
            <line x1={x1} y1={TOP} x2={x2} y2={TOP} stroke={C.hairline} strokeWidth="2" />
            <line
              x1={x1} y1={TOP} x2={x2} y2={TOP}
              stroke={edgeLive(i) ? 'url(#edge-live)' : C.quaternary}
              strokeWidth="2.5"
              style={{
                transformOrigin: `${x1}px ${TOP}px`,
                transform: `scaleX(${edgeDone(i) ? 1 : 0})`,
                transition: reduced ? 'none' : 'transform var(--dur-large) var(--ease-standard)',
              }}
            />
          </g>
        );
      })}

      {}
      {cohortsAt >= 0 && expand === '03' && (
        <SubArc
          x={xOf(cohortsAt)} y={TOP} reduced={reduced}
          items={cohorts.map((c) => ({
            id: c.key,
            label: `${c.campaign} ${c.startDate.slice(5)}`,
            state: c.status === 'done' ? 'done' : c.status === 'failed' ? 'failed' : c.status === 'idle' ? 'idle' : 'running',
            note: c.cached ? 'cache' : null,
            aria: `Cohort ${c.key}, ${c.status}${c.cached ? ', served from a call log already on disk' : ''}`,
          }))}
        />
      )}
      {booksAt >= 0 && expand === '06' && (
        <SubArc
          x={xOf(booksAt)} y={TOP} reduced={reduced}
          items={books.map((b) => ({
            id: b.book,
            label: b.book,
            state: b.status === 'built' ? 'done' : b.status === 'failed' ? 'failed' : 'idle',
            aria: `Book ${b.book}, ${b.status}${b.attempts != null ? `, ${b.attempts.toLocaleString('en-IN')} call attempts` : ''}`,
          }))}
        />
      )}

      {}
      {order.map((o, i) => {
        const st = statusOf(o.stage);
        const tone = TONE[st] ?? TONE.idle;
        const x = xOf(i);
        const expandable = (o.stage === '03' && cohorts.length) || (o.stage === '06' && books.length);
        const open = expand === o.stage;
        const count = o.stage === '03' ? cohorts.length : o.stage === '06' ? books.length : 0;

        return (
          <g
            key={o.stage}
            tabIndex={0}
            role="button"
            aria-label={`Stage ${o.stage} ${o.name} — ${tone.word}${count ? `, ${count} ${o.stage === '03' ? 'cohorts' : 'books'}${open ? ', expanded' : ''}` : ''}`}
            aria-expanded={expandable ? open : undefined}
            onClick={() => expandable && onExpand?.(open ? null : o.stage)}
            onKeyDown={(e) => {
              if (expandable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onExpand?.(open ? null : o.stage); }
            }}
            style={{ cursor: expandable ? 'pointer' : 'default', outlineOffset: 4 }}
          >
            {}
            <circle
              cx={x} cy={TOP} r={R + 6}
              fill="none"
              stroke={st === 'running' ? C.accent : st === 'stalled' ? C.caution : st === 'cached' || st === 'dry' ? C.secondary : 'transparent'}
              strokeWidth="2.5"
              strokeLinecap="round"

              strokeDasharray={st === 'cached' || st === 'dry' ? '5 6' : CIRC}
              strokeDashoffset={st === 'running' || st === 'stalled' || st === 'cached' || st === 'dry' ? 0 : CIRC}
              transform={`rotate(-90 ${x} ${TOP})`}
              style={{
                transition: reduced ? 'none' : 'stroke-dashoffset var(--dur-enter) var(--ease-enter)',
                opacity: st === 'running' || st === 'stalled' || st === 'cached' || st === 'dry' ? 1 : 0,
              }}
            />

            {}
            {(st === 'running' || st === 'stopped' || st === 'stalled' || st === 'failed') && (

              <circle
                cx={x} cy={TOP} r={R + 2}
                fill="none"
                stroke={st === 'running' ? C.gold(0.13)
                  : st === 'failed' ? C.bad(0.16) : C.warn(0.16)}
                strokeWidth="8"
                style={{ pointerEvents: 'none' }}
              />
            )}
            <circle
              cx={x} cy={TOP} r={R}

              fill={st === 'done' ? C.accent : tone.fill}
              stroke={st === 'done' ? C.accent : tone.stroke}
              strokeWidth={st === 'idle' ? 1.5 : 2.5}
              style={{
                transformOrigin: `${x}px ${TOP}px`,
                transform: st === 'running' ? 'translateY(-3px) scale(1.06)' : 'none',
                transition: reduced ? 'none' : 'transform var(--dur-medium) var(--ease-standard), stroke var(--dur-medium) var(--ease-glide), fill var(--dur-medium) var(--ease-glide)',
              }}
            />

            {st === 'done' && <Check x={x} y={TOP} />}
            {st === 'failed' && <Cross x={x} y={TOP} />}
            {st === 'stopped' && <Query x={x} y={TOP} />}
            {(st === 'cached' || st === 'dry') && <Disk x={x} y={TOP} />}
            {(st === 'idle' || st === 'running' || st === 'stalled') && (
              <text x={x} y={TOP + 5} textAnchor="middle" style={{ ...T.footnote, ...NUM, fontWeight: 600, fill: tone.label }}>{o.stage}</text>
            )}

            <text x={x} y={TOP + R + 22} textAnchor="middle" style={{ ...T.micro, fill: st === 'idle' ? C.quaternary : C.secondary }}>
              {o.name}
            </text>
            {}
            <text x={x} y={TOP + R + 36} textAnchor="middle" style={{ ...T.micro, fill: tone.label, fontWeight: 600 }}>
              {tone.word}
            </text>
            {expandable && (
              <text x={x} y={TOP + R + 50} textAnchor="middle" style={{ ...T.micro, ...NUM, fill: C.tertiary }}>
                {open ? '▾' : '▸'} {count.toLocaleString('en-IN')}
              </text>
            )}
            {}
            {st === 'stalled' && stages[o.stage]?.silentFor != null && (
              <text x={x} y={TOP + R + 64} textAnchor="middle" style={{ ...T.micro, fill: C.caution }}>
                silent {Math.round(stages[o.stage].silentFor / 60)}m
              </text>
            )}
            {}
            {st === 'cached' && !open && sourceFiles.length > 0 && (
              <text x={x} y={TOP + R + 64} textAnchor="middle" style={{ ...T.micro, fill: C.tertiary }}>
                {sourceFiles.length === 1
                  ? (sourceFiles[0].length > 20 ? `${sourceFiles[0].slice(0, 19)}…` : sourceFiles[0])
                  : `${sourceFiles.length} files on disk`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SubArc({ x, y, items, reduced }) {
  if (!items.length) return null;

  const n = items.length;
  const { perArc, spread, r, rowGap, chars } = n <= 6 ? { perArc: 6, spread: 168, r: 14, rowGap: 52, chars: 22 }
    : n <= 12 ? { perArc: 6, spread: 168, r: 12, rowGap: 48, chars: 22 }
      : n <= 24 ? { perArc: 12, spread: 84, r: 10, rowGap: 38, chars: 11 }
        : { perArc: 13, spread: 78, r: 9, rowGap: 34, chars: 10 };

  return (
    <g>
      {items.map((it, i) => {
        const arc = Math.floor(i / perArc);
        const inArc = i % perArc;
        const countInArc = Math.min(perArc, items.length - arc * perArc);
        const cx = x + (inArc - (countInArc - 1) / 2) * spread;
        const cy = y + 96 + arc * rowGap;

        const tone = it.state === 'done' ? { s: C.quaternary, f: C.quiet }
          : it.state === 'running' ? { s: C.accent, f: C.gold(0.14) }
            : it.state === 'failed' ? { s: C.abort, f: C.bad(0.16) }
              : { s: C.rim, f: 'none' };

        return (
          <g
            key={it.id}
            tabIndex={0}
            role="img"
            aria-label={it.aria}
            style={{
              transformOrigin: `${x}px ${y}px`,
              animation: reduced ? 'none' : `cardIn var(--dur-enter) var(--ease-enter) both`,
              animationDelay: reduced ? '0ms' : `${Math.min(i, 20) * 18}ms`,
              outlineOffset: 3,
            }}
          >
            <line x1={x} y1={y + R} x2={cx} y2={cy - r} stroke={C.hairline} strokeWidth="1" />
            <circle cx={cx} cy={cy} r={r} fill={tone.f} stroke={tone.s} strokeWidth={it.state === 'idle' ? 1.2 : 2} />
            {it.state === 'done' && (r >= 12 ? <Check x={cx} y={cy} tone={C.secondary} /> : <circle cx={cx} cy={cy} r={3} fill={C.secondary} />)}
            <text
              x={cx} y={cy + r + 12} textAnchor="middle"
              style={{ ...T.micro, fill: it.state === 'idle' ? C.quaternary : C.secondary }}
            >
              {it.label.length > chars ? `${it.label.slice(0, chars - 1)}…` : it.label}
            </text>
            {it.note && (
              <text x={cx} y={cy + r + 24} textAnchor="middle" style={{ ...T.micro, fill: C.caution, fontWeight: 600 }}>
                {it.note}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
