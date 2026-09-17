'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { PAYLOAD_VERSION } from '@/lib/payload_version.mjs';
import { BASE_PATH, withBase } from '../../lib/basepath.mjs';
import {
  C as AU, T, NUM, glass, surface, Metal, fmtCr, fmtInt, pct, mmss, fmtDay,
} from '../aurum';

const C = {
  ink: AU.primary,
  quiet: AU.tertiary,
  blue: AU.secondary,
  indigo: AU.secondary,
  purple: AU.tertiary,
  teal: AU.tertiary,
  pink: AU.tertiary,
  cyan: AU.tertiary,

  orange: AU.tertiary,

  green: AU.nominal,
  red: AU.abort,
  caution: AU.caution,

  gold: AU.accent,
};

const RAMP = ['var(--ramp-1)', 'var(--ramp-2)', 'var(--ramp-3)', 'var(--ramp-4)', 'var(--ramp-5)', 'var(--ramp-6)'];
const ramp = (i) => RAMP[i % RAMP.length];

const SEG_HEX = {
  red: '#FF3B30', amber: '#FF9500', orange: '#FF7A00',
  yellow: '#FFCC00', green: '#34C759', blue: '#0071E3',
};
const segColor = (name, i) => SEG_HEX[String(name || '').trim().toLowerCase()] || ramp(i);

const FW = 560;

const ink = (a) => `rgba(var(--ink-rgb), ${a})`;
const txt = (a) => (a >= 0.8 ? AU.primary : a >= 0.55 ? AU.secondary : AU.tertiary);

const heat = (p) => `rgba(var(--ink-rgb), ${(0.05 + Math.min(1, Math.max(0, (p || 0) / 100)) * 0.20).toFixed(3)})`;

const l2Th = (align, w) => ({
  padding: '10px 10px', textAlign: align, width: w,
  ...T.overline, color: AU.tertiary, whiteSpace: 'nowrap',
  borderBottom: `1px solid ${AU.hairline}`,
});

const arrowBtn = (disabled) => ({
  border: 'none', background: disabled ? 'transparent' : AU.quiet,
  color: disabled ? AU.tertiary : AU.primary,
  cursor: disabled ? 'default' : 'pointer',
  width: 32, height: 32, borderRadius: 'var(--radius-capsule)',
  fontSize: 17, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit',
});

const dayLabel = (u) => String(u?.label || '').replace(/^Upload\b/i, 'Day') || 'Day';

const SUMMARY_ID = '__summary';

const GLASS = glass('regular', 3);

function Card({ span = 12, children, style = {}, className = '', pad = 24 }) {
  return (
    <div
      className={`hover-kpi card u-squircle ${className}`.trim()}
      style={{ gridColumn: `span ${span}`, ...surface(1), padding: pad, ...style }}
    >
      {children}
    </div>
  );
}
function Title({ t, s }) {
  return (
    <div style={{ marginBottom: s ? 20 : 16 }}>
      <div style={{ ...T.title3, color: AU.primary }}>{t}</div>
      {s && <div style={{ ...T.subhead, color: AU.tertiary, marginTop: 4, maxWidth: 820 }}>{s}</div>}
    </div>
  );
}

function Bar({ label, right, pctv, color = AU.tertiary, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 7 }}>
        <span style={{ ...T.footnote, color: AU.secondary }}>{label}</span>
        <span style={{ ...T.footnote, ...NUM, fontWeight: 600, color: AU.primary, whiteSpace: 'nowrap' }}>{right}</span>
      </div>
      <div style={{ height: 8, borderRadius: 'var(--radius-capsule)', background: AU.quiet, overflow: 'hidden' }}>
        <div className="u-grow" style={{
          height: '100%', borderRadius: 'var(--radius-capsule)',
          width: `${Math.min(100, Math.max(1.5, pctv))}%`, background: color,
        }} />
      </div>
      {sub && <div style={{ ...T.caption, color: AU.tertiary, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function ManageLinks({ links, busy, revoking, copiedToken, onRevoke, onCopy, onRefresh, onClose }) {
  const fmtWhen = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  if (busy && !links) {
    return <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 13, color: txt(.5) }}>Loading links…</div>;
  }

  const live = (links || []).filter((l) => !l.revoked);
  const dead = (links || []).filter((l) => l.revoked);

  if (!links || !links.length) {
    return (
      <>
        <div style={{ padding: '34px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: txt(.7), marginBottom: 6 }}>No links yet</div>
          <div style={{ fontSize: 13, color: txt(.45), lineHeight: 1.6 }}>
            Create one on the <b>New link</b> tab. Anything you issue will appear here, and this
            is where you take it back.
          </div>
        </div>
        <button onClick={onClose} style={{
          width: '100%', padding: '11px 18px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
          background: ink(.07), color: AU.primary, fontSize: 13, fontWeight: 600,
        }}>Close</button>
      </>
    );
  }

  const row = (l) => {
    const expired = l.expires_at && new Date(l.expires_at) < new Date();
    const dead_ = l.revoked || expired;
    const views = Number(l.views || 0);
    return (
      <div key={l.token} style={{
        padding: '13px 14px', borderRadius: 16, marginBottom: 8,
        background: dead_ ? 'transparent' : ink(.03),
        border: `1px solid ${dead_ ? ink(.06) : ink(.08)}`,
        opacity: dead_ ? 0.55 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: txt(.9), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {l.label || <span style={{ color: txt(.45), fontWeight: 500 }}>(no recipient named)</span>}
              {l.revoked && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: AU.abort }}>REVOKED</span>}
              {!l.revoked && expired && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: AU.caution }}>EXPIRED</span>}
            </div>
            <div style={{ fontSize: 12, color: txt(.45), marginTop: 3 }}>
              {l.report_date || l.reportDate}
              {' · '}
              {}
              {views === 0
                ? <span style={{ color: txt(.4) }}>never opened</span>
                : <b style={{ color: AU.nominal }}>{views} view{views === 1 ? '' : 's'}</b>}
              {l.last_viewed_at && <> · last {fmtWhen(l.last_viewed_at)}</>}
              {!l.expires_at && !l.revoked && <> · no expiry</>}
            </div>
          </div>

          {!dead_ && (
            <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
              <button onClick={() => onCopy(l.token)} style={{
                padding: '7px 13px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
                background: copiedToken === l.token ? AU.good(0.16) : ink(.07),
                color: copiedToken === l.token ? AU.nominal : AU.primary,
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              }}>{copiedToken === l.token ? 'Copied ✓' : 'Copy'}</button>

              <button onClick={() => onRevoke(l.token, l.label)} disabled={revoking === l.token} style={{
                padding: '7px 13px', borderRadius: 'var(--radius-capsule)', border: 'none',
                cursor: revoking === l.token ? 'default' : 'pointer',
                background: AU.bad(0.10), color: AU.abort,
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                opacity: revoking === l.token ? 0.5 : 1,
              }}>{revoking === l.token ? 'Revoking…' : 'Revoke'}</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div style={{ maxHeight: 320, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
        {live.map(row)}
        {dead.length > 0 && (
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.35), margin: '14px 0 8px' }}>
            Revoked &amp; expired
          </div>
        )}
        {dead.map(row)}
      </div>

      <div style={{ fontSize: 12, color: txt(.42), marginTop: 12, lineHeight: 1.6 }}>
        Revoking is immediate and permanent. Anyone holding the link — including in an email
        already sent — will see &ldquo;This link is no longer available&rdquo;.
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button onClick={onRefresh} disabled={busy} style={{
          padding: '11px 18px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
          background: ink(.07), color: AU.primary, fontSize: 13, fontWeight: 600,
        }}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        <button onClick={onClose} style={{
          flex: 1, padding: '11px 18px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
          background: AU.accent, color: AU.onAccent, fontSize: 13, fontWeight: 600,
        }}>Done</button>
      </div>
    </>
  );
}

function SummaryView({ s }) {
  if (!s) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center', color: txt(.45), fontSize: 15 }}>
        Building the campaign summary…
      </div>
    );
  }
  if (s.error || !s.campaign) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: txt(.5), fontSize: 15 }}>
        {s.error || 'No reports have been uploaded for this date, so there is nothing to summarise.'}
      </div>
    );
  }

  const A = s.campaign.agg;
  const t = A.totals;
  const m = s.movement;
  const multi = s.trend.length > 1;

  const head = [
    { l: 'Recovered Total Outstanding Amount', v: fmtCr(t.recovered), s: `${pct(t.recoveryRatePct, 1)} of total outstanding amount`, c: C.green },
    { l: 'Accounts Resolved', v: fmtInt(t.resolved), s: `${pct(t.resolutionRatePct, 1)} of ${fmtInt(t.accounts)}`, c: C.blue },
    { l: 'Total Outstanding Amount', v: fmtCr(t.sumOut), s: `${fmtInt(t.accounts)} accounts`, c: C.indigo },
    { l: 'Still Open', v: fmtCr(t.outstandingPending), s: `${fmtInt(t.unresolved)} accounts`, c: C.orange },
  ];

  return (
    <div style={{ paddingTop: 8 }}>
      {}
      <div style={{ padding: '44px 0 30px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.12em', color: C.blue, textTransform: 'uppercase', marginBottom: 14 }}>
          Summary &nbsp;·&nbsp; {s.display || s.date}
        </div>
        {}
        <h1 style={{ margin: '0 0 16px', maxWidth: 900 }}>
          <Metal size="display2">
            {fmtCr(t.recovered)} recovered{multi ? ` across ${s.trend.length} days` : ''}.
          </Metal>
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: txt(.6), maxWidth: 760, margin: 0 }}>
          {fmtInt(t.accounts)} accounts holding {fmtCr(t.sumOut)} — {fmtInt(t.resolved)} resolved ({pct(t.resolutionRatePct)}),
          {' '}{fmtCr(t.outstandingPending)} still open across {fmtInt(t.unresolved)} accounts.
          {multi && (
            <>
              {' '}This is the <b>Day Total</b> for {s.display} — every Day below reads the <b>same book</b> against a
              later status file, so the accounts never change and the money is counted <b>once</b>.
            </>
          )}
        </p>
      </div>

      {}
      {s.carry && (
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title
            t="Earlier cycles — not in the current accounts"
            s="Worked on an earlier report date, and deliberately kept out of the totals above"
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'baseline', marginTop: 2 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.45), marginBottom: 5 }}>Accounts</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(s.carry.accounts)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.45), marginBottom: 5 }}>Their outstanding</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.orange, fontVariantNumeric: 'tabular-nums' }}>{fmtCr(s.carry.outstanding)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.45), marginBottom: 5 }}>Recovered from them</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>{fmtCr(s.carry.recovered)}</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: txt(.5), lineHeight: 1.6, marginTop: 14 }}>
            These accounts appear on {s.carry.dates.map((d) => d.display).join(', ')} but not in the current accounts.
            They are <b>not</b> included in the totals above — outstanding is what is open today, and adding an
            earlier cycle would inflate the figure every time RBL sends a new one.
          </div>
        </Card>
      )}

      {}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${head.length},1fr)`, gap: 16, marginBottom: 16 }}>
        {head.map((k, i) => (
          <div className="hover-kpi" key={i} style={{ ...GLASS, borderRadius: 20, padding: '22px 20px', animation: 'fadeUp .7s cubic-bezier(.32,.72,0,1) both' }}>

            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.5), marginBottom: 8 }}>{k.l}</div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', marginBottom: 6 }}>{k.v}</div>
            <div style={{ fontSize: 13, color: txt(.48) }}>{k.s}</div>
          </div>
        ))}
      </div>

      {}
      {m && (
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title t="Movement" s={`How the accounts changed between ${m.from} and ${m.to}`} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20, marginTop: 4 }}>
            {[
              { l: 'Recovered', v: `${m.recovered >= 0 ? '+' : '−'}${fmtCr(Math.abs(m.recovered))}`, c: m.recovered >= 0 ? C.green : AU.abort },
              { l: 'Accounts resolved', v: `${m.resolved >= 0 ? '+' : '−'}${fmtInt(Math.abs(m.resolved))}`, c: m.resolved >= 0 ? C.green : AU.abort },
              { l: 'Resolution rate', v: `${m.resolutionPts >= 0 ? '+' : '−'}${Math.abs(m.resolutionPts).toFixed(1)} pts`, c: m.resolutionPts >= 0 ? C.green : AU.abort },
            ].map((x, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.45), marginBottom: 6 }}>{x.l}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: x.c, fontVariantNumeric: 'tabular-nums' }}>{x.v}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {}
      {multi && (
        <Card span={12} className="print-breakable" style={{ marginBottom: 16 }}>
          <Title t="Every day, in order" s="Each day re-checks the same accounts against a newer status file — this is progress, not new money" />
          <div className="table-scroll" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Day', 'Accounts', 'Outstanding', 'Recovered', 'Resolved', 'Resolution', 'Change'].map((h, i) => (
                    <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.45), borderBottom: `1px solid ${ink(.1)}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.trend.map((d, i) => (
                  <tr key={d.id}>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, fontWeight: 600 }}>{d.label}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.accounts)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCr(d.outstanding)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: C.green }}>{fmtCr(d.recovered)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.resolved)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{pct(d.resolutionPct, 1)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: `1px solid ${ink(.06)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: d.recoveredDelta > 0 ? C.green : ink(.35) }}>
                      {i === 0 ? '—' : d.sameBook === false ? 'different book' : d.recoveredDelta ? `+${fmtCr(d.recoveredDelta)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: txt(.42), marginTop: 10, lineHeight: 1.6 }}>
            <b>These rows do not add up, and must not be added up.</b> Every Day re-reads the <b>same</b> accounts
            against a later status file — a customer who paid on the 4th is still resolved on the 8th. The headline
            above is the <b>Day Total</b>: each account counted once, at its most recent outcome. Adding the Days
            together would report the money {s.trend.length} times over.
          </div>
        </Card>
      )}

      {}
      {s.findings?.length > 0 && (
        <Card span={12} className="print-breakable" style={{ marginBottom: 16 }}>
          <Title t="What's working, and what isn't" s="Every line below is measured from the data — nothing is assumed" />
          <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
            {s.findings.map((f, i) => (
              <div key={i} style={{
                display: 'flex', gap: 14, alignItems: 'flex-start', padding: '13px 16px', borderRadius: 12,
                background: f.kind === 'good' ? AU.good(0.07) : AU.warn(0.07),
                border: `1px solid ${f.kind === 'good' ? AU.good(0.22) : AU.warn(0.22)}`,
              }}>
                <div style={{ flex: 'none', width: 74, fontSize: 16, fontWeight: 700, color: f.kind === 'good' ? AU.nominal : AU.caution, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                  {f.value}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{f.label}</div>
                  <div style={{ fontSize: 13, color: txt(.62), lineHeight: 1.6 }}>{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {}
      <Card span={12} className="print-breakable" style={{ marginBottom: 16 }}>
        <Title t="What to work next" s="Open accounts, ranked by value — a work queue" />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '2px 0 18px' }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.02em', color: C.orange, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCr(s.openAmount)}
          </div>
          <div style={{ fontSize: 13, color: txt(.55) }}>still outstanding across {fmtInt(s.openAccounts)} open accounts</div>
        </div>
        {s.actions.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '13px 0', borderTop: `1px solid ${ink(.08)}` }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.label}</div>
              <div style={{ fontSize: 12, color: txt(.45), marginTop: 2 }}>{a.note} · {fmtInt(a.count)} accounts</div>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.indigo, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtCr(a.amount)}</div>
          </div>
        ))}
        {!s.actions.length && (
          <div style={{ fontSize: 13, color: txt(.45), paddingTop: 8 }}>Nothing left in the open book to prioritise.</div>
        )}
      </Card>

      <div style={{ textAlign: 'center', fontSize: 12, color: txt(.4), marginTop: 40, lineHeight: 1.7 }}>
        Convin × RBL Bank · Summary · {s.display} · {s.trend.length} day{s.trend.length === 1 ? '' : 's'} ·
        {' '}Each account counted once, at its most recent outcome.
      </div>
    </div>
  );
}

export default function Report({ shareToken = null }) {
  const [share, setShare] = useState(null);
  const [shareErr, setShareErr] = useState(null);
  const [authed, setAuthed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [dateIdx, setDateIdx] = useState(0);
  const [batchId, setBatchId] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [shareTabs, setShareTabs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [theme, setTheme] = useState(() => (

    typeof document !== 'undefined' && !document.documentElement.classList.contains('dark') ? 'light' : 'dark'
  ));
  const [name, setName] = useState('');

  const bootShare = async () => {
    const res = await fetch(withBase(`/api/share/${shareToken}`));
    if (res.status !== 200) {
      const j = await res.json().catch(() => ({}));
      setShareErr(j.error || 'This link is not valid, or it has expired.');
      setLoading(false);
      return;
    }
    const j = await res.json();
    setShare({ label: j.label, expiresAt: j.expiresAt, display: j.display, date: j.date });

    setShareTabs(Array.isArray(j.tabs) ? j.tabs : []);
    setBatchId(j.batchId || null);
    setData(j.payload);
    setAuthed(true);
    setLoading(false);
  };

  const selectShareBatch = async (id) => {
    if (id === batchId) return;
    setSwitching(true);
    try {
      const r = await fetch(withBase(`/api/share/${shareToken}?batch=${encodeURIComponent(id)}`));
      if (!r.ok) return;
      const j = await r.json();
      setData(j.payload); setBatchId(j.batchId);
    } catch {  } finally { setSwitching(false); }
  };

  const boot = async () => {
    const res = await fetch(withBase('/api/data'));
    if (res.status !== 200) { setAuthed(false); return; }
    const man = await res.json();
    if (!man.dates || !man.dates.length) { setManifest(man); setAuthed(true); return; }
    let idx = 0, bid;
    try {
      const sp = new URLSearchParams(window.location.search);
      const qDate = sp.get('date');
      const qBatch = sp.get('batch_id');
      if (qDate) { const i = man.dates.findIndex((d) => d.date === qDate); if (i >= 0) idx = i; }
      if (qBatch) bid = qBatch;
    } catch {}
    if (!bid) bid = man.dates[idx].dayTotal;
    const payload = await fetch(withBase(`/api/batch?id=${encodeURIComponent(bid)}`)).then((r) => r.json());
    const me = await fetch(withBase('/api/me')).then((r) => (r.ok ? r.json() : { name: '' })).catch(() => ({ name: '' }));
    setName(me.name || '');

    setManifest(man); setDateIdx(idx); setBatchId(bid); setData(payload); setAuthed(true);
  };

  useEffect(() => {
    (async () => {
      try {
        if (shareToken) await bootShare();
        else await boot();
      } catch {
        if (shareToken) setShareErr('This link could not be opened.');
        else setAuthed(false);
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken]);

  const finishSynced = useRef(false);

  useEffect(() => {
    if (!finishSynced.current) { finishSynced.current = true; return; }
    const el = document.documentElement;
    if (theme === 'dark') el.classList.add('dark'); else el.classList.remove('dark');
    try { localStorage.setItem('cvfinish', theme); } catch {}
  }, [theme]);

  const selectBatch = async (id) => {
    if (id === batchId) return;
    setSwitching(true);
    try {
      if (id === SUMMARY_ID) {
        setBatchId(id);
        await loadSummary(manifest?.dates?.[dateIdx]?.date);
        return;
      }
      const p = await fetch(withBase(`/api/batch?id=${encodeURIComponent(id)}`)).then((r) => r.json());
      setData(p); setBatchId(id);
    } catch {
      if (id === SUMMARY_ID) setSummary({ error: 'Could not build the summary.' });
    } finally { setSwitching(false); }
  };

  const loadSummary = async (iso) => {
    if (!iso) return;
    if (summary && summary.date === iso && !summary.error) return;
    try {
      const j = await fetch(withBase(`/api/summary?date=${encodeURIComponent(iso)}`)).then((r) => r.json());
      setSummary(j.error ? { error: j.error } : j);
    } catch {
      setSummary({ error: 'Could not build the summary.' });
    }
  };
  const gotoDate = async (idx) => {
    if (!manifest || idx < 0 || idx >= manifest.dates.length) return;
    setDateIdx(idx);

    if (batchId === SUMMARY_ID) {
      setSwitching(true);
      try { await loadSummary(manifest.dates[idx].date); } finally { setSwitching(false); }
      return;
    }
    selectBatch(manifest.dates[idx].dayTotal);
  };

  const logout = async () => { try { await fetch(withBase('/api/auth')); window.location.href = withBase('/'); } catch {} };

  const [shareOpen, setShareOpen] = useState(false);
  const [shareWho, setShareWho] = useState('');
  const [shareDays, setShareDays] = useState(0);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareRes, setShareRes] = useState(null);
  const [shareErrMsg, setShareErrMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const [shareTab, setShareTab] = useState('new');
  const [links, setLinks] = useState(null);
  const [linksBusy, setLinksBusy] = useState(false);
  const [revoking, setRevoking] = useState('');
  const [copiedToken, setCopiedToken] = useState('');

  const loadLinks = async () => {
    setLinksBusy(true);
    try {
      const res = await fetch(withBase('/api/share'));
      const j = await res.json();
      setLinks(Array.isArray(j.shares) ? j.shares : []);
    } catch {
      setLinks([]);
    } finally {
      setLinksBusy(false);
    }
  };

  const doRevoke = async (token, label) => {
    const who = label ? `the link issued to "${label}"` : 'this link';
    if (!window.confirm(`Revoke ${who}?\n\nIt stops working immediately. Anyone holding it — including in an email already sent — will see "This link is no longer available". This cannot be undone; you would have to issue a new one.`)) return;
    setRevoking(token);
    try {
      const res = await fetch(withBase(`/api/share?token=${encodeURIComponent(token)}`), { method: 'DELETE' });
      if (!res.ok) throw new Error('Revoke failed');

      setLinks((prev) => (prev || []).map((l) => (l.token === token ? { ...l, revoked: true } : l)));
    } catch (e) {
      window.alert(`Could not revoke the link.\n\n${e.message}`);
    } finally {
      setRevoking('');
    }
  };

  const copyLink = async (token) => {
    const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/+$/, '') || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${base}${BASE_PATH}/r/${token}`);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(''), 2000);
    } catch {  }
  };

  const openShare = () => {
    setShareRes(null); setShareErrMsg(''); setCopied(false);
    setShareWho(''); setShareDays(0); setShareTab('new'); setLinks(null); setShareOpen(true);
  };

  const makeShare = async () => {
    if (!batchId || !manifest) return;

    if (batchId === SUMMARY_ID) {
      setShareErrMsg('The campaign summary spans every report date, so it cannot be shared as a link. Pick a specific report first — a share link is deliberately scoped to one.');
      return;
    }
    setShareBusy(true); setShareErrMsg('');
    try {
      const res = await fetch(withBase('/api/share'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          reportDate: manifest.dates[dateIdx].date,
          label: shareWho.trim(),
          days: shareDays,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.url) throw new Error(j.error || 'Could not create the link.');
      setShareRes(j);
      try { await navigator.clipboard.writeText(j.url); setCopied(true); } catch {  }
    } catch (e) {
      setShareErrMsg(e.message);
    } finally {
      setShareBusy(false);
    }
  };

  const copyShare = async () => {
    if (!shareRes) return;
    try { await navigator.clipboard.writeText(shareRes.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const printReport = () => {
    const wasDark = document.documentElement.classList.contains('dark');
    if (wasDark) document.documentElement.classList.remove('dark');

    const restore = () => {
      if (wasDark) document.documentElement.classList.add('dark');
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);

    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const [downloading, setDownloading] = useState(false);
  const downloadReport = async () => {
    if (downloading) return;
    setDownloading(true);
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const wasDark = document.documentElement.classList.contains('dark');
    if (wasDark) document.documentElement.classList.remove('dark');
    const original = batchId;
    try {
      let specs, pick;
      if (shareToken) {
        specs = (shareTabs && shareTabs.length ? shareTabs : [{ id: batchId, label: 'Report' }]).map((t) => ({ id: t.id, label: t.label }));
        pick = selectShareBatch;
      } else {
        const day = manifest?.dates?.[dateIdx];
        if (!day) { if (wasDark) document.documentElement.classList.add('dark'); setDownloading(false); return; }
        specs = [
          { id: SUMMARY_ID, label: 'Summary' },
          { id: day.dayTotal, label: 'Day Total' },
          ...day.uploads.map((u) => ({ id: u.id, label: dayLabel(u) })),
        ];
        pick = selectBatch;
      }
      const sections = [];
      for (const s of specs) {
        await pick(s.id);
        await raf();
        await new Promise((r) => setTimeout(r, 140));
        const shell = document.querySelector('.page-shell');
        if (!shell) continue;
        const clone = shell.cloneNode(true);
        clone.querySelectorAll('.no-print, .island, button, a[href], script, .no-print-explorer').forEach((e) => e.remove());
        sections.push({ label: s.label, html: clone.innerHTML });
      }
      if (!sections.length) throw new Error('Nothing rendered to export.');

      let css = '';
      for (const sheet of Array.from(document.styleSheets)) {
        try { for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n'; } catch {  }
      }
      const dateIso = shareToken ? (data?.meta?.reportDate || 'report') : manifest.dates[dateIdx].date;
      const dateLabel = data?.meta?.reportDate || dateIso;
      const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const btns = sections.map((s, i) => `<button class="xtab-btn${i === 0 ? ' on' : ''}" data-i="${i}">${esc(s.label)}</button>`).join('');
      const panes = sections.map((s, i) => `<div class="xtab${i === 0 ? ' on' : ''}" id="xtab-${i}"><div class="page-shell">${s.html}</div></div>`).join('');
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recovery Intelligence — ${esc(dateLabel)}</title>
<style>${css}</style>
<style>
 html,body{margin:0;background:var(--surface-canvas,#F2F1EC);}
 .xwrap{max-width:1440px;margin:0 auto;padding:14px 40px 60px;}
 .xhead{font:600 12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#6b7280;padding:14px 0 6px;letter-spacing:.03em;text-transform:uppercase;}
 .xhead b{color:#111;font-weight:700;}
 .xtabbar{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 20px;padding:5px;background:rgba(0,0,0,.05);border-radius:999px;width:max-content;max-width:100%;}
 .xtab-btn{border:none;cursor:pointer;border-radius:999px;padding:8px 15px;font:600 13px system-ui,-apple-system,sans-serif;color:#5b6470;background:transparent;white-space:nowrap;}
 .xtab-btn.on{background:#1d1d1f;color:#fff;}
 .xtab{display:none;} .xtab.on{display:block;}
 @media print{ .xtabbar,.xhead{display:none;} .xtab{display:block!important;} }
</style></head>
<body>
 <div class="xwrap">
  <div class="xhead">Recovery Intelligence · Convin × RBL Bank — report date <b>${esc(dateLabel)}</b> · exported ${esc(new Date().toLocaleString('en-GB'))}</div>
  <div class="xtabbar">${btns}</div>
  ${panes}
 </div>
 <script>
  (function(){
   var btns=[].slice.call(document.querySelectorAll('.xtab-btn'));
   var panes=[].slice.call(document.querySelectorAll('.xtab'));
   btns.forEach(function(b){ b.addEventListener('click',function(){
     btns.forEach(function(x){x.classList.remove('on');});
     panes.forEach(function(p){p.classList.remove('on');});
     b.classList.add('on');
     var t=document.getElementById('xtab-'+b.getAttribute('data-i')); if(t){t.classList.add('on');}
     window.scrollTo(0,0);
   });});
  })();
 </script>
</body></html>`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Recovery-Intelligence_${String(dateIso).replace(/[^\w.-]+/g, '-')}.html`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      window.alert('Could not build the download.\n\n' + (e && e.message ? e.message : String(e)));
    } finally {
      try { if (shareToken) { await selectShareBatch(original); } else { await selectBatch(original); } } catch {  }
      if (wasDark) document.documentElement.classList.add('dark');
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 46, height: 46, border: `3px solid ${AU.gold(0.16)}`, borderTopColor: AU.accent, borderRadius: 'var(--radius-capsule)', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: 15, fontWeight: 500, color: txt(.6) }}>Loading Recovery Intelligence…</div>
        </div>
      </div>
    );
  }

  if (shareToken && (shareErr || !data)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: AU.primary }}>
        <div style={{ ...GLASS, borderRadius: 28, padding: '38px 42px', textAlign: 'center', maxWidth: 460 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>This link is no longer available</div>
          <div style={{ fontSize: 13, color: txt(.55), lineHeight: 1.6 }}>
            {shareErr || 'It may have expired or been withdrawn. Ask whoever sent it for a fresh link.'}
          </div>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: AU.primary }}>
        <div style={{ ...GLASS, borderRadius: 28, padding: 34, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Session expired</div>
          <div style={{ fontSize: 13, color: txt(.55), marginBottom: 20 }}>Please sign in to view the dashboard.</div>
          <Link href="/" style={{ display: 'inline-block', padding: '12px 24px', fontSize: 15, fontWeight: 600, borderRadius: 'var(--radius-capsule)', background: AU.accent, color: AU.onAccent, textDecoration: 'none' }}>Go to sign in</Link>
        </div>
      </div>
    );
  }

  const A = data.agg, I = data.intel, t = A.totals;

  const OW = A.outcomeWindow;
  const isSummary = batchId === SUMMARY_ID;
  const kpis = [
    { label: 'Recovered Total Outstanding Amount', value: fmtCr(t.recovered), sub: `${pct(t.recoveryRatePct)} of total outstanding amount`, color: C.green },
    { label: 'Resolution Rate', value: pct(t.resolutionRatePct), sub: `${fmtInt(t.resolved)} of ${fmtInt(t.accounts)} accounts`, color: C.blue },
    { label: 'Total Outstanding Amount', value: fmtCr(t.sumOut), sub: `${fmtInt(t.accounts)} accounts`, color: C.indigo },
    { label: 'AI Calls Connected', value: fmtInt(A.ai.connected), sub: `of ${fmtInt(A.ai.attempts)} attempts`, color: C.purple },
  ];

  const dispTotal = Math.max(A.disposition.reduce((s, d) => s + (d.recovered || 0), 0), 1);

  const segments = A.segments || [];

  const durL2 = (A.durationByL2 || []).filter((d) => d.name !== '(No disposition)');

  const l2Longest = durL2.length
    ? durL2.reduce((a, b) => (b.avgSeconds > a.avgSeconds ? b : a))
    : null;

  const ptpStage = (A.funnel || []).find((f) => f.stage === 'Promise to Pay Later');
  const paidStage = (A.funnel || []).find((f) => f.stage === 'Paid');

  const ovr = A.bandOrder.map((b) => {
    const d = A.band[b] || {};
    return {
      band: b,
      outstanding: d.outstanding || 0,
      recovered: d.recovered || 0,
      pending: (d.outstanding || 0) - (d.recovered || 0),
      recoveryPct: d.outstanding ? (d.recovered || 0) / d.outstanding * 100 : 0,
      count: d.count || 0,
    };
  });

  const L2_MIN_N = 20;
  const allL2 = A.dispositionL2 || [];
  const dispL2 = allL2.filter((d) => d.total >= L2_MIN_N);
  const dispL2Small = allL2.filter((d) => d.total < L2_MIN_N).reduce(
    (acc, d) => ({ count: acc.count + d.total, recovered: acc.recovered + d.recovered, kinds: acc.kinds + 1 }),
    { count: 0, recovered: 0, kinds: 0 },
  );
  const dispL2Total = Math.max(dispL2.reduce((s, d) => s + (d.recovered || 0), 0), 1);
  const dispL2Ptp = dispL2.find((d) => d.name === 'Promise to Pay Later');
  const dispL2Paid = dispL2.find((d) => d.name === 'Paid');

  const R = A.aiReach || null;

  const CL = A.callLog?.present ? A.callLog : null;
  const hourMax = CL ? Math.max(...CL.byHour.map((h) => h.attempts), 1) : 1;
  const attMax = CL ? Math.max(...CL.byAttempt.map((a) => a.dialled), 1) : 1;

  const connColor = () => AU.secondary;

  const _cohorts = A.cohorts || [];

  const funnelGeom = (() => {
    const stages = A.funnel || [];
    if (!stages.length) return null;
    const journey = stages.filter((f) => f.kind === 'journey');
    const outcomes = stages.filter((f) => f.kind === 'outcome');
    if (!journey.length) return null;

    const BAND = 64;
    const NECK_GAP = 40;
    const OUT_TOP = 46;
    const OUT_H = 48;
    const mid = FW / 2;
    const widthOf = (v) => (stages[0].value ? (v / stages[0].value) * FW : 0);

    const jg = journey.map((f, i) => {
      const next = journey[i + 1];
      const wTop = widthOf(f.value);
      const wBot = widthOf(next ? next.value : f.value);
      const y0 = i * BAND;
      const y1 = y0 + BAND;
      const x0 = mid - wTop / 2, x1 = mid + wTop / 2;
      const b0 = mid - wBot / 2, b1 = mid + wBot / 2;
      const drop = next ? f.value - next.value : 0;
      return {
        stage: f,
        path: `M ${x0} ${y0} L ${x1} ${y0} L ${b1} ${y1} L ${b0} ${y1} Z`,
        x0, x1, y0, y1, yMid: y0 + BAND / 2,
        drop,
        dropPct: f.value ? (drop / f.value) * 100 : 0,
      };
    });

    const neckY = journey.length * BAND;
    const neckW = widthOf(journey[journey.length - 1].value);
    const outY = neckY + NECK_GAP + OUT_TOP;

    const GUT = 30;

    const outW = outcomes.map((f) => Math.max(66, widthOf(f.value)));
    const totalW = outW.reduce((s, w) => s + w, 0) + GUT * (outcomes.length - 1);

    const outX = outW.map((_, i) => (mid - totalW / 2) + outW.slice(0, i).reduce((a, w) => a + w + GUT, 0));
    const og = outcomes.map((f, i) => {
      const w = outW[i];
      const x = outX[i];
      const cx = x + w / 2;

      const link = `M ${mid} ${neckY} C ${mid} ${neckY + NECK_GAP * 0.7}, ${cx} ${outY - NECK_GAP * 0.7}, ${cx} ${outY}`;

      const words = f.stage.toUpperCase().split(' ');
      const label = words.length <= 2
        ? [words.join(' ')]
        : [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
      return { stage: f, x, y: outY, w, h: OUT_H, link, label, good: f.resolutionPct >= t.resolutionRatePct };
    });

    const LABEL_CH = 5.8;
    const SIDE_CALLOUT = 62;
    let minX = Math.min(...jg.map((g) => g.x0)) - 14 - SIDE_CALLOUT;
    let maxX = Math.max(...jg.map((g) => g.x1)) + 14 + SIDE_CALLOUT;
    for (const o of og) {
      const labelW = Math.max(...o.label.map((l) => l.length)) * LABEL_CH;
      const overhang = Math.max(0, (labelW - o.w) / 2);
      minX = Math.min(minX, o.x - overhang - 8);
      maxX = Math.max(maxX, o.x + o.w + overhang + 8);
    }

    return {
      journey: jg,
      outcomes: og,
      neck: { x0: mid - neckW / 2, x1: mid + neckW / 2, y: neckY },
      height: outY + OUT_H + 44,
      viewBox: `${minX} -6 ${maxX - minX} ${outY + OUT_H + 54}`,
    };
  })();

  const regionOrder = Object.keys(A.region).sort((a, b) => A.region[b].outstanding - A.region[a].outstanding);
  const stateTop = A.state.slice(0, 8);

  const hasBucketCol = !!data.meta?.hasBucketColumn;
  const bucketOrder = Object.keys(A.cycleBucket || {}).sort((a, b) => {
    if (a === 'Unspecified') return 1;
    if (b === 'Unspecified') return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const bucketAllBlank = hasBucketCol && bucketOrder.length > 0
    && bucketOrder.every((k) => k === 'Unspecified');
  const languageOrder = Object.keys(A.language || {}).sort((a, b) => (A.language[b].count - A.language[a].count));

  const languageAllOther = languageOrder.length > 0
    && languageOrder.every((k) => k === 'Others' || k === 'Unspecified');
  const bucketRegionRows = (A.bucketRegion || []).filter((x) => x.count > 0).slice(0, 12);

  const outcomeLine = (g) => {
    const o = g?.outcomes || {};
    const parts = (A.outcomeOrder || []).concat(Object.keys(o).filter((k) => !(A.outcomeOrder || []).includes(k)))
      .filter((k) => o[k])
      .map((k) => `${fmtInt(o[k])} ${k}`);
    return parts.length > 1 ? parts.join(' · ') : null;
  };

  const durColor = (p) => (p >= t.resolutionRatePct ? AU.nominal : AU.tertiary);

  return (
    <div style={{ minHeight: '100vh', color: AU.primary, paddingBottom: 90 }}>

      {}
      {shareOpen && !shareToken && (
        <div className="no-print" onClick={() => setShareOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 200, background: AU.scrim,
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            ...GLASS, borderRadius: 28, padding: '28px 30px', width: 'min(560px, 100%)',
            animation: 'fadeUp .35s cubic-bezier(.32,.72,0,1) both',
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', marginBottom: 14 }}>
              Share this report
            </div>

            {}
            <div style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 12, background: ink(.05), marginBottom: 18 }}>
              {[
                { id: 'new', label: 'New link' },
                { id: 'manage', label: 'Manage links' },
              ].map((tb) => (
                <button key={tb.id} onClick={() => { setShareTab(tb.id); if (tb.id === 'manage' && links === null) loadLinks(); }}
                  style={{
                    flex: 1, padding: '9px 12px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600,
                    background: shareTab === tb.id ? AU.raised : 'transparent',
                    color: shareTab === tb.id ? AU.primary : ink(.5),
                    boxShadow: shareTab === tb.id ? 'var(--e1)' : 'none',
                  }}>
                  {tb.label}
                  {tb.id === 'manage' && links && links.filter((l) => !l.revoked).length > 0 && (
                    <span style={{
                      marginLeft: 7, fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--radius-capsule)',
                      background: AU.good(0.16), color: AU.nominal,
                    }}>{links.filter((l) => !l.revoked).length}</span>
                  )}
                </button>
              ))}
            </div>

            {shareTab === 'manage' ? (
              <ManageLinks
                links={links}
                busy={linksBusy}
                revoking={revoking}
                copiedToken={copiedToken}
                onRevoke={doRevoke}
                onCopy={copyLink}
                onRefresh={loadLinks}
                onClose={() => setShareOpen(false)}
              />
            ) : !shareRes ? (
              <>
                {}
                <div style={{ fontSize: 13, color: txt(.55), lineHeight: 1.6, marginBottom: 18 }}>
                  A private, read-only link to <b style={{ color: txt(.8) }}>{data.meta.reportDate}</b> — the whole date:{' '}
                  <b style={{ color: txt(.8) }}>Day Total and every Day</b> filed under it. No login, no password —
                  whoever holds the URL can open it. The report carries{' '}
                  <b style={{ color: txt(.8) }}>no customer names, mobile numbers or account numbers</b> anywhere — there is
                  no per-customer table left in the product at all — so a leaked link is an embarrassment rather than a
                  personal-data disclosure. They cannot reach any other date and cannot upload. Revoke it anyway when it has
                  done its job.
                </div>
                <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.45) }}>
                  Who is it for?
                </label>
                <input
                  autoFocus
                  value={shareWho}
                  onChange={(e) => setShareWho(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !shareBusy) makeShare(); }}
                  placeholder="e.g. Convin COO, or RBL Collections Head"
                  style={{
                    width: '100%', marginTop: 8, padding: '12px 14px', borderRadius: 12, fontSize: 15,
                    border: `1px solid ${ink(.12)}`, background: 'transparent', color: AU.primary, outline: 'none',
                  }}
                />
                <div style={{ fontSize: 12, color: txt(.42), marginTop: 7, lineHeight: 1.5 }}>
                  Printed at the foot of the report, so a screenshot that leaks is traceable to them.
                </div>

                <div style={{ marginTop: 18 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.45) }}>
                    Expires
                  </label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {[
                      { d: 0, l: 'Never' },
                      { d: 7, l: '7 days' },
                      { d: 30, l: '30 days' },
                      { d: 90, l: '90 days' },
                    ].map((o) => (
                      <button key={o.d} onClick={() => setShareDays(o.d)} style={{
                        flex: 1, padding: '9px 6px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        border: `1px solid ${shareDays === o.d ? AU.accent : ink(.12)}`,
                        background: shareDays === o.d ? AU.gold(0.12) : 'transparent',
                        color: shareDays === o.d ? AU.accent : ink(.6),
                      }}>{o.l}</button>
                    ))}
                  </div>
                  {shareDays === 0 && (
                    <div style={{ fontSize: 12, color: txt(.42), marginTop: 7, lineHeight: 1.5 }}>
                      {}
                      Works until you revoke it. Since it carries real customer names, revoke it when it is done.
                    </div>
                  )}
                </div>

                {shareErrMsg && (
                  <div style={{ marginTop: 14, fontSize: 13, color: AU.abort }}>{shareErrMsg}</div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                  <button onClick={makeShare} disabled={shareBusy} style={{
                    flex: 1, padding: '12px 18px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: shareBusy ? 'default' : 'pointer',
                    background: AU.accent, color: AU.onAccent, fontSize: 15, fontWeight: 600, opacity: shareBusy ? 0.6 : 1,
                  }}>
                    {shareBusy ? 'Creating…' : 'Create link'}
                  </button>
                  <button onClick={() => setShareOpen(false)} style={{
                    padding: '12px 18px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
                    background: ink(.07), color: AU.primary, fontSize: 15, fontWeight: 600,
                  }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {}
                {shareRes.source === 'local' && (
                  <div style={{
                    marginBottom: 16, padding: '13px 15px', borderRadius: 16,
                    border: `1px solid ${AU.bad(0.35)}`, background: AU.bad(0.03),
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: AU.abort, marginBottom: 4 }}>
                      This link only works on this Mac
                    </div>
                    <div style={{ fontSize: 13, color: txt(.72), lineHeight: 1.6 }}>
                      There is no public address to build it from, so it points at <code>localhost</code>. Send it and
                      they will see nothing. Stop <code>npm run dev</code> and start it again — it brings up a free
                      Cloudflare tunnel and the next link will be public. (Needs <code>brew install cloudflared</code>, once.)
                    </div>
                  </div>
                )}

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderRadius: 16,
                  background: ink(.04), border: `1px solid ${ink(.09)}`,
                }}>
                  <code style={{
                    flex: 1, fontSize: 13, color: txt(.85), wordBreak: 'break-all', lineHeight: 1.5,
                  }}>{shareRes.url}</code>
                  <button onClick={copyShare} style={{
                    flex: 'none', padding: '9px 16px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
                    background: copied ? AU.good(0.16) : AU.accent,
                    color: copied ? AU.nominal : AU.onAccent, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                  }}>
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>

                <div style={{ fontSize: 13, color: txt(.5), marginTop: 14, lineHeight: 1.65 }}>
                  {shareRes.expiresAt ? (
                    <>Expires <b style={{ color: txt(.75) }}>
                      {new Date(shareRes.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                    </b></>
                  ) : (
                    <><b style={{ color: txt(.75) }}>No expiry</b> — works until revoked</>
                  )}
                  {shareRes.label ? <> · issued to <b style={{ color: txt(.75) }}>{shareRes.label}</b></> : null}
                  {shareRes.source === 'tunnel' && (
                    <div style={{ marginTop: 8, color: AU.caution }}>
                      {}
                      This address is a tunnel to <b>this Mac</b>. It stops working the moment you
                      quit <code>npm run dev</code> or close the laptop — no matter what the expiry says.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                  <button onClick={() => setShareRes(null)} style={{
                    padding: '11px 18px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
                    background: ink(.07), color: AU.primary, fontSize: 13, fontWeight: 600,
                  }}>
                    Another link
                  </button>
                  <button onClick={() => setShareOpen(false)} style={{
                    flex: 1, padding: '11px 18px', borderRadius: 'var(--radius-capsule)', border: 'none', cursor: 'pointer',
                    background: AU.accent, color: AU.onAccent, fontSize: 13, fontWeight: 600,
                  }}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {}
      {shareToken && share && (
        <div className="island no-print" style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', borderRadius: 'var(--radius-capsule)', ...GLASS,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-capsule)', background: C.green, boxShadow: `0 0 10px ${C.green}` }} />
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Shared report — read only</span>
          {share.label && (
            <span style={{ fontSize: 12, color: txt(.5), whiteSpace: 'nowrap' }}>· for {share.label}</span>
          )}
          {share.expiresAt && (
            <span style={{ fontSize: 12, color: txt(.5), whiteSpace: 'nowrap' }}>
              · expires {new Date(share.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      )}

      {}
      {!shareToken && (
      <div className="island" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px 7px 10px', borderRadius: 'var(--radius-capsule)', ...GLASS }}>
        <div style={{ width: 30, height: 30, borderRadius: 'var(--radius-capsule)', background: 'var(--metal-aurum)', boxShadow: 'var(--e2)', flex: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.18, marginRight: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{name ? `Hi, ${name}` : 'Recovery Intelligence'}</div>
          <div style={{ fontSize: 11, color: txt(.5), whiteSpace: 'nowrap' }}>Convin × RBL · {data.meta.reportDate}</div>
        </div>
        <span style={{ width: 1, height: 20, background: ink(.12), flex: 'none' }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: txt(.55), whiteSpace: 'nowrap', padding: '0 4px' }}>
          <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-capsule)', background: AU.nominal, animation: 'pulseDot 2s ease-in-out infinite' }} />Live
        </span>
        <Link href="/" title="Home" className="pill" style={{ fontSize: 12, fontWeight: 600, color: AU.primary, textDecoration: 'none', padding: '7px 14px', background: ink(.07), whiteSpace: 'nowrap' }}>Home</Link>
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle light / dark" aria-label="Toggle theme" className="pill" style={{ background: ink(.07), color: AU.primary, fontSize: 13, padding: '7px 12px', lineHeight: 1 }} suppressHydrationWarning>{theme === 'dark' ? '☀' : '☾'}</button>
        {}
        <button onClick={printReport} title="Open the print preview and Save as PDF (landscape, one card per row — nothing is cut)" aria-label="Save report as PDF" className="pill"
          style={{ background: ink(.07), color: AU.primary, fontSize: 12, fontWeight: 600, padding: '7px 14px', whiteSpace: 'nowrap' }}>
          Save as PDF
        </button>
        <button onClick={openShare} title="Create a private read-only link to this report" className="pill"
          style={{ background: ink(.07), color: AU.primary, fontSize: 12, fontWeight: 600, padding: '7px 14px', whiteSpace: 'nowrap' }}>
          Share
        </button>
        {}
        <button onClick={downloadReport} disabled={downloading} title="Download this date's full report (all days) as a self-contained .html file" aria-label="Download report as HTML" className="pill"
          style={{ background: ink(.07), color: AU.primary, fontSize: 12, fontWeight: 600, padding: '7px 14px', whiteSpace: 'nowrap', opacity: downloading ? 0.6 : 1, cursor: downloading ? 'default' : 'pointer' }}>
          {downloading ? 'Preparing…' : 'Download'}
        </button>
        <button onClick={logout} className="pill" style={{ background: 'transparent', color: AU.tertiary, fontSize: 12, fontWeight: 600, padding: '7px 14px' }}>Log out</button>
      </div>
      )}

      <div style={{ height: 84 }} />

      <div className="page-shell" style={{ maxWidth: 1440, margin: '0 auto', padding: '0 40px' }}>
        {}
        {!shareToken && manifest && manifest.dates && manifest.dates.length > 0 && (() => {
          const day = manifest.dates[dateIdx];

          const tabs = [

            { id: SUMMARY_ID, label: 'Summary', meta: `${day.uploads.length} day${day.uploads.length === 1 ? '' : 's'}` },
            { id: day.dayTotal, label: 'Day Total', meta: `${fmtInt(day.rowCount)} accounts` },
            ...day.uploads.map((u) => ({ id: u.id, label: dayLabel(u), meta: u.time || `${fmtInt(u.rowCount)} rows` }))];
          return (
            <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 2px', animation: 'fadeUp .6s cubic-bezier(.32,.72,0,1) both' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...GLASS, borderRadius: 'var(--radius-capsule)', padding: '7px 10px 7px 16px' }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: txt(.45), marginRight: 2 }}>Report date</span>
                <button aria-label="Older date" onClick={() => gotoDate(dateIdx + 1)} disabled={dateIdx >= manifest.dates.length - 1} style={arrowBtn(dateIdx >= manifest.dates.length - 1)}>‹</button>
                <span style={{ fontSize: 15, fontWeight: 600, minWidth: 118, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{day.display}</span>
                <button aria-label="Newer date" onClick={() => gotoDate(dateIdx - 1)} disabled={dateIdx <= 0} style={arrowBtn(dateIdx <= 0)}>›</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, ...GLASS, borderRadius: 'var(--radius-capsule)', padding: 5, opacity: switching ? 0.55 : 1, transition: 'opacity var(--dur-medium) var(--ease-glide)' }}>
                {tabs.map((tb) => {
                  const on = tb.id === batchId;
                  return (
                    <button key={tb.id} onClick={() => selectBatch(tb.id)} style={{ border: 'none', cursor: on ? 'default' : 'pointer', borderRadius: 'var(--radius-capsule)', padding: '8px 15px', fontSize: 13, fontWeight: 600, color: on ? AU.canvas : AU.tertiary, background: on ? AU.primary : 'transparent', transition: 'background-color var(--dur-medium) var(--ease-glide), color var(--dur-medium) var(--ease-glide)', whiteSpace: 'nowrap' }}>
                      {tb.label}<span style={{ fontWeight: 500, opacity: on ? 0.8 : 0.55, marginLeft: 7, fontSize: 12 }}>{tb.meta}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {}
        {shareToken && shareTabs.length > 1 && (
          <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 2px', animation: 'fadeUp .6s cubic-bezier(.32,.72,0,1) both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...GLASS, borderRadius: 'var(--radius-capsule)', padding: '9px 18px' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: txt(.45) }}>Report date</span>
              <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{share?.display || data.meta.reportDate}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, ...GLASS, borderRadius: 'var(--radius-capsule)', padding: 5, opacity: switching ? 0.55 : 1, transition: 'opacity var(--dur-medium) var(--ease-glide)' }}>
              {shareTabs.map((tb) => {
                const on = tb.id === batchId;
                return (
                  <button key={tb.id} onClick={() => selectShareBatch(tb.id)} style={{ border: 'none', cursor: on ? 'default' : 'pointer', borderRadius: 'var(--radius-capsule)', padding: '8px 15px', fontSize: 13, fontWeight: 600, color: on ? AU.canvas : AU.tertiary, background: on ? AU.primary : 'transparent', transition: 'background-color var(--dur-medium) var(--ease-glide), color var(--dur-medium) var(--ease-glide)', whiteSpace: 'nowrap' }}>
                    {tb.label}
                    {tb.meta && <span style={{ fontWeight: 500, opacity: on ? 0.8 : 0.55, marginLeft: 7, fontSize: 12 }}>{tb.meta}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {}
        {isSummary ? <SummaryView s={summary} /> : (<>

        {}
        <div className="print-only print-cover" style={{ display: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottom: `3px solid ${AU.primary}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: AU.accent }}>
              AI Collections Performance
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: AU.abort, border: `1px solid ${AU.abort}`, borderRadius: 'var(--radius-capsule)', padding: '3px 9px' }}>
              Confidential
            </div>
          </div>

          <h1 style={{ fontSize: 34, lineHeight: 1.08, fontWeight: 700, letterSpacing: '-.028em', margin: '26px 0 6px', color: AU.primary }}>
            Recovery Intelligence
          </h1>
          <div style={{ fontSize: 17, color: AU.tertiary, fontWeight: 500, marginBottom: data.meta.cycFile ? 8 : 30 }}>
            RBL Bank &nbsp;·&nbsp; prepared by Convin &nbsp;·&nbsp; {data.meta.reportDate}
          </div>
          {}
          {data.meta.cycFile && (
            <div style={{ fontSize: 14.5, color: AU.tertiary, marginBottom: 30, fontVariantNumeric: 'tabular-nums' }}>
              Source book: <span style={{ color: AU.secondary, fontWeight: 600 }}>{data.meta.cycFile}</span>
            </div>
          )}

          {}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 26 }}>
            {[
              { l: 'Recovered Total Outstanding Amount', v: fmtCr(t.recovered), s: `${pct(t.recoveryRatePct, 1)} of total outstanding amount`, c: AU.nominal },
              { l: 'Accounts resolved', v: fmtInt(t.resolved), s: `${pct(t.resolutionRatePct, 1)} of all accounts`, c: AU.accent },
              { l: 'Total Accounts', v: fmtInt(t.accounts), s: fmtCr(t.sumOut) + ' outstanding', c: AU.secondary },
              { l: 'Still open', v: fmtCr(t.outstandingPending), s: `${fmtInt(t.unresolved)} accounts`, c: AU.tertiary },
            ].map((k, i) => (
              <div key={i} style={{ border: `1px solid ${AU.hairline}`, borderRadius: 12, padding: '13px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: AU.tertiary, marginBottom: 6 }}>{k.l}</div>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: k.c, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                <div style={{ fontSize: 11, color: AU.tertiary, marginTop: 3 }}>{k.s}</div>
              </div>
            ))}
          </div>

          <div className="cover-provenance" style={{ border: `1px solid ${AU.hairline}`, borderLeft: `3px solid ${AU.accent}`, borderRadius: 'var(--radius-capsule)', padding: '15px 17px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: AU.tertiary, marginBottom: 8 }}>
              Where these numbers came from
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.65, color: AU.secondary }}>
              Every account in RBL&apos;s CYC file is included — <b>including the ones the AI never reached</b> — so the
              base is the bank&apos;s, not ours. <b>The outcome (Resolved / Unresolved) comes only from RBL&apos;s own
              status file</b>; Convin&apos;s export does not contain it, by design — we don&apos;t mark our own homework.
              Call activity, dispositions, timings and talk time come from Convin&apos;s AI call log — one row per call
              attempt — rolled up per account and joined on Account No. Nothing here is estimated unless it is labelled
              an assumption, and anything that couldn&apos;t be measured is listed as such, not filled in.
              {' '}<b>No customer name or phone number appears anywhere in this document.</b>
            </div>

          </div>

          <div className="cover-strip" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: AU.tertiary, borderTop: `1px solid ${AU.hairline}`, paddingTop: 10 }}>
            <span>{fmtInt(t.accounts)} accounts &nbsp;·&nbsp; {fmtInt(A.ai.attempts)} call attempts &nbsp;·&nbsp; {fmtInt(Math.round(A.ai.talkMinutes))} talk-minutes</span>
            <span>Generated {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>

        {}
        <div className="print-footer" style={{ display: 'none' }}>
          <span>Recovery Intelligence · RBL Bank · {data.meta.reportDate}</span>
          <span>Outcome sourced from RBL&apos;s status file · Prepared by Convin · Confidential</span>
        </div>

        {}
        <div className="hero" style={{ padding: '52px 0 36px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.12em', color: C.blue, textTransform: 'uppercase', marginBottom: 14, animation: 'fadeUp .7s cubic-bezier(.32,.72,0,1) both' }}>AI Collections Performance</div>
          {}
          {}
          <h1 className="u-rise" style={{ margin: '0 0 16px', maxWidth: 900, animationDelay: '.05s' }}>
            <Metal size="display2">{fmtCr(t.recovered)} recovered.</Metal>
            <span style={{ ...T.display2, color: AU.tertiary, display: 'block' }}>And every reason why.</span>
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.5, color: txt(.6), maxWidth: 680, margin: 0, animation: 'fadeUp .8s cubic-bezier(.32,.72,0,1) both .1s' }}>
            Convin&apos;s AI worked {fmtInt(t.accounts)} RBL accounts holding {fmtCr(t.sumOut)} in outstanding — resolving {fmtInt(t.resolved)} of them ({pct(t.resolutionRatePct)}) across {fmtInt(A.ai.attempts)} calls.
          </p>
          {}
          {data.meta.cycFile && (
            <div style={{ fontSize: 15.5, color: txt(.5), marginTop: 16, animation: 'fadeUp .8s cubic-bezier(.32,.72,0,1) both .15s' }}>
              Source book: <span style={{ color: txt(.75), fontWeight: 600 }}>{data.meta.cycFile}</span>
            </div>
          )}
        </div>

        {}
        {data.version !== PAYLOAD_VERSION && (() => {
          const stored = data.version ?? 1;
          const appBehind = stored > PAYLOAD_VERSION;
          return (
            <div style={{
              ...GLASS, borderRadius: 16, padding: '16px 20px', marginBottom: 16,
              border: `1px solid ${AU.warn(0.42)}`, background: AU.warn(0.09),
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: AU.caution, marginBottom: 4 }}>
                {appBehind
                  ? 'You are running an older version of the app than the data'
                  : 'This report was computed by an older version of the analysis engine'}
              </div>
              <div style={{ fontSize: 13, color: txt(.72), lineHeight: 1.6 }}>
                The stored report is schema <b>v{stored}</b>; the app you are running is <b>v{PAYLOAD_VERSION}</b>.{' '}
                {appBehind ? (
                  <>
                    The data has been rebuilt but this browser is still running old code — a deploy that
                    has not landed yet, or a cached bundle. Sections and wording added since v{PAYLOAD_VERSION} will{' '}
                    <b>not appear</b>, however many times you rebuild. Check the deploy finished, then{' '}
                    <b>hard-refresh</b> (<code style={{ background: ink(.08), padding: '2px 7px', borderRadius: 'var(--radius-capsule)', fontSize: 13 }}>Cmd/Ctrl + Shift + R</code>).
                  </>
                ) : (
                  <>
                    Sections added since then are <b>not on this page</b> — they are missing, not empty. Regenerate
                    every stored report from its saved rows with{' '}
                    <code style={{ background: ink(.08), padding: '2px 7px', borderRadius: 'var(--radius-capsule)', fontSize: 13 }}>npm run rebuild</code>
                    {' '}and reload. Nothing is re-uploaded and no numbers change.
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {}

        {}
        {data.quality && (data.quality.unknownBands?.length > 0 || data.quality.dirtyAttemptRows > 0) && (
          <div style={{ ...GLASS, borderRadius: 16, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 11, borderColor: AU.warn(0.30) }}>
            <span style={{ width: 7, height: 7, borderRadius: 'var(--radius-capsule)', background: C.orange, marginTop: 6, flex: 'none' }} />
            <div style={{ fontSize: 13, color: txt(.62), lineHeight: 1.55 }}>
              <strong style={{ color: AU.primary, fontWeight: 600 }}>A note on this export.</strong>{' '}
              {data.quality.unknownBands?.length > 0 && (
                <>We found {data.quality.unknownBands.length === 1 ? 'a balance band' : 'balance bands'} we don&apos;t recognise
                  {' '}({data.quality.unknownBands.join(', ')}).{' '}
                  {data.quality.unknownBands.length === 1 ? 'It is' : 'They are'} charted as-is rather than dropped,
                  so every account is still accounted for.{' '}</>
              )}
              {data.quality.dirtyAttemptRows > 0 && (
                <>{fmtInt(data.quality.dirtyAttemptRows)} {data.quality.dirtyAttemptRows === 1 ? 'account records a connected call' : 'accounts record connected calls'} with
                  zero logged attempts — likely a dialler-export quirk. We&apos;ve counted {data.quality.dirtyAttemptRows === 1 ? 'it' : 'them'} as attempted so the funnel stays honest.</>
              )}
            </div>
          </div>
        )}

        {}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${kpis.length},1fr)`, gap: 16, marginBottom: 16 }}>
          {kpis.map((k, i) => (
            <div className="hover-kpi" key={i} style={{ ...GLASS, borderRadius: 20, padding: '22px 20px', animation: 'fadeUp .7s cubic-bezier(.32,.72,0,1) both' }}>

              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.5), marginBottom: 8 }}>{k.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', marginBottom: 6 }}>{k.value}</div>
              <div style={{ fontSize: 13, color: txt(.48) }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={6}>
            <Title t="Overall portfolio summary" s="The accounts RBL gave us, before any calling started" />
            {[
              { l: 'Total accounts', v: fmtInt(t.accounts), c: C.blue },
              { l: 'Total outstanding', v: fmtCr(t.sumOut), c: C.indigo },
              { l: 'Total minimum due', v: fmtCr(t.sumMinDue), c: C.teal },
              { l: 'Balance bands in the accounts', v: fmtInt(A.bandOrder.length), c: C.cyan },

              { l: 'States covered', v: fmtInt(A.totals.statesCovered ?? A.state.filter((s) => s.state !== 'Unspecified').length), c: C.orange },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderTop: i ? `1px solid ${ink(.07)}` : 'none' }}>
                <span style={{ fontSize: 13, color: txt(.65) }}>{r.l}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: r.c, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
              </div>
            ))}
          </Card>

          <Card span={6}>
            <Title t="Resolution summary" s="Resolved vs still open — the outcome comes from RBL's status file, not ours" />
            <div style={{ display: 'flex', height: 8, borderRadius: 'var(--radius-capsule)', overflow: 'hidden', margin: '4px 0 20px', background: AU.quiet }}>
              <div style={{ width: `${t.resolutionRatePct}%`, background: AU.nominal }} />
            </div>
            {[
              { l: 'Resolved accounts', v: fmtInt(t.resolved), s: pct(t.resolutionRatePct, 1) + ' of all accounts', c: C.green },
              { l: 'Unresolved accounts', v: fmtInt(t.unresolved), s: pct(100 - t.resolutionRatePct, 1) + ' still open', c: AU.primary },
              { l: 'Value recovered', v: fmtCr(t.recovered), s: pct(t.recoveryRatePct, 1) + ' of outstanding', c: C.green },
              { l: 'Value still outstanding', v: fmtCr(t.outstandingPending), s: 'the working opportunity', c: C.orange },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i ? `1px solid ${ink(.07)}` : 'none' }}>
                <div>
                  <div style={{ fontSize: 13, color: txt(.7) }}>{r.l}</div>
                  <div style={{ fontSize: 12, color: txt(.42) }}>{r.s}</div>
                </div>
                <span style={{ fontSize: 16, fontWeight: 700, color: r.c, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
              </div>
            ))}
          </Card>
        </div>

        {}
        {R && (
          <Card span={12} style={{ marginBottom: 16 }}>
            <Title t="AI connection rate — accounts reached vs total accounts" s="How many of RBL's accounts the AI actually reached — measured per account, not per dial" />
            <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr 300px', gap: 26, alignItems: 'center' }}>

              {}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <svg viewBox="0 0 120 120" style={{ width: 168, height: 168 }}>
                  <circle cx="60" cy="60" r="52" fill="none" stroke={ink(.09)} strokeWidth="13" />
                  <circle
                    cx="60" cy="60" r="52" fill="none" stroke={C.green} strokeWidth="13" strokeLinecap="round"
                    strokeDasharray={`${(R.connectionRatePct / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
                    transform="rotate(-90 60 60)"
                    style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.32,.72,0,1)' }}
                  />
                  <text x="60" y="70" textAnchor="middle" fontSize="28" fontWeight="700" fill="currentColor" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {R.connectionRatePct.toFixed(1)}%
                  </text>
                </svg>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.5), textAlign: 'center', marginTop: 6 }}>
                  AI connection rate
                </div>
                <div style={{ fontSize: 12, color: txt(.45), textAlign: 'center', marginTop: 3 }}>
                  connected accounts ÷ total accounts
                </div>
              </div>

              {}
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: txt(.7) }}>Total accounts</span>
                    <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(R.totalLeads)}</span>
                  </div>
                  <div style={{ height: 22, borderRadius: 12, background: ink(.09) }} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    {}
                    <span style={{ fontSize: 13, color: txt(.7) }}>Connected accounts <span style={{ color: txt(.42) }}>— the call was answered</span></span>
                    <span style={{ fontSize: 22, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtInt(R.leadsConnected)} <span style={{ fontSize: 13, color: txt(.45), fontWeight: 500 }}>· {pct(R.connectionRatePct, 1)}</span>
                    </span>
                  </div>
                  <div style={{ height: 22, borderRadius: 12, background: ink(.09), overflow: 'hidden' }}>
                    <div style={{ width: `${R.connectionRatePct}%`, height: '100%', borderRadius: 12, background: AU.nominal }} />
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: txt(.7) }}>Never reached <span style={{ color: txt(.42) }}>— dialled, never answered</span></span>
                    <span style={{ fontSize: 22, fontWeight: 700, color: txt(.55), fontVariantNumeric: 'tabular-nums' }}>
                      {fmtInt(R.leadsNotConnected)} <span style={{ fontSize: 13, color: txt(.45), fontWeight: 500 }}>· {pct(100 - R.connectionRatePct, 1)}</span>
                    </span>
                  </div>
                  <div style={{ height: 22, borderRadius: 12, background: ink(.09), overflow: 'hidden' }}>
                    <div style={{ width: `${100 - R.connectionRatePct}%`, height: '100%', borderRadius: 12, background: ink(.22) }} />
                  </div>
                </div>
                {R.neverAttempted > 0 && (
                  <div style={{ fontSize: 12, color: AU.caution, marginTop: 12 }}>
                    {fmtInt(R.neverAttempted)} accounts were never dialled at all — they are inside &quot;never reached&quot;.
                  </div>
                )}
              </div>

              {}
              <div style={{ padding: '16px 18px', borderRadius: 16, background: 'transparent', border: `1px solid ${ink(.06)}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: txt(.45), marginBottom: 12 }}>
                  Per dial, not per account
                </div>
                {[
                  { l: 'Total dial attempts', v: fmtInt(R.callAttempts) },
                  { l: 'Calls connected', v: fmtInt(R.callsConnected) },
                  { l: 'Call connect rate', v: pct(R.callConnectRatePct, 1), hi: true },
                  { l: 'Avg attempts per account', v: R.avgAttemptsPerLead.toFixed(1) },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: i ? `1px solid ${ink(.07)}` : 'none' }}>
                    <span style={{ fontSize: 13, color: txt(.62) }}>{r.l}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: r.hi ? C.blue : ink(.85), fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: txt(.42), marginTop: 10, lineHeight: 1.5 }}>
                  This counts every dial; accounts that never pick up are dialled many times, so this figure ({pct(R.callConnectRatePct, 1)}) is lower than the per-account one ({pct(R.connectionRatePct, 1)}).
                </div>
              </div>
            </div>

            {}
            <div style={{
              marginTop: 20, padding: '16px 18px', borderRadius: 16,
              background: AU.good(0.07), border: `1px solid ${AU.good(0.22)}`,
              display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>Reached by the AI</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: AU.nominal, fontVariantNumeric: 'tabular-nums' }}>{pct(R.resolutionConnectedPct, 1)}</div>
                <div style={{ fontSize: 12, color: txt(.45) }}>{fmtInt(R.resolvedConnected)} of {fmtInt(R.leadsConnected)} resolved</div>
              </div>
              <div style={{ fontSize: 17, color: AU.tertiary }}>vs</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>Never reached</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: txt(.55), fontVariantNumeric: 'tabular-nums' }}>{pct(R.resolutionNotConnectedPct, 1)}</div>
                <div style={{ fontSize: 12, color: txt(.45) }}>{fmtInt(R.resolvedNotConnected)} of {fmtInt(R.leadsNotConnected)} resolved</div>
              </div>
              <div style={{ flex: 1, minWidth: 320, fontSize: 13, color: txt(.72), lineHeight: 1.6 }}>
                An account the AI actually reached resolves{' '}
                <b style={{ color: AU.nominal }}>{(R.resolutionConnectedPct - R.resolutionNotConnectedPct).toFixed(1)} points higher</b>{' '}
                than one it never got hold of.{' '}
                {}
                <span style={{ color: txt(.5) }}>
                  These groups were not randomly assigned, so treat this as the measured gap between
                  reached and unreached customers, not as proof the call caused the payment.
                </span>
              </div>
            </div>
          </Card>
        )}

        {}
        {CL && (
          <Card span={12} style={{ marginBottom: 16 }}>
            {}
            <Title
              t="Attempt % and Contact % — the two rates, and their denominators"
              s={`Per dial vs per account — two different rates, ${Math.abs(CL.rates.contactPct - CL.rates.attemptPct).toFixed(1)} points apart on these accounts.`}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16, marginBottom: 20 }}>
              {[
                {
                  l: 'Attempt % (per dial)', v: pct(CL.rates.attemptPct, 1), c: C.teal,
                  d: `${fmtInt(CL.rates.attemptNumerator)} answered calls ÷ ${fmtInt(CL.rates.attemptDenominator)} dial attempts`,
                  n: 'How the dialler performs. One customer who never answers is dialled twenty times and drags this down twenty times.',
                },
                {
                  l: 'Contact % (per account)', v: pct(CL.rates.contactPct, 1), c: C.green,
                  d: `${fmtInt(CL.rates.contactNumerator)} accounts reached ÷ ${fmtInt(CL.rates.contactDenominator)} total accounts`,
                  n: "How many of RBL's accounts we got hold of at all. This is the one an exec means.",
                },
                {
                  l: 'Contact % — human only', v: pct(CL.rates.humanContactPct, 1), c: C.blue,
                  d: `${fmtInt(CL.rates.humanReached)} accounts where a person answered at least once`,
                  n: `${fmtInt(CL.rates.voicemailCalls)} of the ${fmtInt(CL.rates.attemptNumerator)} answered calls (${pct(CL.rates.voicemailPctOfConnected, 1)}) were voicemail — answered, and not a conversation.`,
                },
              ].map((k, i) => (
                <div key={i} style={{ padding: '16px 18px', borderRadius: 16, background: 'transparent', border: `1px solid ${ink(.06)}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.5), marginBottom: 8 }}>{k.l}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', color: k.c, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                  <div style={{ fontSize: 12, color: txt(.62), marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{k.d}</div>
                  <div style={{ fontSize: 12, color: txt(.45), marginTop: 8, lineHeight: 1.55 }}>{k.n}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 20 }}>
              {[
                { l: 'Dial attempts', v: fmtInt(CL.intensity.attempts) },
                { l: 'Avg attempts / account', v: CL.intensity.avgAttemptsPerBookAccount.toFixed(1), hi: true },
                { l: 'Avg connects / account', v: CL.intensity.avgConnectedPerBookAccount.toFixed(1) },
                { l: 'Dials per answered call', v: CL.intensity.dialsPerConnectedCall.toFixed(1), hi: true },
                { l: 'Dials per account reached', v: CL.intensity.dialsPerReachedAccount.toFixed(1) },
                { l: 'Most attempts on one account', v: fmtInt(CL.maxAttempt) },
                { l: 'Talk-minutes (human)', v: fmtInt(CL.rates.humanTalkMinutes) },
              ].map((m, i) => (
                <div key={i} style={{ padding: '11px 13px', borderRadius: 12, background: 'transparent', border: `1px solid ${ink(.06)}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>{m.l}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, color: m.hi ? C.blue : AU.primary, fontVariantNumeric: 'tabular-nums' }}>{m.v}</div>
                </div>
              ))}
            </div>

            {}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 26 }}>
              {[
                { title: 'How hard each account was dialled', rows: CL.intensity.distribution, colour: C.indigo },
                { title: 'How often each account was reached', rows: CL.intensity.contactDistribution, colour: C.teal },
              ].map((blk, bi) => (
                <div key={bi}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: txt(.5), marginBottom: 12 }}>{blk.title}</div>
                  {blk.rows.map((d, i) => (
                    <div key={i} style={{ marginBottom: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                        <span style={{ color: txt(.7) }}>{d.band}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: txt(.85) }}>
                          {fmtInt(d.accounts)} <span style={{ color: txt(.42) }}>· {pct(d.sharePct, 0)} of book</span>
                          {!d.thin && <span style={{ fontWeight: 700, color: d.resolutionPct >= t.resolutionRatePct ? AU.nominal : AU.abort }}>{'  '}{pct(d.resolutionPct, 0)} res</span>}
                        </span>
                      </div>
                      <div style={{ height: 9, borderRadius: 'var(--radius-capsule)', background: ink(.07), overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 'var(--radius-capsule)', width: `${Math.max(1.5, d.sharePct)}%`, background: blk.colour }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, padding: '13px 15px', borderRadius: 16, border: `1px solid ${AU.hairline}`, fontSize: 13, color: txt(.72), lineHeight: 1.65 }}>
              <b style={{ color: AU.primary }}>Read the resolution rates on the right of each bar as description, not as advice.</b>{' '}
              The dialler stops ringing an account once it resolves, so &ldquo;fewer attempts&rdquo; and &ldquo;resolved&rdquo; are
              the same fact told twice — an account that paid on the first call could never accumulate twenty dials. It does
              not follow that dialling less would recover more.
            </div>
          </Card>
        )}

        {}
        {CL && CL.byHour.length > 0 && (
          <Card span={12} style={{ marginBottom: 16 }}>
            <Title t="When the AI called" s="Dials and connect rate by hour of day, from each call's timestamp" />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 230, marginTop: 8 }}>
              {CL.byHour.map((h, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 6, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: connColor(h.connectPct), fontVariantNumeric: 'tabular-nums' }}>
                    {h.thin ? '·' : pct(h.connectPct, 0)}
                  </div>
                  {}
                  <div style={{ width: '100%', maxWidth: 54, height: `${Math.max(4, (h.attempts / hourMax) * 100)}%`, borderRadius: 'var(--radius-sm)', background: ink(.09), display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
                    <div style={{ height: `${h.connectPct}%`, background: connColor(h.connectPct), borderRadius: 0 }} />
                  </div>
                  <div style={{ fontSize: 12, color: txt(.6), fontVariantNumeric: 'tabular-nums' }}>{h.hour}:00</div>
                  <div style={{ fontSize: 11, color: txt(.38), fontVariantNumeric: 'tabular-nums' }}>{fmtInt(h.attempts)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', marginTop: 18 }}>
              {CL.bestHours.length > 0 && (
                <div className="u-squircle-sm" style={{ padding: '16px 18px', border: `1px solid ${AU.hairline}`, minWidth: 250 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: txt(.5), marginBottom: 8 }}>
                    Best-performing windows
                  </div>
                  {CL.bestHours.map((h, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 22, fontSize: 13, padding: '3px 0' }}>
                      <span style={{ color: txt(.75), fontVariantNumeric: 'tabular-nums' }}>{h.hour}:00 – {String(Number(h.hour) + 1).padStart(2, '0')}:00</span>
                      <span style={{ fontWeight: 700, color: AU.accent, fontVariantNumeric: 'tabular-nums' }}>{pct(h.connectPct, 1)}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 12, color: txt(.5), marginTop: 8 }}>against {pct(CL.rates.attemptPct, 1)} across the campaign</div>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 300, fontSize: 13, color: txt(.6), lineHeight: 1.65 }}>
                Bar height is the number of dials placed in that hour; the coloured fill is the share of them that were
                answered. The campaign ran from <b>{CL.byHour[0].hour}:00 to {CL.byHour[CL.byHour.length - 1].hour}:59</b> — nothing was
                dialled outside that window, so this chart cannot say whether an earlier or later slot would do better. It can
                only rank the hours that were actually tried.
                {CL.byHour.some((h) => h.thin) && ' Hours with too few dials to rate are shown without a percentage rather than with a noisy one.'}
              </div>
            </div>
          </Card>
        )}

        {}
        {CL && CL.byAttempt.length > 0 && (
          <Card span={12} className="print-breakable" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 22px 0' }}>
              <Title t="Conversion by attempt number — observed" s="What each successive dial actually produced. A description of this campaign, not a recommended cut-off." />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                {[
                  { l: 'Accounts with a payment disposition', v: fmtInt(CL.firstPaidAccounts), c: C.green },
                  { l: 'Dials placed', v: fmtInt(CL.intensity.attempts), c: C.indigo },
                  CL.flattensAt ? { l: 'Attempts to reach 90% of payments', v: fmtInt(CL.flattensAt), c: C.blue } : null,
                ].filter(Boolean).map((m, i) => (
                  <div key={i} style={{ flex: '1 1 190px', padding: '12px 14px', borderRadius: 16, background: 'transparent', border: `1px solid ${ink(.06)}` }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>{m.l}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: m.c, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{m.v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="table-scroll" style={{ overflowX: 'auto', padding: '0 22px 22px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={l2Th('left', 70)}>Attempt</th>
                    <th style={l2Th('right', 90)}>Dials</th>
                    <th style={l2Th('right', 90)}>Answered</th>
                    <th style={l2Th('right', 88)}>Connect %</th>
                    <th style={l2Th('right', 118)}>First payment here</th>
                    <th style={l2Th('left', 190)}>Cumulative share of first payments</th>
                  </tr>
                </thead>
                <tbody>
                  {CL.byAttempt.map((a, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${ink(.07)}` }}>
                      <td style={{ padding: '9px 10px', fontWeight: 700, color: txt(.9), fontVariantNumeric: 'tabular-nums' }}>{a.attempt}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', color: txt(.62), fontVariantNumeric: 'tabular-nums' }}>
                        {fmtInt(a.dialled)}
                        <div style={{ height: 4, borderRadius: 'var(--radius-capsule)', background: ink(.07), marginTop: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(a.dialled / attMax) * 100}%`, background: ink(.22), borderRadius: 'var(--radius-capsule)' }} />
                        </div>
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', color: txt(.62), fontVariantNumeric: 'tabular-nums' }}>{fmtInt(a.connected)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: a.thin ? AU.tertiary : AU.primary, fontVariantNumeric: 'tabular-nums' }}>
                        {a.thin ? <span style={{ fontWeight: 400, color: AU.tertiary }}>too few</span> : pct(a.connectPct, 1)}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: a.firstPaid ? AU.primary : AU.tertiary, fontVariantNumeric: 'tabular-nums' }}>
                        {a.firstPaid ? fmtInt(a.firstPaid) : '—'}
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <div style={{ flex: 1, height: 9, borderRadius: 'var(--radius-capsule)', background: ink(.07), overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 'var(--radius-capsule)', width: `${a.cumFirstPaidPct}%`, background: AU.tertiary }} />
                          </div>
                          <span style={{ width: 44, textAlign: 'right', fontSize: 12, color: txt(.6), fontVariantNumeric: 'tabular-nums' }}>{pct(a.cumFirstPaidPct, 0)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 14, padding: '13px 15px', borderRadius: 16, border: `1px solid ${AU.hairline}`, fontSize: 13, color: txt(.72), lineHeight: 1.65 }}>
                <b style={{ color: AU.primary }}>This shows what happened — not the best stopping point.</b>{' '}
                Once an account pays, we stop dialling it. So the later attempts are only the hardest accounts, and their
                lower connect rate is part call fatigue and part that. This data can&apos;t tell the two apart.
                {CL.flattensAt && (
                  <> <b>{pct(90, 0)} of first payments were in by attempt {fmtInt(CL.flattensAt)}</b>, and the
                    {' '}{fmtInt(CL.dialsBeyondFlatten)} dials after that brought {fmtInt(CL.paidBeyondFlatten)} more.
                    Whether stopping earlier would recover the same money needs a proper test to say.</>
                )}
              </div>
            </div>
          </Card>
        )}

        {}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={8}>
            <Title t="Longer conversations recover more" s="Resolution rate by how long the AI talked — the key insight" />
            <div style={{ fontSize: 12.5, color: txt(.6), lineHeight: 1.6, marginTop: 4, marginBottom: 12 }}>
              Accounts are grouped by how long the AI actually talked to them. Each bar is the share of that
              group RBL later marked resolved. <b style={{ color: txt(.85) }}>n</b> = number of accounts in the group.
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 200, marginTop: 6 }}>
              {A.duration.filter((d) => !/not\s*connected/i.test(d.bucket)).map((d, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: durColor(d.resolutionPct), fontVariantNumeric: 'tabular-nums' }}>{pct(d.resolutionPct, 0)}</div>
                  <div style={{ width: '100%', maxWidth: 60, borderRadius: 'var(--radius-sm)', height: `${d.resolutionPct}%`, background: durColor(d.resolutionPct), minHeight: 6 }} />
                  <div style={{ fontSize: 12, color: txt(.55), textAlign: 'center', lineHeight: 1.2 }}>{d.bucket}</div>
                  <div style={{ fontSize: 11, color: txt(.38) }}>n={fmtInt(d.n)}</div>
                </div>
              ))}
            </div>
            {OW?.blindAccounts > 0 && (
              <div style={{ fontSize: 11, color: txt(.4), marginTop: 10 }}>
                Excludes {fmtInt(OW.blindAccounts)} accounts whose calls continued past the outcome file
                ({fmtDay(OW.outcomeSeenTo)}) — their result is not yet known.
              </div>
            )}
          </Card>
          <Card span={4}>
            <Title t="AI calling performance" s="Engagement at scale" />
            {[
              { l: 'Total attempts', v: fmtInt(A.ai.attempts), c: C.blue },
              { l: 'Connected', v: fmtInt(A.ai.connected), c: C.green },
              { l: 'Not connected', v: fmtInt(A.ai.notConnected), c: txt(.5) },
              { l: 'Connect rate', v: pct(A.ai.connectRatePct), c: C.teal },
              { l: 'Talk-minutes', v: fmtInt(A.ai.talkMinutes), c: C.purple },
              { l: 'Avg attempts / account', v: A.ai.avgAttempts.toFixed(1), c: C.indigo },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid ' + ink(.07) : 'none' }}>
                <span style={{ fontSize: 13, color: txt(.65) }}>{r.l}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: r.c, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
              </div>
            ))}
          </Card>
        </div>

        {}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={12}>
            <Title t="Collection disposition analysis — L1" s="Recovered value by the AI's main disposition" />
            {A.disposition.slice(0, 7).map((d, i) => (
              <Bar key={i} label={d.name} right={fmtCr(d.recovered)} pctv={d.recovered / dispTotal * 100}
                color={AU.nominal} sub={`${fmtInt(d.resolved)} resolved of ${fmtInt(d.total)} · ${fmtCr(d.outstanding)} outstanding`} />
            ))}
          </Card>
        </div>

        {}
        {dispL2.length > 0 && (
          <Card span={12} className="print-breakable" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 22px 0' }}>
              <Title t="Collection disposition analysis — L2" s="What the customer actually said, and what it was worth — sorted by value recovered" />
            </div>
            <div className="table-scroll" style={{ overflowX: 'auto', padding: '4px 22px 22px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={l2Th('left', 250)}>Disposition L2</th>
                    <th style={l2Th('right', 74)}>Accounts</th>
                    <th style={l2Th('right', 110)}>Recovered</th>
                    <th style={l2Th('right', 110)}>Outstanding</th>
                    <th style={l2Th('right', 96)}>Recovery %</th>
                    <th style={l2Th('right', 96)}>Resolution %</th>
                    <th style={l2Th('left', 150)}>Share of recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {dispL2.map((d, i) => {
                    const good = d.resolutionPct >= t.resolutionRatePct;
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${ink(.07)}` }}>
                        <td style={{ padding: '11px 10px', fontWeight: 600, color: txt(.9) }}>
                          {d.name}
                          {d.name === '(Not contacted)' && (
                            <div style={{ fontSize: 11, fontWeight: 400, color: txt(.45), marginTop: 2 }}>
                              Never connected — no disposition exists for these
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.62), fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.total)}</td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', fontWeight: 700, color: AU.nominal, fontVariantNumeric: 'tabular-nums' }}>{fmtCr(d.recovered)}</td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.72), fontVariantNumeric: 'tabular-nums' }}>{fmtCr(d.outstanding)}</td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.72), fontVariantNumeric: 'tabular-nums' }}>{pct(d.recoveryPct, 1)}</td>
                        <td style={{ padding: '11px 10px', textAlign: 'right', fontWeight: 700, color: good ? AU.nominal : AU.abort, fontVariantNumeric: 'tabular-nums' }}>
                          {pct(d.resolutionPct, 1)}
                          <div style={{ fontSize: 10, fontWeight: 400, color: txt(.4) }}>vs {pct(t.resolutionRatePct, 0)}</div>
                        </td>
                        <td style={{ padding: '11px 10px' }}>
                          <div style={{ height: 10, borderRadius: 'var(--radius-capsule)', background: ink(.07), overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(1.5, d.recovered / dispL2Total * 100)}%`, height: '100%', borderRadius: 'var(--radius-capsule)', background: AU.nominal }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 12, color: txt(.5), lineHeight: 1.6 }}>
                {}
                {dispL2Small.count > 0 && (
                  <>Dispositions with fewer than {L2_MIN_N} accounts are not listed: {fmtInt(dispL2Small.count)} accounts
                  across {dispL2Small.kinds} L2 {dispL2Small.kinds === 1 ? 'value' : 'values'}, {fmtCr(dispL2Small.recovered)} recovered.
                  A 100% resolution rate on one account is a customer, not a finding. </>
                )}
                {dispL2Ptp && dispL2Paid && (
                  <>
                    <b style={{ color: AU.abort }}>The two to read together:</b> {fmtInt(dispL2Paid.total)} customers said the payment
                    was already made and {pct(dispL2Paid.resolutionPct, 1)} of them resolved.{' '}
                    {fmtInt(dispL2Ptp.total)} promised to pay later — only {pct(dispL2Ptp.resolutionPct, 1)} did.
                  </>
                )}
              </div>
            </div>
          </Card>
        )}

        {}
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title t="Outstanding vs recovery analysis" s="Recovered vs outstanding in each balance band — is recovery coming from the whole portfolio, or only the small accounts?" />
          <div style={{ display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
            {[
              { l: 'Total outstanding', v: fmtCr(t.sumOut), c: C.indigo },
              { l: 'Recovered', v: fmtCr(t.recovered), c: C.green },
              { l: 'Still pending', v: fmtCr(t.outstandingPending), c: C.orange },
              { l: 'Recovery rate', v: pct(t.recoveryRatePct, 1), c: C.blue },
            ].map((m, i) => (
              <div key={i} style={{ flex: '1 1 160px', padding: '12px 14px', borderRadius: 16, background: 'transparent', border: `1px solid ${ink(.06)}` }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>{m.l}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: m.c, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{m.v}</div>
              </div>
            ))}
          </div>
          {ovr.map((r, i) => (
            <div key={i} style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, marginBottom: 5 }}>
                <span style={{ color: txt(.78), fontWeight: 600 }}>{r.band}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                  <b style={{ color: AU.nominal }}>{fmtCr(r.recovered)}</b>
                  <span style={{ color: txt(.4) }}> recovered of </span>
                  <b style={{ color: txt(.8) }}>{fmtCr(r.outstanding)}</b>
                  <span style={{ color: r.recoveryPct >= t.recoveryRatePct ? AU.nominal : AU.abort, fontWeight: 700 }}>{'  '}{pct(r.recoveryPct, 1)}</span>
                </span>
              </div>
              {}
              <div style={{ height: 14, borderRadius: 'var(--radius-capsule)', background: ink(.06), overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(1.5, r.recoveryPct)}%`, height: '100%', borderRadius: 'var(--radius-capsule)', background: AU.nominal }} />
              </div>
              <div style={{ fontSize: 12, color: txt(.42), marginTop: 4 }}>
                {fmtInt(r.count)} accounts · {fmtCr(r.pending)} still pending
              </div>
            </div>
          ))}
        </Card>

        {}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={12}>
            <Title t="Region-wise performance" s="Recovered value & resolution by region — the bar is each region's resolution rate" />
            {regionOrder.map((r, i) => {
              const d = A.region[r];
              return <Bar key={i} label={r} right={`${fmtCr(d.recovered)} rec · ${pct(d.resolutionPct, 0)} res`} pctv={d.resolutionPct}
                color={ramp(i)} sub={`${fmtInt(d.count)} accounts · ${fmtCr(d.outstanding)} outstanding · ${pct(d.connectPct, 0)} connect`} />;
            })}
          </Card>
        </div>

        {}
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title t="Performance by bucket" s="RBL's collections cycle bucket — the bar is each bucket's resolution rate" />
          {!hasBucketCol ? (

            <div style={{ ...T.body, color: txt(.72), lineHeight: 1.65 }}>
              This book does not carry a <b style={{ color: txt(.92) }}>Bucket</b> column, so there is no
              B1 / B2 / B3 split to show. That is a property of the file, not a gap in the data —
              nothing has been dropped.
              <div style={{ ...T.caption, marginTop: 10, color: txt(.55) }}>
                Send a book that carries the column and this card fills in automatically.
              </div>
            </div>
          ) : bucketAllBlank ? (

            <div style={{ ...T.body, color: txt(.72), lineHeight: 1.65 }}>
              This book has a <b style={{ color: txt(.92) }}>Bucket</b> column, but every one of
              its {fmtInt(A.cycleBucket.Unspecified?.count || 0)} accounts is blank in it. Worth checking at source —
              the column exists, so something was expected to fill it.
            </div>
          ) : (
            bucketOrder.map((b, i) => {
              const d = A.cycleBucket[b];
              const oc = outcomeLine(d);
              return (
                <Bar key={i} label={b} right={`${fmtCr(d.recovered)} rec · ${pct(d.resolutionPct, 1)} res`} pctv={d.resolutionPct}
                  color={ramp(i)}
                  sub={`${fmtInt(d.count)} accounts · ${fmtCr(d.outstanding)} outstanding · ${fmtInt(d.attempts)} attempts · ${pct(d.connectPct, 0)} connect${oc ? ` — ${oc}` : ''}`} />
              );
            })
          )}
        </Card>

        {}
        {hasBucketCol && !bucketAllBlank && bucketRegionRows.length > 0 && (
          <Card span={12} style={{ marginBottom: 16 }}>
            <Title t="Bucket × region" s="Where each bucket sits geographically, and how it recovers there" />
            {bucketRegionRows.map((x, i) => {
              const oc = outcomeLine(x);
              return (
                <Bar key={x.key} label={`${x.cycleBucket} · ${x.region}`}
                  right={`${fmtCr(x.recovered)} rec · ${pct(x.resolutionPct, 1)} res`} pctv={x.resolutionPct}
                  color={ramp(i)}
                  sub={`${fmtInt(x.count)} accounts · ${fmtCr(x.outstanding)} outstanding · ${pct(x.connectPct, 0)} connect${oc ? ` — ${oc}` : ''}`} />
              );
            })}
            {(A.bucketRegion || []).length > bucketRegionRows.length && (
              <div style={{ ...T.caption, color: txt(.55), marginTop: 4 }}>
                Showing the {bucketRegionRows.length} largest of {(A.bucketRegion || []).length} bucket × region pairs, by outstanding.
              </div>
            )}
          </Card>
        )}

        {}
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title t="Performance by language" s="Derived from the account's state, per RBL's mapping" />
          {languageOrder.length === 0 ? (
            <div style={{ ...T.body, color: txt(.72), lineHeight: 1.65 }}>
              No state information on this book, so no language can be derived.
            </div>
          ) : (
            <>
              {}
              {languageOrder.map((l, i) => {
                const d = A.language[l];
                const oc = outcomeLine(d);
                return (
                  <Bar key={i} label={l} right={`${fmtCr(d.recovered)} rec · ${pct(d.resolutionPct, 1)} res`} pctv={d.resolutionPct}
                    color={ramp(i)}
                    sub={`${fmtInt(d.count)} accounts · ${fmtCr(d.outstanding)} outstanding · ${pct(d.connectPct, 0)} connect${oc ? ` — ${oc}` : ''}`} />
                );
              })}
              {languageAllOther && (
                <div style={{ ...T.caption, marginTop: 10, color: txt(.55), lineHeight: 1.6 }}>
                  No accounts in this book fall in the six states the mapping covers — Kerala, Andhra
                  Pradesh, Tamil Nadu, Pondicherry, Karnataka and Telangana — so every account is
                  grouped as Others. That is the mapping working correctly on a northern and western
                  portfolio, not a gap; send a southern book and the split appears.
                </div>
              )}
            </>
          )}
        </Card>

        {}
        {segments.length > 0 && (
          <Card span={12} style={{ marginBottom: 16 }}>
            <Title t="Performance by RBL segment" s="RBL's own risk grade vs what actually recovered" />
            {segments.length > 1 ? (
              <>
                {segments.map((s, i) => (
                  <Bar key={i} label={s.name} right={`${fmtCr(s.recovered)} rec · ${pct(s.resolutionPct, 1)} res`}
                    pctv={s.resolutionPct}
                    color={segColor(s.name, i)}
                    sub={`${fmtInt(s.count)} accounts · ${fmtCr(s.outstanding)} outstanding · ${fmtInt(s.resolved)} resolved`} />
                ))}
              </>
            ) : (

              <div style={{ fontSize: 15, color: txt(.72), lineHeight: 1.65 }}>
                Every account in this file carries the same segment — <b style={{ color: txt(.92) }}>{segments[0].name}</b>{' '}
                ({fmtInt(segments[0].count)} accounts, {pct(segments[0].resolutionPct, 1)} resolved). This cycle <i>is</i> the {segments[0].name.toLowerCase()} book,
                so there is no second segment to compare it against, and no honest lift to report.
                <div style={{ marginTop: 10, color: txt(.55), fontSize: 13 }}>
                  Send a cycle that spans more than one segment and the comparison appears automatically.
                </div>
              </div>
            )}
          </Card>
        )}

        {}

        {}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={6}>
            <Title t="State-wise performance" s="Where the accounts concentrate, and how each state is recovering" />
            {stateTop.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11 }}>
                <div style={{ width: 120, fontSize: 13, color: txt(.72), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.state}</div>
                <div style={{ flex: 1, height: 9, borderRadius: 'var(--radius-capsule)', background: ink(.07), overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 'var(--radius-capsule)', width: `${s.resolutionPct}%`, background: AU.tertiary }} />
                </div>
                <div style={{ width: 128, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: txt(.85) }}>{fmtCr(s.outstanding)} · {pct(s.resolutionPct, 0)} res</div>
              </div>
            ))}
          </Card>
          <Card span={6}>
            <Title t="Dial efficiency" s="Accounts grouped by how many times they were dialled" />
            <div style={{ fontSize: 12.5, color: txt(.6), lineHeight: 1.6, marginBottom: 16 }}>
              Each group is a set of accounts dialled a certain number of times.
              {' '}<b style={{ color: txt(.85) }}>Connected</b> = share the AI reached a person on.
              {' '}<b style={{ color: txt(.85) }}>Resolved</b> = share RBL&apos;s status file later marked paid.
            </div>
            {I.dial.map((d, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: txt(.82), fontWeight: 600 }}>{d.band} attempts</span>
                  <span style={{ color: txt(.5), fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.n)} accounts</span>
                </div>
                {d.thin ? (
                  <div style={{ fontSize: 12, color: AU.tertiary }}>Too few accounts here to show a reliable rate.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 74, fontSize: 11.5, color: txt(.55) }}>Connected</span>
                      <div style={{ flex: 1, height: 8, borderRadius: 'var(--radius-capsule)', background: ink(.07), overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d.connectPct}%`, background: C.cyan, opacity: .7, borderRadius: 'var(--radius-capsule)' }} />
                      </div>
                      <span style={{ width: 42, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: txt(.75) }}>{pct(d.connectPct, 0)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 74, fontSize: 11.5, color: txt(.55) }}>Resolved</span>
                      <div style={{ flex: 1, height: 8, borderRadius: 'var(--radius-capsule)', background: ink(.07), overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d.resolutionPct}%`, background: C.green, borderRadius: 'var(--radius-capsule)' }} />
                      </div>
                      <span style={{ width: 42, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: txt(.85) }}>{pct(d.resolutionPct, 0)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div style={{ fontSize: 11, color: txt(.42), marginTop: 6, lineHeight: 1.5 }}>
              {OW?.blindAccounts > 0
                ? <>Excludes {fmtInt(OW.blindAccounts)} accounts still being dialled when the status file was pulled ({fmtDay(OW.outcomeSeenTo)}) — their outcome isn&apos;t known yet.</>
                : <>The dialler stops once an account resolves, so more attempts don&apos;t cause a lower rate — read this as a description, not a cause.</>}
            </div>
          </Card>
        </div>

        {}
        {CL && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
            <Card span={7}>
              <Title t="Promise to pay — generated, and converted" s="How many customers promised to pay, and how many RBL's file later marked resolved" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: txt(.5) }}>Promises generated</div>
                  <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.02em', color: C.blue, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(CL.ptp.accounts)}</div>
                  <div style={{ fontSize: 12, color: txt(.45) }}>{pct(CL.ptp.sharePct, 1)} of all accounts · {pct(CL.ptp.shareOfReachedPct, 1)} of accounts reached</div>
                </div>
                <div style={{ fontSize: 17, color: AU.tertiary }}>→</div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: txt(.5) }}>Promise to Pay - Resolved</div>
                  <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.02em', color: AU.nominal, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(CL.ptp.resolved)}</div>
                  <div style={{ fontSize: 12, color: txt(.45) }}>{pct(CL.ptp.resolutionPct, 1)} of the promises kept</div>
                </div>
              </div>
              <div style={{ height: 14, borderRadius: 'var(--radius-capsule)', background: ink(.07), overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ width: `${CL.ptp.resolutionPct}%`, height: '100%', borderRadius: 'var(--radius-capsule)', background: AU.nominal }} />
              </div>
              {[
                { l: 'Outstanding behind the promises', v: fmtCr(CL.ptp.outstanding), c: C.indigo },
                { l: 'Recovered from them', v: fmtCr(CL.ptp.recovered), c: C.green },
                { l: 'Promised and still open', v: fmtCr(CL.ptp.openAmount), c: C.orange },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderTop: i ? `1px solid ${ink(.07)}` : `1px solid ${ink(.07)}` }}>
                  <span style={{ fontSize: 13, color: txt(.65) }}>{r.l}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: r.c, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
                </div>
              ))}
              <div style={{ fontSize: 12, color: txt(.5), marginTop: 12, lineHeight: 1.6 }}>
                A promise is counted if the customer made one on <b>any</b>{' '}attempt. The book resolved at{' '}
                {pct(CL.ptp.baseResolutionPct, 1)} overall, so on this cycle a promise is worth{' '}
                {Math.abs(CL.ptp.liftPts) < 2 ? <b>almost exactly what saying nothing was worth</b>
                  : CL.ptp.liftPts > 0 ? <b>{Math.abs(CL.ptp.liftPts).toFixed(1)} points more than average</b>
                    : <b>{Math.abs(CL.ptp.liftPts).toFixed(1)} points less than average</b>}.
              </div>
            </Card>

            {}
            <Card span={5}>
              <Title t="Potential complaints" s="Accounts where the AI logged a Potential Complaint on any attempt" />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 6 }}>
                <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-.03em', color: CL.complaints.accounts ? C.orange : C.green, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtInt(CL.complaints.accounts)}
                </div>
                <div style={{ fontSize: 13, color: txt(.55) }}>
                  accounts · {pct(CL.complaints.ratePct, 1)} of all accounts
                </div>
              </div>
              <div style={{ height: 12, borderRadius: 'var(--radius-capsule)', background: ink(.07), overflow: 'hidden', margin: '10px 0 18px' }}>
                <div style={{ width: `${Math.max(0.8, CL.complaints.ratePct)}%`, height: '100%', borderRadius: 'var(--radius-capsule)', background: C.orange }} />
              </div>
              {[
                { l: 'Of the accounts we reached', v: pct(CL.complaints.ofReachedPct, 1) },
                { l: 'Outstanding on those accounts', v: fmtCr(CL.complaints.outstanding) },
                { l: 'Of them, later resolved', v: `${fmtInt(CL.complaints.resolved)} · ${pct(CL.complaints.resolutionPct, 1)}` },
                { l: 'Also carry a DNC disposition', v: fmtInt(CL.complaints.alsoDnc) },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderTop: `1px solid ${ink(.07)}` }}>
                  <span style={{ fontSize: 13, color: txt(.65) }}>{r.l}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
                </div>
              ))}
              <div style={{ fontSize: 12, color: txt(.5), marginTop: 12, lineHeight: 1.6 }}>
                Counted from <b>any</b>{' '}attempt, which is why this is larger than the &ldquo;Potential Complaint&rdquo; row in
                the Disposition L2 table above — that table files each account under its <i>strongest</i>{' '}disposition, so an
                account that complained and then paid appears there under Paid. For compliance the complaint still counts.
              </div>
            </Card>
          </div>
        )}

        {}
        {CL && CL.dnc.accounts > 0 && (
          <Card span={12} style={{ marginBottom: 16 }}>
            <Title t="DNC & compliance" s="Accounts that asked not to be called — and whether the dialler called them again" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 18 }}>
              {[
                { l: 'DNC dispositions', v: fmtInt(CL.dnc.accounts), s: `${pct(CL.dnc.ratePct, 1)} of all accounts`, c: C.orange },
                {
                  l: 'Dialled again afterwards',
                  v: fmtInt(CL.dnc.redialledAccounts),
                  s: `${pct(CL.dnc.redialledPct, 1)} of DNC accounts`,
                  c: CL.dnc.redialledAccounts ? C.red : C.green,
                },
                { l: 'Dials placed after the DNC', v: fmtInt(CL.dnc.redialledDials), s: `up to ${fmtInt(CL.dnc.maxDialsAfter)} on one account`, c: CL.dnc.redialledDials ? C.red : C.green },
                { l: 'Refused to pay', v: fmtInt(CL.dnc.refusedAccounts), s: `${fmtInt(CL.dnc.refusedResolved)} resolved anyway`, c: C.purple },
              ].map((m, i) => (
                <div key={i} style={{ padding: '14px 16px', borderRadius: 16, background: 'transparent', border: `1px solid ${ink(.06)}` }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: txt(.5) }}>{m.l}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', color: m.c, fontVariantNumeric: 'tabular-nums', marginTop: 5 }}>{m.v}</div>
                  <div style={{ fontSize: 12, color: txt(.45), marginTop: 3 }}>{m.s}</div>
                </div>
              ))}
            </div>

            <div style={{
              padding: '15px 17px', borderRadius: 16,
              background: CL.dnc.redialledAccounts ? AU.bad(0.03) : AU.good(0.04),
              border: `1px solid ${CL.dnc.redialledAccounts ? AU.bad(0.22) : AU.good(0.22)}`,
              fontSize: 13, color: txt(.75), lineHeight: 1.7,
            }}>
              {CL.dnc.redialledAccounts > 0 ? (
                <>
                  <b style={{ color: AU.abort }}>{fmtInt(CL.dnc.redialledAccounts)} of the {fmtInt(CL.dnc.accounts)} accounts that were given a DNC
                  disposition were dialled again after it</b> — {fmtInt(CL.dnc.redialledDials)} further attempts in total, and as many
                  as {fmtInt(CL.dnc.maxDialsAfter)}{' '}on a single account. Measured by comparing each account&apos;s DNC attempt number
                  against the attempts that came after it.
                  <div style={{ marginTop: 10, color: txt(.6), fontSize: 13 }}>
                    <b>What this does and does not establish.</b> It establishes that the dialler did not stop on this
                    disposition. It does <i>not</i>{' '}establish a breach: whether a Sense &ldquo;DNC&rdquo; is wired to suppress the
                    campaign is a configuration in the dialler, not a fact in this file, and on this export{' '}
                    {CL.dnc.alsoComplaint > 0 && <>{fmtInt(CL.dnc.alsoComplaint)} of the {fmtInt(CL.dnc.accounts)}{' '}DNC accounts carry
                      the second-level reason &ldquo;Potential Complaint&rdquo;, </>}
                    which reads more like a model flag on the conversation than a registered do-not-call request. That
                    distinction is worth settling with whoever configures the campaign before this number goes anywhere near
                    a regulator — in either direction.
                  </div>
                </>
              ) : (
                <>
                  <b style={{ color: AU.nominal }}>No account was dialled again after a DNC disposition was logged against it.</b>{' '}
                  Checked on every one of the {fmtInt(CL.dnc.accounts)} DNC accounts by comparing the DNC attempt number
                  against every attempt that followed it.
                </>
              )}
            </div>
          </Card>
        )}

        {}

        {}
        <Card span={12} style={{ marginBottom: 16 }}>
          <Title t="Complete collection funnel" s="From RBL's full portfolio to a resolved customer — and what each stage was worth" />

          {funnelGeom && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 30, alignItems: 'start', marginTop: 8 }}>

              {}
              <svg
                viewBox={funnelGeom.viewBox}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              >
                <defs>
                  <linearGradient id="fnJourney" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ramp-6)" />
                    <stop offset="100%" stopColor="var(--ramp-4)" />
                  </linearGradient>
                  <linearGradient id="fnGood" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--sig-nominal)" />
                    <stop offset="100%" stopColor="var(--sig-nominal)" />
                  </linearGradient>
                  <linearGradient id="fnBad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--sig-abort)" />
                    <stop offset="100%" stopColor="var(--sig-abort)" />
                  </linearGradient>
                </defs>

                {}
                {funnelGeom.journey.map((g, i) => (
                  <g key={i}>
                    <path d={g.path} fill="url(#fnJourney)" opacity={0.92 - i * 0.14} />
                    {}
                    <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y0} stroke="var(--content-on-accent)" strokeWidth="1" opacity="0.45" />

                    <text x={FW / 2} y={g.yMid - 7} textAnchor="middle" fontSize="11" fontWeight="700"
                      fill="var(--content-on-accent)" letterSpacing="0.3" style={{ paintOrder: 'stroke' }}>
                      {g.stage.stage.toUpperCase()}
                    </text>
                    <text x={FW / 2} y={g.yMid + 12} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--content-on-accent)">
                      {fmtInt(g.stage.value)}
                      <tspan fontSize="11" fontWeight="500" opacity="0.85">{'  '}{pct(g.stage.pctOfBook, 1)}</tspan>
                    </text>

                    {}
                    {g.drop > 0 && (
                      <>
                        <text x={g.x1 + 14} y={g.yMid - 2} fontSize="10" fontWeight="700" fill="var(--sig-abort)">
                          −{fmtInt(g.drop)}
                        </text>
                        <text x={g.x1 + 14} y={g.yMid + 11} fontSize="10" fill={txt(.45)}>
                          {pct(g.dropPct, 0)} lost
                        </text>
                      </>
                    )}

                    {}
                    <text x={g.x0 - 14} y={g.yMid - 2} textAnchor="end" fontSize="10" fontWeight="700"
                      fill={g.stage.resolutionPct >= t.resolutionRatePct ? AU.nominal : ink(.5)}>
                      {pct(g.stage.resolutionPct, 1)}
                    </text>
                    <text x={g.x0 - 14} y={g.yMid + 11} textAnchor="end" fontSize="10" fill={txt(.4)}>
                      resolved
                    </text>
                  </g>
                ))}

                {}
                <text x={FW / 2} y={funnelGeom.neck.y + 20} textAnchor="middle" fontSize="10" fontWeight="700"
                  letterSpacing="1.2" fill={txt(.42)}>
                  OUTCOMES — PARALLEL, NOT SEQUENTIAL
                </text>

                {}
                {funnelGeom.outcomes.map((o, i) => (
                  <g key={i}>
                    <path d={o.link} fill="none" stroke="var(--ramp-3)" strokeWidth="1.25" opacity="0.5" />
                    {}
                    {o.label.map((line, k) => (
                      <text key={k} x={o.x + o.w / 2} y={o.y - 16 + k * 11} textAnchor="middle"
                        fontSize="10" fontWeight="700" letterSpacing="0.4" fill={txt(.6)}>
                        {line}
                      </text>
                    ))}
                    <rect x={o.x} y={o.y} width={o.w} height={o.h} rx="12"
                      fill="var(--ramp-5)" />
                    <text x={o.x + o.w / 2} y={o.y + o.h / 2 + 6} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--content-on-accent)">
                      {fmtInt(o.stage.value)}
                    </text>
                    <text x={o.x + o.w / 2} y={o.y + o.h + 15} textAnchor="middle" fontSize="10" fill={txt(.5)}>
                      {pct(o.stage.pctOfBook, 1)} of book
                    </text>
                    {o.stage.n < A.funnel.length && (
                      <text x={o.x + o.w / 2} y={o.y + o.h + 28} textAnchor="middle" fontSize="10" fontWeight="700"
                        fill={o.good ? AU.nominal : AU.abort}>
                        {pct(o.stage.resolutionPct, 1)} resolved
                      </text>
                    )}
                  </g>
                ))}
              </svg>

              {}
              <div>
                {A.funnel.map((f, i) => {
                  const prev = i > 0 ? A.funnel[i - 1] : null;
                  const step = prev && prev.kind === 'journey' && f.kind === 'journey' && prev.value
                    ? f.value / prev.value * 100 : null;
                  const good = f.resolutionPct >= t.resolutionRatePct;
                  return (
                    <div key={i} style={{ padding: '10px 0', borderTop: i ? `1px solid ${ink(.07)}` : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 13 }}>
                          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 'var(--radius-capsule)', marginRight: 8,
                            background: f.kind === 'journey' ? C.blue : (good ? C.green : C.red) }} />
                          <b style={{ color: txt(.9) }}>{f.stage}</b>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(f.value)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: txt(.45), marginLeft: 15, marginTop: 2 }}>
                        {pct(f.pctOfBook, 1)} of book{step !== null ? ` · ${pct(step, 0)} step` : ''}
                        {f.n < A.funnel.length && (
                          <> · <b style={{ color: good ? AU.nominal : AU.abort }}>{pct(f.resolutionPct, 1)} resolved</b></>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {ptpStage && paidStage && ptpStage.resolutionPct < paidStage.resolutionPct && (
            <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 16, background: AU.bad(0.03), border: `1px solid ${AU.bad(0.18)}`, fontSize: 13, color: txt(.75), lineHeight: 1.6 }}>
              <b style={{ color: AU.abort }}>Read the two outcome channels together.</b>{' '}
              {fmtInt(ptpStage.value)} customers promised to pay later, and only {pct(ptpStage.resolutionPct, 1)} of them did.
              {' '}{fmtInt(paidStage.value)} said the payment was already made, and {pct(paidStage.resolutionPct, 1)} of those resolved.
              A promise is the weakest signal in this book.
            </div>
          )}
        </Card>

        {}
        {durL2.length > 0 && (
          <Card span={12} className="print-breakable" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 22px 0' }}>
              <Title t="Conversation duration analysis — by disposition L2" s="How long the AI talked, and what the customer actually said — resolution rate in every cell" />
            </div>
            <div className="table-scroll" style={{ overflowX: 'auto', padding: '4px 22px 22px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={l2Th('left', 260)}>Disposition L2</th>
                    <th style={l2Th('right', 74)}>Accounts</th>
                    <th style={l2Th('right', 86)}>Avg talk</th>
                    <th style={l2Th('right', 84)}>Resolution</th>
                    {A.durationOrder.map((b) => <th key={b} style={l2Th('center', 84)}>{b}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {durL2.map((d, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${ink(.07)}` }}>
                      <td style={{ padding: '11px 10px', fontWeight: 600, color: txt(.9) }}>{d.name}</td>
                      <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.62), fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.n)}</td>
                      <td style={{ padding: '11px 10px', textAlign: 'right', color: txt(.62), fontVariantNumeric: 'tabular-nums' }}>{mmss(d.avgSeconds)}</td>
                      <td style={{ padding: '11px 10px', textAlign: 'right', fontWeight: 700, color: durColor(d.resolutionPct), fontVariantNumeric: 'tabular-nums' }}>{pct(d.resolutionPct, 1)}</td>
                      {d.buckets.map((b, j) => (
                        <td key={j} style={{ padding: 4, textAlign: 'center' }}>
                          {}
                          {b.n === 0 ? (
                            <span style={{ color: AU.tertiary }}>·</span>
                          ) : (
                            <div title={`${b.n} account${b.n === 1 ? '' : 's'}`} style={{
                              borderRadius: 'var(--radius-sm)', padding: '8px 4px',
                              background: b.n < 10 ? AU.quiet : heat(b.resolutionPct),
                              color: b.n < 10 ? AU.secondary : AU.primary,
                              fontWeight: b.n < 10 ? 400 : 700, fontVariantNumeric: 'tabular-nums',
                            }}>
                              {b.n < 10 ? `n=${b.n}` : pct(b.resolutionPct, 0)}
                              <div style={{ fontSize: 10, fontWeight: 400, color: AU.primary, marginTop: 1 }}>{b.n >= 10 ? `n=${fmtInt(b.n)}` : ''}</div>
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 12, color: txt(.5), lineHeight: 1.6 }}>
                Shaded cells are resolution rate; cells with fewer than 10 accounts show the raw count instead, because a
                percentage of eight accounts is not a finding.
                {A.l2BelowThreshold > 0 && ` ${fmtInt(A.l2BelowThreshold)} accounts sit in L2 dispositions with fewer than ${A.l2Min} accounts each and are not charted.`}
                {OW?.blindAccounts > 0 && ` Excludes ${fmtInt(OW.blindAccounts)} accounts still being dialled after the outcome file was pulled (${fmtDay(OW.outcomeSeenTo)}) — their result is not yet known, so counts here are lower than in the Disposition L2 table above, which is the full book.`}
                {l2Longest && l2Longest.resolutionPct < t.resolutionRatePct && (
                  <>
                    {' '}<b style={{ color: AU.abort }}>Note the top of the &quot;Avg talk&quot; column:</b> the longest conversations in this book end in{' '}
                    <b>{l2Longest.name}</b> ({mmss(l2Longest.avgSeconds)} average) and resolve at only {pct(l2Longest.resolutionPct, 1)} —
                    below the {pct(t.resolutionRatePct, 1)} book rate. Talk time alone is not the goal; what the customer commits to is.
                  </>
                )}
              </div>
            </div>
          </Card>
        )}

        {}
        {CL && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
            {}

          </div>
        )}

        {}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 16, marginBottom: 16 }}>
          <Card span={12}>
            <Title t="Recoverable opportunity" s="Open accounts, and what to work next" />
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{fmtCr(I.opportunity.openOutstanding)}</div>
            <div style={{ fontSize: 13, color: txt(.48), marginBottom: 16 }}>still outstanding across {fmtInt(t.unresolved)} open accounts</div>
            {I.opportunity.lists.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid ' + ink(.07) }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: txt(.8) }}>{l.label}</div>
                  <div style={{ fontSize: 12, color: txt(.45) }}>{l.note} · {fmtInt(l.count)} accounts</div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: [C.green, C.blue, C.orange][i], fontVariantNumeric: 'tabular-nums' }}>{fmtCr(l.amount)}</div>
              </div>
            ))}
          </Card>
        </div>

        {}

        <div style={{ textAlign: 'center', fontSize: 12, color: txt(.4), marginTop: 40, lineHeight: 1.7 }}>
          Convin × RBL Bank · Recovery Intelligence · {data.meta.reportDate} · Recovered value counts full outstanding on resolved accounts.
          {shareToken && share && (
            <div style={{ marginTop: 8, color: txt(.35) }}>
              {}
              Confidential · shared read-only{share.label ? ` with ${share.label}` : ''} · no customer names, mobile numbers
              or account numbers are included in this view.
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
