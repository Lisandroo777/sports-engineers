import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCK_SCRIPT, OBSERVE_SCRIPT, RESERVE_SCRIPT, SETTLE_SCRIPT, UNLOCK_SCRIPT } from '../odds/autoRefreshLedger';

const ledger = vi.hoisted(() => ({
  durable: true, observed: true, spent: 0, pending: 0, remaining: 20000, requests: 0,
  reservations: new Map<string, number>(), locks: new Map<string, string>(),
  settlements: [] as Array<{ estimated: number; charged: number; known: boolean }>,
}));

// Only storage and provider I/O are mocked; authorization, budgeting, and ledger code stay real.
vi.mock('../storage/kv', () => ({
  hasDurableKV: () => ledger.durable,
  kvEval: async (script: string, keys: string[], args: Array<string | number>) => {
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
      ledger.remaining = Math.min(ledger.remaining, Number(args[0]));
      ledger.observed = true;
      return 'OK';
    }
    if (script === RESERVE_SCRIPT) {
      const [cost, cap, floor, rate] = args.map(Number);
      if (!ledger.observed) return 'REMAINING_UNKNOWN';
      if (ledger.spent + ledger.pending + cost > cap) return 'DAILY_CAP';
      if (ledger.remaining - cost < floor) return 'RESERVE';
      if (ledger.requests >= rate) return 'RATE_LIMIT';
      ledger.requests += 1;
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
        ledger.remaining -= charged - estimated;
        ledger.observed = false;
      }
      ledger.settlements.push({ estimated, charged, known: Number(args[1]) === 1 });
      return 'OK';
    }
    throw new Error('Unexpected ledger operation');
  },
}));
vi.mock('../odds/persistentCache', () => ({
  readPersistentCache: async () => null,
  readStalePersistentCache: async () => null,
  writePersistentCache: async () => {},
  writeCreditStatus: async () => {},
  readCreditStatus: async () => ({ remaining: '20000' }),
}));
vi.mock('./refreshLease', () => ({
  withNFLRefreshLease: async (_key: string, operation: () => Promise<unknown>) => operation(),
}));

let api: typeof import('./sportsbook');
let client: typeof import('../odds/client');
let sequence = 0;
const now = new Date('2026-10-18T12:00:00Z');
const kickoff = '2026-10-18T17:00:00Z';
function retrieve(markets: Parameters<typeof api.retrieveNFLSportsbookGame>[0]['markets'] = ['player_pass_yds'], eventId = `guard-${++sequence}`) {
  return api.retrieveNFLSportsbookGame({ date: '2026-10-18', gameId: eventId, eventId, kickoff, markets });
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  Object.assign(ledger, { durable: true, observed: true, spent: 0, pending: 0, remaining: 20000, requests: 0 });
  ledger.reservations.clear();
  ledger.locks.clear();
  ledger.settlements.length = 0;
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
    const cost = url.searchParams.get('markets')!.split(',').length;
    return Response.json({ id: url.pathname.split('/').at(-2), bookmakers: [] }, {
      headers: { 'x-requests-last': String(cost), 'x-requests-remaining': String(ledger.remaining) },
    });
  }));
  client = await import('../odds/client');
  api = await import('./sportsbook');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('NFL real spending guard with offline durable storage', () => {
  it('does not authorize a purchase using the legacy environment flag alone', async () => {
    vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'true');
    expect((await retrieve()).failure).toBe('RESERVE');
    expect(fetch).not.toHaveBeenCalled();
    expect(ledger.reservations.size).toBe(0);
  });

  it('does not authorize automatic purchases when automatic refresh is disabled', async () => {
    vi.stubEnv('ODDS_AUTO_REFRESH', 'false');
    expect((await client.withAutomaticOddsRefresh(() => retrieve())).failure).toBe('RESERVE');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks a two-market request under a one-credit approval', async () => {
    const result = await client.withOneRunPaidRefresh(() => retrieve(['player_pass_yds', 'player_receptions']), { maxCredits: 1 });
    expect(result.failure).toBe('RESERVE');
    expect(fetch).not.toHaveBeenCalled();
    expect(ledger.requests).toBe(0);
  });

  it('preserves the one-request approval even when credits remain', async () => {
    await client.withOneRunPaidRefresh(async () => {
      expect((await retrieve()).complete).toBe(true);
      expect((await retrieve()).failure).toBe('RESERVE');
    }, { maxRequests: 1, maxCredits: 50 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.spent).toBe(1);
  });

  it('keeps the 50-credit search ceiling across games and nested approvals', async () => {
    const { NFL_ELITE_MARKETS } = await import('./oddsTypes');
    await client.withAutomaticOddsRefresh(async () => {
      for (let index = 0; index < 5; index += 1) {
        expect((await retrieve(NFL_ELITE_MARKETS.slice(0, 10))).complete).toBe(true);
      }
      const blocked = await client.withOneRunPaidRefresh(() => retrieve(), { maxRequests: 50, maxCredits: 50 });
      expect(blocked.failure).toBe('RESERVE');
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(ledger.spent).toBe(50);
    expect(ledger.pending).toBe(0);
  });

  it.each(['daily cap', 'reserve floor', 'missing storage', 'unknown balance', 'rate cap'] as const)('blocks %s before provider I/O', async (limit) => {
    if (limit === 'daily cap') ledger.spent = 300;
    if (limit === 'reserve floor') ledger.remaining = 2000;
    if (limit === 'missing storage') ledger.durable = false;
    if (limit === 'unknown balance') ledger.observed = false;
    if (limit === 'rate cap') ledger.requests = 10;
    expect((await client.withAutomaticOddsRefresh(() => retrieve())).failure).toBe('RESERVE');
    expect(fetch).not.toHaveBeenCalled();
    expect(ledger.pending).toBe(0);
    expect(ledger.settlements).toEqual([]);
  });

  it('reuses fresh cache outside authorization without a second reservation', async () => {
    const eventId = `cached-${++sequence}`;
    expect((await client.withAutomaticOddsRefresh(() => retrieve(undefined, eventId))).complete).toBe(true);
    expect(await retrieve(undefined, eventId)).toMatchObject({ complete: true, fromCache: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.settlements).toEqual([{ estimated: 1, charged: 1, known: true }]);
  });

  it.each([429, 503, 'timeout'] as const)('makes and settles exactly one paid attempt for %s', async (failure) => {
    vi.mocked(fetch).mockImplementation(async () => {
      if (failure === 'timeout') throw new DOMException('Offline fixture timeout', 'TimeoutError');
      return new Response(null, { status: failure, headers: { 'x-requests-last': '2' } });
    });
    const result = await client.withAutomaticOddsRefresh(() => retrieve(['player_pass_yds', 'player_receptions']));
    expect(result.failure).toBe(failure === 'timeout' ? 'TIMEOUT' : failure === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.spent).toBe(2);
    expect(ledger.pending).toBe(0);
    expect(ledger.reservations.size).toBe(0);
    expect(ledger.settlements).toEqual([{ estimated: 2, charged: 2, known: failure !== 'timeout' }]);
    expect(ledger.locks.size).toBe(failure === 'timeout' ? 1 : 0);
  });
});