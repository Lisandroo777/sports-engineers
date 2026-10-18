import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../odds/budget', () => ({ getOddsBudgetStatus: vi.fn().mockResolvedValue({ belowReserve: false }) }));
vi.mock('../odds/persistentCache', () => ({ readStalePersistentCache: vi.fn().mockResolvedValue(null), writePersistentCache: vi.fn(), writeCreditStatus: vi.fn() }));
vi.mock('./refreshLease', () => ({ withNFLRefreshLease: vi.fn(async (_key, operation) => operation()) }));

let api: typeof import('./sportsbook');
const kickoff = '2026-10-18T17:00:00Z';
const now = new Date('2026-10-18T12:00:00Z');
const events = [{ id: 'event', home_team: 'Home', away_team: 'Away', commence_time: kickoff }];
function retrieve(eventId = 'event', markets: Parameters<typeof api.retrieveNFLSportsbookGame>[0]['markets'] = ['player_pass_yds']) {
  return api.retrieveNFLSportsbookGame({ date: '2026-10-18', gameId: eventId, eventId, kickoff, markets });
}

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('THE_ODDS_API_KEY', 'fixture-secret-never-log');
  vi.stubGlobal('fetch', vi.fn());
  api = await import('./sportsbook');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('NFL free read retries and paid single attempts', () => {
  it('recovers free events in three attempts without reserving paid credits', async () => {
    const { getOddsBudgetStatus } = await import('../odds/budget');
    const { writeCreditStatus } = await import('../odds/persistentCache');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException('fixture', 'TimeoutError'))
      .mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json(events));
    const pending = api.getNFLSportsbookEvents();
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([{ id: 'event', homeTeam: 'Home', awayTeam: 'Away', commenceTime: kickoff }]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([8000, 8000, 8000]);
    expect(getOddsBudgetStatus).not.toHaveBeenCalled();
    expect(writeCreditStatus).not.toHaveBeenCalled();
  });

  it.each([429, 503, 'timeout'] as const)('makes exactly one paid network call for %s', async failure => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    if (failure === 'timeout') vi.mocked(fetch).mockRejectedValue(new DOMException('fixture', 'TimeoutError'));
    else vi.mocked(fetch).mockResolvedValue(new Response(null, { status: failure }));
    expect((await retrieve()).failure).toBe(failure === 'timeout' ? 'TIMEOUT' : failure === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20000);
  });

  it.each([429, 503])('honors a long Retry-After for status %s without waiting or repurchasing', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status, headers: { 'retry-after': '120' } }));
    await retrieve();
    vi.setSystemTime(new Date(now.getTime() + 90000));
    await retrieve('second');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(now.getTime() + 121000));
    await retrieve('third');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [new Date(now.getTime() + 180000).toUTCString(), 180000],
    ['172800', 86400000],
  ] as const)('parses and bounds Retry-After %s', async (header, duration) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': header } }));
    await retrieve();
    vi.setSystemTime(new Date(now.getTime() + duration - 1));
    await retrieve('second');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(now.getTime() + duration + 1));
    await retrieve('third');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains a still-fresh market when an expanded scope fails, but never returns it after expiry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ id: 'event', bookmakers: [{ key: 'book', title: 'Book', markets: [{
      key: 'player_pass_yds', last_update: now.toISOString(), outcomes: [{ name: 'Over', description: 'QB', point: 200.5, price: -110 }],
    }] }] })).mockResolvedValue(new Response(null, { status: 503 }));
    await retrieve();
    const expanded = await retrieve('event', ['player_pass_yds', 'player_receptions']);
    expect(expanded.returnedMarkets).toEqual(['player_pass_yds']);
    expect(expanded.failedMarkets).toEqual(['player_receptions']);
    expect(expanded.props).toHaveLength(1);
    vi.setSystemTime(new Date(now.getTime() + 11 * 60000));
    const expired = await retrieve();
    expect(expired.returnedMarkets).toEqual([]);
    expect(expired.props).toEqual([]);
    expect(expired.complete).toBe(false);
  });

  it('classifies invalid JSON without exposing credentials or provider payloads', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('fixture-secret-never-log', { status: 200 }));
    const result = await retrieve();
    expect(result.failure).toBe('MALFORMED_RESPONSE');
    expect(JSON.stringify(result)).not.toContain('fixture-secret-never-log');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});