import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPersistentCache, writePersistentCache, writeCreditStatus } from './persistentCache';
import { reserveDailyCredits, settleDailyCredits, recordProviderRemaining } from './autoRefreshLedger';

vi.mock('./budget', () => ({ getOddsBudgetStatus: vi.fn().mockResolvedValue({ belowReserve: false }), OddsBudgetGuardError: class extends Error {} }));
vi.mock('./autoRefreshLedger', async importOriginal => ({
  ...await importOriginal<typeof import('./autoRefreshLedger')>(),
  acquireRefreshLock: vi.fn().mockResolvedValue('owner'), releaseRefreshLock: vi.fn(),
  reserveDailyCredits: vi.fn(async (credits: number) => ({ credits, id: 'fixture', dayKey: 'fixture' })),
  settleDailyCredits: vi.fn(), recordProviderRemaining: vi.fn(),
}));
vi.mock('./persistentCache', () => ({
  readPersistentCache: vi.fn().mockResolvedValue(null), readStalePersistentCache: vi.fn().mockResolvedValue(null),
  writePersistentCache: vi.fn(), writeCreditStatus: vi.fn(),
  readCreditStatus: vi.fn().mockResolvedValue({ remaining: '20000', used: '0' }),
}));

let api: typeof import('./client');
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  vi.mocked(writePersistentCache).mockResolvedValue(undefined);
  vi.mocked(writeCreditStatus).mockResolvedValue(undefined);
  vi.mocked(settleDailyCredits).mockResolvedValue(undefined);
  vi.mocked(recordProviderRemaining).mockResolvedValue(undefined);
  vi.stubEnv('THE_ODDS_API_KEY', 'fixture-secret-never-log');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'event', bookmakers: [] }, {
    headers: { 'x-requests-last': '1', 'x-requests-remaining': '19999' },
  })));
  api = await import('./client');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('shared odds read retries and purchased-response persistence', () => {
  it.each([429, 503, 'timeout'] as const)('makes exactly one paid network call for %s and settles once', async failure => {
    if (failure === 'timeout') vi.mocked(fetch).mockRejectedValue(new DOMException('fixture timeout', 'TimeoutError'));
    else vi.mocked(fetch).mockResolvedValue(new Response('provider-body-secret', { status: failure }));
    await api.withOneRunPaidRefresh(async () => {
      await expect(api.getEventMarkets('event')).rejects.toThrow(failure === 'timeout' ? 'fixture timeout' : `Odds API request failed (${failure})`);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reserveDailyCredits).toHaveBeenCalledTimes(1);
    expect(settleDailyCredits).toHaveBeenCalledTimes(1);
  });

  it('recovers free events without consuming a paid request reservation or ledger credits', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new DOMException('fixture', 'TimeoutError'))
      .mockResolvedValueOnce(Response.json([{ id: 'event', home_team: 'Home', away_team: 'Away', commence_time: '2026-10-18T17:00:00Z' }]))
      .mockResolvedValueOnce(Response.json({ id: 'event', bookmakers: [] }, { headers: { 'x-requests-last': '1' } }));
    const pending = api.withOneRunPaidRefresh(async () => {
      expect(await api.getOddsEvents()).toHaveLength(1);
      expect(reserveDailyCredits).not.toHaveBeenCalled();
      await api.getEventMarkets('event');
    }, { maxRequests: 1, maxCredits: 1 });
    await vi.runAllTimersAsync();
    await pending;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(reserveDailyCredits).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each(['snapshot', 'credit status'])('returns and memory-caches purchased data after a %s write failure', async failure => {
    if (failure === 'snapshot') vi.mocked(writePersistentCache).mockRejectedValue(new Error('fixture storage outage'));
    else vi.mocked(writeCreditStatus).mockRejectedValue(new Error('fixture storage outage'));
    const tracker = api.beginOddsSpendTracking();
    await api.withOneRunPaidRefresh(async () => { await expect(api.getEventMarkets('event')).resolves.toEqual({}); });
    await expect(api.getEventMarkets('event')).resolves.toEqual({});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reserveDailyCredits).toHaveBeenCalledTimes(1);
    expect(settleDailyCredits).toHaveBeenCalledTimes(1);
    expect(tracker).toMatchObject({ paidRequestsMade: 1, cacheErrors: 1, cacheHits: 1 });
    expect(api.getLastOddsCreditInfo()).toMatchObject({ source: 'memory', cacheState: 'CACHE_FRESH' });
  });

  it('does not hide daily ledger settlement failures behind a successful response', async () => {
    vi.mocked(settleDailyCredits).mockRejectedValue(new Error('fixture settlement unavailable'));
    await expect(api.withOneRunPaidRefresh(() => api.getEventMarkets('event'))).rejects.toThrow('fixture settlement unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not suppress provider-remaining ledger failures', async () => {
    vi.mocked(recordProviderRemaining).mockRejectedValue(new Error('fixture budget storage unavailable'));
    await expect(api.withOneRunPaidRefresh(() => api.getEventMarkets('event'))).rejects.toThrow('fixture budget storage unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(writePersistentCache).not.toHaveBeenCalled();
  });

  it('records invalid JSON as a provider error without caching or leaking the payload', async () => {
    const tracker = api.beginOddsSpendTracking();
    vi.mocked(fetch).mockResolvedValue(new Response('fixture-secret-never-log', { status: 200 }));
    await expect(api.withOneRunPaidRefresh(() => api.getEventMarkets('event'))).rejects.toThrow('Odds API returned invalid JSON.');
    expect(tracker.providerErrors).toBe(1);
    expect(writePersistentCache).not.toHaveBeenCalled();
    expect(readPersistentCache).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});