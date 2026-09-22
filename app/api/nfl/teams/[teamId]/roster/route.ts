import { NextResponse } from 'next/server';
import { getNFLRoster } from '@/lib/nfl/rosters';

export const revalidate = 3600;

export async function GET(_: Request, { params }: { params: Promise<{ teamId: string }> }) {
  try {
    return NextResponse.json({ data: await getNFLRoster((await params).teamId) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
