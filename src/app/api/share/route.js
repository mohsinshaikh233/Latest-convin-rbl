import { NextResponse } from 'next/server';
import { createShare, listShares, revokeShare } from '../../../lib/share.mjs';
import { publicBaseUrl } from '../../../lib/publicurl.mjs';
import { BASE_PATH } from '../../../lib/basepath.mjs';

export const dynamic = 'force-dynamic';

const authed = (req) => req.cookies.get('auth_session')?.value === 'true';

export async function POST(request) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { batchId, reportDate, label, days } = await request.json();
    if (!batchId || !reportDate) {
      return NextResponse.json({ error: 'batchId and reportDate are required' }, { status: 400 });
    }

    const d = Math.min(365, Math.max(0, Number(days) || 0));
    const row = await createShare({ batchId, reportDate, label, days: d });

    const base = publicBaseUrl(request);
    return NextResponse.json({
      ok: true,
      token: row.token,
      url: `${base.url}${BASE_PATH}/r/${row.token}`,
      source: base.source,
      expiresAt: row.expires_at,
      label: row.label,
    });
  } catch (e) {
    console.error('share create', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(request) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ shares: await listShares() });
}

export async function DELETE(request) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  await revokeShare(token);
  return NextResponse.json({ ok: true, revoked: token });
}
