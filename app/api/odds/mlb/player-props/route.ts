import { NextResponse } from 'next/server';
import { getPlayerProps } from '@/lib/odds/playerProps';
import { getLastOddsCreditInfo } from '@/lib/odds/client';

export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const player = searchParams.get('player');
  const team = searchParams.get('team');
  const isPitcher = searchParams.get('pitcher') === 'true';
  if (!player || !team) {
    return NextResponse.json({ error: 'player and team query params are required.' }, { status: 400 });
  }
  try {
    const result = await getPlayerProps(player, team, isPitcher);
    return NextResponse.json({ data: result, credits: getLastOddsCreditInfo() });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
