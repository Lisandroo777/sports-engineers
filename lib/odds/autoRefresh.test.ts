import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  durable: true, failEval: false, lockHeld: false, remaining: null as number | null,
  days: new Map<string, { spent: number; reserved: number }>(), locks: new Set<string>(),
  cache: new Map<string, unknown>(), pending: 0, reservations: new Map<string, number>(), owners: new Map<string, string>(), stale: false,
  rateWindow: -1, rateCount: 0,
}));

vi.mock('../storage/kv', () => ({
  hasDurableKV: () => store.durable,
  kvSetJson: async (key: string, value: unknown) => { if (key.endsWith('provider-remaining')) store.remaining = Number(value); },
  kvDel: async (key: string) => { store.locks.delete(key); },
  kvSetNx: async (key: string) => { if (store.lockHeld || store.locks.has(key)) return false; store.locks.add(key); return true; },
  kvEval: async (script: string, keys: string[], args: Array<string | number>) => {
    if (store.failEval) throw new Error('kv down');
    if (script.includes("'NX'")) {
      if (store.lockHeld || store.owners.has(keys[0])) return 'BUSY';
      store.owners.set(keys[0], String(args[0])); return 'OK';
    }
    if (script.includes('== ARGV[1]')) {
      if (store.owners.get(keys[0]) !== args[0]) return 0;
      store.owners.delete(keys[0]); return 1;
    }
    if (script.includes('local observed = tonumber(ARGV[1])')) {
      store.remaining = store.remaining == null ? Number(args[0]) : Math.min(store.remaining, Number(args[0])); return 'OK';
    }
    const day = store.days.get(keys[0]) ?? { spent: 0, reserved: 0 };
    store.days.set(keys[0], day);
    if (script.includes('DAILY_CAP')) {
      const [cost, dailyCap, minRemaining, requestsPerMinute] = args.map(Number);
      if (store.remaining == null) return 'REMAINING_UNKNOWN';
      if (day.spent + store.pending + cost > dailyCap) return 'DAILY_CAP';
      if (store.remaining - cost < minRemaining) return 'RESERVE';
      const window = Math.floor(Date.now() / 60000);
      if (store.rateWindow !== window) { store.rateWindow = window; store.rateCount = 0; }
      if (store.rateCount >= requestsPerMinute) return 'RATE_LIMIT';
      store.rateCount += 1;
      store.remaining -= cost; store.pending += cost; store.reservations.set(keys[2], cost);
      return 'OK';
    }
    const cost = store.reservations.get(keys[2]);
    if (cost == null) return 'ALREADY_SETTLED';
    store.reservations.delete(keys[2]); store.pending -= cost;
    day.spent += Math.max(cost, Number(args[0]));
    return 'OK';
  },
}));
vi.mock('./persistentCache', () => ({
  readPersistentCache: async (key: string) => store.cache.has(key) ? { data: store.cache.get(key), cachedAt: Date.now(), expiresAt: Date.now() + 60_000 } : null,
  readStalePersistentCache: async () => store.stale ? { data: { bookmakers: [] }, cachedAt: 0 } : null,
  writePersistentCache: async (key: string, data: unknown) => { store.cache.set(key, data); },
  writeCreditStatus: async () => {}, readCreditStatus: async () => ({ remaining: String(store.remaining ?? 20000), used: '0' }),
}));

import { getEventMarkets, getEventPlayerProps, getOddsEventsForSport, OddsBudgetGuardError, OddsRefreshNotAuthorizedError, withAutomaticOddsRefresh, withOneRunPaidRefresh, withBoundedOddsRequest } from './client';
import { AUTO_REFRESH_LIMITS, dailyLedgerKey, getOddsRefreshLimits, isAutomaticOddsRefreshEnabled, reserveDailyCredits } from './autoRefreshLedger';
import { NBA_VERIFIED_RESEARCH_MARKETS } from '../nba/prediction/researchReceipt';

const today = () => store.days.get(dailyLedgerKey()) ?? { spent: 0, reserved: 0 };
const respond = (cost: string | null) => vi.fn(async () => Response.json({ id: 'fixture', bookmakers: [] },
  { headers: { ...(cost == null ? {} : { 'x-requests-last': cost }), 'x-requests-remaining': '15000' } }));

beforeEach(() => {
  Object.assign(store, { durable: true, failEval: false, lockHeld: false, remaining: 20_000, stale: false });
  store.rateWindow = -1; store.rateCount = 0;
  store.days.clear(); store.locks.clear(); store.cache.clear(); store.owners.clear(); store.reservations.clear(); store.pending = 0;
  vi.stubEnv('THE_ODDS_API_KEY', 'fixture-key');
  vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
  vi.stubEnv('ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE', '50');
  vi.stubGlobal('fetch', respond('1'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('controlled automatic odds refresh', () => {
  it('keeps NBA acquisition disabled by default even when generic production refresh flags are true', async () => {
    vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
    vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'true');
    vi.stubEnv('NBA_ODDS_AUTO_REFRESH', '');
    expect(process.env.ODDS_AUTO_REFRESH).toBe('true');
    expect(process.env.ODDS_ALLOW_PAID_REFRESH).toBe('true');
    const operation = vi.fn(async () => ({ data: 'must not run', credits: '2', remaining: '19000' }));
    expect(isAutomaticOddsRefreshEnabled('nba')).toBe(false);
    await expect(withAutomaticOddsRefresh(() => withBoundedOddsRequest('/sports/basketball_nba/events/default-off/odds',
      { markets: NBA_VERIFIED_RESEARCH_MARKETS.slice(0, 1).join(','), regions: 'us,us2' }, operation), 'nba')).rejects.toThrow('Paid refresh disabled');
    expect(operation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rechecks cache after taking the lock and makes no credit reservation when another writer filled it', async () => {
    vi.stubEnv('NBA_ODDS_AUTO_REFRESH', 'true');
    let reads = 0;
    const operation = vi.fn(async () => ({ data: 'should not buy', credits: '52', remaining: '19000' }));
    const result = await withAutomaticOddsRefresh(() => withBoundedOddsRequest('/sports/basketball_nba/events/postlock/odds',
      { markets: NBA_VERIFIED_RESEARCH_MARKETS.join(','), regions: 'us,us2' }, operation,
      { read: async () => ++reads === 1 ? null : 'fresh after lock' }), 'nba');
    expect(result).toBe('fresh after lock');
    expect(operation).not.toHaveBeenCalled();
    expect(store.reservations.size).toBe(0);
    expect(today().spent).toBe(0);
    expect(store.owners.size).toBe(0);
  });
  it.each(['reserve', 'daily', 'storage', 'rate'])('preserves %s protection under the NBA70 policy', async reason => {
    vi.stubEnv('NBA_ODDS_AUTO_REFRESH', 'true');
    if (reason === 'reserve') store.remaining = 2051;
    if (reason === 'daily') store.days.set(dailyLedgerKey(), { spent: 260, reserved: 0 });
    if (reason === 'storage') store.durable = false;
    if (reason === 'rate') { store.rateWindow = Math.floor(Date.now() / 60000); store.rateCount = 50; }
    const operation = vi.fn(async () => ({ data: 'blocked', credits: '52', remaining: '10000' }));
    await expect(withAutomaticOddsRefresh(() => withBoundedOddsRequest('/sports/basketball_nba/events/protected/odds',
      { markets: NBA_VERIFIED_RESEARCH_MARKETS.join(','), regions: 'us,us2' }, operation), 'nba')).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shares a concurrent request after the event lock and rechecks cache before another reservation', async () => {
    vi.stubEnv('NBA_ODDS_AUTO_REFRESH', 'true');
    let cached: string | null = null;
    const operation = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
      cached = 'shared';
      return { data: cached, credits: '2', remaining: '19000' };
    });
    const request = () => withAutomaticOddsRefresh(() => withBoundedOddsRequest('/sports/basketball_nba/events/shared/odds',
      { markets: 'player_points', regions: 'us,us2' }, operation, { read: async () => cached, waitForShared: true }), 'nba');
    expect(await Promise.all([request(), request()])).toEqual(['shared', 'shared']);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(today().spent).toBe(2);
    expect(store.pending).toBe(0);
  });
  it('allows exactly 70 credits only in a trusted outer NBA scope and tracks the shared daily ledger', async () => {
    vi.stubEnv('NBA_ODDS_AUTO_REFRESH', 'true');
    const operation = vi.fn(async () => ({ data: 'nba', credits: '18', remaining: '19000' }));
    const result = await withAutomaticOddsRefresh(async () => {
      await withBoundedOddsRequest('/sports/basketball_nba/events/first/odds',
        { markets: NBA_VERIFIED_RESEARCH_MARKETS.join(','), regions: 'us,us2' }, async () => ({ data: 'first', credits: '52', remaining: '19500' }));
      return withBoundedOddsRequest(
      '/sports/basketball_nba/events/0123456789abcdef0123456789abcdef/odds',
      { markets: NBA_VERIFIED_RESEARCH_MARKETS.slice(0, 9).join(','), regions: 'us,us2' }, operation);
    }, 'nba');
    expect(result).toBe('nba');
    expect(today().spent).toBe(70);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(getOddsRefreshLimits('nba').perSearchCredits).toBe(70);
    expect(getOddsRefreshLimits().perSearchCredits).toBe(50);
  });

  it('rejects 71 credits, cross-sport endpoints and nested attempts to expand the outer NBA scope', async () => {
    vi.stubEnv('NBA_ODDS_AUTO_REFRESH', 'true');
    expect(() => withOneRunPaidRefresh(async () => undefined, { sport: 'nba', maxCredits: 71 })).toThrow();
    const operation = vi.fn(async () => ({ data: 'bad', credits: '1', remaining: '19000' }));
    await expect(withAutomaticOddsRefresh(() => withBoundedOddsRequest('/sports/baseball_mlb/events/fixture/odds',
      { markets: 'h2h', regions: 'us' }, operation), 'nba')).rejects.toThrow('another sport');
    await expect(withAutomaticOddsRefresh(async () => {
      await withBoundedOddsRequest('/sports/basketball_nba/events/one/odds', { markets: NBA_VERIFIED_RESEARCH_MARKETS.slice(0, 10).join(','), regions: 'us,us2' }, operation);
      return withOneRunPaidRefresh(() => withBoundedOddsRequest('/sports/basketball_nba/events/two/odds',
        { markets: NBA_VERIFIED_RESEARCH_MARKETS.join(','), regions: 'us,us2' }, operation), { sport: 'nba', maxCredits: 70 });
    }, 'nba')).rejects.toThrow('ceiling reached');
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('blocks the full 26-market NBA request before any network or ledger spend under the current outer cap', async () => {
    vi.stubEnv('NBA_ODDS_AUTO_REFRESH', 'true');
    const operation = vi.fn(async () => ({ data: {}, credits: '52', remaining: '19000' }));
    expect(NBA_VERIFIED_RESEARCH_MARKETS).toHaveLength(26);
    await expect(withAutomaticOddsRefresh(() => withOneRunPaidRefresh(() => withBoundedOddsRequest(
      '/sports/basketball_nba/events/0123456789abcdef0123456789abcdef/odds',
      { markets: NBA_VERIFIED_RESEARCH_MARKETS.join(','), regions: 'us,us2', oddsFormat: 'american' }, operation,
    ), { maxRequests: 1, maxCredits: 52 }))).rejects.toThrow('ceiling reached');
    expect(operation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.reservations.size).toBe(0);
    expect(today().spent).toBe(0);
  });

  it('does not let a standalone authorization or daily reservation bypass the current 50-credit policy', async () => {
    vi.stubEnv('NBA_ODDS_AUTO_REFRESH', 'true');
    const operation = vi.fn(async () => undefined);
    expect(() => withOneRunPaidRefresh(operation, { maxRequests: 1, maxCredits: 52 })).toThrow('limits required');
    await expect(reserveDailyCredits(52)).rejects.toMatchObject({ reason: 'RESERVE' });
    vi.stubEnv('ODDS_REFRESH_MAX_SEARCH_CREDITS', '64');
    expect(() => getOddsRefreshLimits()).toThrow('paid refresh is blocked');
    expect(operation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('initializes an unknown provider balance from free events while paid refresh stays disabled', async () => {
    store.remaining = null;
    vi.stubEnv('ODDS_AUTO_REFRESH', 'false');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      { id: 'free-bootstrap', commence_time: '2026-10-16T00:15:00Z', home_team: 'Home', away_team: 'Away' },
    ], { headers: { 'x-requests-last': '0', 'x-requests-remaining': '16966', 'x-requests-used': '3034' } })));

    const events = await withAutomaticOddsRefresh(() => getOddsEventsForSport('americanfootball_nfl'));

    expect(events).toEqual([
      { id: 'free-bootstrap', commenceTime: '2026-10-16T00:15:00Z', homeTeam: 'Home', awayTeam: 'Away' },
    ]);
    expect(store.remaining).toBe(16966);
    expect(store.reservations.size).toBe(0);
    expect(store.days.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).pathname).toBe('/v4/sports/americanfootball_nfl/events');
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('bootstrap-paid-blocked', 'americanfootball_nfl')))
      .rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rate-limits concurrent distinct requests across scopes without charging blocked attempts', async () => {
    vi.stubEnv('ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE', '2');
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      withAutomaticOddsRefresh(() => getEventMarkets(`rate-${index}`, 'baseball_mlb')).then(() => 'ok', error => error.cause?.reason)));
    expect(results.filter(result => result === 'ok')).toHaveLength(2);
    expect(results.filter(result => result === 'RATE_LIMIT')).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(today().spent).toBe(2);
    expect(store.pending).toBe(0);
  });
  it('allows stricter budgets but rejects invalid or weaker hard limits', () => {
    vi.stubEnv('ODDS_REFRESH_MAX_SEARCH_CREDITS', '5');
    vi.stubEnv('ODDS_REFRESH_MAX_DAILY_CREDITS', '20');
    vi.stubEnv('ODDS_REFRESH_MIN_REMAINING', '2500');
    vi.stubEnv('ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE', '2');
    expect(getOddsRefreshLimits()).toEqual({ perSearchCredits: 5, dailyCredits: 20, minProviderRemaining: 2500, requestsPerMinute: 2 });
    for (const [name, value] of [['ODDS_REFRESH_MAX_SEARCH_CREDITS', '51'], ['ODDS_REFRESH_MAX_DAILY_CREDITS', '301'],
      ['ODDS_REFRESH_MIN_REMAINING', '1999'], ['ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE', 'NaN']]) {
      const before = process.env[name];
      vi.stubEnv(name, value);
      expect(() => getOddsRefreshLimits()).toThrow('paid refresh is blocked');
      vi.stubEnv(name, before);
    }
  });

  it('enforces configured cumulative search and daily credit ceilings', async () => {
    vi.stubEnv('ODDS_REFRESH_MAX_SEARCH_CREDITS', '2');
    vi.stubEnv('ODDS_REFRESH_MAX_DAILY_CREDITS', '3');
    const outcomes = await withAutomaticOddsRefresh(() => Promise.allSettled(
      Array.from({ length: 3 }, (_, index) => getEventMarkets(`configured-${index}`, 'baseball_mlb'))));
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(2);
    await withAutomaticOddsRefresh(() => getEventMarkets('configured-day-last', 'baseball_mlb'));
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('configured-day-blocked', 'baseball_mlb'))).rejects.toBeInstanceOf(OddsBudgetGuardError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('cannot expand a configured search ceiling through explicit manual authorization', async () => {
    vi.stubEnv('ODDS_REFRESH_MAX_SEARCH_CREDITS', '1');
    await withOneRunPaidRefresh(async () => {
      await getEventMarkets('manual-configured-first', 'baseball_mlb');
      await expect(getEventMarkets('manual-configured-second', 'baseball_mlb')).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    }, { maxRequests: 2, maxCredits: 20 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares a configured budget across nested sport searches rather than granting it per sport', async () => {
    vi.stubEnv('ODDS_REFRESH_MAX_SEARCH_CREDITS', '2');
    await withAutomaticOddsRefresh(async () => {
      await withAutomaticOddsRefresh(() => getEventMarkets('cross-mlb', 'baseball_mlb'));
      await withAutomaticOddsRefresh(() => getEventMarkets('cross-nba', 'basketball_nba'));
      await expect(withAutomaticOddsRefresh(() => getEventMarkets('cross-nfl', 'americanfootball_nfl'))).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('stays cache-only when the server flag is off', async () => {
    vi.stubEnv('ODDS_AUTO_REFRESH', 'false');
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('off', 'basketball_nba'))).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('manual server scopes cannot exceed 50 credits or bypass the shared daily ledger', async () => {
    expect(() => withOneRunPaidRefresh(() => getEventMarkets('manual-too-large'), { maxCredits: 51 })).toThrow();
    store.days.set(dailyLedgerKey(), { spent: 300, reserved: 0 });
    await expect(withOneRunPaidRefresh(() => getEventMarkets('manual-daily-cap'))).rejects.toBeInstanceOf(OddsBudgetGuardError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed without durable storage, on storage errors, and when the provider balance is unknown', async () => {
    store.durable = false;
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('a', 'basketball_nba'))).rejects.toBeInstanceOf(OddsBudgetGuardError);
    store.durable = true; store.failEval = true;
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('b', 'basketball_nba'))).rejects.toBeInstanceOf(OddsBudgetGuardError);
    store.failEval = false; store.remaining = null;
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('c', 'basketball_nba'))).rejects.toBeInstanceOf(OddsBudgetGuardError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('caps one search at 50 credits regardless of how many requests it attempts', async () => {
    const outcomes = await withAutomaticOddsRefresh(() => Promise.allSettled(
      Array.from({ length: 60 }, (_, i) => getEventMarkets(`evt-${i}`, 'baseball_mlb'))));
    expect(fetch).toHaveBeenCalledTimes(AUTO_REFRESH_LIMITS.perSearchCredits);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(50);
    expect(today().spent).toBe(50);
  });

  it('enforces the 300-credit daily cap across concurrent searches', async () => {
    store.days.set(dailyLedgerKey(), { spent: 290, reserved: 0 });
    const searches = Array.from({ length: 5 }, (_, s) => withAutomaticOddsRefresh(() => Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => getEventMarkets(`d-${s}-${i}`, 'americanfootball_nfl')))));
    await Promise.all(searches);
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(today()).toEqual({ spent: 300, reserved: 0 });
  });

  it('keeps 2,000 credits in the provider account', async () => {
    store.remaining = 2_003;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'fixture', bookmakers: [] },
      { headers: { 'x-requests-last': '2', 'x-requests-remaining': '2001' } })));
    await withAutomaticOddsRefresh(() => getEventPlayerProps('r1', ['batter_hits', 'batter_total_bases'], undefined, 'baseball_mlb'));
    await expect(withAutomaticOddsRefresh(() => getEventPlayerProps('r2', ['batter_hits', 'batter_total_bases'], undefined, 'baseball_mlb')))
      .rejects.toBeInstanceOf(OddsBudgetGuardError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('settles actual provider cost, charges the reserved worst case on timeouts, and never refunds failures', async () => {
    vi.stubGlobal('fetch', respond('0'));
    await withAutomaticOddsRefresh(() => getEventPlayerProps('cost', ['player_points', 'player_rebounds', 'player_assists'], undefined, 'basketball_nba'));
    expect(today()).toEqual({ spent: 3, reserved: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    await expect(withAutomaticOddsRefresh(() => getEventPlayerProps('slow', ['player_points', 'player_rebounds', 'player_assists'], undefined, 'basketball_nba'))).rejects.toThrow();
    expect(today()).toEqual({ spent: 6, reserved: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 500, headers: { 'x-requests-last': '2' } })));
    await expect(withAutomaticOddsRefresh(() => getEventPlayerProps('err', ['h2h', 'spreads'] as never, undefined, 'americanfootball_nfl'))).rejects.toThrow();
    expect(today()).toEqual({ spent: 8, reserved: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses fresh cache and shares another instance\'s identical in-flight refresh without paying twice', async () => {
    await withAutomaticOddsRefresh(() => getEventMarkets('cached', 'basketball_nba'));
    await withAutomaticOddsRefresh(() => getEventMarkets('cached', 'basketball_nba'));
    expect(fetch).toHaveBeenCalledTimes(1);

    store.lockHeld = true;
    setTimeout(() => store.cache.set('https://api.the-odds-api.com/v4/sports/basketball_nba/events/shared/markets?regions=us',
      { id: 'shared', bookmakers: [{ key: 'book', title: 'Book', markets: [{ key: 'h2h' }] }] }), 100);
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('shared', 'basketball_nba'))).resolves.toEqual({ Book: ['h2h'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(today().spent).toBe(1);
  });

  it('rolls the daily ledger at UTC midnight', () => {
    expect(dailyLedgerKey(new Date('2026-10-13T23:59:59Z'))).not.toBe(dailyLedgerKey(new Date('2026-10-14T00:00:00Z')));
  });

  it('retains an uncertain refresh lock so retry cannot purchase the same request again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }));
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('unknown-charge', 'basketball_nba'))).rejects.toThrow();
    vi.useFakeTimers();
    const rejected = expect(withAutomaticOddsRefresh(() => getEventMarkets('unknown-charge', 'basketball_nba'))).rejects.toThrow('already in progress');
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(today().spent).toBe(1);
  });

  it('does not return stale markets when the credit reserve blocks fresh data', async () => {
    store.remaining = 10; store.stale = true;
    await expect(withAutomaticOddsRefresh(() => getEventMarkets('stale-reserve', 'baseball_mlb'))).rejects.toBeInstanceOf(OddsBudgetGuardError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares the 50-credit ceiling across repeated nested research tool calls', async () => {
    await withAutomaticOddsRefresh(async () => {
      await withAutomaticOddsRefresh(() => Promise.all(Array.from({ length: 30 }, (_, index) => getEventMarkets(`nested-a-${index}`, 'baseball_mlb'))));
      const outcomes = await withAutomaticOddsRefresh(() => Promise.allSettled(Array.from({ length: 30 }, (_, index) => getEventMarkets(`nested-b-${index}`, 'americanfootball_nfl'))));
      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(20);
    });
    expect(fetch).toHaveBeenCalledTimes(50);
  });
});
