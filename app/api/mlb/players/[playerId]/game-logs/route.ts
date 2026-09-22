import { NextResponse } from 'next/server';
import { getPlayerGameLogs } from '@/lib/mlb/stats';

export const revalidate = 3600;

export async function GET(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const season = Number(new URL(request.url).searchParams.get('season')) || new Date().getUTCFullYear();
  try {
    return NextResponse.json({ data: await getPlayerGameLogs((await params).playerId, season) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
