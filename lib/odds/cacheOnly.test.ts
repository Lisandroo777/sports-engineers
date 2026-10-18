import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn(), stale: vi.fn(), budget: vi.fn(), lock: vi.fn(), reserve: vi.fn(),
  enabled: vi.fn(), limits: vi.fn(), observe: vi.fn(), write: vi.fn(),
}));

vi.mock('./persistentCache', () => ({
  readPersistentCache: mocks.read, readStalePersistentCache: mocks.stale,
  writePersistentCache: mocks.write, writeCreditStatus: vi.fn(), readCreditStatus: vi.fn(async () => null),
}));
vi.mock('./budget', async (importOriginal) => ({
  ...await importOriginal<typeof import('./budget')>(), getOddsBudgetStatus: mocks.budget,
}));
vi.mock('./autoRefreshLedger', async (importOriginal) => ({
  ...await importOriginal<typeof import('./autoRefreshLedger')>(),
  isAutomaticOddsRefreshEnabled: mocks.enabled, getOddsRefreshLimits: mocks.limits,
  acquireRefreshLock: mocks.lock, reserveDailyCredits: mocks.reserve, recordProviderRemaining: mocks.observe,
  releaseRefreshLock: vi.fn(), settleDailyCredits: vi.fn(),
}));
vi.mock('../nfl/refreshLease', () => ({
  withNFLRefreshLease: async (_key: string, operation: () => Promise<unknown>) => operation(),
}));

let client: typeof import('./client');

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(null);
  mocks.stale.mockResolvedValue(null);
  mocks.enabled.mockReturnValue(true);
  mocks.limits.mockReturnValue({ perSearchCredits: 50 });
  mocks.budget.mockImplementation(() => { throw new Error('Unexpected budget access'); });
  vi.stubEnv('THE_ODDS_API_KEY', 'offline-fixture-not-a-real-key');
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'true');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected provider request'); }));
  client = await import('./client');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function expectNoPaidWork() {
  expect(mocks.budget).not.toHaveBeenCalled();
  expect(mocks.lock).not.toHaveBeenCalled();
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

describe('request-local cache-only odds', () => {
  it('skips automatic approvals while allowing the operation', async () => {
    expect(await client.withCachedOddsOnly(() => client.withAutomaticOddsRefresh(async () => {
      await Promise.resolve();
      return client.isPaidRefreshAllowed();
    }))).toBe(false);
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.limits).not.toHaveBeenCalled();
    expect(client.isPaidRefreshAllowed()).toBe(true);
    expectNoPaidWork();
  });

  it.each(['outer', 'inner'] as const)('blocks shared markets with an %s force-fresh approval', async (order) => {
    const request = () => client.withAutomaticOddsRefresh(() => client.getEventMarkets('cache-only-missing'));
    const operation = order === 'outer'
      ? () => client.withOneRunPaidRefresh(() => client.withCachedOddsOnly(request), { forceFresh: true })
      : () => client.withCachedOddsOnly(() => client.withOneRunPaidRefresh(request, { forceFresh: true }));
    await expect(operation()).rejects.toBeInstanceOf(client.OddsRefreshNotAuthorizedError);
    expectNoPaidWork();
  });

  it('blocks the NFL direct request inside automatic and explicit approvals', async () => {
    const { retrieveNFLSportsbookGame } = await import('../nfl/sportsbook');
    const result = await client.withAutomaticOddsRefresh(() => client.withCachedOddsOnly(() =>
      client.withOneRunPaidRefresh(() => retrieveNFLSportsbookGame({
        date: '2026-10-18', gameId: 'cache-only-nfl', eventId: 'cache-only-nfl',
        kickoff: '2026-10-18T17:00:00Z', markets: ['player_pass_yds'],
      }), { forceFresh: true })));
    expect(result).toMatchObject({ complete: false, failure: 'RESERVE', props: [] });
    expectNoPaidWork();
  });

  it('serves fresh persisted priced props and then memory despite force-fresh approval', async () => {
    const updated = new Date().toISOString();
    mocks.read.mockResolvedValue({ cachedAt: Date.now(), expiresAt: Date.now() + 60000, data: {
      id: 'cache-only-priced', bookmakers: [{ key: 'draftkings', title: 'DraftKings', markets: [{
        key: 'player_points', last_update: updated,
        outcomes: [{ name: 'Over', description: 'Fixture Player', point: 25.5, price: -110 }],
      }] }],
    } });
    const read = () => client.getEventPlayerProps('cache-only-priced', ['player_points'], undefined, 'basketball_nba');
    await client.withOneRunPaidRefresh(() => client.withCachedOddsOnly(async () => {
      expect(await read()).toEqual([expect.objectContaining({ player: 'Fixture Player', line: 25.5, overOdds: -110, lastUpdate: updated })]);
      expect(client.getLastOddsCreditInfo()).toMatchObject({ source: 'disk', cacheState: 'CACHE_FRESH' });
      mocks.read.mockResolvedValue(null);
      expect(await read()).toEqual([expect.objectContaining({ line: 25.5, overOdds: -110 })]);
      expect(client.getLastOddsCreditInfo()).toMatchObject({ source: 'memory', cacheState: 'CACHE_FRESH' });
    }), { forceFresh: true });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expectNoPaidWork();
  });

  it('allows mocked free events with zero cost and no paid budget or reservation', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json([{
      id: 'free-event', home_team: 'Home', away_team: 'Away', commence_time: '2026-10-18T17:00:00Z',
    }], { headers: { 'x-requests-last': '0' } }));
    const events = await client.withCachedOddsOnly(() => client.withAutomaticOddsRefresh(() =>
      client.getOddsEventsForSport('americanfootball_nfl')));
    expect(events).toEqual([{ id: 'free-event', homeTeam: 'Home', awayTeam: 'Away', commenceTime: '2026-10-18T17:00:00Z' }]);
    expect(client.getLastOddsCreditInfo()).toMatchObject({ cacheState: 'FREE', lastCost: '0' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.budget).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('isolates concurrent normal work and restores authorization after rejection', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = client.withCachedOddsOnly(async () => {
      await gate;
      expect(client.isPaidRefreshAllowed()).toBe(false);
      throw new Error('fixture rejection');
    });
    expect(client.isPaidRefreshAllowed()).toBe(true);
    release();
    await expect(pending).rejects.toThrow('fixture rejection');
    expect(client.isPaidRefreshAllowed()).toBe(true);
    expectNoPaidWork();
  });
});