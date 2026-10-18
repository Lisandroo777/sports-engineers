import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MLBGame } from '../mlb/types';
import type { NormalizedProp } from '../odds/types';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), history: vi.fn(), props: vi.fn(), cache: vi.fn(), resolve: vi.fn() }));
vi.mock('../mlb/schedule', () => ({ getMLBSchedule: mocks.schedule }));
vi.mock('../mlb/players', () => ({ getMLBPlayer: async () => ({ currentTeam: { id: 1 } }), findMLBPlayerIdByName: mocks.resolve }));
vi.mock('../mlb/stats', async importOriginal => ({ ...await importOriginal<typeof import('../mlb/stats')>(), getMLBResearchGameLogs: mocks.history }));
vi.mock('../odds/persistentCache', () => ({ readPersistentCache: mocks.cache }));
vi.mock('../odds/client', () => ({
  getOddsEvents: async () => [{ id: 'event', commenceTime: '2026-10-18T23:00:00Z' }],
  hasCachedEventMarkets: async () => true, getEventPlayerProps: mocks.props, getDiscoveredEventPlayerProps: mocks.props,
  beginOddsSpendTrackingAsync: async () => undefined, getActiveOddsSpendTracker: () => null,
  getLastOddsCreditInfo: () => null, getPropsCacheTtlMs: () => 60_000,
  inspectEventPlayerPropsCacheState: async () => ({ props: 'CACHE_FRESH' }), isPaidRefreshAllowed: () => false,
  OddsBudgetGuardError: class extends Error {}, OddsRefreshNotAuthorizedError: class extends Error {},
}));
vi.mock('../odds/match', () => ({ matchOddsEvent: (_game: unknown, events: unknown[]) => events[0], oddsEventSlateDate: () => '2026-10-18' }));
vi.mock('../odds/snapshotStore', () => ({ recordSnapshot: async () => undefined, getSnapshotHistory: async () => [] }));
vi.mock('../mlb/researchContext', async importOriginal => ({ ...await importOriginal<typeof import('../mlb/researchContext')>(), getMLBResearchContext: async () => null }));
vi.mock('./matchup', () => ({ buildMatchupSignal: async () => ({ available: false, opposingPitcher: null, qualityScore: null }) }));
vi.mock('./alternateLineOptimizer', () => ({ computeAlternateLineOptimizer: () => ({ available: false }) }));
vi.mock('./crossBookThreshold', () => ({ computeCrossBookThreshold: () => ({ available: false }) }));

import { runFinderDeepSearch } from './engine';

const game: MLBGame = {
  id: '123', date: '2026-10-18', gameTime: '2026-10-18T23:00:00Z', status: 'Scheduled',
  homeTeam: { id: 1, name: 'Home', abbreviation: 'H' }, awayTeam: { id: 2, name: 'Away', abbreviation: 'A' },
};
const props: NormalizedProp[] = ['Unavailable', 'Available'].map(player => ({
  eventId: 'event', player, playerId: 999, marketKey: 'batter_hits', marketLabel: 'Hits', line: 0.5,
  sourceMarketKey: 'batter_hits',
  overOdds: -110, underOdds: null, sportsbookKey: 'fixture', sportsbookName: 'Fixture',
  historicalAnalysisAvailable: true, isAlternate: false, lastUpdate: '2026-10-18T18:00:00Z',
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
  mocks.schedule.mockResolvedValue([game]);
  mocks.props.mockResolvedValue(props);
  mocks.resolve.mockImplementation(async (name: string) => {
    if (name === 'Unavailable') throw new Error('Identity provider unavailable');
    return 10;
  });
  mocks.history.mockResolvedValue({ regularSeason: [{ date: '2026-09-20', hits: 2 }], postseason: [], qualityNotes: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['discovery', 'cached-primary'])('MLB %s player resolution', path => {
  beforeEach(() => {
    mocks.cache.mockImplementation(async (url: string) => path === 'discovery' ? null : {
      data: url.includes('/markets?') ? { bookmakers: [{ markets: [{ key: 'batter_hits' }] }] } : { id: 'event' },
    });
  });

  it('retains raw pricing and available history without guessing a failed identity', async () => {
    const summary = await runFinderDeepSearch('2026-10-18');
    expect(summary).toMatchObject({ gamesAnalyzed: 1, rawPropsTotal: 2, propsAnalyzed: 2 });
    expect(summary.gameCoverage?.[0].status).toBe('RESEARCHED');
    expect(summary.results).toHaveLength(2);
    expect(summary.results.find(result => result.player === 'Unavailable')).toMatchObject({
      playerId: null, projection: null, historical: { seasonRate: null },
    });
    expect(summary.results.find(result => result.player === 'Available')).toMatchObject({ playerId: 10, projection: 2 });
    expect(mocks.history.mock.calls).toEqual([[10, '2026-10-18', 'batter_hits']]);
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it('keeps whole-event provider failures visible', async () => {
    mocks.props.mockRejectedValueOnce(new Error('Pricing unavailable'));
    const summary = await runFinderDeepSearch('2026-10-18');
    expect(summary.gameCoverage?.[0].status).toBe('PROVIDER_ERROR');
    expect(summary).toMatchObject({ gamesAnalyzed: 0, rawPropsTotal: 0, results: [] });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});