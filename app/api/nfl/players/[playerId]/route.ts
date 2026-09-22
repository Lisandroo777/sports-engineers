import { NextResponse } from 'next/server';
import { getNFLPlayer } from '@/lib/nfl/players';

export const revalidate = 3600;

export async function GET(_: Request, { params }: { params: Promise<{ playerId: string }> }) {
  try {
    return NextResponse.json({ data: await getNFLPlayer((await params).playerId) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
