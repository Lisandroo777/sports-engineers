import { NextResponse } from 'next/server';
import { getNBAInjuryStatuses } from '@/lib/nba/injuries';

export const revalidate = 120;

export async function GET() {
  try {
    return NextResponse.json({ data: await getNBAInjuryStatuses() });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
