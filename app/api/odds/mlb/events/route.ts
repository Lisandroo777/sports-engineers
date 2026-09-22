import { NextResponse } from 'next/server';
import { getOddsEvents, getLastOddsCreditInfo } from '@/lib/odds/client';

export const revalidate = 0;

export async function GET() {
  try {
    const events = await getOddsEvents();
    return NextResponse.json({ data: events, credits: getLastOddsCreditInfo() });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
