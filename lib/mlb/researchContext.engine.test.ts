import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFinderDeepSearch } from '../finder/engine';
import type { MLBResearchGameLogs } from './types';

const mocks = vi.hoisted(() => ({ score: vi.fn(), feedFails: false }));

vi.mock('./schedule', () => ({ getMLBSchedule: async () => [{ id: '123', date: '2026-10-16', gameTime: '2026-10-16T23:00:00Z', status: 'Scheduled', homeTeam: { id: 1, name: 'Home', abbreviation: 'H' }, awayTeam: { id: 2, name: 'Away', abbreviation: 'A' } }] }));
vi.mock('./players', () => ({ getMLBPlayer: async (id: number) => ({ currentTeam: { id: id === 40 ? 3 : 1 } }), findMLBPlayerIdByName: async () => null }));
vi.mock('./stats', async (importOriginal) => ({
  ...await importOriginal<typeof import('./stats')>(),
  getMLBResearchGameLogs: async (_id: number, slateDate: string): Promise<MLBResearchGameLogs> => ({
  season: 2026, slateDate, group: 'pitching', qualityNotes: [],
  regularSeason: [1, 2].map(index => ({ date: `2026-09-${20 + index}`, gamePk: 100 + index, gameType: 'R',
    opponent: 'Away', homeAway: 'home', strikeouts: 6, inningsPitched: 6, hitsAllowed: 3, earnedRuns: 1, walks: 1, pitches: 90 })),
  postseason: [{ date: '2026-10-10', gamePk: 200, gameType: 'D', opponent: 'Away', homeAway: 'home',
    strikeouts: 12, inningsPitched: 7, hitsAllowed: 2, earnedRuns: 0, walks: 0, pitches: 95 }],
}) }));
vi.mock('../odds/persistentCache', () => ({ readPersistentCache: async () => null }));
vi.mock('../odds/eventProps', () => ({ getEventProps: async () => ({ event: { id: 'event' }, props: [{}] }) }));
vi.mock('../odds/client', () => ({
  getOddsEvents: async () => [{ id: 'event', commenceTime: '2026-10-16T23:00:00Z' }],
  hasCachedEventMarkets: async () => true,
  beginOddsSpendTrackingAsync: async () => undefined,
  getActiveOddsSpendTracker: () => null,
  getLastOddsCreditInfo: () => null,
  getPropsCacheTtlMs: () => 60_000,
  getEventPlayerProps: vi.fn(),
  inspectEventPlayerPropsCacheState: async () => ({ props: 'CACHE_FRESH' }),
  isPaidRefreshAllowed: () => false,
  OddsBudgetGuardError: class extends Error {},
  OddsRefreshNotAuthorizedError: class extends Error {},
}));
vi.mock('../odds/match', () => ({ matchOddsEvent: (_game: unknown, events: unknown[]) => events[0], oddsEventSlateDate: () => '2026-10-16' }));
vi.mock('../odds/anyOpportunities', () => ({ buildAllMarketOpportunities: () => [10, 30, 40].map(playerId => ({
  id: String(playerId), player: `Player ${playerId}`, playerId, eventId: 'event', marketKey: 'pitcher_strikeouts', marketLabel: 'Strikeouts',
  line: 3.5, side: 'over', odds: -110, sportsbookKey: 'book', sportsbookName: 'Book', historicalAnalysisAvailable: true, evPercent: 2, marketAgreement: 1,
})) }));
vi.mock('../odds/snapshotStore', () => ({ recordSnapshot: async () => undefined, getSnapshotHistory: async () => [] }));
vi.mock('../finder/matchup', () => ({ buildMatchupSignal: async () => ({ available: false }) }));
vi.mock('../finder/score', () => ({ computeFinderScore: mocks.score }));
vi.mock('../finder/explain', () => ({ buildExplanation: () => ({ signals: [], concerns: [] }) }));
vi.mock('../finder/alternateLineOptimizer', () => ({ computeAlternateLineOptimizer: () => ({ available: false }) }));
vi.mock('../finder/crossBookThreshold', () => ({ computeCrossBookThreshold: () => ({ available: false }) }));

beforeEach(() => {
  mocks.feedFails = false;
  mocks.score.mockReset().mockReturnValue({ score: 81, grade: 'Good' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url !== 'https://statsapi.mlb.com/api/v1.1/game/123/feed/live') throw new Error(`Unexpected network request: ${url}`);
    if (mocks.feedFails) throw new Error('Feed unavailable');
    return { ok: true, json: async () => ({ gamePk: 123, gameData: { probablePitchers: { home: { id: 10, fullName: 'Player 10' }, away: { id: 20, fullName: 'Player 20' } } } }) };
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('MLB engine context integration (offline)', () => {
  it('retrieves once per game, retains relievers, and avoids attributing mismatched teams', async () => {
    const summary = await runFinderDeepSearch('2026-10-16');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(summary.results).toHaveLength(3);
    const [starter, reliever, mismatch] = summary.results;
    expect(starter.projection).toBe(6);
    expect(starter.historical.seasonRate).toBe(100);
    expect(starter.matchupEvidenceAvailable).toBe(false);
    expect(starter.mlbContext?.history).toMatchObject({ regularSeasonGames: 2, postseasonGames: 1,
      postseasonRecent: [{ date: '2026-10-10', gamePk: 200, gameType: 'D', value: 12 }] });
    expect(starter.mlbContext?.probablePitchers).toBe(reliever.mlbContext?.probablePitchers);
    expect(starter.mlbContext?.player?.scheduledStarter.value?.isListedProbableStarter).toBe(true);
    expect(reliever.mlbContext?.player?.scheduledStarter.value?.isListedProbableStarter).toBe(false);
    expect(mismatch.teamId).toBeNull();
    expect(mismatch.opponentTeamId).toBeNull();
    expect(mismatch.concerns.join(' ')).toContain('does not match');
    expect(starter.sources).toContain('https://statsapi.mlb.com/api/v1.1/game/123/feed/live');
    expect(starter.sources).toContain('https://statsapi.mlb.com/api/v1/people/10?hydrate=currentTeam');
    expect(summary.gameCoverage?.[0].status).toBe('RESEARCHED');
  });

  it('keeps scoring inputs and results unchanged when feed context fails', async () => {
    const available = await runFinderDeepSearch('2026-10-16');
    const scoringInputs = mocks.score.mock.calls.map(call => call[0]);
    mocks.score.mockClear();
    mocks.feedFails = true;
    const unavailable = await runFinderDeepSearch('2026-10-16');
    expect(mocks.score.mock.calls.map(call => call[0])).toEqual(scoringInputs);
    expect(unavailable.results.map(result => [result.id, result.finderScore, result.grade, result.evPercent])).toEqual(available.results.map(result => [result.id, result.finderScore, result.grade, result.evPercent]));
    expect(unavailable.results[0].mlbContext?.weather.status).toBe('UNAVAILABLE');
    expect(unavailable.results[0].sources).not.toContain('https://statsapi.mlb.com/api/v1.1/game/123/feed/live');
  });
});