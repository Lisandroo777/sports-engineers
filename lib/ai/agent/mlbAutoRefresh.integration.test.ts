import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  remaining: 16948 as number | null, observedAt: 0, pending: 0, spent: 0, owners: new Map<string, string>(),
  reservations: new Map<string, number>(), cache: new Map<string, { data: unknown; expiresAt: number }>(),
  gameStatus: 'Pre-Game', startOffsetMs: 2 * 3600_000, calls: [] as string[], marketsStatus: 200, postedMarkets: null as string[] | null,
}));

vi.mock('../../storage/kv', () => ({
  hasDurableKV: () => true,
  allowLocalPersistenceFallback: () => false,
  kvGetJson: async () => null, kvSetJson: async () => {}, kvDel: async () => {}, kvSetNx: async () => true,
  kvEval: async (script: string, keys: string[], args: Array<string | number>) => {
    if (script.includes("'NX'")) {
      if (store.owners.has(keys[0])) return 'BUSY';
      store.owners.set(keys[0], String(args[0])); return 'OK';
    }
    if (script.includes('== ARGV[1]')) {
      if (store.owners.get(keys[0]) !== args[0]) return 0;
      store.owners.delete(keys[0]); return 1;
    }
    if (script.includes('local observed = tonumber(ARGV[1])')) {
      store.remaining = store.remaining == null ? Number(args[0]) : Math.min(store.remaining, Number(args[0]));
      store.observedAt = Date.now(); return 'OK';
    }
    if (script.includes('DAILY_CAP')) {
      const [cost, dailyCap, minRemaining] = args.map(Number);
      if (store.remaining == null || Date.now() - store.observedAt > 300_000) return 'REMAINING_UNKNOWN';
      if (store.spent + store.pending + cost > dailyCap) return 'DAILY_CAP';
      if (store.remaining - cost < minRemaining) return 'RESERVE';
      store.remaining -= cost; store.pending += cost; store.reservations.set(keys[2], cost);
      return 'OK';
    }
    const cost = store.reservations.get(keys[2]);
    if (cost == null) return 'ALREADY_SETTLED';
    store.reservations.delete(keys[2]); store.pending -= cost; store.spent += Math.max(cost, Number(args[0]));
    return 'OK';
  },
}));
vi.mock('../../odds/persistentCache', () => ({
  readPersistentCache: async (key: string) => {
    const hit = store.cache.get(key);
    return hit && hit.expiresAt > Date.now() ? { data: hit.data, cachedAt: Date.now(), expiresAt: hit.expiresAt } : null;
  },
  readStalePersistentCache: async (key: string) => {
    const hit = store.cache.get(key);
    return hit ? { data: hit.data, cachedAt: 0, expiresAt: hit.expiresAt } : null;
  },
  writePersistentCache: async (key: string, data: unknown, expiresAt: number) => { store.cache.set(key, { data, expiresAt }); },
  writeCreditStatus: async () => {},
  readCreditStatus: async () => ({ remaining: String(store.remaining ?? 0), used: '3052' }),
}));
vi.mock('../../odds/snapshotStore', () => ({ recordSnapshot: async () => {}, getSnapshotHistory: async () => [] }));
vi.mock('../../mlb/pitcherStats', () => ({ getMLBPitcherSeasonStats: async () => null }));
vi.mock('../../mlb/players', () => ({
  findMLBPlayerIdByName: async () => 660271,
  getMLBPlayer: async () => ({ currentTeam: { id: 119 } }),
  searchMLBPlayers: async () => [],
}));
vi.mock('../../mlb/stats', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../mlb/stats')>(),
  getPlayerGameLogs: async () => Array.from({ length: 30 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`, hits: 2, totalBases: 3, homeRuns: 0, runs: 1, rbi: 1,
    strikeOuts: 1, atBats: 4, plateAppearances: 4, opponent: 'Fixture', isHome: index % 2 === 0,
  })),
}));
vi.mock('../../mlb/schedule', () => ({
  getMLBSchedule: async (date: string) => [{
    id: '849811', date, gameTime: new Date(Date.now() + store.startOffsetMs).toISOString(), status: store.gameStatus,
    awayTeam: { id: 158, name: 'Milwaukee Brewers', abbreviation: 'MIL' },
    homeTeam: { id: 119, name: 'Los Angeles Dodgers', abbreviation: 'LAD' },
    awayProbableStarter: null, homeProbableStarter: null, venue: null,
  }],
}));
vi.mock('./sessionStore', () => ({
  getResearchSession: async () => null, saveResearchSession: async () => 'mlb-fixture-session', deleteResearchSession: async () => {},
}));

import { todaySlateDate } from '../../dateModel';

const EVENT_ID = '622fd31d2c8178b025455656e0d2fb89';
const MLB_MARKETS = ['batter_hits', 'batter_total_bases', 'batter_home_runs', 'batter_rbis', 'batter_runs_scored', 'batter_hits_runs_rbis',
  'batter_singles', 'batter_doubles', 'batter_walks', 'batter_strikeouts', 'batter_stolen_bases', 'batter_first_home_run',
  'pitcher_strikeouts', 'pitcher_hits_allowed', 'pitcher_walks', 'pitcher_earned_runs', 'pitcher_outs', 'pitcher_record_a_win',
  'batter_hits_alternate', 'batter_total_bases_alternate', 'batter_home_runs_alternate', 'batter_rbis_alternate',
  'pitcher_strikeouts_alternate', 'h2h', 'spreads', 'totals'];

function oddsApi() {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    store.calls.push(url.pathname);
    const headers = { 'x-requests-remaining': String(store.remaining ?? 16948), 'x-requests-used': '3052' };
    if (url.pathname.endsWith('/events')) {
      return Response.json([{ id: EVENT_ID, commence_time: new Date(Date.now() + 2 * 3600_000).toISOString(),
        home_team: 'Los Angeles Dodgers', away_team: 'Milwaukee Brewers' }], { headers: { ...headers, 'x-requests-last': '0' } });
    }
    if (url.pathname.endsWith('/markets')) {
      if (store.marketsStatus !== 200) return Response.json({ message: 'fixture' }, { status: store.marketsStatus, headers: { ...headers, 'x-requests-last': '0' } });
      return Response.json({ id: EVENT_ID, bookmakers: ['draftkings', 'fanduel', 'betmgm'].map(key => ({ key, title: key,
        markets: (store.postedMarkets ?? MLB_MARKETS).map(market => ({ key: market })) })) }, { headers: { ...headers, 'x-requests-last': '1' } });
    }
    const markets = (url.searchParams.get('markets') ?? '').split(',');
    return Response.json({ id: EVENT_ID, bookmakers: ['draftkings', 'fanduel', 'betmgm'].map((key, index) => ({ key, title: key,
      markets: markets.filter(market => market === 'batter_hits').map(market => ({ key: market, outcomes: [
        { name: 'Over', description: 'Shohei Ohtani', price: -150 + index * 5, point: 0.5 },
        { name: 'Under', description: 'Shohei Ohtani', price: 120 - index * 5, point: 0.5 },
      ] })) })) }, { headers: { ...headers, 'x-requests-last': String(markets.length) } });
  });
}

beforeEach(() => {
  Object.assign(store, { remaining: 16948, observedAt: Date.now(), pending: 0, spent: 0, gameStatus: 'Pre-Game', startOffsetMs: 2 * 3600_000, calls: [], marketsStatus: 200, postedMarkets: null });
  store.owners.clear(); store.reservations.clear(); store.cache.clear();
  vi.resetModules();
  vi.stubEnv('THE_ODDS_API_KEY', 'fixture-key');
  vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'false');
  vi.stubGlobal('fetch', oddsApi());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function loadMLB() {
  const { createAgentContext, executeTool } = await import('./tools');
  const { withAutomaticOddsRefresh } = await import('../../odds/client');
  const context = createAgentContext();
  context.pendingQueryIntent = 'best mlb plays for today';
  return withAutomaticOddsRefresh(() => executeTool('get_sportsbook_candidates', { sport: 'mlb', date: todaySlateDate() }, context));
}

describe('MLB automatic live research', () => {
  it('refreshes uncached MLB markets under the automatic scope and loads candidates', async () => {
    const result = await loadMLB();
    expect({ status: result.status, error: (result as { error?: string }).error, calls: store.calls }).toMatchObject({ status: 'SUCCESS' });
    expect(store.spent).toBeLessThanOrEqual(50);
  });

  it('never reserves paid ledger credits for the free event list inside the automatic scope', async () => {
    const { getOddsEvents, withAutomaticOddsRefresh } = await import('../../odds/client');
    await withAutomaticOddsRefresh(() => getOddsEvents());
    expect(store.calls).toEqual(['/v4/sports/baseball_mlb/events']);
    expect(store.spent).toBe(0);
    expect(store.reservations.size).toBe(0);
  });

  it('reports a started slate specifically and spends nothing', async () => {
    Object.assign(store, { gameStatus: 'In Progress', startOffsetMs: -20 * 60_000 });
    const result = await loadMLB();
    expect(result).toMatchObject({ status: 'SLATE_COMPLETE', gamesInProgress: 1 });
    expect((result as { error?: string }).error).toContain('already started');
    expect(store.calls.filter(path => !path.endsWith('/events'))).toEqual([]);
  });

  it('distinguishes no posted player props from a provider outage', async () => {
    store.postedMarkets = ['h2h', 'spreads', 'totals'];
    const result = await loadMLB();
    expect(result).toMatchObject({ status: 'NO_CACHED_SPORTSBOOK_DATA' });
    expect((result as { error?: string }).error).toMatch(/have not posted MLB player props/);
    expect(store.spent).toBe(1);
  });

  it('reports provider failures explicitly and does not strand the refresh lock', async () => {
    store.marketsStatus = 500;
    const first = await loadMLB();
    expect(first).toMatchObject({ status: 'PROVIDER_ERROR' });
    expect(store.owners.size).toBe(0);
    store.marketsStatus = 200;
    const second = await loadMLB();
    expect(second).toMatchObject({ status: 'SUCCESS' });
  });

  it('classifies MLB game start from live status and first-pitch time', async () => {
    const { hasMLBGameStarted } = await import('./tools');
    const now = Date.parse('2026-10-15T00:05:00Z');
    expect(hasMLBGameStarted({ status: 'Warmup', gameTime: '2026-10-15T00:00:00Z' }, now)).toBe(false);
    expect(hasMLBGameStarted({ status: 'In Progress', gameTime: '2026-10-15T00:00:00Z' }, now)).toBe(true);
    expect(hasMLBGameStarted({ status: 'Delayed: Rain', gameTime: '2026-10-15T00:00:00Z' }, now)).toBe(true);
    expect(hasMLBGameStarted({ status: 'Scheduled', gameTime: '2026-10-15T17:00:00Z' }, now)).toBe(false);
    expect(hasMLBGameStarted({ status: 'Scheduled', gameTime: '7:10 PM' }, now)).toBe(false);
  });

  it('makes no paid request when automatic refresh is disabled', async () => {
    vi.stubEnv('ODDS_AUTO_REFRESH', 'false');
    const result = await loadMLB();
    expect(result).toMatchObject({ status: 'SPORTSBOOK_DATA_REQUIRED' });
    expect(store.calls.filter(path => !path.endsWith('/events'))).toEqual([]);
    expect(store.spent).toBe(0);
  });
});
