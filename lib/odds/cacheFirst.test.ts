vi.mock('./autoRefreshLedger', async importOriginal => ({
  ...await importOriginal<typeof import('./autoRefreshLedger')>(),
  acquireRefreshLock: async () => 'fixture-owner', releaseRefreshLock: async () => {},
  reserveDailyCredits: async (credits: number) => ({ credits, id: 'fixture', dayKey: 'fixture' }),
  settleDailyCredits: async () => {}, recordProviderRemaining: async () => {},
}));
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./persistentCache', () => ({
  readPersistentCache: async () => null,
  readStalePersistentCache: async () => null,
  writePersistentCache: async () => {},
  readCreditStatus: async () => ({ remaining: '20000', used: '0' }),
  writeCreditStatus: async () => {},
}));

const { getEventMarkets, withOneRunPaidRefresh } = await import('./client');

describe('automatic paid refresh is cache-first', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves fresh cache inside an automatic run and only re-buys on an explicit refresh', async () => {
    process.env.THE_ODDS_API_KEY = 'test-key';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bookmakers: [] }), {
      status: 200, headers: { 'x-requests-last': '1', 'x-requests-remaining': '19999', 'x-requests-used': '1' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await withOneRunPaidRefresh(() => getEventMarkets('evt-cache-first', 'baseball_mlb'));
    await withOneRunPaidRefresh(() => getEventMarkets('evt-cache-first', 'baseball_mlb'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await withOneRunPaidRefresh(() => getEventMarkets('evt-cache-first', 'baseball_mlb'), { forceFresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
