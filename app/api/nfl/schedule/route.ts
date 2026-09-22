import { NextResponse } from 'next/server';
import { getNFLSchedule } from '@/lib/nfl/schedule';
import { isValidSlateDate } from '@/lib/dateModel';

export const revalidate = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const weekParam = params.get('week');
  const dateParam = params.get('date');
  const week = weekParam ? Number(weekParam) : undefined;
  const date = isValidSlateDate(dateParam) ? dateParam : undefined;
  try {
    return NextResponse.json({ data: await getNFLSchedule({ week, date }) });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
