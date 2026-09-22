import { NextResponse } from 'next/server';
import { searchNBAPlayers } from '@/lib/nba/players';

export const revalidate = 120;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? '';
  try {
    return NextResponse.json({ data: await searchNBAPlayers(query) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
