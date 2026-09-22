import { NextResponse } from 'next/server';
import { getNBAPlayerGameLogs } from '@/lib/nba/stats';

export const revalidate = 900;

export async function GET(_request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  try {
    const { playerId } = await params;
    return NextResponse.json({ data: await getNBAPlayerGameLogs(playerId) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
