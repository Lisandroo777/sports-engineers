import { NextResponse } from 'next/server';
import { getMLBActiveRoster } from '@/lib/mlb/rosters';

export const revalidate = 300;

export async function GET(_: Request, { params }: { params: Promise<{ teamId: string }> }) {
  try {
    return NextResponse.json({ data: await getMLBActiveRoster((await params).teamId) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
