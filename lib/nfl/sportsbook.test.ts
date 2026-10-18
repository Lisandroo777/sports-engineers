import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readStalePersistentCache, writePersistentCache, writeCreditStatus } from '../odds/persistentCache';

// Legacy provider/cache unit boundary; real spending guards are tested in sportsbook.spendingGuard.offline.test.ts.
vi.mock('../odds/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../odds/client')>(),
  withBoundedOddsRequest: async <T>(_path: string, _params: Record<string, string>, operation: () => Promise<{ data: T }>) => (await operation()).data,
}));

vi.mock('../odds/budget', async (importOriginal) => ({
  ...await importOriginal<typeof import('../odds/budget')>(),
  getOddsBudgetStatus: vi.fn().mockResolvedValue({ belowReserve: false }),
}));
vi.mock('../odds/persistentCache', () => ({ readStalePersistentCache: vi.fn().mockResolvedValue(null), writePersistentCache: vi.fn(), writeCreditStatus: vi.fn() }));
vi.mock('./refreshLease', () => ({ withNFLRefreshLease: vi.fn().mockImplementation(async (_key, operation) => operation()) }));

let api: typeof import('./sportsbook');
const kickoff = '2026-10-11T17:00:00Z';
const now = new Date('2026-10-11T12:00:00Z');

function payload(markets = ['player_pass_yds']) {
  return { id: 'event', bookmakers: [{ key: 'book', title: 'Fixture Book', markets: markets.map((key) => ({ key, last_update: new Date().toISOString(), outcomes: [
    { name: 'Over', description: 'Test QB', point: 244.5, price: -110 }, { name: 'Under', description: 'Test QB', point: 244.5, price: -105 },
  ] })) }] };
}
function response(data: unknown, status = 200) { return { status, ok: status === 200, headers: new Headers(), json: async () => data } as Response; }
function retrieve(markets?: Parameters<typeof api.retrieveNFLSportsbookGame>[0]['markets']) {
  return api.retrieveNFLSportsbookGame({ date: '2026-10-11', gameId: 'game', eventId: 'event', kickoff, markets });
}

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.mocked(readStalePersistentCache).mockResolvedValue(null);
  vi.mocked(writeCreditStatus).mockResolvedValue(undefined);
  vi.stubEnv('THE_ODDS_API_KEY', 'fixture-not-a-real-key');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload())));
  api = await import('./sportsbook');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('NFL cache-first targeted sportsbook refresh', () => {
  it('records purchase headers and the identical cache repeat without another provider call', async () => {
    const telemetry = await import('./spendTelemetry');
    const result = response(payload());
    result.headers.set('x-requests-remaining', '19700'); result.headers.set('x-requests-last', '9');
    vi.mocked(fetch).mockResolvedValue(result);
    await telemetry.withNFLSpendTelemetry(async () => {
      await retrieve(['player_pass_yds']);
      expect(telemetry.getNFLSpendTelemetry()).toMatchObject({ creditsBefore: 19709, creditsAfter: 19700, creditsConsumed: 9, providerRequestsMade: 1,
        paidRequestsMade: 1, cacheMisses: 1, refreshedGames: ['event'], refreshedMarkets: [{ eventId: 'event', market: 'player_pass_yds' }] });
    }, 19709);
    await telemetry.withNFLSpendTelemetry(async () => {
      expect((await retrieve(['player_pass_yds'])).fromCache).toBe(true);
      expect(telemetry.getNFLSpendTelemetry()).toMatchObject({ creditsConsumed: 0, cacheHits: 1, providerRequestsMade: 0, refreshedGames: [] });
    }, 19700);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses a fresh zero-market result after its short negative-cache TTL without requesting the provider again', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ id: 'event', bookmakers: [] }));
    const first = await retrieve(['player_rush_tds']);
    expect(first.zeroMarkets).toEqual(['player_rush_tds']);
    expect(first.fromCache).toBe(false);

    vi.setSystemTime(new Date(now.getTime() + 3 * 60000));
    const repeated = await retrieve(['player_rush_tds']);
    expect(repeated.fromCache).toBe(true);
    expect(repeated.expiresAt).toBeGreaterThan(Date.now());
    expect(await api.inspectNFLSportsbookCoverage({ date: '2026-10-11', gameId: 'game', eventId: 'event', kickoff,
      markets: ['player_rush_tds'] })).toEqual({ state: 'CACHE_FRESH', missingMarkets: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('telemetry storage failure cannot invalidate purchased data or trigger another request', async () => {
    vi.mocked(writeCreditStatus).mockRejectedValue(new Error('fixture write failure'));
    const telemetry = await import('./spendTelemetry');
    const result = response(payload()); result.headers.set('x-requests-last', '1'); result.headers.set('x-requests-remaining', '99');
    vi.mocked(fetch).mockResolvedValue(result);
    await telemetry.withNFLSpendTelemetry(async () => {
      expect((await retrieve(['player_pass_yds'])).complete).toBe(true);
      expect((await retrieve(['player_pass_yds'])).fromCache).toBe(true);
      expect(telemetry.getNFLSpendTelemetry()).toMatchObject({ creditsConsumed: 1, cacheHits: 1, paidRequestsMade: 1 });
    }, 100);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares and caches the free NFL event list', async () => {
    vi.mocked(fetch).mockResolvedValue(response([{ id: 'event', sport_key: 'americanfootball_nfl', home_team: 'Kansas City Chiefs', away_team: 'Las Vegas Raiders', commence_time: kickoff }]));
    const results = await Promise.all(Array.from({ length: 10 }, () => api.getNFLSportsbookEvents()));
    expect(results.every((events) => events.length === 1)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed event list and cools down subsequent attempts', async () => {
    vi.mocked(fetch).mockResolvedValue(response([{ id: 'event', home_team: 'Chiefs' }]));
    await expect(api.getNFLSportsbookEvents()).rejects.toMatchObject({ kind: 'MALFORMED_RESPONSE' });
    await expect(api.getNFLSportsbookEvents()).rejects.toMatchObject({ kind: 'MALFORMED_RESPONSE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects corrupt JSON as failed retrieval rather than empty market availability', async () => {
    vi.mocked(fetch).mockResolvedValue({ ...response({}), json: async () => { throw new SyntaxError('fixture'); } });
    expect((await retrieve(['player_pass_yds'])).failure).toBe('MALFORMED_RESPONSE');
    await retrieve(['player_pass_yds']); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched sport or kickoff in an event response', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ ...payload(), sport_key: 'basketball_nba' }));
    expect((await retrieve(['player_pass_yds'])).failure).toBe('MALFORMED_RESPONSE');
  });

  it('does not substitute deprecated bookmaker timestamps for missing market timestamps', async () => {
    const data = payload(); data.bookmakers[0].markets[0].last_update = '';
    vi.mocked(fetch).mockResolvedValue(response(data));
    expect((await retrieve(['player_pass_yds'])).failure).toBe('MALFORMED_RESPONSE');
  });
  it('reuses persisted snapshots across a server/module restart', async () => {
    await retrieve(['player_pass_yds']);
    const saved = vi.mocked(writePersistentCache).mock.calls.at(-1)!;
    vi.mocked(readStalePersistentCache).mockResolvedValue({ key: saved[0], data: saved[1], cachedAt: now.getTime(), expiresAt: now.getTime() + 600000 });
    vi.resetModules(); api = await import('./sportsbook');
    expect((await retrieve(['player_pass_yds'])).fromCache).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses compatible fresh legacy purchased odds without repurchasing', async () => {
    vi.mocked(readStalePersistentCache).mockImplementation(async (key) => key.includes('/markets?')
      ? { key, data: { bookmakers: [{ markets: [{ key: 'player_pass_yds' }] }] }, cachedAt: now.getTime(), expiresAt: now.getTime() + 600000 }
      : key.includes('/odds?') ? { key, data: payload(), cachedAt: now.getTime(), expiresAt: now.getTime() + 600000 } : null);
    expect((await retrieve(['player_pass_yds'])).fromCache).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks repeated authentication failures across different event scopes', async () => {
    vi.mocked(fetch).mockResolvedValue(response({}, 401));
    await retrieve(['player_pass_yds']);
    const result = await api.retrieveNFLSportsbookGame({ date: '2026-10-11', gameId: 'other', eventId: 'other', kickoff, markets: ['player_pass_yds'] });
    expect(result.failure).toBe('AUTHENTICATION'); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not call the provider when its key is missing', async () => {
    vi.stubEnv('THE_ODDS_API_KEY', '');
    expect((await retrieve(['player_pass_yds'])).failure).toBe('CONFIGURATION');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('automatically fetches once without user credit approval then reuses fresh coverage', async () => {
    const first = await retrieve(['player_pass_yds']);
    const second = await retrieve(['player_pass_yds']);
    expect(first.complete).toBe(true); expect(second.fromCache).toBe(true);
    expect(first.props[0]).toMatchObject({ sportsbookName: 'Fixture Book', player: 'Test QB', line: 244.5, eventId: 'event', retrievedAt: now.toISOString() });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await api.inspectNFLSportsbookCoverage({ date: '2026-10-11', gameId: 'game', eventId: 'event', kickoff, markets: ['player_pass_yds'] })).toEqual({ state: 'CACHE_FRESH', missingMarkets: 0 });
  });

  it('refreshes expired coverage rather than serving stale prices', async () => {
    await retrieve(['player_pass_yds']);
    vi.setSystemTime(new Date(now.getTime() + 11 * 60000));
    vi.mocked(fetch).mockResolvedValue(response(payload()));
    expect((await retrieve(['player_pass_yds'])).fromCache).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('purchases only new markets when expanding a fresh scope', async () => {
    await retrieve(['player_pass_yds']);
    vi.mocked(fetch).mockResolvedValue(response(payload(['player_receptions'])));
    const result = await retrieve(['player_pass_yds', 'player_receptions']);
    expect(result.returnedMarkets).toEqual(['player_pass_yds', 'player_receptions']);
    expect(new URL(vi.mocked(fetch).mock.calls[1][0] as URL).searchParams.get('markets')).toBe('player_receptions');
  });

  it('deduplicates concurrent identical refreshes before any cache or network await', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => retrieve(['player_pass_yds'])));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.complete)).toBe(true);
  });

  it('caches successful zero-market responses instead of purchasing repeatedly', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ id: 'event', bookmakers: [] }));
    const result = await retrieve(['player_pass_yds']);
    expect(result.complete).toBe(true); expect(result.zeroMarkets).toEqual(['player_pass_yds']);
    await retrieve(['player_pass_yds']); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([[401, 'AUTHENTICATION'], [403, 'AUTHENTICATION'], [429, 'RATE_LIMIT'], [500, 'PROVIDER_ERROR']] as const)('classifies status %s and prevents retries', async (status, failure) => {
    vi.mocked(fetch).mockResolvedValue(response({}, status));
    expect((await retrieve(['player_pass_yds'])).failure).toBe(failure);
    await Promise.all(Array.from({ length: 10 }, () => retrieve(['player_pass_yds'])));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([['TimeoutError', 'TIMEOUT'], ['TypeError', 'NETWORK']] as const)('classifies %s without retrying', async (name, failure) => {
    vi.mocked(fetch).mockRejectedValue(Object.assign(new Error('fixture'), { name }));
    expect((await retrieve(['player_pass_yds'])).failure).toBe(failure);
    await retrieve(['player_pass_yds']); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('classifies malformed payload and incomplete records rather than zero markets', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ id: 'wrong', bookmakers: [] }));
    expect((await retrieve(['player_pass_yds'])).failure).toBe('MALFORMED_RESPONSE');
  });

  it('fails closed on malformed outcomes even when some valid props are returned', async () => {
    const data = payload(); data.bookmakers[0].markets[0].outcomes[0].price = 0;
    vi.mocked(fetch).mockResolvedValue(response(data));
    const result = await retrieve(['player_pass_yds']);
    expect(result.complete).toBe(false); expect(result.failure).toBe('MALFORMED_RESPONSE');
  });

  it('does not treat stale provider prices as current after a new fetch', async () => {
    const data = payload(); data.bookmakers[0].markets[0].last_update = '2026-10-10T12:00:00Z';
    vi.mocked(fetch).mockResolvedValue(response(data));
    const result = await retrieve(['player_pass_yds']);
    expect(result.complete).toBe(false); expect(result.failure).toBe('STALE_PRICE');
  });

  it('excludes unsupported, partial, defensive and alternate markets and deduplicates records', async () => {
    const data = payload(['player_pass_yds', 'player_anytime_td', 'player_sacks', 'player_pass_yds_alternate']);
    data.bookmakers.push(data.bookmakers[0]);
    vi.mocked(fetch).mockResolvedValue(response(data));
    const result = await retrieve(['player_pass_yds', 'player_sacks']);
    expect(result.props).toHaveLength(1); expect(result.requestedMarkets).toEqual(['player_pass_yds']);
  });

  it('keeps distinct lines separate and preserves side-specific prices', async () => {
    const data = payload(); data.bookmakers[0].markets[0].outcomes[1].point = 245.5;
    vi.mocked(fetch).mockResolvedValue(response(data));
    const props = (await retrieve(['player_pass_yds'])).props;
    expect(props).toHaveLength(2);
    expect(props[0]).toMatchObject({ line: 244.5, overOdds: -110, underOdds: null });
    expect(props[1]).toMatchObject({ line: 245.5, overOdds: null, underOdds: -105 });
  });

  it('uses deterministic far, near, and immediate kickoff TTLs', () => {
    expect(api.nflFreshnessMs('2026-10-12T17:00:00Z')).toBe(30 * 60000);
    expect(api.nflFreshnessMs(kickoff)).toBe(10 * 60000);
    expect(api.nflFreshnessMs('2026-10-11T12:30:00Z')).toBe(5 * 60000);
  });
});