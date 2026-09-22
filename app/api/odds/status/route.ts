import { NextResponse } from 'next/server';
import { isOddsApiConfigured } from '@/lib/odds/client';

export async function GET() {
  return NextResponse.json({ configured: isOddsApiConfigured() });
}
