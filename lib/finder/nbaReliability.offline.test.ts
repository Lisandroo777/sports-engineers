import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../nba/schedule', () => ({ getNBASchedule: vi.fn() }));
vi.mock('../nba/players', () => ({ searchNBAPlayers: vi.fn(async () => []), getNBAPlayer: vi.fn() }));
vi.mock('../nba/injuries', () => ({ getNBAInjuryStatuses: vi.fn(async () => []), classifyNBAInjuryTier: vi.fn() }));
vi.mock('../nba/opponentContext', () => ({ buildNBAOpponentContextCache: vi.fn(async () => new Map()), getNBAOpponentContext: vi.fn() }));
vi.mock('../nba/context/provider', () => ({ createNBAContextProvider: vi.fn(() => ({})) }));
vi.mock('../odds/client', () => ({
  getOddsEventsForSport: vi.fn(), getDiscoveredEventPlayerProps: vi.fn(),
  getLastOddsCreditInfo: vi.fn(() => null), beginOddsSpendTrackingAsync: vi.fn(),
  getActiveOddsSpendTracker: vi.fn(() => null), inspectEventPlayerPropsCacheState: vi.fn(),
  isPaidRefreshAllowed: vi.fn(() => false),
  OddsBudgetGuardError: class extends Error {}, OddsRefreshNotAuthorizedError: class extends Error {},
}));

import { runNBAFinderDeepSearch } from './nbaEngine';
import { getNBASchedule } from '../nba/schedule';
import { getOddsEventsForSport, getDiscoveredEventPlayerProps, OddsRefreshNotAuthorizedError } from '../odds/client';

const teams = [
  ['Boston Celtics', 'New York Knicks'],
  ['Denver Nuggets', 'Los Angeles Lakers'],
  ['Miami Heat', 'Chicago Bulls'],
];

function prop(eventId: string) {
  return {
    eventId, player: `Player ${eventId}`, marketKey: 'player_points', line: 20.5,
    overOdds: -110, underOdds: null, sportsbookKey: 'fixture', sportsbookName: 'Fixture',
    isAlternate: false, lastUpdate: '2026-10-18T18:00:00Z',
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
  vi.mocked(getNBASchedule).mockResolvedValue(teams.map(([home, away], index) => ({
    id: `g${index}`, gameTime: '2026-10-18T23:00:00Z', completed: false,
    homeTeam: { id: index * 2 + 1, displayName: home }, awayTeam: { id: index * 2 + 2, displayName: away },
  })) as Awaited<ReturnType<typeof getNBASchedule>>);
  vi.mocked(getOddsEventsForSport).mockResolvedValue(teams.map(([home, away], index) => ({
    id: `e${index}`, homeTeam: home, awayTeam: away, commenceTime: '2026-10-18T23:00:00Z',
  })) as Awaited<ReturnType<typeof getOddsEventsForSport>>);
  vi.mocked(getDiscoveredEventPlayerProps).mockReset();
  vi.mocked(getDiscoveredEventPlayerProps).mockImplementation(async (eventId) => [prop(eventId)] as Awaited<ReturnType<typeof getDiscoveredEventPlayerProps>>);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('NBA per-game reliability', () => {
  it('retains real earlier and later props after one provider failure', async () => {
    vi.mocked(getDiscoveredEventPlayerProps).mockImplementation(async (eventId) => {
      if (eventId === 'e1') throw new Error('Provider unavailable');
      return [prop(eventId)] as Awaited<ReturnType<typeof getDiscoveredEventPlayerProps>>;
    });
    const summary = await runNBAFinderDeepSearch('2026-10-18');
    expect(summary.nbaCandidates.map((candidate) => candidate.eventId)).toEqual(['e0', 'e2']);
    expect(summary.nbaGameCoverage).toEqual([
      { gameId: 'g0', eventId: 'e0', state: 'RESEARCHED' },
      { gameId: 'g1', eventId: 'e1', state: 'PROVIDER_ERROR' },
      { gameId: 'g2', eventId: 'e2', state: 'RESEARCHED' },
    ]);
    expect(summary).toMatchObject({ gamesAnalyzed: 2, rawPropsTotal: 2, propsAnalyzed: 2, partialCoverage: true, researchComplete: false, results: [] });
  });

  it('distinguishes empty markets from a failed refresh without fabricating picks', async () => {
    vi.mocked(getDiscoveredEventPlayerProps).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Refresh failed'));
    const summary = await runNBAFinderDeepSearch('2026-10-18');
    expect(summary.nbaGameCoverage?.map((entry) => entry.state)).toEqual(['NO_MARKETS', 'PROVIDER_ERROR', 'RESEARCHED']);
    expect(summary.nbaCandidates.map((candidate) => candidate.eventId)).toEqual(['e2']);
    expect(summary.gamesAnalyzed).toBe(1);
    expect(summary.researchComplete).toBe(false);
  });

  it('reports authorization blocks separately and continues cached games', async () => {
    vi.mocked(getDiscoveredEventPlayerProps).mockRejectedValueOnce(new OddsRefreshNotAuthorizedError('Blocked'));
    const summary = await runNBAFinderDeepSearch('2026-10-18');
    expect(summary.nbaGameCoverage?.map((entry) => entry.state)).toEqual(['BUDGET_BLOCKED', 'RESEARCHED', 'RESEARCHED']);
    expect(summary).toMatchObject({ budgetLimited: true, blockReason: 'NOT_AUTHORIZED', gamesAnalyzed: 2, researchComplete: false });
  });

  it('counts only researched games when validation leaves games unfetched', async () => {
    const summary = await runNBAFinderDeepSearch('2026-10-18', { validationMaxGames: 1 });
    expect(summary.nbaGameCoverage?.map((entry) => entry.state)).toEqual(['RESEARCHED', 'NOT_FETCHED', 'NOT_FETCHED']);
    expect(summary).toMatchObject({ gamesAnalyzed: 1, gamesEligible: 3, partialCoverage: true });
  });

  it('marks a fully researched slate complete', async () => {
    const summary = await runNBAFinderDeepSearch('2026-10-18');
    expect(summary).toMatchObject({ gamesAnalyzed: 3, partialCoverage: false, researchComplete: true });
  });

  it('never reports a failed schedule lookup as complete', async () => {
    vi.mocked(getNBASchedule).mockRejectedValueOnce(new Error('Schedule unavailable'));
    const summary = await runNBAFinderDeepSearch('2026-10-18');
    expect(summary).toMatchObject({ gamesAnalyzed: 0, partialCoverage: true, researchComplete: false, nbaCandidates: [] });
  });

  it('does not count blocked validation games or request their props', async () => {
    const summary = await runNBAFinderDeepSearch('2026-10-18', { validationMaxCredits: 1 });
    expect(getDiscoveredEventPlayerProps).not.toHaveBeenCalled();
    expect(summary.nbaGameCoverage?.map((entry) => entry.state)).toEqual(['BUDGET_BLOCKED', 'BUDGET_BLOCKED', 'BUDGET_BLOCKED']);
    expect(summary).toMatchObject({ gamesAnalyzed: 0, gamesSkippedByCreditCap: 3, budgetLimited: true, researchComplete: false });
  });

  it('retains unmatched scheduled games as unfetched rather than researched', async () => {
    vi.mocked(getOddsEventsForSport).mockResolvedValueOnce([]);
    const summary = await runNBAFinderDeepSearch('2026-10-18');
    expect(summary.nbaGameCoverage).toEqual(teams.map((_, index) => ({ gameId: `g${index}`, eventId: null, state: 'NOT_FETCHED' })));
    expect(summary).toMatchObject({ gamesAnalyzed: 0, partialCoverage: true, researchComplete: false });
  });
});