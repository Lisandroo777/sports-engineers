import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espnSiteFetch, espnWebFetch, NFLDataUnavailableError } from '../nfl/client';
import { withNFLResearchSnapshot } from '../nfl/researchSnapshot';
import { mlbFetch, MLBDataUnavailableError } from '../mlb/client';
import { espnNBASiteFetch, espnNBAWebFetch, NBADataUnavailableError } from '../nba/client';

const clients = [
  { name: 'NFL site', load: () => espnSiteFetch('scoreboard', { dates: '20261018' }, 120), error: NFLDataUnavailableError, host: 'site.api.espn.com' },
  { name: 'NFL web', load: () => espnWebFetch('common/v3/sports/football/nfl/athletes/1', {}, 120), error: NFLDataUnavailableError, host: 'site.web.api.espn.com' },
  { name: 'MLB', load: () => mlbFetch('schedule?sportId=1', { revalidate: 120 }), error: MLBDataUnavailableError, host: 'statsapi.mlb.com' },
  { name: 'NBA site', load: () => espnNBASiteFetch('scoreboard', { dates: '20261018' }, 120), error: NBADataUnavailableError, host: 'site.api.espn.com' },
  { name: 'NBA web', load: () => espnNBAWebFetch('common/v3/sports/basketball/nba/athletes/1', {}, 120), error: NBADataUnavailableError, host: 'site.web.api.espn.com' },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(clients)('$name free JSON reads', ({ load, error, host }) => {
  it('recovers a 503, honors short Retry-After, and preserves request options', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', request);
    const result = load();
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [url, init] of request.mock.calls) {
      expect(new URL(url).hostname).toBe(host);
      expect(init).toEqual({ headers: { accept: 'application/json' }, next: { revalidate: 120 }, signal: expect.any(AbortSignal) });
    }
    expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
    expect(request.mock.calls[0][1].signal).not.toBe(request.mock.calls[1][1].signal);
    expect(AbortSignal.timeout).toHaveBeenNthCalledWith(1, 8000);
    expect(AbortSignal.timeout).toHaveBeenNthCalledWith(2, 8000);
  });

  it.each([400, 401, 403, 404])('does not retry permanent HTTP %s', async status => {
    const request = vi.fn(async () => new Response('unavailable', { status }));
    vi.stubGlobal('fetch', request);
    await expect(load()).rejects.toThrow(new error(`${host === 'statsapi.mlb.com' ? 'MLB' : error === NFLDataUnavailableError ? 'NFL' : 'NBA'} request failed (${status})`));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bounds network failures at three attempts', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', request);
    const result = expect(load()).rejects.toThrow(host === 'statsapi.mlb.com' ? TypeError : error);
    await vi.advanceTimersByTimeAsync(600);
    await result;
    expect(request).toHaveBeenCalledTimes(3);
    expect(AbortSignal.timeout).toHaveBeenCalledTimes(3);
  });

  it('bounds persistent 503 responses at three attempts', async () => {
    const request = vi.fn(async () => new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', request);
    const result = expect(load()).rejects.toThrow(error);
    await vi.advanceTimersByTimeAsync(600);
    await result;
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('aborts each stalled attempt after eight seconds', async () => {
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', request);
    const result = expect(load()).rejects.toThrow(host === 'statsapi.mlb.com' ? DOMException : error);
    await vi.advanceTimersByTimeAsync(24600);
    await result;
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every(([, init]) => init.signal?.aborted)).toBe(true);
    expect(vi.mocked(AbortSignal.timeout).mock.calls).toEqual([[8000], [8000], [8000]]);
  });

  it('does not retry malformed JSON', async () => {
    const request = vi.fn(async () => new Response('{invalid json'));
    vi.stubGlobal('fetch', request);
    await expect(load()).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry or reinterpret a successful unexpected response shape', async () => {
    const request = vi.fn(async () => Response.json({ unexpected: null }));
    vi.stubGlobal('fetch', request);
    await expect(load()).resolves.toEqual({ unexpected: null });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('existing client-specific request semantics', () => {
  it('keeps NFL no-store reads and request-scoped memoization', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', request);
    const result = withNFLResearchSnapshot(() => Promise.all([
      espnSiteFetch('scoreboard', { dates: '20261018' }, 0),
      espnSiteFetch('scoreboard', { dates: '20261018' }, 0),
    ]));
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(request).toHaveBeenCalledTimes(2);
    for (const [, init] of request.mock.calls) {
      expect(init.cache).toBe('no-store');
      expect(init.next).toBeUndefined();
    }
    expect(new URL(request.mock.calls[0][0]).searchParams.get('dates')).toBe('20261018');
  });

  it('preserves MLB init overrides on every attempt', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', request);
    const result = mlbFetch('schedule', { revalidate: 0, init: { headers: { accept: 'custom/json', 'x-fixture': 'offline' }, cache: 'no-store' } });
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [, init] of request.mock.calls) {
      expect(init).toMatchObject({ headers: { accept: 'custom/json', 'x-fixture': 'offline' }, cache: 'no-store', next: { revalidate: 0 } });
    }
  });

  it('preserves NBA zero revalidation without introducing no-store', async () => {
    const request = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', request);
    await espnNBASiteFetch('scoreboard', {}, 0);
    expect(request).toHaveBeenCalledWith(expect.any(String), {
      headers: { accept: 'application/json' }, next: { revalidate: 0 }, signal: expect.any(AbortSignal),
    });
  });
});