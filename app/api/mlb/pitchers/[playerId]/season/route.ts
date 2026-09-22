import { NextResponse } from 'next/server';
import { getMLBPitcherSeasonStats } from '@/lib/mlb/pitcherStats';

export const revalidate = 900;

export async function GET(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const season = Number(new URL(request.url).searchParams.get('season')) || new Date().getUTCFullYear();
  try {
    return NextResponse.json({ data: await getMLBPitcherSeasonStats((await params).playerId, season) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
