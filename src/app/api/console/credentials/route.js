import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/console/auth.mjs';
import {
  GROUPS, OPTIONAL, GROUP_LABELS, validateAll, validateGroup, envStatus, writeEnvLocal, monthStates,
} from '../../../../lib/console/credentials.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SHOWN = Object.keys(GROUPS).filter((g) => g !== 'convinAuth');
const ALL_KEYS = [...new Set(SHOWN.flatMap((g) => GROUPS[g]).concat(Object.values(OPTIONAL).flat()))];

function shape(extra = {}) {
  return {
    groups: SHOWN.map((group) => ({
      group,
      label: GROUP_LABELS[group] ?? group,
      required: GROUPS[group],
      optional: OPTIONAL[group] ?? [],
    })),
    env: envStatus(ALL_KEYS),
    months: monthStates(),
    ...extra,
  };
}

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const wantCheck = url.searchParams.get('check') === '1';
  const only = url.searchParams.get('group');

  if (!wantCheck) return NextResponse.json(shape());

  if (only) {
    if (!SHOWN.includes(only)) return NextResponse.json({ error: `no such group: ${only}` }, { status: 400 });
    const one = await validateGroup(only);
    return NextResponse.json(shape({ validation: { checkedAt: one.checkedAt, groups: { [only]: one } } }));
  }
  return NextResponse.json(shape({ validation: await validateAll(process.env, SHOWN) }));
}

export async function POST(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'body must be JSON' }, { status: 400 }); }

  const values = body?.values ?? {};
  if (typeof values !== 'object' || Array.isArray(values)) {
    return NextResponse.json({ error: 'values must be an object of NAME → value' }, { status: 400 });
  }

  const names = Object.keys(values);
  const unknown = names.filter((n) => !ALL_KEYS.includes(n));
  if (unknown.length) {
    return NextResponse.json({
      error: `not variables this screen manages: ${unknown.join(', ')}`,
      allowed: ALL_KEYS,
    }, { status: 400 });
  }
  const empty = names.filter((n) => String(values[n] ?? '').trim() === '');
  if (empty.length) {
    return NextResponse.json({
      error: `refusing to write empty value(s) for ${empty.join(', ')} — clearing a credential is not something this form does by accident`,
    }, { status: 400 });
  }

  const written = writeEnvLocal(values);

  const touched = SHOWN.filter((g) => [...GROUPS[g], ...(OPTIONAL[g] ?? [])].some((k) => names.includes(k)));
  const validation = body?.check === false
    ? null
    : await validateAll(process.env, touched.length ? touched : SHOWN);

  return NextResponse.json(shape({ written, validation }));
}
