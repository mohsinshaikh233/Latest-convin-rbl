'use client';

const SYSTEMS = [
  {
    id: 's3',
    name: 'Amazon S3',
    what: 'books + status',

    proof: null,
  },
  {
    id: 'db',
    name: 'Postgres',
    what: 'report store',
    proof: 'db.connect',
  },
  {
    id: 'imap',
    name: 'Mailbox · IMAP',
    what: 'export delivery',
    proof: null,
  },
  {
    id: 'convinAuth',
    name: 'Convin API',
    what: 'call-log export',
    proof: null,

    awaited: true,
  },
];

export default function Connections({ preflight, mode }) {
  const groups = preflight?.groups ?? [];
  const byId = Object.fromEntries(groups.map((g) => [g.group, g]));
  if (preflight?.convinAuth) byId.convinAuth = preflight.convinAuth;
  const checks = Object.fromEntries((preflight?.checks ?? []).map((c) => [c.id, c]));

  const live = SYSTEMS.filter((s) => byId[s.id]?.ok).length;

  return (
    <>
      <div className="cx-creds">
        {SYSTEMS.map((s) => {
          const g = byId[s.id];
          const set = !!g?.ok;

          const check = s.proof ? checks[s.proof] : null;
          const reachable = check ? check.status === 'pass' : null;
          const ok = set && reachable !== false;
          const pending = !set && s.awaited;

          return (
            <div key={s.id} className={`cx-panel cx-cred${pending ? ' cx-pending' : ''}`}>
              <div className="cx-cn">{s.name}</div>
              <div className="cx-cd">{s.what}</div>

              <span className={`cx-badge ${ok ? 'cx-ok' : pending ? 'cx-wait' : 'cx-off'}`}>
                {(ok || pending) && <span className="cx-pulse" aria-hidden />}
                {}
                {ok ? 'connected' : pending ? 'monday' : 'not set'}
              </span>

              {}
              {!set && g?.missing?.length > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: 'var(--content-quaternary)',
                    wordBreak: 'break-all',
                  }}
                >
                  {g.missing.join(' ')}
                </div>
              )}
              {ok && check?.detail && (
                <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, color: 'var(--content-quaternary)' }}>
                  {check.detail}
                </div>
              )}
              {ok && s.id === 'convinAuth' && preflight?.convinAuth?.via && (
                <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--content-quaternary)' }}>
                  via {preflight.convinAuth.via}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {}
      {live < SYSTEMS.length && (
        <div className="cx-note">
          <b>{SYSTEMS.length - live} outstanding.</b>{' '}
          {mode === 'replay'
            ? 'REPLAY does not need them. It reads this month’s sources from the folder you pick and serves stage 03 from a call log already on disk — every other stage does its real work and the PDFs at the end are real. When the missing key lands, this card turns green and nothing else changes.'
            : 'LIVE cannot start until each one answers. A missing key stops the run rather than producing a report with a hole in it.'}
        </div>
      )}
      {}
      {preflight?.checks?.length > 0 && (
        <div className="cx-panel" style={{ marginTop: 14, padding: '16px 18px' }}>
          <div className="cx-mk" style={{ marginTop: 0, marginBottom: 12 }}>
            The machine · stage 00, run for real
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '10px 18px' }}>
            {preflight.checks
              .filter((c) => c.kind !== 'config' || c.status !== 'fail')
              .map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                  <span
                    aria-hidden
                    style={{
                      width: 5, height: 5, borderRadius: '50%', flex: 'none', marginTop: 6,
                      background: c.status === 'pass' ? 'var(--sig-nominal)'
                        : c.status === 'fail' ? 'var(--sig-abort)'
                          : c.status === 'skip' ? 'var(--content-quaternary)' : 'var(--sig-caution)',
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--content-primary)' }}>
                      {c.label}{' '}
                      {}
                      <span
                        style={{
                          fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase',
                          color: c.status === 'pass' ? 'var(--sig-nominal)'
                            : c.status === 'fail' ? 'var(--sig-abort)'
                              : c.status === 'skip' ? 'var(--content-quaternary)' : 'var(--sig-caution)',
                        }}
                      >
                        {c.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--content-quaternary)' }}>{c.detail}</div>
                  </div>
                </div>
              ))}
          </div>
          {preflight.scopeNote && (
            <div style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.55, color: 'var(--content-quaternary)' }}>
              {preflight.scopeNote}
            </div>
          )}
        </div>
      )}

      {live === SYSTEMS.length && (
        <div className="cx-note cx-plain">
          <b>All four answer.</b> LIVE can run the month end to end. The first LIVE run of any
          month still reports instead of firing — see the run control below.
        </div>
      )}
    </>
  );
}
