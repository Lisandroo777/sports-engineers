import { NextResponse } from 'next/server';
import { getMLBTeamRecord } from '@/lib/mlb/records';

export const revalidate = 900;

export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const season = Number(new URL(request.url).searchParams.get('season')) || new Date().getUTCFullYear();
  try {
    return NextResponse.json({ data: await getMLBTeamRecord((await params).teamId, season) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
