import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

const COOKIE = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
const WEEK = 60 * 60 * 24 * 7;

function pretty(name) {
  return String(name || '')
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 40);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length) {
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    const configured = process.env.DASHBOARD_PASSWORD;
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd && !configured) {
      console.error('DASHBOARD_PASSWORD is not set — refusing all logins.');
      return NextResponse.json(
        { success: false, error: 'This deployment is not configured. DASHBOARD_PASSWORD is missing.' },
        { status: 503 },
      );
    }
    const targetPassword = configured || 'rblrecovery2026';
    const allowedUser = process.env.DASHBOARD_USER;

    if (!username || !String(username).trim()) {
      return NextResponse.json({ success: false, error: 'Enter your username' }, { status: 400 });
    }
    if (allowedUser && String(username).trim().toLowerCase() !== allowedUser.toLowerCase()) {
      return NextResponse.json({ success: false, error: 'Incorrect username or password' }, { status: 401 });
    }
    if (!safeEqual(password, targetPassword)) {
      return NextResponse.json({ success: false, error: 'Incorrect username or password' }, { status: 401 });
    }

    const name = pretty(username);
    const res = NextResponse.json({ success: true, name });
    res.cookies.set('auth_session', 'true', { ...COOKIE, maxAge: WEEK });
    res.cookies.set('auth_user', encodeURIComponent(name), { ...COOKIE, maxAge: WEEK });
    return res;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
}

export async function GET() {
  const res = NextResponse.json({ success: true });
  res.cookies.set('auth_session', '', { ...COOKIE, maxAge: -1 });
  res.cookies.set('auth_user', '', { ...COOKIE, maxAge: -1 });
  return res;
}
