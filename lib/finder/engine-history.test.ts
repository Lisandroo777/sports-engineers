import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MLBGame, MLBResearchGameLogs } from '../mlb/types';
import { runFinderDeepSearch } from './engine';
import { hasMLBGameStarted, isMLBGameEligibleForResearch } from '../mlb/researchContext';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), history: vi.fn(), events: vi.fn(), matchup: vi.fn() }));

vi.mock('../mlb/schedule', () => ({ getMLBSchedule: mocks.schedule }));
vi.mock('../mlb/players', () => ({ getMLBPlayer: async () => ({ currentTeam: { id: 1 } }), findMLBPlayerIdByName: async () => 10 }));
vi.mock('../mlb/stats', async importOriginal => ({ ...await importOriginal<typeof import('../mlb/stats')>(), getMLBResearchGameLogs: mocks.history }));
vi.mock('../odds/persistentCache', () => ({ readPersistentCache: async () => null }));
vi.mock('../odds/eventProps', () => ({ getEventProps: async () => ({ event: { id: 'event' }, props: [{}] }) }));
vi.mock('../odds/client', () => ({
  getOddsEvents: mocks.events, hasCachedEventMarkets: async () => true,
  beginOddsSpendTrackingAsync: async () => undefined, getActiveOddsSpendTracker: () => null,
  getLastOddsCreditInfo: () => null, getPropsCacheTtlMs: () => 60_000, getEventPlayerProps: vi.fn(),
  inspectEventPlayerPropsCacheState: async () => ({ props: 'CACHE_FRESH' }), isPaidRefreshAllowed: () => false,
  OddsBudgetGuardError: class extends Error {}, OddsRefreshNotAuthorizedError: class extends Error {},
}));
vi.mock('../odds/match', () => ({ matchOddsEvent: (_game: unknown, events: unknown[]) => events[0], oddsEventSlateDate: () => '2025-10-16' }));
vi.mock('../odds/anyOpportunities', () => ({ buildAllMarketOpportunities: () => [
  ['batter_hits', 0.5], ['batter_hits', 1.5], ['batter_total_bases', 1.5], ['pitcher_strikeouts', 3.5], ['pitcher_strikeouts', 4.5],
].map(([marketKey, line], index) => ({
  id: String(index), player: 'Two Way', playerId: 10, eventId: 'event', marketKey, marketLabel: marketKey,
  line, side: 'over', odds: -110, sportsbookKey: 'book', sportsbookName: 'Book', historicalAnalysisAvailable: true,
  evPercent: 2, marketAgreement: 1,
})) }));
vi.mock('../odds/snapshotStore', () => ({ recordSnapshot: async () => undefined, getSnapshotHistory: async () => [] }));
vi.mock('./matchup', () => ({ buildMatchupSignal: mocks.matchup }));
vi.mock('./alternateLineOptimizer', () => ({ computeAlternateLineOptimizer: () => ({ available: false }) }));
vi.mock('./crossBookThreshold', () => ({ computeCrossBookThreshold: () => ({ available: false }) }));

const game: MLBGame = {
  id: '123', date: '2025-10-16', gameTime: '2025-10-16T23:00:00Z', status: 'Scheduled',
  homeTeam: { id: 1, name: 'Home', abbreviation: 'H' }, awayTeam: { id: 2, name: 'Away', abbreviation: 'A' },
  awayProbableStarter: { id: 20, name: 'Opponent', throwingHand: 'R' },
};

function history(marketKey: string): MLBResearchGameLogs {
  const pitching = marketKey.startsWith('pitcher_');
  return {
    season: 2025, slateDate: '2025-10-16', group: pitching ? 'pitching' : 'hitting', qualityNotes: [],
    regularSeason: [1, 2].map((value, index) => ({
      date: `2025-09-${20 + index}`, gamePk: 100 + index, gameType: 'R', opponent: 'Away', homeAway: 'home',
      ...(pitching ? { strikeouts: value + 4, inningsPitched: 6 } : { hits: value, doubles: 0, triples: 0, homeRuns: 0, plateAppearances: 4 }),
    })),
    postseason: [{ date: '2025-10-10', gamePk: 200, gameType: 'D', opponent: 'Away', homeAway: 'home', hits: 99, strikeouts: 99 }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.schedule.mockResolvedValue([game]);
  mocks.events.mockResolvedValue([{ id: 'event', commenceTime: game.gameTime }]);
  mocks.history.mockImplementation(async (_id: number, _date: string, market: string) => history(market));
  mocks.matchup.mockImplementation(async (pitcherId: number | null, market: string) => ({
    available: pitcherId === 20 && market.startsWith('batter_'), opposingPitcher: null,
    qualityScore: pitcherId === 20 && market.startsWith('batter_') ? 60 : null,
  }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ gamePk: 123 }) })));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('MLB engine season-separated history', () => {
  it('uses the selected slate year and caches once per player/group across markets and lines', async () => {
    const summary = await runFinderDeepSearch('2025-10-16');
    expect(mocks.history.mock.calls).toEqual([[10, '2025-10-16', 'batter_hits'], [10, '2025-10-16', 'pitcher_strikeouts']]);
    expect(summary.results).toHaveLength(5);
    const batter = summary.results.find(result => result.marketKey === 'batter_hits')!;
    const pitcher = summary.results.find(result => result.marketKey === 'pitcher_strikeouts')!;
    expect(batter.projection).toBe(1.5);
    expect(pitcher.projection).toBe(5.5);
    expect(batter.mlbContext?.history).toMatchObject({ regularSeasonGames: 2, postseasonGames: 1, postseasonRecent: [{ date: '2025-10-10', gamePk: 200, gameType: 'D', value: 99 }] });
    expect(batter.matchupEvidenceAvailable).toBe(true);
    expect(pitcher.matchupEvidenceAvailable).toBe(false);
  });

  it('keeps all scoring outputs unchanged when only postseason history changes', async () => {
    const baseline = await runFinderDeepSearch('2025-10-16');
    mocks.history.mockImplementation(async (_id: number, _date: string, market: string) => ({ ...history(market), postseason: [] }));
    const withoutPostseason = await runFinderDeepSearch('2025-10-16');
    const scoring = (summary: typeof baseline) => summary.results.map(({ mlbContext, ...result }) => { void mlbContext; return result; });
    expect(scoring(withoutPostseason)).toEqual(scoring(baseline));
  });

  it.each(['missing', 'incomplete', 'partial', 'rejected'])('does not substitute postseason for %s regular-season data', async mode => {
    mocks.history.mockImplementation(async (_id: number, _date: string, market: string) => {
      if (mode === 'rejected') throw new Error('Unavailable');
      const result = history(market);
      result.regularSeason = mode === 'missing' ? [] : result.regularSeason.map((log, index) => mode === 'partial' && index === 0 ? log : ({ ...log, hits: null, strikeouts: null }));
      return result;
    });
    const summary = await runFinderDeepSearch('2025-10-16');
    expect(mocks.history).toHaveBeenCalledTimes(2);
    for (const result of summary.results) {
      expect(result.projection).toBeNull();
      expect(result.historical.seasonRate).toBeNull();
      expect(result.mlbContext?.history?.qualityNotes.join(' ')).toContain('projection unavailable');
    }
  });

  it('does not claim matchup evidence merely because a probable pitcher is known', async () => {
    mocks.matchup.mockResolvedValue({ available: false, opposingPitcher: null, qualityScore: null });
    const summary = await runFinderDeepSearch('2025-10-16');
    expect(summary.results.every(result => result.matchupEvidenceAvailable === false)).toBe(true);
    expect(mocks.matchup).toHaveBeenCalledWith(20, 'batter_hits', 'over');
  });
});

describe('MLB engine eligibility before event discovery', () => {
  it.each([false, true])('does not fetch events on an empty slate (preflight %s)', async preflight => {
    mocks.schedule.mockResolvedValue([]);
    const summary = await runFinderDeepSearch('2025-10-16', { preflight });
    expect(summary.gamesEligible).toBe(0);
    expect(summary.slateComplete).toBe(false);
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it.each(['Final', 'Postponed', 'Cancelled', 'Suspended', 'In Progress', 'Manager Challenge', 'Live', 'Unknown'])('skips %s games before event discovery', async status => {
    mocks.schedule.mockResolvedValue([{ ...game, status }]);
    const summary = await runFinderDeepSearch('2025-10-16');
    expect(summary.results).toEqual([]);
    expect(summary.gamesEligible).toBe(0);
    expect(summary.slateComplete).toBe(['Final', 'Postponed', 'Cancelled', 'Suspended'].includes(status));
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it.each(['Scheduled', 'Pre-Game', 'Warmup', 'Delayed Start'])('retains explicit %s games despite elapsed scheduled time', status => {
    expect(isMLBGameEligibleForResearch({ ...game, status }, Date.parse('2025-10-17'))).toBe(true);
    expect(hasMLBGameStarted({ ...game, status }, Date.parse('2025-10-17'))).toBe(false);
  });

  it('excludes a live game even when its scheduled time is in the future', () => {
    expect(isMLBGameEligibleForResearch({ ...game, status: 'In Progress' }, Date.parse('2025-10-15'))).toBe(false);
  });

  it('researches only pregame entries on a mixed slate', async () => {
    mocks.schedule.mockResolvedValue([{ ...game, id: 'finished', status: 'Final' }, { ...game, id: 'started', status: 'In Progress' }, game]);
    const summary = await runFinderDeepSearch('2025-10-16');
    expect(summary.gamesScheduled).toBe(3);
    expect(summary.gamesEligible).toBe(1);
    expect(summary.gamesAnalyzed).toBe(1);
    expect(summary.slateComplete).toBe(false);
    expect(summary.results.every(result => result.gameId === game.id)).toBe(true);
  });
});