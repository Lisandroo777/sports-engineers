import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNFLFinderDeepSearch } from './nflEngine';
import { isPaidRefreshAllowed, withAutomaticOddsRefresh, withBoundedOddsRequest, withOneRunPaidRefresh } from '../odds/client';
import type { NFLGame } from '../nfl/types';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(), events: vi.fn(), retrieve: vi.fn(), coverage: vi.fn(), injuries: vi.fn(),
  provider: vi.fn(), reserve: vi.fn(), cached: false, authorization: [] as boolean[],
}));

vi.mock('../nfl/schedule', () => ({ getNFLSchedule: mocks.schedule }));
vi.mock('../nfl/sportsbook', async (original) => ({
  ...await original<typeof import('../nfl/sportsbook')>(),
  getNFLSportsbookEvents: mocks.events,
  retrieveNFLSportsbookGame: mocks.retrieve,
  inspectNFLSportsbookCoverage: mocks.coverage,
}));
vi.mock('../nfl/injuries', async (original) => ({
  ...await original<typeof import('../nfl/injuries')>(), getNFLInjurySnapshot: mocks.injuries,
}));
vi.mock('../odds/client', async (original) => {
  const actual = await original<typeof import('../odds/client')>();
  return { ...actual, withAutomaticOddsRefresh: vi.fn(actual.withAutomaticOddsRefresh) };
});
vi.mock('../odds/budget', async (original) => ({
  ...await original<typeof import('../odds/budget')>(),
  getOddsBudgetStatus: async () => ({ belowReserve: false, remaining: 20000, minReserve: 2000 }),
}));
vi.mock('../odds/autoRefreshLedger', async (original) => ({
  ...await original<typeof import('../odds/autoRefreshLedger')>(),
  acquireRefreshLock: async () => 'offline-owner',
  releaseRefreshLock: async () => {},
  reserveDailyCredits: mocks.reserve,
  settleDailyCredits: async () => {},
  recordProviderRemaining: async () => {},
}));
vi.mock('../odds/persistentCache', () => ({ readCreditStatus: async () => ({ remaining: '20000' }) }));

const now = '2026-10-18T12:00:00Z';
const kickoff = '2026-10-18T17:00:00Z';
const team = (id: number, displayName: string) => ({
  id, displayName, name: displayName, abbreviation: displayName, logoUrl: null, color: null,
});
const games: NFLGame[] = [1, 2, 3].map(index => ({
  id: `game-${index}`, season: 2026, week: 7, seasonType: 'REGULAR', gameTime: kickoff,
  homeTeam: team(index * 2, `Home ${index}`), awayTeam: team(index * 2 + 1, `Away ${index}`),
  homeScore: null, awayScore: null, completed: false, status: 'Scheduled',
}));
const cachedResult = () => ({
  props: [], complete: true, fromCache: true, returnedMarkets: [], zeroMarkets: [], failedMarkets: [],
  retrievedAt: now, expiresAt: Date.parse(kickoff), failure: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'false');
  vi.stubEnv('ODDS_REFRESH_MAX_SEARCH_CREDITS', '2');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls forbidden'); }));
  mocks.cached = false;
  mocks.authorization.length = 0;
  mocks.schedule.mockResolvedValue(games);
  mocks.events.mockResolvedValue(games.map(game => ({
    id: `event-${game.id}`, homeTeam: game.homeTeam.displayName,
    awayTeam: game.awayTeam.displayName, commenceTime: kickoff,
  })));
  mocks.coverage.mockResolvedValue({ state: 'CACHE_MISSING', missingMarkets: 1 });
  mocks.injuries.mockResolvedValue({ reports: [], complete: true });
  mocks.reserve.mockResolvedValue({ id: 'offline-reservation', credits: 1 });
  mocks.provider.mockImplementation(async () => ({
    data: { ...cachedResult(), fromCache: false }, credits: '1', remaining: '20000',
  }));
  mocks.retrieve.mockImplementation(async ({ eventId }: { eventId: string }) => {
    mocks.authorization.push(isPaidRefreshAllowed());
    if (mocks.cached) return cachedResult();
    return withBoundedOddsRequest(`/sports/americanfootball_nfl/events/${eventId}/odds`,
      { markets: 'player_pass_yds', regions: 'us' }, mocks.provider);
  });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('NFL Finder shared automatic budget wrapper, offline', () => {
  it('enters the automatic wrapper once and shares its cap across all games', async () => {
    const result = await runNFLFinderDeepSearch('2026-10-18');
    expect(withAutomaticOddsRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.authorization).toEqual([true, true, true]);
    expect(mocks.provider).toHaveBeenCalledTimes(2);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ eventsMatched: 2, budgetLimited: true, blockReason: 'NOT_AUTHORIZED' });
    expect(isPaidRefreshAllowed()).toBe(false);
  });

  it.each([
    { maxRequests: 1, maxCredits: 2 },
    { maxRequests: 2, maxCredits: 1 },
  ])('preserves an outer approval of $maxRequests requests and $maxCredits credits', async limits => {
    await withOneRunPaidRefresh(async () => {
      const result = await runNFLFinderDeepSearch('2026-10-18');
      expect(result).toMatchObject({ eventsMatched: 1, budgetLimited: true, blockReason: 'NOT_AUTHORIZED' });
      await expect(withBoundedOddsRequest('/sports/americanfootball_nfl/events/after-search/odds',
        { markets: 'player_pass_yds', regions: 'us' }, mocks.provider)).rejects.toThrow(/ceiling reached/);
    }, limits);
    expect(withAutomaticOddsRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.retrieve).toHaveBeenCalledTimes(3);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });

  it('keeps direct cache hits usable with automatic refresh disabled', async () => {
    vi.stubEnv('ODDS_AUTO_REFRESH', 'false');
    mocks.cached = true;
    const result = await runNFLFinderDeepSearch('2026-10-18');
    expect(result).toMatchObject({ eventsMatched: 3, fromCache: true, budgetLimited: false });
    expect(mocks.authorization).toEqual([false, false, false]);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('does not secretly authorize uncached direct searches when automatic refresh is disabled', async () => {
    vi.stubEnv('ODDS_AUTO_REFRESH', 'false');
    const result = await runNFLFinderDeepSearch('2026-10-18');
    expect(result).toMatchObject({ eventsMatched: 0, budgetLimited: true, blockReason: 'NOT_AUTHORIZED' });
    expect(mocks.authorization).toEqual([false, false, false]);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each(['true', 'false'])('keeps preflight free with ODDS_AUTO_REFRESH=%s', async enabled => {
    vi.stubEnv('ODDS_AUTO_REFRESH', enabled);
    const result = await runNFLFinderDeepSearch('2026-10-18', { preflight: true });
    expect(withAutomaticOddsRefresh).toHaveBeenCalledTimes(1);
    expect(result.validationPreflight).toMatchObject({ matchedEvents: 3, cacheMisses: 3 });
    expect(mocks.coverage).toHaveBeenCalledTimes(3);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.injuries).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});