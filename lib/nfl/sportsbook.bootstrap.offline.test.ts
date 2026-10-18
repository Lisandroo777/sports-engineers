import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCK_SCRIPT, OBSERVE_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT, UNLOCK_SCRIPT } from '../odds/autoRefreshLedger';
import { NFL_ELITE_MARKETS } from './oddsTypes';

const ledger = vi.hoisted(() => ({
  durable: true, failObservation: false, observedAt: null as number | null,
  remaining: null as number | null, spent: 0, pending: 0, requests: 0, rateWindow: -1,
  observations: 0, reserveAttempts: 0,
  reservations: new Map<string, number>(), locks: new Map<string, string>(),
  settlements: [] as Array<{ estimated: number; charged: number; known: boolean }>,
}));
const cache = vi.hoisted(() => ({
  credit: null as null | { remaining: string | null },
  writeCreditStatus: vi.fn(),
}));

vi.mock('../storage/kv', () => ({
  hasDurableKV: () => ledger.durable,
  kvEval: async (script: string, keys: string[], args: Array<string | number>) => {
    const now = Math.floor(Date.now() / 1000);
    if (script === LOCK_SCRIPT) {
      if (ledger.locks.has(keys[0])) return 'BUSY';
      ledger.locks.set(keys[0], String(args[0]));
      return 'OK';
    }
    if (script === UNLOCK_SCRIPT) {
      if (ledger.locks.get(keys[0]) !== args[0]) return 0;
      ledger.locks.delete(keys[0]);
      return 1;
    }
    if (script === OBSERVE_SCRIPT) {
      if (ledger.failObservation) throw new Error('Offline storage failure');
      ledger.remaining = ledger.remaining == null ? Number(args[0]) : Math.min(ledger.remaining, Number(args[0]));
      ledger.observedAt = now;
      ledger.observations += 1;
      return 'OK';
    }
    if (script === RESERVE_SCRIPT) {
      ledger.reserveAttempts += 1;
      const [cost, cap, floor, rate] = args.map(Number);
      if (ledger.remaining == null || ledger.observedAt == null || now - ledger.observedAt > 300) return 'REMAINING_UNKNOWN';
      if (ledger.spent + ledger.pending + cost > cap) return 'DAILY_CAP';
      if (ledger.remaining - cost < floor) return 'RESERVE';
      const window = Math.floor(now / 60);
      const requests = ledger.rateWindow === window ? ledger.requests : 0;
      if (requests >= rate) return 'RATE_LIMIT';
      ledger.rateWindow = window;
      ledger.requests = requests + 1;
      ledger.remaining -= cost;
      ledger.pending += cost;
      ledger.reservations.set(keys[2], cost);
      return 'OK';
    }
    if (script === SETTLE_SCRIPT) {
      const estimated = ledger.reservations.get(keys[2]);
      if (estimated == null) return 'ALREADY_SETTLED';
      const charged = Math.max(estimated, Number(args[0]));
      ledger.reservations.delete(keys[2]);
      ledger.pending -= estimated;
      ledger.spent += charged;
      if (charged > estimated) {
        ledger.remaining = ledger.remaining! - (charged - estimated);
        ledger.observedAt = null;
      }
      ledger.settlements.push({ estimated, charged, known: Number(args[1]) === 1 });
      return 'OK';
    }
    throw new Error('Unexpected offline ledger operation');
  },
}));
vi.mock('../odds/persistentCache', () => ({
  readPersistentCache: async () => null,
  readStalePersistentCache: async () => null,
  writePersistentCache: async () => {},
  readCreditStatus: async () => cache.credit,
  writeCreditStatus: cache.writeCreditStatus,
}));
vi.mock('./refreshLease', () => ({
  withNFLRefreshLease: async (_key: string, operation: () => Promise<unknown>) => operation(),
}));

let api: typeof import('./sportsbook');
let client: typeof import('../odds/client');
let guards: typeof import('../odds/autoRefreshLedger');
let sequence = 0;
const now = new Date('2026-10-18T12:00:00Z');
const kickoff = '2026-10-18T17:00:00Z';
const eventId = 'offline-bootstrap-event';
let freeRemaining: string | null;
let freeStatus: number;

function retrieve(markets = NFL_ELITE_MARKETS, id = eventId) {
  return api.retrieveNFLSportsbookGame({ date: '2026-10-18', gameId: id, eventId: id, kickoff, markets });
}
async function normalPath() {
  return client.withAutomaticOddsRefresh(async () => {
    const [event] = await api.getNFLSportsbookEvents();
    return retrieve(undefined, event.id);
  });
}
function paidCalls() {
  return vi.mocked(fetch).mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/odds'));
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  Object.assign(ledger, { durable: true, failObservation: false, observedAt: null, remaining: null,
    spent: 0, pending: 0, requests: 0, rateWindow: -1, observations: 0, reserveAttempts: 0 });
  ledger.reservations.clear();
  ledger.locks.clear();
  ledger.settlements.length = 0;
  cache.credit = null;
  cache.writeCreditStatus.mockReset().mockImplementation(async (status: { remaining: string | null }) => { cache.credit = status; });
  freeRemaining = '20000';
  freeStatus = 200;
  vi.stubEnv('THE_ODDS_API_KEY', 'offline-fixture-not-a-real-key');
  vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'false');
  vi.stubEnv('ODDS_REFRESH_MAX_SEARCH_CREDITS', '50');
  vi.stubEnv('ODDS_REFRESH_MAX_DAILY_CREDITS', '300');
  vi.stubEnv('ODDS_REFRESH_MIN_REMAINING', '2000');
  vi.stubEnv('ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE', '10');
  vi.stubEnv('ODDS_MIN_CREDIT_RESERVE', '50');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.the-odds-api.com');
    expect(url.searchParams.get('apiKey')).toBe('offline-fixture-not-a-real-key');
    if (url.pathname.endsWith('/events')) {
      return Response.json([{ id: eventId, home_team: 'Buffalo Bills', away_team: 'New York Jets', commence_time: kickoff }], {
        status: freeStatus, headers: { 'x-requests-last': '0', 'x-requests-used': '0',
          ...(freeRemaining == null ? {} : { 'x-requests-remaining': freeRemaining }) },
      });
    }
    expect(url.pathname).toMatch(/\/events\/[^/]+\/odds$/);
    const markets = url.searchParams.get('markets')!.split(',');
    return Response.json({ id: url.pathname.split('/').at(-2), sport_key: 'americanfootball_nfl', commence_time: kickoff,
      bookmakers: [{ key: 'draftkings', title: 'DraftKings', markets: markets.map((market) => ({
        key: market, last_update: new Date().toISOString(), outcomes: [
          { name: 'Over', description: 'Offline Player', point: 10.5, price: -110 },
          { name: 'Under', description: 'Offline Player', point: 10.5, price: -110 },
        ],
      })) }],
    }, { headers: { 'x-requests-last': String(markets.length), 'x-requests-remaining': String(ledger.remaining) } });
  }));
  client = await import('../odds/client');
  api = await import('./sportsbook');
  guards = await import('../odds/autoRefreshLedger');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('NFL free events bootstrap with real bounded authorization and offline I/O', () => {
  it('bootstraps a cold normal search and purchases all 13 normalized markets exactly once', async () => {
    const result = await normalPath();
    expect(result).toMatchObject({ complete: true, failure: null, fromCache: false, failedMarkets: [], zeroMarkets: [] });
    expect(result.returnedMarkets).toEqual([...NFL_ELITE_MARKETS].sort());
    expect(result.props).toHaveLength(13);
    expect(new Set(result.props.map((prop) => prop.marketKey))).toEqual(new Set(NFL_ELITE_MARKETS));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(paidCalls()).toHaveLength(1);
    expect(ledger.requests).toBe(1);
    expect(ledger.spent).toBe(13);
    expect(ledger.pending).toBe(0);
    expect(ledger.remaining).toBe(19987);
    expect(ledger.reservations.size).toBe(0);
    expect(ledger.settlements).toEqual([{ estimated: 13, charged: 13, known: true }]);
    expect(cache.writeCreditStatus).toHaveBeenCalledWith(expect.objectContaining({ lastCost: '0', remaining: '20000',
      used: '0', path: '/sports/americanfootball_nfl/events', updatedAt: now.getTime() }));
  });

  it.each([null, '', 'invalid', '-1', '9007199254740992'])('fails closed for unusable free balance %s', async (remaining) => {
    freeRemaining = remaining;
    cache.writeCreditStatus.mockResolvedValue(undefined);
    const result = await normalPath();
    expect(result).toMatchObject({ complete: false, failure: 'CREDIT_BALANCE_UNKNOWN', returnedMarkets: [], props: [] });
    expect(result.failedMarkets).toEqual([...NFL_ELITE_MARKETS].sort());
    expect(ledger.observedAt).toBeNull();
    expect(ledger.requests).toBe(0);
    expect(paidCalls()).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('renews a 301-second stale observation only with an actual free response', async () => {
    ledger.remaining = 20000;
    ledger.observedAt = Math.floor(Date.now() / 1000) - 301;
    expect((await client.withAutomaticOddsRefresh(() => retrieve(undefined, 'stale-before-free'))).failure).toBe('CREDIT_BALANCE_UNKNOWN');
    expect(fetch).not.toHaveBeenCalled();
    expect((await normalPath()).complete).toBe(true);
    expect(ledger.observedAt).toBe(Math.floor(Date.now() / 1000));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(paidCalls()).toHaveLength(1);
  });

  it('does not turn the one-minute event cache into a fresh balance observation', async () => {
    await api.getNFLSportsbookEvents();
    const observedAt = ledger.observedAt;
    vi.setSystemTime(now.getTime() + 59000);
    await api.getNFLSportsbookEvents();
    expect(ledger.observedAt).toBe(observedAt);
    expect(ledger.observations).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now.getTime() + 61000);
    await api.getNFLSportsbookEvents();
    expect(ledger.observedAt).toBe(Math.floor(Date.now() / 1000));
    expect(ledger.observations).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ledger.reserveAttempts).toBe(0);
  });

  it.each([401, 403])('never observes a balance or retries permanent free authentication failure %s', async (status) => {
    freeStatus = status;
    await expect(normalPath()).rejects.toMatchObject({ kind: 'AUTHENTICATION' });
    await expect(normalPath()).rejects.toMatchObject({ kind: 'AUTHENTICATION' });
    expect(ledger.observations).toBe(0);
    expect(cache.writeCreditStatus).not.toHaveBeenCalled();
    expect(ledger.reserveAttempts).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(paidCalls()).toHaveLength(0);
  });

  it('allows a zero-balance free read in a zero-paid-budget cache-only scope', async () => {
    freeRemaining = '0';
    const events = await client.withCachedOddsOnly(() => client.withAutomaticOddsRefresh(() => api.getNFLSportsbookEvents()));
    expect(events).toHaveLength(1);
    expect(ledger.remaining).toBe(0);
    expect(ledger.observations).toBe(1);
    expect(ledger.reserveAttempts).toBe(0);
    expect(ledger.requests).toBe(0);
    expect(paidCalls()).toHaveLength(0);
    expect((await client.withAutomaticOddsRefresh(() => retrieve())).failure).toBe('RESERVE');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps credit-status persistence best effort without losing the durable observation', async () => {
    cache.writeCreditStatus.mockRejectedValue(new Error('Offline credit status failure'));
    expect((await normalPath()).complete).toBe(true);
    expect(paidCalls()).toHaveLength(1);
    expect(ledger.spent).toBe(13);
  });

  it('propagates failed durable observation and never proceeds to a purchase', async () => {
    ledger.failObservation = true;
    await expect(normalPath()).rejects.toMatchObject({ kind: 'REFRESH_UNAVAILABLE' });
    expect(ledger.observedAt).toBeNull();
    expect(cache.writeCreditStatus).not.toHaveBeenCalled();
    expect(paidCalls()).toHaveLength(0);
    expect(ledger.reserveAttempts).toBe(0);
  });

  it.each([
    ['daily', 'DAILY_LIMIT'], ['floor', 'RESERVE'], ['storage', 'REFRESH_UNAVAILABLE'], ['rate', 'RATE_LIMIT'],
  ] as const)('preserves the %s guard after free bootstrap', async (limit, failure) => {
    await api.getNFLSportsbookEvents();
    if (limit === 'daily') ledger.spent = 300;
    if (limit === 'floor') ledger.remaining = 2000;
    if (limit === 'storage') ledger.durable = false;
    if (limit === 'rate') { ledger.requests = 10; ledger.rateWindow = Math.floor(Date.now() / 60000); }
    const result = await client.withAutomaticOddsRefresh(() => retrieve());
    expect(result).toMatchObject({ complete: false, failure, props: [], returnedMarkets: [] });
    expect(result.failedMarkets).toEqual([...NFL_ELITE_MARKETS].sort());
    expect(paidCalls()).toHaveLength(0);
    expect(ledger.pending).toBe(0);
  });

  it('preserves search caps across games and nested approvals', async () => {
    await api.getNFLSportsbookEvents();
    await client.withAutomaticOddsRefresh(async () => {
      for (let index = 0; index < 3; index += 1) expect((await retrieve(undefined, `cap-${++sequence}`)).complete).toBe(true);
      const blocked = await client.withOneRunPaidRefresh(() => retrieve(undefined, `cap-${++sequence}`), { maxCredits: 50 });
      expect(blocked).toMatchObject({ complete: false, failure: 'SEARCH_LIMIT', props: [] });
    });
    expect(paidCalls()).toHaveLength(3);
    expect(ledger.spent).toBe(39);
    expect(ledger.pending).toBe(0);
  });

  it('distinguishes cache-only and unauthorized requests without buying odds', async () => {
    expect((await retrieve(undefined, 'unauthorized')).failure).toBe('REFRESH_NOT_AUTHORIZED');
    expect((await client.withCachedOddsOnly(() => retrieve(undefined, 'cache-only'))).failure).toBe('CACHE_ONLY');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('classifies only actual ledger causes and static authorization messages', () => {
    for (const [reason, expected] of [
      ['REMAINING_UNKNOWN', 'CREDIT_BALANCE_UNKNOWN'], ['DAILY_CAP', 'DAILY_LIMIT'],
      ['RESERVE', 'RESERVE'], ['RATE_LIMIT', 'RATE_LIMIT'], ['STORAGE_UNAVAILABLE', 'REFRESH_UNAVAILABLE'],
    ] as const) {
      const error = new client.OddsBudgetGuardError('Untrusted fixture message');
      error.cause = new guards.AutoRefreshLedgerError(reason);
      expect(api.classifyNFLProviderFailure(error)).toBe(expected);
    }
    const forged = new client.OddsBudgetGuardError();
    forged.cause = { reason: 'DAILY_CAP' };
    expect(api.classifyNFLProviderFailure(forged)).toBe('RESERVE');
    expect(api.classifyNFLProviderFailure(new client.OddsRefreshNotAuthorizedError('arbitrary private fixture'))).toBe('REFRESH_NOT_AUTHORIZED');
  });
});