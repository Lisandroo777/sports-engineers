import { NextResponse } from 'next/server';
import { getNFLTeams } from '@/lib/nfl/teams';

export const revalidate = 86400;

export async function GET() {
  try {
    return NextResponse.json({ data: await getNFLTeams() });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
