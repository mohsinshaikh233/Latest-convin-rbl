import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/console/auth.mjs';
import { GROUPS, check } from '../../../../../scripts/pipeline/config.mjs';
import { browseRoot } from '../../../../lib/console/browse.mjs';
import { preflight } from '../../../../lib/console/preflight.mjs';
import { liveDryRunDone } from '../../../../lib/console/runner.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || '';
  const mode = url.searchParams.get('mode') === 'replay' ? 'replay' : 'live';

  const groups = Object.keys(GROUPS).map((group) => {
    const { ok, missing } = check(group);
    return { group, ok, missing, needs: GROUPS[group] };
  });

  const hasToken = !!process.env.CONVIN_TOKEN?.trim();
  const hasLogin = !!process.env.CONVIN_EMAIL?.trim() && !!process.env.CONVIN_PASSWORD?.trim();
  const convinAuth = {
    group: 'convinAuth',
    ok: hasToken || hasLogin,
    via: hasToken ? 'CONVIN_TOKEN' : hasLogin ? 'CONVIN_EMAIL + CONVIN_PASSWORD' : null,
    missing: hasToken || hasLogin ? [] : ['CONVIN_TOKEN', 'or CONVIN_EMAIL + CONVIN_PASSWORD'],
  };

  const byName = Object.fromEntries(groups.map((g) => [g.group, g]));
  const missingFor = (names) => names.flatMap((n) => (n === 'convinAuth' ? convinAuth.missing : byName[n]?.missing ?? []));

  const modes = {
    live: {
      label: 'LIVE',
      touches: ['S3 (books + status files)', 'Convin export queue', 'the IMAP mailbox', 'Postgres', 'Chrome'],
      requires: ['s3', 'convin', 'convinAuth', 'imap'],
      available: ['s3', 'convin', 'imap'].every((g) => byName[g]?.ok) && convinAuth.ok,
      missing: missingFor(['s3', 'convin', 'convinAuth', 'imap']),
    },
    replay: {
      label: 'REPLAY',
      touches: ['the folder you pick', 'Postgres', 'Chrome'],
      requires: [],
      available: true,
      missing: [],
      note: 'Stage 03 is served from call logs already on disk instead of calling Convin. Every other stage does its real work and the PDFs at the end are real.',
    },
  };

  const flight = /^\d{4}-\d{2}$/.test(month) ? await preflight(month, mode) : null;

  return NextResponse.json({
    month, mode, groups, convinAuth, modes,

    liveDryRunDone: /^\d{4}-\d{2}$/.test(month) ? liveDryRunDone(month) : false,
    browseRoot: browseRoot(),
    ...(flight ?? { checks: [], scopeNote: 'give a month to run the real stage 00' }),
  });
}
