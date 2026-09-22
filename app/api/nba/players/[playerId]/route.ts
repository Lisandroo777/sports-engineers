import { NextResponse } from 'next/server';
import { getNBAPlayer } from '@/lib/nba/players';

export const revalidate = 3600;

export async function GET(_request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  try {
    const { playerId } = await params;
    return NextResponse.json({ data: await getNBAPlayer(playerId) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
