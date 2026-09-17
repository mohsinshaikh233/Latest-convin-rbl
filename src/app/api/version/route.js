import { NextResponse } from 'next/server';
import { PAYLOAD_VERSION } from '../../../lib/payload_version.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    payloadVersion: PAYLOAD_VERSION,

    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    branch: process.env.VERCEL_GIT_COMMIT_REF || 'local',
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] || '',
    env: process.env.VERCEL_ENV || 'development',

    database: process.env.DATABASE_URL ? 'connected' : 'NOT SET',
  });
}
