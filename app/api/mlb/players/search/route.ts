import { NextResponse } from 'next/server';
import { searchMLBPlayers } from '@/lib/mlb/players';

export const revalidate = 300;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!query) return NextResponse.json({ data: [] });
  try {
    return NextResponse.json({ data: await searchMLBPlayers(query) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
