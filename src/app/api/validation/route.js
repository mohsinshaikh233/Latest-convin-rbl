import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const v = (await import('@/data/validation.json')).default;
    return NextResponse.json(v);
  } catch {
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
