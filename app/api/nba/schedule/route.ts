import { NextResponse } from 'next/server';
import { getNBASchedule } from '@/lib/nba/schedule';
import { isValidSlateDate } from '@/lib/dateModel';

export const revalidate = 300;

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get('date');
  try {
    return NextResponse.json({ data: await getNBASchedule(isValidSlateDate(date) ? date : undefined) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
