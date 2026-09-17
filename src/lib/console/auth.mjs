import { NextResponse } from 'next/server';

export const UNAUTHORIZED = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export function operator(request) {
  const raw = request.cookies.get('auth_user');
  try { return raw ? decodeURIComponent(raw.value) : 'operator'; } catch { return 'operator'; }
}

export function requireAuth(request) {
  const session = request.cookies.get('auth_session');
  return !session || session.value !== 'true' ? UNAUTHORIZED() : null;
}
