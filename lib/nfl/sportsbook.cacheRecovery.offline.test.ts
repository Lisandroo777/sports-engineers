import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Legacy provider/cache unit boundary; real spending guards are tested in sportsbook.spendingGuard.offline.test.ts.
vi.mock('../odds/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../odds/client')>(),
  withBoundedOddsRequest: async <T>(_path: string, _params: Record<string, string>, operation: () => Promise<{ data: T }>) => (await operation()).data,
}));

vi.mock('../odds/budget', async (importOriginal) => ({
  ...await importOriginal<typeof import('../odds/budget')>(),
  getOddsBudgetStatus: vi.fn().mockResolvedValue({ belowReserve: false }),
}));
vi.mock('../odds/persistentCache', () => ({ readStalePersistentCache: vi.fn(), writePersistentCache: vi.fn(), writeCreditStatus: vi.fn() }));
vi.mock('./refreshLease', () => ({ withNFLRefreshLease: vi.fn(async (_key, operation) => operation()) }));

let api: typeof import('./sportsbook');
const now = new Date('2026-10-18T12:00:00Z');
const input = { date: '2026-10-18', gameId: 'game', eventId: 'event', kickoff: '2026-10-18T17:00:00Z' };
type Market = 'player_pass_yds' | 'player_receptions';
const retrieve = (markets: Market[] = ['player_pass_yds']) => api.retrieveNFLSportsbookGame({ ...input, markets });
const payload = (updatedAt = now.toISOString(), point = 200.5) => ({ id: 'event', bookmakers: [{ key: 'book', title: 'Book', markets: [{
  key: 'player_pass_yds', last_update: updatedAt, outcomes: [{ name: 'Over', description: 'QB', point, price: -110 }],
}] }] });
function cachedSnapshot(retrievedAt = new Date(now.getTime() - 11 * 60000).toISOString()) {
  return { key: 'offline-snapshot', data: { version: 1, sport: 'nfl', ...input, markets: { player_pass_yds: {
    status: 'ZERO_MARKETS', props: [], retrievedAt, expiresAt: Date.parse(retrievedAt) + 120000,
  } } }, cachedAt: Date.parse(retrievedAt), expiresAt: Date.parse(retrievedAt) + 120000 };
}

beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('THE_ODDS_API_KEY', 'offline-fixture');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  const { getOddsBudgetStatus } = await import('../odds/budget');
  const cache = await import('../odds/persistentCache');
  const { withNFLRefreshLease } = await import('./refreshLease');
  vi.mocked(getOddsBudgetStatus).mockResolvedValue({ belowReserve: false } as Awaited<ReturnType<typeof getOddsBudgetStatus>>);
  vi.mocked(cache.readStalePersistentCache).mockResolvedValue(null);
  vi.mocked(withNFLRefreshLease).mockImplementation(async (_key, operation) => operation());
  api = await import('./sportsbook');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('NFL sportsbook cache recovery and publication freshness', () => {
  it.each(['RETURNED', 'ZERO_MARKETS'] as const)('drops %s coverage that expires while an expanded paid request fails', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(status === 'RETURNED' ? payload() : { id: 'event', bookmakers: [] }));
    await retrieve();
    vi.setSystemTime(new Date(now.getTime() + 9 * 60000));
    vi.mocked(fetch).mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(now.getTime() + 10 * 60000 + 1));
      return new Response(null, { status: 503 });
    });
    const result = await retrieve(['player_pass_yds', 'player_receptions']);
    expect(result).toMatchObject({ complete: false, failure: 'STALE_PRICE', props: [], returnedMarkets: [], zeroMarkets: [],
      failedMarkets: ['player_pass_yds', 'player_receptions'] });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(now.getTime() + 12 * 60000));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload(new Date().toISOString())));
    expect((await retrieve()).complete).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps purchased memory coverage over stale persisted data after writes fail', async () => {
    const cache = await import('../odds/persistentCache');
    const persisted = cachedSnapshot();
    vi.mocked(cache.readStalePersistentCache).mockImplementation(async () => structuredClone(persisted));
    vi.mocked(cache.writePersistentCache).mockRejectedValue(new Error('write outage'));
    vi.mocked(fetch).mockResolvedValue(Response.json(payload()));
    expect((await retrieve()).props).toHaveLength(1);
    const second = await retrieve();
    expect(second).toMatchObject({ fromCache: true, complete: true });
    expect(second.props[0].line).toBe(200.5);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(persisted.data.markets.player_pass_yds.status).toBe('ZERO_MARKETS');
  });

  it('merges markets independently and accepts newer persisted coverage without mutating it', async () => {
    const cache = await import('../odds/persistentCache');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload()));
    await retrieve();
    vi.setSystemTime(new Date(now.getTime() + 60000));
    const persisted = cachedSnapshot(new Date().toISOString());
    const markets = persisted.data.markets as Record<string, typeof persisted.data.markets.player_pass_yds>;
    markets.player_receptions = { ...markets.player_pass_yds };
    vi.mocked(cache.readStalePersistentCache).mockResolvedValue(persisted);
    const result = await retrieve(['player_pass_yds', 'player_receptions']);
    expect(result).toMatchObject({ complete: true, fromCache: true, props: [], zeroMarkets: ['player_pass_yds', 'player_receptions'] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('combines fresh memory with newer persisted markets instead of choosing an entire snapshot', async () => {
    const cache = await import('../odds/persistentCache');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload()));
    await retrieve();
    vi.setSystemTime(new Date(now.getTime() + 60000));
    const persisted = cachedSnapshot();
    const markets = persisted.data.markets as Record<string, typeof persisted.data.markets.player_pass_yds>;
    markets.player_receptions = { status: 'ZERO_MARKETS', props: [], retrievedAt: new Date().toISOString(), expiresAt: Date.now() + 120000 };
    vi.mocked(cache.readStalePersistentCache).mockImplementation(async () => structuredClone(persisted));
    const result = await retrieve(['player_pass_yds', 'player_receptions']);
    expect(result).toMatchObject({ complete: true, fromCache: true, returnedMarkets: ['player_pass_yds'], zeroMarkets: ['player_receptions'] });
    expect(result.props).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['date', 'gameId', 'eventId', 'kickoff', 'sport', 'version'] as const)('rejects persisted snapshots with mismatched %s', async field => {
    const cache = await import('../odds/persistentCache');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload()));
    await retrieve();
    const persisted = cachedSnapshot(new Date(now.getTime() + 1000).toISOString());
    Object.assign(persisted.data, { [field]: field === 'version' ? 2 : 'wrong-identity' });
    vi.mocked(cache.readStalePersistentCache).mockResolvedValue(persisted);
    const result = await retrieve();
    expect(result).toMatchObject({ complete: true, fromCache: true, returnedMarkets: ['player_pass_yds'] });
    expect(result.props).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses validated fresh memory during durable read outages, but refuses uncovered purchases', async () => {
    const cache = await import('../odds/persistentCache');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload()));
    await retrieve();
    vi.mocked(cache.readStalePersistentCache).mockRejectedValue(new Error('durable read outage'));
    expect((await retrieve()).props).toHaveLength(1);
    await expect(retrieve(['player_pass_yds', 'player_receptions'])).rejects.toThrow('durable read outage');
    vi.setSystemTime(new Date(now.getTime() + 11 * 60000));
    await expect(retrieve()).rejects.toThrow('durable read outage');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails closed on durable read outage without memory', async () => {
    const cache = await import('../odds/persistentCache');
    vi.mocked(cache.readStalePersistentCache).mockRejectedValue(new Error('durable read outage'));
    await expect(retrieve()).rejects.toThrow('durable read outage');
    expect(fetch).not.toHaveBeenCalled();
  });
});