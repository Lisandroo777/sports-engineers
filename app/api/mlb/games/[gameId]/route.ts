import { NextResponse } from 'next/server';
import { getMLBGame } from '@/lib/mlb/games';

export const revalidate = 60;

export async function GET(_: Request, { params }: { params: Promise<{ gameId: string }> }) {
  try {
    const game = await getMLBGame((await params).gameId);
    if (!game) return NextResponse.json({ error: 'Data unavailable.' }, { status: 404 });
    return NextResponse.json({ data: game });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
