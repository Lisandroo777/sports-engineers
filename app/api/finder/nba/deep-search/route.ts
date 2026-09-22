import { NextResponse } from 'next/server';
import { runNBAFinderDeepSearch } from '@/lib/finder/nbaEngine';
import { resolveSlateDate } from '@/lib/dateModel';
import type { FinderRunSummary } from '@/lib/finder/engine';

export const revalidate = 0;

const CACHE_TTL_MS = 15 * 60 * 1000;
const cacheByDate = new Map<string, { expires: number; data: FinderRunSummary }>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slateDate = resolveSlateDate(params.get('date'));

  const toPositiveInt = (raw: string | null) => {
    const n = Number(raw);
    return raw != null && Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const validationMaxGames = toPositiveInt(params.get('validationMaxGames'));
  const validationMaxCredits = toPositiveInt(params.get('validationMaxCredits'));
  const preflight = params.get('preflight') === '1';

  if (validationMaxGames != null || validationMaxCredits != null || preflight) {
    try {
      const data = await runNBAFinderDeepSearch(slateDate, { validationMaxGames, validationMaxCredits, preflight });
      return NextResponse.json({ data, cached: false, validationMode: true });
    } catch {
      return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
    }
  }

  try {
    const cached = cacheByDate.get(slateDate);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json({ data: cached.data, cached: true });
    }
    const data = await runNBAFinderDeepSearch(slateDate);
    cacheByDate.set(slateDate, { expires: Date.now() + CACHE_TTL_MS, data });
    return NextResponse.json({ data, cached: false });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
