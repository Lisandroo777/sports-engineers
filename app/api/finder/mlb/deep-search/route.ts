import { NextResponse } from 'next/server';
import { runFinderDeepSearch, type FinderRunSummary } from '@/lib/finder/engine';
import { resolveSlateDate } from '@/lib/dateModel';

export const revalidate = 0;

const CACHE_TTL_MS = 15 * 60 * 1000;
const cacheByDate = new Map<string, { expires: number; data: FinderRunSummary }>();
const inFlightByDate = new Map<string, Promise<FinderRunSummary>>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slateDate = resolveSlateDate(params.get('date'));

  // Validation/dev-only escape hatch for one controlled live test. Absent = normal production run
  // over every eligible game. These bypass the shared cache so a validation request never pollutes
  // (or is served by) the normal slate cache.
  const toPositiveInt = (raw: string | null) => {
    const n = Number(raw);
    return raw != null && Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const validationMaxGames = toPositiveInt(params.get('validationMaxGames'));
  const validationMaxCredits = toPositiveInt(params.get('validationMaxCredits'));
  const preflight = params.get('preflight') === '1';

  if (validationMaxGames != null || validationMaxCredits != null || preflight) {
    try {
      const data = await runFinderDeepSearch(slateDate, { validationMaxGames, validationMaxCredits, preflight });
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
    let inFlight = inFlightByDate.get(slateDate);
    if (!inFlight) {
      inFlight = runFinderDeepSearch(slateDate).finally(() => { inFlightByDate.delete(slateDate); });
      inFlightByDate.set(slateDate, inFlight);
    }
    const data = await inFlight;
    cacheByDate.set(slateDate, { expires: Date.now() + CACHE_TTL_MS, data });
    return NextResponse.json({ data, cached: false });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
