import { NextResponse } from 'next/server';
import { getEventProps } from '@/lib/odds/eventProps';
import { getLastOddsCreditInfo } from '@/lib/odds/client';
import { buildMarketConsensusOpportunities } from '@/lib/odds/opportunities';

export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const home = searchParams.get('home');
  const away = searchParams.get('away');
  if (!home || !away) return NextResponse.json({ error: 'home and away query params are required.' }, { status: 400 });
  try {
    const result = await getEventProps(home, away);
    return NextResponse.json({ data: buildMarketConsensusOpportunities(result.props), event: result.event, credits: getLastOddsCreditInfo() });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
