import { NextResponse } from 'next/server';
import { getEventPlayerProps, getLastOddsCreditInfo } from '@/lib/odds/client';
import type { AlternateOddsMarketKey } from '@/lib/odds/types';

const TEST_MARKETS: AlternateOddsMarketKey[] = ['batter_hits_alternate', 'batter_home_runs_alternate'];

export const revalidate = 0;

export async function GET(_: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const props = await getEventPlayerProps((await params).eventId, TEST_MARKETS);
    return NextResponse.json({ data: props, credits: getLastOddsCreditInfo() });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
