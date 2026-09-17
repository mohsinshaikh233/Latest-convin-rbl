import { NextResponse } from 'next/server';
import { resolveShare, sanitizeForShare } from '../../../../lib/share.mjs';
import { batchPayload, manifest } from '../../../../lib/backend.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { token } = await params;
  const share = await resolveShare(token);

  const deny = () => NextResponse.json(
    { error: 'This link is not valid, or it has expired.' }, { status: 404 },
  );

  if (!share) return deny();

  const wanted = new URL(request.url).searchParams.get('batch');
  let batchId = share.batchId;
  let tabs = [];
  let display = '';

  if (share.scope === 'date') {
    const man = await manifest();
    const day = (man.dates || []).find((d) => d.date === share.reportDate);
    if (!day) return deny();

    display = day.display;

    tabs = [
      { id: day.dayTotal, label: 'Day Total', meta: `${Number(day.rowCount || 0).toLocaleString('en-IN')} accounts` },
      ...(day.uploads || []).map((u) => ({
        id: u.id,
        label: String(u.label || '').replace(/^Upload\b/i, 'Day') || 'Day',
        meta: u.time || '',
      })),
    ];

    const allowed = new Set(tabs.map((t) => t.id));

    if (wanted) {
      if (!allowed.has(wanted)) return deny();
      batchId = wanted;
    } else if (!allowed.has(batchId)) {
      batchId = day.dayTotal;
    }
  } else if (wanted && wanted !== share.batchId) {
    return deny();
  }

  const payload = await batchPayload(batchId);
  if (!payload) {
    return NextResponse.json({ error: 'The report behind this link no longer exists.' }, { status: 404 });
  }

  const res = NextResponse.json({
    ok: true,
    label: share.label,
    expiresAt: share.expiresAt,
    scope: share.scope,
    date: share.reportDate,
    display,
    tabs,
    batchId,
    payload: sanitizeForShare(payload),
  });

  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}
