import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../nba/schedule', () => ({ getNBASchedule: vi.fn() }));
vi.mock('../nba/players', () => ({ searchNBAPlayers: vi.fn(), getNBAPlayer: vi.fn(async () => ({ team: null })) }));
vi.mock('../nba/stats', () => ({ getNBAPlayerGameLogs: vi.fn(async () => []) }));
vi.mock('../nba/injuries', () => ({ getNBAInjuryStatuses: vi.fn(async () => []), classifyNBAInjuryTier: vi.fn() }));
vi.mock('../nba/opponentContext', () => ({ buildNBAOpponentContextCache: vi.fn(async () => new Map()), getNBAOpponentContext: vi.fn(() => null) }));
vi.mock('../nba/context/provider', () => ({ createNBAContextProvider: vi.fn(() => ({})) }));
vi.mock('../odds/client', () => ({
  getOddsEventsForSport: vi.fn(), getDiscoveredEventPlayerProps: vi.fn(),
  getLastOddsCreditInfo: vi.fn(() => null), beginOddsSpendTrackingAsync: vi.fn(),
  getActiveOddsSpendTracker: vi.fn(() => null), inspectEventPlayerPropsCacheState: vi.fn(),
  isPaidRefreshAllowed: vi.fn(() => false),
  OddsBudgetGuardError: class extends Error {}, OddsRefreshNotAuthorizedError: class extends Error {},
}));

import { matchNBAPlayer, runNBAFinderDeepSearch } from './nbaEngine';
import { getNBASchedule } from '../nba/schedule';
import { searchNBAPlayers } from '../nba/players';
import { getNBAPlayerGameLogs } from '../nba/stats';
import { getOddsEventsForSport, getDiscoveredEventPlayerProps } from '../odds/client';

const teams = [['Boston Celtics', 'New York Knicks'], ['Denver Nuggets', 'Los Angeles Lakers']];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
  vi.mocked(getNBASchedule).mockResolvedValue(teams.map(([home, away], index) => ({
    id: `g${index}`, gameTime: '2026-10-18T23:00:00Z', completed: false,
    homeTeam: { id: index * 2 + 1, displayName: home }, awayTeam: { id: index * 2 + 2, displayName: away },
  })) as Awaited<ReturnType<typeof getNBASchedule>>);
  vi.mocked(getOddsEventsForSport).mockResolvedValue(teams.map(([home, away], index) => ({
    id: `e${index}`, homeTeam: home, awayTeam: away, commenceTime: '2026-10-18T23:00:00Z',
  })));
  vi.mocked(getDiscoveredEventPlayerProps).mockImplementation(async eventId =>
    (eventId === 'e0' ? ['Unavailable', 'Available'] : ['Later Player']).map(player => ({
      eventId, player, playerId: 999, marketKey: 'player_points', marketLabel: 'Points', line: 20.5,
      sourceMarketKey: 'player_points',
      overOdds: -110, underOdds: null, sportsbookKey: 'fixture', sportsbookName: 'Fixture',
      historicalAnalysisAvailable: true, isAlternate: false, lastUpdate: '2026-10-18T18:00:00Z',
    })));
  vi.mocked(searchNBAPlayers).mockImplementation(async name => {
    if (name === 'Unavailable') throw new Error('Player search unavailable');
    return [{ id: name === 'Available' ? 10 : 20, name, position: 'G', team: null, jersey: null, headshotUrl: null }];
  });
  vi.mocked(getNBAPlayerGameLogs).mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe('NBA player resolution isolation', () => {
  it('returns the canonical unmatched shape on a rejected search', async () => {
    await expect(matchNBAPlayer('Unavailable')).resolves.toEqual({ state: 'UNMATCHED', playerId: null, position: null });
  });

  it('retains same-game and later-game players without guessing the failed identity', async () => {
    const summary = await runNBAFinderDeepSearch('2026-10-18');
    expect(summary).toMatchObject({ gamesAnalyzed: 2, rawPropsTotal: 3, propsAnalyzed: 3 });
    expect(summary.nbaCandidates).toHaveLength(3);
    expect(summary.nbaCandidates.find(candidate => candidate.playerName === 'Unavailable')).toMatchObject({
      playerId: null, playerMatch: 'UNMATCHED', position: null, history: null, projection: null, eliteAnalysis: null,
    });
    expect(summary.nbaCandidates.filter(candidate => candidate.playerMatch === 'MATCHED').map(candidate => candidate.playerId)).toEqual([10, 20]);
    expect(vi.mocked(getNBAPlayerGameLogs).mock.calls.map(call => call[0])).toEqual([10, 20]);
  });

  it('isolates rejected logs and retains later games without inventing history', async () => {
    vi.mocked(getNBAPlayerGameLogs).mockRejectedValueOnce(new Error('Player logs unavailable'));
    const summary = await runNBAFinderDeepSearch('2026-10-18');
    expect(summary).toMatchObject({ gamesAnalyzed: 2, rawPropsTotal: 3, propsAnalyzed: 3 });
    expect(summary.nbaCandidates.find(candidate => candidate.playerId === 10)).toMatchObject({ projection: null, history: { windows: { season: { total: 0 } } } });
    expect(summary.nbaCandidates.find(candidate => candidate.playerId === 20)).toBeDefined();
    expect(vi.mocked(getNBAPlayerGameLogs).mock.calls.map(call => call[0])).toEqual([10, 20]);
  });
});