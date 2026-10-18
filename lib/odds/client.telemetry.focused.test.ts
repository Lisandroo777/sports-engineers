import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCreditStatus, readPersistentCache, writeCreditStatus, writePersistentCache } from './persistentCache';
import { getOddsBudgetStatus } from './budget';
import { AutoRefreshLedgerError, recordProviderRemaining, reserveDailyCredits, settleDailyCredits } from './autoRefreshLedger';

vi.mock('./persistentCache', () => ({
  readCreditStatus: vi.fn(), readPersistentCache: vi.fn(), readStalePersistentCache: vi.fn(),
  writeCreditStatus: vi.fn(), writePersistentCache: vi.fn(),
}));
vi.mock('./autoRefreshLedger', async importOriginal => ({
  ...await importOriginal<typeof import('./autoRefreshLedger')>(),
  acquireRefreshLock: vi.fn().mockResolvedValue('owner'), releaseRefreshLock: vi.fn(),
  reserveDailyCredits: vi.fn(), settleDailyCredits: vi.fn(), recordProviderRemaining: vi.fn(),
}));
vi.mock('./budget', async importOriginal => ({
  ...await importOriginal<typeof import('./budget')>(),
  getOddsBudgetStatus: vi.fn((...args: []) => importOriginal<typeof import('./budget')>().then(actual => actual.getOddsBudgetStatus(...args))),
}));

const payload = { id: 'event', bookmakers: [{ key: 'fixture', title: 'Fixture Book', markets: [{ key: 'batter_hits' }] }] };
const markets = { 'Fixture Book': ['batter_hits'] };
const outage = new Error('fixture-private-redis-url-token');
let api: typeof import('./client');

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(readPersistentCache).mockResolvedValue(null);
  vi.mocked(readCreditStatus).mockResolvedValue({ remaining: '20000', used: '0', lastCost: '0', path: 'fixture', updatedAt: Date.now() });
  vi.mocked(writePersistentCache).mockResolvedValue(undefined);
  vi.mocked(writeCreditStatus).mockResolvedValue(undefined);
  vi.mocked(reserveDailyCredits).mockResolvedValue({ credits: 1, id: 'fixture', dayKey: 'fixture' });
  vi.mocked(settleDailyCredits).mockResolvedValue(undefined);
  vi.mocked(recordProviderRemaining).mockResolvedValue(undefined);
  vi.stubEnv('THE_ODDS_API_KEY', 'fixture-api-key');
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'false');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload, {
    headers: { 'x-requests-last': '1', 'x-requests-used': '1', 'x-requests-remaining': '19999' },
  })));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  api = await import('./client');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('optional odds credit telemetry without paid authorization fallback', () => {
  it('keeps purchased quotes usable from memory when status reads and snapshot writes fail', async () => {
    vi.mocked(writePersistentCache).mockRejectedValue(outage);
    const tracker = api.beginOddsSpendTracking();
    await expect(api.withOneRunPaidRefresh(() => api.getEventMarkets('event'))).resolves.toEqual(markets);
    vi.mocked(readCreditStatus).mockRejectedValue(outage);
    await expect(api.getEventMarkets('event')).resolves.toEqual(markets);
    expect(api.getLastOddsCreditInfo()).toMatchObject({ cached: true, source: 'memory', cacheState: 'CACHE_FRESH', lastCost: '0', remaining: null, used: null });
    expect(tracker).toMatchObject({ paidRequestsMade: 1, cacheHits: 1, cacheErrors: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reserveDailyCredits).toHaveBeenCalledTimes(1);
    expect(settleDailyCredits).toHaveBeenCalledTimes(1);
    expect(getOddsBudgetStatus).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tracker)).not.toContain(outage.message);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining(outage.message));
  });

  it('starts tracking with unknown balance and serves fresh disk then memory without authorization', async () => {
    vi.mocked(readCreditStatus).mockRejectedValue(outage);
    vi.mocked(readPersistentCache).mockResolvedValue({ key: 'fixture', data: payload, cachedAt: Date.now(), expiresAt: Date.now() + 60000 });
    const tracker = await api.beginOddsSpendTrackingAsync();
    expect(tracker).toMatchObject({ creditsBefore: null, creditsAfter: null, creditsSpent: 0, cacheErrors: 1 });
    await expect(api.getEventMarkets('event')).resolves.toEqual(markets);
    expect(api.getLastOddsCreditInfo()).toMatchObject({ source: 'disk', cacheState: 'CACHE_FRESH', lastCost: '0', remaining: null, used: null });
    await expect(api.getEventMarkets('event')).resolves.toEqual(markets);
    expect(api.getLastOddsCreditInfo()).toMatchObject({ source: 'memory', cacheState: 'CACHE_FRESH', lastCost: '0', remaining: null });
    expect(tracker).toMatchObject({ creditsBefore: null, creditsAfter: null, cacheHits: 2, cacheErrors: 3, paidRequestsMade: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(getOddsBudgetStatus).not.toHaveBeenCalled();
    expect(reserveDailyCredits).not.toHaveBeenCalled();
  });

  it('does not authorize a cache miss after a failed tracking read', async () => {
    vi.mocked(readCreditStatus).mockRejectedValue(outage);
    await api.beginOddsSpendTrackingAsync();
    await expect(api.getEventMarkets('event')).rejects.toBeInstanceOf(api.OddsRefreshNotAuthorizedError);
    expect(fetch).not.toHaveBeenCalled();
    expect(reserveDailyCredits).not.toHaveBeenCalled();
  });

  it('still fails closed on the actual budget read without retrying or purchasing', async () => {
    vi.mocked(readCreditStatus).mockRejectedValue(outage);
    await api.beginOddsSpendTrackingAsync();
    await expect(api.withOneRunPaidRefresh(() => api.getEventMarkets('event'))).rejects.toBe(outage);
    expect(readCreditStatus).toHaveBeenCalledTimes(2);
    expect(getOddsBudgetStatus).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(reserveDailyCredits).not.toHaveBeenCalled();
  });

  it('still fails closed if the durable reservation is unavailable after telemetry recovers', async () => {
    vi.mocked(readCreditStatus).mockRejectedValueOnce(outage);
    await api.beginOddsSpendTrackingAsync();
    vi.mocked(reserveDailyCredits).mockRejectedValue(new AutoRefreshLedgerError('STORAGE_UNAVAILABLE'));
    await expect(api.withOneRunPaidRefresh(() => api.getEventMarkets('event'))).rejects.toBeInstanceOf(api.OddsBudgetGuardError);
    expect(reserveDailyCredits).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves a purchased response when the header telemetry write fails', async () => {
    vi.mocked(writeCreditStatus).mockRejectedValue(outage);
    const tracker = api.beginOddsSpendTracking();
    await expect(api.withOneRunPaidRefresh(() => api.getEventMarkets('event'))).resolves.toEqual(markets);
    await expect(api.getEventMarkets('event')).resolves.toEqual(markets);
    expect(writeCreditStatus).toHaveBeenCalledTimes(1);
    expect(recordProviderRemaining).toHaveBeenCalledExactlyOnceWith('19999');
    expect(tracker).toMatchObject({ cacheErrors: 1, paidRequestsMade: 1, cacheHits: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite credit status without provider credit headers', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(payload));
    await api.withOneRunPaidRefresh(() => api.getEventMarkets('event'));
    expect(writeCreditStatus).not.toHaveBeenCalled();
    expect(recordProviderRemaining).toHaveBeenCalledExactlyOnceWith(null);
  });

  it.each(['remaining ledger', 'settlement'] as const)('does not suppress a critical %s failure or retry a purchase', async failure => {
    if (failure === 'remaining ledger') vi.mocked(recordProviderRemaining).mockRejectedValue(outage);
    else vi.mocked(settleDailyCredits).mockRejectedValue(outage);
    await expect(api.withOneRunPaidRefresh(() => api.getEventMarkets('event'))).rejects.toBe(outage);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reserveDailyCredits).toHaveBeenCalledTimes(1);
    expect(settleDailyCredits).toHaveBeenCalledTimes(1);
    if (failure === 'remaining ledger') expect(writePersistentCache).not.toHaveBeenCalled();
  });
});