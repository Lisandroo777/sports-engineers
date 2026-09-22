import { NextResponse } from 'next/server';
import { getMLBSchedule } from '@/lib/mlb/schedule';

export const revalidate = 60;

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get('date') ?? undefined;
  try {
    return NextResponse.json({ data: await getMLBSchedule(date) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
