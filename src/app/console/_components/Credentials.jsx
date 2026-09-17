'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { C, T, NUM } from '../../aurum';
import { withBase } from '../../../lib/basepath.mjs';

const STATE = {
  pass: { word: 'Working', glyph: '●', tone: C.nominal, rank: 0 },

  unchecked: { word: 'Set, not checked', glyph: '·', tone: C.tertiary, rank: 1 },
  unset: { word: 'Not set', glyph: '○', tone: C.quaternary, rank: 2 },
  partial: { word: 'Partly working', glyph: '◐', tone: C.caution, rank: 3 },
  gap: { word: 'Untested', glyph: '◌', tone: C.caution, rank: 4 },
  fail: { word: 'Not working', glyph: '▲', tone: C.abort, rank: 5 },
};
const stateOf = (s) => STATE[s] ?? STATE.unset;

const HINT = {
  S3_ACCESS_KEY_ID: 'AKIA…', S3_SECRET_ACCESS_KEY: '40 characters', S3_REGION: 'ap-south-1',
  S3_BUCKET: 'bucket name', S3_PREFIX_BOOKS: 'books/', S3_PREFIX_STATUS: 'status/',
  S3_PREFIX_ARCHIVE: 'archive/  (optional, but sources are not kept without it)',
  CONVIN_TENANT: 'rblbank', CONVIN_TOKEN: 'without the "Bearer " prefix',
  CONVIN_CAMPAIGN_PREX: 'campaign id', CONVIN_CAMPAIGN_BUCKET: 'campaign id',
  CONVIN_EMAIL: 'only for the untested browser fallback',
  CONVIN_PASSWORD: 'only for the untested browser fallback',
  IMAP_HOST: 'imap.example.com', IMAP_USER: 'the full address', IMAP_PASSWORD: 'an app password, if 2FA is on',
  IMAP_PORT: '993  (optional)',
  DATABASE_URL: 'postgresql://user:pass@host:5432/db?sslmode=require',
};
const SECRETISH = /(KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)/;

function Pill({ status }) {
  const s = stateOf(status);
  return (
    <span style={{
      ...T.micro, display: 'inline-flex', alignItems: 'center', gap: 6,
      color: s.tone, border: `1px solid ${C.rim}`, background: C.quiet,
      borderRadius: 'var(--radius-capsule)', padding: '2px 10px', whiteSpace: 'nowrap',
    }}>
      <span aria-hidden="true">{s.glyph}</span>{s.word}
    </span>
  );
}

function Group({ spec, envState, result, values, onChange, busy }) {
  const [open, setOpen] = useState(false);

  const status = result?.status
    ?? (spec.required.every((k) => envState.set.includes(k)) ? 'unchecked' : 'unset');
  const vars = [...spec.required, ...spec.optional];
  const unset = spec.required.filter((k) => !envState.set.includes(k));

  return (
    <section style={{
      border: `1px solid ${C.rim}`, borderRadius: 'var(--radius-card)',
      background: C.raised, padding: 20, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ ...T.headline, color: C.primary, margin: 0 }}>{spec.label}</h3>
        <Pill status={status} />
        <button type="button" className="cx-btn cx-ghost cx-sm" style={{ marginLeft: 'auto' }}
          onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide' : unset.length ? `Set ${unset.length} value${unset.length === 1 ? '' : 's'}` : 'Change values'}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...T.callout, color: C.primary }}>{result.headline}</div>
          {result.detail && (
            <div style={{ ...T.footnote, color: C.secondary, marginTop: 6 }}>{result.detail}</div>
          )}
          {}
          {!!result.remedy?.length && (
            <ul style={{ ...T.footnote, color: C.secondary, margin: '10px 0 0', paddingLeft: 18 }}>
              {result.remedy.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {!result && (
        <div style={{ ...T.footnote, color: C.tertiary, marginTop: 8 }}>
          {unset.length > 0 ? (
            <>Not checked yet · {unset.length} required value{unset.length === 1 ? '' : 's'} still to set:{' '}
              <span style={{ ...T.mono }}>{unset.join(', ')}</span></>
          ) : (
            <>Every required value is set. Nothing has been checked against the real service yet —
              press <em>Check everything now</em> to find out whether they work.</>
          )}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {vars.map((name) => {
            const isSet = envState.set.includes(name);
            const optional = spec.optional.includes(name);
            return (
              <label key={name} style={{ display: 'grid', gap: 4 }}>
                <span style={{ ...T.micro, color: C.secondary, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ ...T.mono, color: C.primary }}>{name}</span>
                  {optional && <span style={{ color: C.quaternary }}>optional</span>}
                  {}
                  {isSet && <span style={{ color: C.nominal }}>● already set</span>}
                  {envState.processOnly?.includes(name) && (
                    <span style={{ color: C.caution }}>▲ in this process only — lost on restart</span>
                  )}
                </span>
                <input
                  type={SECRETISH.test(name) ? 'password' : 'text'}
                  autoComplete="off" spellCheck={false} disabled={busy}
                  value={values[name] ?? ''}
                  onChange={(e) => onChange(name, e.target.value)}
                  placeholder={isSet ? 'leave blank to keep the current value' : (HINT[name] ?? '')}
                  style={{
                    ...T.callout, ...NUM, padding: '8px 12px',
                    borderRadius: 'var(--radius-capsule)', border: `1px solid ${C.rim}`,
                    background: C.quiet, color: C.primary, outline: 'none', width: '100%',
                  }}
                />
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MonthState({ months }) {
  if (!months?.length) {
    return <div style={{ ...T.footnote, color: C.tertiary }}>No month has been started on this machine.</div>;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {months.map((m) => {
        const tone = m.lock ? C.caution : m.complete ? C.nominal : m.partial ? C.caution : C.quaternary;
        const word = m.lock ? 'LOCKED' : m.complete ? 'complete' : m.partial ? 'PARTIAL — would resume' : 'not started';
        return (
          <div key={m.month} style={{
            display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap',
            padding: '8px 12px', border: `1px solid ${C.hairline}`,
            borderRadius: 'var(--radius-capsule)', background: C.quiet,
          }}>
            <span style={{ ...T.mono, ...NUM, color: C.primary }}>{m.month}</span>
            <span style={{ ...T.micro, color: tone }}>
              <span aria-hidden="true">{m.lock ? '▲ ' : m.complete ? '● ' : m.partial ? '◐ ' : '○ '}</span>{word}
            </span>
            <span style={{ ...T.footnote, color: C.secondary }}>
              {m.stages.length ? `stages ${m.stages.join(', ')}` : 'nothing recorded'}
              {m.booksAssembled != null && ` · ${m.booksAssembled} assembled`}
              {m.reportsBuilt != null && ` · ${m.reportsBuilt} built`}
            </span>
            {m.lock && (
              <span style={{ ...T.footnote, color: C.caution, width: '100%' }}>
                Held by {m.lock.runId ?? 'an unknown run'} on {m.lock.host ?? 'this machine'} (pid {m.lock.pid ?? '?'}),
                last heartbeat {m.lock.ageHours}h ago
                {m.lock.likelyStale
                  ? ' — older than the two-hour staleness window, so a new run will take it over.'
                  : ' — a new run on this month will be refused while that one is alive.'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Credentials() {
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  const fetchState = useCallback(async (check) => {
    const r = await fetch(withBase(`/api/console/credentials${check ? '?check=1' : ''}`), { cache: 'no-store' });
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    return r.json();
  }, []);

  const load = useCallback(async (check) => {
    setBusy(true); setError(null);
    try { setData(await fetchState(check)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [fetchState]);

  useEffect(() => {
    let alive = true;
    fetchState(false)
      .then((j) => { if (alive) setData(j); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [fetchState]);

  const save = async () => {
    const toSend = Object.fromEntries(Object.entries(values).filter(([, v]) => String(v).trim() !== ''));
    if (!Object.keys(toSend).length) { setError('Nothing to save — every field is blank.'); return; }
    setBusy(true); setError(null); setSaved(null);
    try {
      const r = await fetch(withBase('/api/console/credentials'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: toSend, check: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `the server answered ${r.status}`);
      setData(j);

      setValues({});
      setSaved(j.written);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const validation = data?.validation?.groups ?? null;

  const ordered = useMemo(() => [...(data?.groups ?? [])].sort((a, b) =>
    stateOf(validation?.[b.group]?.status).rank - stateOf(validation?.[a.group]?.status).rank), [data, validation]);

  const ready = data?.validation ? Object.values(validation).every((g) => g.status === 'pass') : null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px 80px' }}>
      <h2 style={{ ...T.title3, color: C.primary, margin: 0 }}>Credentials</h2>
      <p style={{ ...T.callout, color: C.secondary, marginTop: 8 }}>
        Every check here is a real round trip — a LIST against the bucket, a read and a
        deliberately-invalid write against Convin, an INBOX open, a query. Whether a variable is
        set is a different question from whether it works, and only the second one is asked.
      </p>
      <p style={{ ...T.footnote, color: C.tertiary, marginTop: 6 }}>
        Values are written to <span style={T.mono}>.env.local</span> on the server and are never
        sent back to this page. Fields stay blank even after a value is saved.
      </p>

      <div style={{ display: 'flex', gap: 10, margin: '20px 0 24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="cx-btn cx-sm" onClick={() => load(true)} disabled={busy}>
          {busy ? 'Checking…' : 'Check everything now'}
        </button>
        <button type="button" className="cx-btn cx-ghost cx-sm" onClick={save} disabled={busy}>Save and re-check</button>
        {ready === true && <span style={{ ...T.micro, color: C.nominal }}>● every system answered</span>}
        {ready === null && <span style={{ ...T.micro, color: C.tertiary }}>· nothing checked yet</span>}
        {ready === false && (
          <span style={{ ...T.micro, color: C.caution }}>
            ◐ {data.validation.blocking.length} still to resolve — a month will not run cleanly yet
          </span>
        )}
      </div>

      {error && (
        <div role="alert" style={{
          ...T.footnote, color: C.abort, border: `1px solid ${C.rim}`, background: C.quiet,
          borderRadius: 'var(--radius-card)', padding: '10px 14px', marginBottom: 16,
        }}>▲ {error}</div>
      )}
      {saved?.written?.length > 0 && (
        <div style={{
          ...T.footnote, color: C.secondary, border: `1px solid ${C.rim}`, background: C.quiet,
          borderRadius: 'var(--radius-card)', padding: '10px 14px', marginBottom: 16,
        }}>
          Wrote <span style={T.mono}>{saved.written.join(', ')}</span> to {saved.path}.
          {saved.trimmed?.length > 0 && (
            <> Surrounding whitespace was removed from <span style={T.mono}>{saved.trimmed.join(', ')}</span> —
            a trailing newline in a pasted secret is the usual cause of a credential that looks right and is not.</>
          )}
        </div>
      )}

      {ordered.map((spec) => (
        <Group
          key={spec.group} spec={spec} envState={data.env} result={validation?.[spec.group]}
          values={values} busy={busy}
          onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
        />
      ))}

      <h3 style={{ ...T.headline, color: C.primary, margin: '32px 0 4px' }}>What is already on this machine</h3>
      <p style={{ ...T.footnote, color: C.tertiary, margin: '0 0 12px' }}>
        A month with stages recorded will <em>resume</em>, not start over. Worth knowing before pressing Run.
      </p>
      <MonthState months={data?.months} />
    </div>
  );
}
