'use client';

export const C = {
  canvas: 'var(--surface-canvas)',
  grouped: 'var(--surface-grouped)',
  raised: 'var(--surface-raised)',
  glass: 'var(--surface-glass)',
  scrim: 'var(--surface-scrim)',

  primary: 'var(--content-primary)',
  secondary: 'var(--content-secondary)',
  tertiary: 'var(--content-tertiary)',
  quaternary: 'var(--content-quaternary)',
  accent: 'var(--content-accent)',
  onAccent: 'var(--content-on-accent)',

  hairline: 'var(--stroke-hairline)',
  rim: 'var(--stroke-rim)',
  focus: 'var(--stroke-focus)',

  quiet: 'var(--fill-quiet)',
  pressed: 'var(--fill-pressed)',
  accentFill: 'var(--fill-accent)',

  nominal: 'var(--sig-nominal)',
  caution: 'var(--sig-caution)',
  abort: 'var(--sig-abort)',
  link: 'var(--sig-link)',

  ink: (a) => `rgba(var(--ti-100-rgb), ${a})`,
  paper: (a) => `rgba(var(--ti-00-rgb), ${a})`,
  gold: (a) => `rgba(var(--accent-rgb), ${a})`,
  good: (a) => `rgba(var(--sig-nominal-rgb), ${a})`,
  warn: (a) => `rgba(var(--sig-caution-rgb), ${a})`,
  bad: (a) => `rgba(var(--sig-abort-rgb), ${a})`,
};

const step = (size, lead, track, weight, cut = 'text', extra) => ({
  fontFamily: cut === 'display' ? 'var(--font-display)' : cut === 'mono' ? 'var(--font-mono)' : 'var(--font-text)',
  fontSize: size,
  lineHeight: `${lead}px`,
  letterSpacing: track,
  fontWeight: weight,
  ...extra,
});

export const T = {
  colossus: step('var(--size-colossus)', 88, 'var(--track-colossus)', 700, 'display'),
  display1: step('var(--size-display-1)', 64, 'var(--track-display-1)', 700, 'display'),
  display2: step('var(--size-display-2)', 52, 'var(--track-display-2)', 700, 'display'),
  title1: step('var(--size-title-1)', 40, 'var(--track-title-1)', 700, 'display'),
  title2: step('var(--size-title-2)', 34, 'var(--track-title-2)', 600, 'display'),
  title3: step('var(--size-title-3)', 28, 'var(--track-title-3)', 600, 'display'),
  headline: step('var(--size-headline)', 22, 'var(--track-headline)', 600),
  body: step('var(--size-body)', 25, 'var(--track-body)', 400),
  callout: step('var(--size-callout)', 21, 'var(--track-callout)', 400),
  subhead: step('var(--size-subhead)', 20, 'var(--track-subhead)', 400),
  footnote: step('var(--size-footnote)', 18, 'var(--track-footnote)', 400),
  caption: step('var(--size-caption)', 16, 'var(--track-caption)', 400),
  micro: step('var(--size-micro)', 13, 'var(--track-micro)', 500),

  overline: step('var(--size-overline)', 12, 'var(--track-overline)', 600, 'text', { textTransform: 'uppercase' }),

  mono: step('var(--size-footnote)', 18, '0', 400, 'mono'),
};

export const NUM = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' };

export const glass = (weight = 'regular', elevation = 3) => ({
  background: C.glass,
  backdropFilter: `var(--glass-${weight})`,
  WebkitBackdropFilter: `var(--glass-${weight})`,
  border: `1px solid ${C.rim}`,

  boxShadow: `inset 0 1px 0 var(--specular-top), inset 0 -1px 0 var(--specular-bottom), var(--e${elevation})`,
  isolation: 'isolate',
});

export const surface = (elevation = 1) => ({
  background: C.raised,
  border: `1px solid ${C.hairline}`,
  boxShadow: `var(--e${elevation})`,
});

export function Card({ span, children, style = {}, className = '', pad = 24, elevation = 1, as: Tag = 'div', ...rest }) {
  return (
    <Tag
      className={`card u-squircle hover-kpi ${className}`.trim()}

      style={{ ...(span ? { gridColumn: `span ${span}` } : null), ...surface(elevation), padding: pad, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function Glass({ children, style = {}, className = '', weight = 'regular', elevation = 3, radius = 'var(--radius-capsule)' }) {
  return (
    <div className={`u-glass ${className}`.trim()} style={{ ...glass(weight, elevation), borderRadius: radius, ...style }}>
      {children}
    </div>
  );
}

export function Overline({ children, tone = C.tertiary, style = {} }) {
  return <div style={{ ...T.overline, color: tone, ...style }}>{children}</div>;
}

export function Title({ t, s, style = {} }) {
  return (
    <div style={{ marginBottom: s ? 20 : 16, ...style }}>
      <div style={{ ...T.title3, color: C.primary }}>{t}</div>
      {s && <div style={{ ...T.subhead, color: C.tertiary, marginTop: 4, maxWidth: 780 }}>{s}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, accent = false, tone, size = 'title1', style = {} }) {
  return (
    <div style={style}>
      <Overline>{label}</Overline>
      <div style={{ ...T[size], ...NUM, color: tone || (accent ? C.accent : C.primary), marginTop: 8 }}>{value}</div>
      {sub && <div style={{ ...T.caption, color: C.tertiary, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export function Bar({ label, right, pctv = 0, tone = C.tertiary, sub, height = 8, style = {} }) {
  return (
    <div style={{ marginBottom: 14, ...style }}>
      {(label || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 7 }}>
          <span style={{ ...T.footnote, color: C.secondary }}>{label}</span>
          <span style={{ ...T.footnote, ...NUM, fontWeight: 600, color: C.primary, whiteSpace: 'nowrap' }}>{right}</span>
        </div>
      )}
      <Track pctv={pctv} tone={tone} height={height} />
      {sub && <div style={{ ...T.caption, color: C.tertiary, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export function Track({ pctv = 0, tone = C.tertiary, height = 8, style = {} }) {
  return (
    <div style={{ height, borderRadius: 'var(--radius-capsule)', background: C.quiet, overflow: 'hidden', ...style }}>
      <div
        className="u-grow"
        style={{
          width: `${Math.min(100, Math.max(0, pctv))}%`,
          height: '100%',
          borderRadius: 'var(--radius-capsule)',
          background: tone,
        }}
      />
    </div>
  );
}

export function Hairline({ style = {} }) {
  return <div style={{ height: 1, background: C.hairline, ...style }} />;
}

export function SignalDot({ tone = C.nominal, size = 7, pulse = false, style = {} }) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 'var(--radius-capsule)', background: tone,
        flex: 'none', display: 'inline-block',
        animation: pulse ? 'pulseDot 2s ease-in-out infinite' : undefined,
        ...style,
      }}
    />
  );
}

const CAPSULE_SIZE = {
  xs: { height: 28, padding: '0 12px', ...T.caption, fontWeight: 600 },
  s: { height: 36, padding: '0 16px', ...T.subhead, fontWeight: 600 },
  m: { height: 44, padding: '0 20px', ...T.headline },
  l: { height: 52, padding: '0 24px', ...T.headline },
  xl: { height: 64, padding: '0 32px', ...T.title3 },
};

const CAPSULE_VARIANT = {
  metal: { background: C.accentFill, color: C.onAccent, border: '1px solid transparent', boxShadow: 'var(--e2)' },
  solid: { background: C.primary, color: C.canvas, border: '1px solid transparent', boxShadow: 'var(--e1)' },
  glass: { background: C.glass, color: C.primary, border: `1px solid ${C.rim}`, backdropFilter: 'var(--glass-thin)', WebkitBackdropFilter: 'var(--glass-thin)' },
  tinted: { background: 'var(--fill-quiet)', color: C.accent, border: '1px solid transparent' },
  plain: { background: 'transparent', color: C.secondary, border: '1px solid transparent' },
  destruct: { background: 'var(--fill-quiet)', color: C.abort, border: `1px solid rgba(var(--sig-abort-rgb), .28)` },
};

export function Capsule({
  children, variant = 'glass', size = 'm', full = false, as: Tag = 'button',
  style = {}, ...rest
}) {
  return (
    <Tag
      className="pill"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        borderRadius: 'var(--radius-capsule)',
        cursor: rest.disabled ? 'default' : 'pointer',
        opacity: rest.disabled ? 0.4 : 1,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        width: full ? '100%' : undefined,
        minWidth: 'var(--target-min)',
        ...CAPSULE_SIZE[size],
        ...CAPSULE_VARIANT[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function Chip({ children, selected = false, tone, style = {} }) {
  return (
    <span
      className="u-squircle-sm"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px',
        ...T.caption, fontWeight: 600,
        background: selected ? 'transparent' : C.quiet,
        color: tone || (selected ? C.accent : C.secondary),
        border: `1px solid ${selected ? C.gold(0.38) : 'transparent'}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, style = {}, ...rest }) {
  return (
    <label style={{ display: 'block' }}>
      {label && <div style={{ ...T.overline, color: C.tertiary, marginBottom: 8 }}>{label}</div>}
      <input
        style={{
          width: '100%', height: 44, padding: '0 20px',
          ...T.callout,
          borderRadius: 'var(--radius-capsule)',
          border: `1px solid ${C.rim}`,
          background: C.quiet,
          color: C.primary,
          outline: 'none',
          ...style,
        }}
        {...rest}
      />
      {hint && <div style={{ ...T.caption, color: C.tertiary, marginTop: 7 }}>{hint}</div>}
    </label>
  );
}

export function Metal({ children, size = 'display2', style = {} }) {
  return (
    <span
      className="u-metal"
      style={{
        ...T[size],
        fontWeight: 700,
        background: 'var(--metal-aurum)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
        filter: 'var(--metal-glow)',
        display: 'inline-block',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function delta(value, base, { higherIsBetter = true, flat = 1 } = {}) {
  const d = (value || 0) - (base || 0);
  const up = d >= 0;
  const material = Math.abs(d) >= flat;
  const good = higherIsBetter ? up : !up;
  return {
    d,
    abs: Math.abs(d),
    up,
    material,
    glyph: !material ? '—' : up ? '▲' : '▼',
    sign: !material ? '' : up ? '+' : '−',
    tone: !material ? C.tertiary : good ? C.nominal : C.abort,
  };
}

export const th = (align = 'left', width) => ({
  padding: '10px 10px',
  textAlign: align,
  width,
  ...T.overline,
  color: C.tertiary,
  whiteSpace: 'nowrap',
  borderBottom: `1px solid ${C.hairline}`,
});

export const td = (align = 'left', tone = C.secondary, extra = {}) => ({
  padding: '11px 10px',
  textAlign: align,
  ...T.footnote,
  ...(align === 'right' ? NUM : {}),
  color: tone,
  borderTop: `1px solid ${C.hairline}`,
  ...extra,
});

export const fmtCr = (n) => {
  const s = n < 0 ? '−' : '';
  const a = Math.abs(n || 0);
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
  return `${s}₹${Math.round(a)}`;
};
export const fmtINR = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
export const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-IN');
export const pct = (n, d = 1) => `${(n || 0).toFixed(d)}%`;
export const mmss = (s) => {
  const t = Math.round(s || 0);
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`;
};

export const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '—';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
};
