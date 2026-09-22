import { NextResponse } from 'next/server';
import { getPlayerGameLogs } from '@/lib/nfl/stats';

export const revalidate = 900;

export async function GET(_: Request, { params }: { params: Promise<{ playerId: string }> }) {
  try {
    return NextResponse.json({ data: await getPlayerGameLogs((await params).playerId) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
