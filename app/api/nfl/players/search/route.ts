import { NextResponse } from 'next/server';
import { searchNFLPlayers } from '@/lib/nfl/players';

export const revalidate = 120;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? '';
  try {
    return NextResponse.json({ data: await searchNFLPlayers(query) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
