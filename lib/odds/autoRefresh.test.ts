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

import { getEventMarkets, getEventPlayerProps, OddsBudgetGuardError, OddsRefreshNotAuthorizedError, withAutomaticOddsRefresh, withOneRunPaidRefresh } from './client';
import { AUTO_REFRESH_LIMITS, dailyLedgerKey, getOddsRefreshLimits } from './autoRefreshLedger';

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
