import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NBAFinderSummary } from '../../../../../lib/finder/nbaEngine';

const { finder } = vi.hoisted(() => ({ finder: vi.fn() }));
vi.mock('@/lib/finder/nbaEngine', () => ({ runNBAFinderDeepSearch: finder }));
vi.mock('@/lib/dateModel', () => ({ resolveSlateDate: (date: string | null) => date ?? '2026-10-18' }));

function deferred() {
  let resolve!: (value: NBAFinderSummary) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<NBAFinderSummary>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function request(date = '2026-10-18', query = '') {
  return new Request(`http://localhost/api/finder/nba/deep-search?date=${date}${query}`);
}

const summary = { slateDate: '2026-10-18', nbaCandidates: [], results: [], researchComplete: false, partialCoverage: true } as unknown as NBAFinderSummary;

beforeEach(() => {
  vi.resetModules();
  finder.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('NBA default-route in-flight sharing', () => {
  it('runs the finder once for concurrent same-date calls and then serves the cache', async () => {
    const pending = deferred();
    finder.mockReturnValueOnce(pending.promise);
    const { GET } = await import('./route');
    const first = GET(request());
    const second = GET(request());
    expect(finder).toHaveBeenCalledTimes(1);
    expect(finder).toHaveBeenCalledWith('2026-10-18');
    pending.resolve(summary);
    const responses = await Promise.all([first, second]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: summary, cached: false });
    }
    expect(await (await GET(request())).json()).toEqual({ data: summary, cached: true });
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('shares rejection without fabricating picks and retries after cleanup', async () => {
    const pending = deferred();
    finder.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(summary);
    const { GET } = await import('./route');
    const first = GET(request());
    const second = GET(request());
    pending.reject(new Error('Provider unavailable'));
    for (const response of await Promise.all([first, second])) {
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'Data unavailable.' });
    }
    expect(finder).toHaveBeenCalledTimes(1);
    expect((await GET(request())).status).toBe(200);
    expect(finder).toHaveBeenCalledTimes(2);
  });

  it('does not share work across different slate dates', async () => {
    const firstPending = deferred();
    const secondPending = deferred();
    finder.mockReturnValueOnce(firstPending.promise).mockReturnValueOnce(secondPending.promise);
    const { GET } = await import('./route');
    const first = GET(request());
    const second = GET(request('2026-10-19'));
    expect(finder).toHaveBeenCalledTimes(2);
    firstPending.resolve(summary);
    secondPending.resolve({ ...summary, slateDate: '2026-10-19' });
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it.each(['&preflight=1', '&validationMaxGames=1', '&validationMaxCredits=31'])(
    'keeps %s requests outside default sharing and caching', async (query) => {
      const pending = deferred();
      finder.mockReturnValueOnce(pending.promise).mockResolvedValue(summary);
      const { GET } = await import('./route');
      const normal = GET(request());
      const validation = await GET(request('2026-10-18', query));
      expect(await validation.json()).toEqual({ data: summary, cached: false, validationMode: true });
      expect(finder).toHaveBeenCalledTimes(2);
      pending.resolve(summary);
      await normal;
      await GET(request('2026-10-18', query));
      expect(finder).toHaveBeenCalledTimes(3);
    },
  );
});