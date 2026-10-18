import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ledger = vi.hoisted(() => ({
  spent: 0, remaining: 20000, pending: 0, durable: true,
  reservations: new Map<string, number>(), locks: new Map<string, string>(), settlements: [] as Array<[number, number]>,
}));

vi.mock('../storage/kv', () => ({
  hasDurableKV: () => ledger.durable,
  kvEval: async (script: string, keys: string[], args: Array<string | number>) => {
    if (script.includes("'NX'")) {
      if (ledger.locks.has(keys[0])) return 'BUSY';
      ledger.locks.set(keys[0], String(args[0]));
      return 'OK';
    }
    if (script.includes('== ARGV[1]')) { ledger.locks.delete(keys[0]); return 1; }
    if (script.includes('local observed = tonumber(ARGV[1])')) {
      ledger.remaining = Math.min(ledger.remaining, Number(args[0]));
      return 'OK';
    }
    if (script.includes('DAILY_CAP')) {
      const [cost, cap, floor] = args.map(Number);
      if (ledger.spent + ledger.pending + cost > cap) return 'DAILY_CAP';
      if (ledger.remaining - cost < floor) return 'RESERVE';
      ledger.remaining -= cost;
      ledger.pending += cost;
      ledger.reservations.set(keys[2], cost);
      return 'OK';
    }
    const cost = ledger.reservations.get(keys[2]);
    if (cost == null) return 'ALREADY_SETTLED';
    ledger.reservations.delete(keys[2]);
    ledger.pending -= cost;
    ledger.spent += Math.max(cost, Number(args[0]));
    ledger.settlements.push([Number(args[0]), Number(args[1])]);
    return 'OK';
  },
}));
vi.mock('../odds/persistentCache', () => ({
  readPersistentCache: async () => null,
  readStalePersistentCache: async () => null,
  writePersistentCache: async () => {},
  writeCreditStatus: async () => {},
  readCreditStatus: async () => ({ remaining: '20000', used: '0' }),
}));
vi.mock('./refreshLease', () => ({ withNFLRefreshLease: async (_key: string, operation: () => Promise<unknown>) => operation() }));

import { NFL_ELITE_MARKETS } from './oddsTypes';

let sportsbook: typeof import('./sportsbook');
let getEventMarkets: typeof import('../odds/client').getEventMarkets;
let withAutomaticOddsRefresh: typeof import('../odds/client').withAutomaticOddsRefresh;
let withOneRunPaidRefresh: typeof import('../odds/client').withOneRunPaidRefresh;
let kickoff: string;
let sequence = 0;
function retrieve(markets = NFL_ELITE_MARKETS.slice(0, 2), eventId = `caps-${++sequence}`) {
  return sportsbook.retrieveNFLSportsbookGame({ date: '2026-10-18', gameId: eventId, eventId,
    kickoff, markets });
}

beforeEach(async () => {
  vi.resetModules();
  ({ getEventMarkets, withAutomaticOddsRefresh, withOneRunPaidRefresh } = await import('../odds/client'));
  sportsbook = await import('./sportsbook');
  kickoff = new Date(Date.now() + 3600000).toISOString();
  Object.assign(ledger, { spent: 0, remaining: 20000, pending: 0, durable: true });
  ledger.reservations.clear(); ledger.locks.clear(); ledger.settlements.length = 0;
  vi.stubEnv('THE_ODDS_API_KEY', 'offline-fixture-key');
  vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const cost = url.searchParams.get('markets')?.split(',').length ?? 1;
    return Response.json({ id: url.pathname.split('/').at(-2), bookmakers: [] },
      { headers: { 'x-requests-last': String(cost), 'x-requests-remaining': String(ledger.remaining) } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('NFL shared paid credit authorization', () => {
  it('fails closed without an ALS scope even with the legacy paid flag', async () => {
    vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'true');
    expect((await retrieve()).failure).toBe('REFRESH_NOT_AUTHORIZED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks two markets under a one-credit approval before fetch', async () => {
    const result = await withOneRunPaidRefresh(() => retrieve(), { maxCredits: 1 });
    expect(result.failure).toBe('SEARCH_LIMIT');
    expect(fetch).not.toHaveBeenCalled();
    expect(ledger.reservations.size).toBe(0);
  });

  it('shares the 50-credit search cap across NFL games', async () => {
    await withAutomaticOddsRefresh(async () => {
      for (let index = 0; index < 3; index += 1) expect((await retrieve(NFL_ELITE_MARKETS.slice(0, 13))).complete).toBe(true);
      expect((await retrieve(NFL_ELITE_MARKETS.slice(0, 13))).failure).toBe('SEARCH_LIMIT');
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(ledger.spent).toBe(39);
  });

  it('combines MLB and NFL spend inside one search scope', async () => {
    await withOneRunPaidRefresh(async () => {
      await getEventMarkets(`mlb-${++sequence}`, 'baseball_mlb');
      expect((await retrieve()).failure).toBe('SEARCH_LIMIT');
    }, { maxRequests: 3, maxCredits: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.spent).toBe(1);
  });

  it.each([
    ['daily', 'DAILY_LIMIT'],
    ['floor', 'RESERVE'],
    ['storage', 'REFRESH_UNAVAILABLE'],
  ] as const)('blocks the durable %s limit before provider fetch', async (limit, failure) => {
    if (limit === 'daily') ledger.spent = 299;
    if (limit === 'floor') ledger.remaining = 2001;
    if (limit === 'storage') ledger.durable = false;
    expect((await withAutomaticOddsRefresh(() => retrieve())).failure).toBe(failure);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads fresh NFL cache without authorization or another reservation', async () => {
    const eventId = `cache-${++sequence}`;
    expect((await withAutomaticOddsRefresh(() => retrieve(undefined, eventId))).complete).toBe(true);
    const result = await retrieve(undefined, eventId);
    expect(result.fromCache).toBe(true);
    expect(result.complete).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.spent).toBe(2);
  });

  it('settles a paid 503 once using response headers without retrying', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503,
      headers: { 'x-requests-last': '4', 'x-requests-remaining': '2400' } })));
    expect((await withAutomaticOddsRefresh(() => retrieve())).failure).toBe('PROVIDER_ERROR');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.settlements).toEqual([[4, 1]]);
    expect(ledger.remaining).toBe(2400);
    expect(ledger.pending).toBe(0);
  });

  it.each(['missing', 'invalid', 'timeout'])('settles the estimate for %s cost', async (kind) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (kind === 'timeout') throw new DOMException('offline timeout', 'TimeoutError');
      return Response.json({ id: new URL(String(input)).pathname.split('/').at(-2), bookmakers: [] },
        { headers: kind === 'invalid' ? { 'x-requests-last': '' } : {} });
    }));
    await withAutomaticOddsRefresh(() => retrieve());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.settlements).toEqual([[2, 0]]);
    expect(ledger.spent).toBe(2);
    expect(ledger.pending).toBe(0);
    expect(ledger.locks.size).toBe(kind === 'timeout' ? 1 : 0);
  });
});