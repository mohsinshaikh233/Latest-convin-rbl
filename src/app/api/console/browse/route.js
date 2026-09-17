import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/console/auth.mjs';
import { listDir, browseRoot, OutsideRootError } from '../../../../lib/console/browse.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const requested = new URL(request.url).searchParams.get('path');
  try {
    return NextResponse.json(listDir(requested));
  } catch (e) {
    if (e instanceof OutsideRootError) {
      return NextResponse.json({ error: 'That folder is outside the browse root.', root: browseRoot() }, { status: 403 });
    }
    if (e.code === 'ENOENT') return NextResponse.json({ error: e.message, root: browseRoot() }, { status: 404 });
    if (e.code === 'EACCES') return NextResponse.json({ error: e.message, root: browseRoot() }, { status: 403 });
    return NextResponse.json({ error: `could not list that folder: ${e.message}` }, { status: 500 });
  }
}
