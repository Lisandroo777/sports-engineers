import { NextResponse } from 'next/server';
import { getEventMarkets, getLastOddsCreditInfo } from '@/lib/odds/client';

export const revalidate = 0;

export async function GET(_: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const markets = await getEventMarkets((await params).eventId);
    return NextResponse.json({ data: markets, credits: getLastOddsCreditInfo() });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
