import { NextResponse } from 'next/server';
import { getNBATeamStats } from '@/lib/nba/teamStats';

export const revalidate = 900;

export async function GET(_request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  try {
    const { teamId } = await params;
    return NextResponse.json({ data: await getNBATeamStats(teamId) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
