import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNBAFinderDeepSearch } from '../../../finder/nbaEngine';
import { getNBASchedule } from '../../schedule';
import type { NBAGame } from '../../types';
import { researchNBAGameLines } from './pipeline';
import { matchesNBATeams, requestedNBATeams } from './requestScope';

vi.mock('../../schedule', () => ({ getNBASchedule: vi.fn() }));
vi.mock('../../context/provider', () => ({ createNBAContextProvider: vi.fn(() => ({})) }));
vi.mock('./pipeline', () => ({ researchNBAGameLines: vi.fn() }));
vi.mock('../../../odds/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../../odds/client')>(),
  beginOddsSpendTrackingAsync: vi.fn().mockResolvedValue(undefined),
  getOddsEventsForSport: vi.fn().mockResolvedValue([]),
  getLastOddsCreditInfo: vi.fn(() => null),
  getActiveOddsSpendTracker: vi.fn(() => null),
}));

describe('requestedNBATeams', () => {
  it.each([
    ['Best NBA Boston Celtics vs Detroit Pistons moneylines today', ['Boston Celtics', 'Detroit Pistons']],
    ['Best NBA Celtics vs Pistons moneylines today', ['Boston Celtics', 'Detroit Pistons']],
    ['boston CELTICS vs detroit PISTONS', ['Boston Celtics', 'Detroit Pistons']],
    ['Lakers vs Warriors', ['Golden State Warriors', 'Los Angeles Lakers']],
    ['Boston Celtics Celtics vs Detroit Pistons Pistons', ['Boston Celtics', 'Detroit Pistons']],
  ])('resolves full names or nicknames without duplicate teams: %s', (query, expected) => {
    expect(requestedNBATeams(query)).toEqual(expected);
  });

  it.each(['', 'Best NBA moneylines today', 'Los Angeles vs New York', 'Boston vs Detroit',
    'Seattle SuperSonics vs Las Vegas', 'Celticsville vs Pistonstown', 'LA vs GS'])
    ('does not guess unsupported names or city-only aliases: %s', query => {
      expect(requestedNBATeams(query)).toEqual([]);
    });
});

describe('matchesNBATeams', () => {
  const teams = ['Boston Celtics', 'Detroit Pistons'];

  it('requires both requested teams, regardless of home/away order or case', () => {
    expect(matchesNBATeams(teams, ['detroit pistons', 'BOSTON CELTICS'])).toBe(true);
    expect(matchesNBATeams(teams, ['Boston Celtics', 'Los Angeles Lakers'])).toBe(false);
    expect(matchesNBATeams(teams, ['Detroit Pistons', 'Golden State Warriors'])).toBe(false);
    expect(matchesNBATeams(teams, ['Los Angeles Lakers', 'Golden State Warriors'])).toBe(false);
  });

  it('matches each requested matchup when several games are named', () => {
    const games = ['New York Knicks', 'Boston Celtics', 'Houston Rockets', 'San Antonio Spurs'];
    expect(matchesNBATeams(games, ['Boston Celtics', 'New York Knicks'])).toBe(true);
    expect(matchesNBATeams(games, ['San Antonio Spurs', 'Houston Rockets'])).toBe(true);
    expect(matchesNBATeams(games, ['Boston Celtics', 'Miami Heat'])).toBe(false);
  });

  it('treats an empty request as unrestricted, including an empty slate', () => {
    expect(matchesNBATeams([], ['Los Angeles Lakers', 'Golden State Warriors'])).toBe(true);
    expect(matchesNBATeams([], [])).toBe(true);
  });

  it('does not match missing names, nicknames, ambiguous cities or unsupported teams', () => {
    expect(matchesNBATeams(teams, [])).toBe(false);
    expect(matchesNBATeams(teams, [null, undefined, '', 'Boston Celtics'])).toBe(false);
    expect(matchesNBATeams(teams, ['Celtics', 'Pistons'])).toBe(false);
    expect(matchesNBATeams(['Los Angeles Lakers'], ['Los Angeles'])).toBe(false);
    expect(matchesNBATeams(['Boston Celtics'], ['Boston'])).toBe(false);
    expect(matchesNBATeams(['Seattle SuperSonics'], ['Golden State Warriors'])).toBe(false);
  });
});

describe('real Finder validationGameIds boundary', () => {
  const team = (id: number, displayName: string) => ({ id, displayName, name: displayName, abbreviation: 'FIX', logoUrl: null });
  const schedule: NBAGame[] = [
    { id: 'target', gameTime: '2026-01-21T23:00:00Z', completed: false, homeScore: null, awayScore: null,
      homeTeam: team(1, 'Boston Celtics'), awayTeam: team(2, 'Detroit Pistons') },
    { id: 'other', gameTime: '2026-01-21T23:00:00Z', completed: false, homeScore: null, awayScore: null,
      homeTeam: team(3, 'Los Angeles Lakers'), awayTeam: team(4, 'Golden State Warriors') },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-21T18:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in real Finder scope tests'); }));
    vi.mocked(getNBASchedule).mockResolvedValue(schedule);
    vi.mocked(researchNBAGameLines).mockResolvedValue({ recommendations: [], modeledGames: [] });
  });

  afterEach(() => {
    try { expect(fetch).not.toHaveBeenCalled(); }
    finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it.each([['target'], []] as string[][])('passes only selected games into game research for IDs %j', async (...gameIds) => {
    const summary = await runNBAFinderDeepSearch('2026-01-21', {
      gameLines: true, gameLinesOnly: true, validationGameIds: gameIds,
    });
    const selected = schedule.filter(game => gameIds.includes(game.id));
    expect(getNBASchedule).toHaveBeenCalledExactlyOnceWith('2026-01-21');
    expect(researchNBAGameLines).toHaveBeenCalledExactlyOnceWith(selected, []);
    expect(summary).toMatchObject({ gamesScheduled: 2, gamesEligible: selected.length, gamesAnalyzed: selected.length,
      gameCandidates: [], modeledGames: [], nbaCandidates: [] });
  });
});