import { describe, expect, it } from 'vitest';
import { buildNFLHistory } from './history';
import { buildNFLRollingHistory } from './rollingHistory';
import { buildNFLEliteCandidate } from './research';
import { projectNFLMarket } from './projection';
import type { NFLGameLogEntry } from './types';
import { computeNFLOpportunityTrend } from './roleContext';

function logs(values: Array<number | null>, season = 2026): NFLGameLogEntry[] {
  return values.map((value, index): NFLGameLogEntry => ({
    gameId: `${season}-${index}`, season, teamId: 12, position: 'QB', week: index + 1,
    date: `${season}-09-${String(index + 1).padStart(2, '0')}`, opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: index % 2 ? 'away' : 'home', result: 'W',
    stats: value == null ? {} : { passingAttempts: value, passingYards: value * 8 },
  }));
}

describe('truthful exact-line NFL windows', () => {
  it('calculates half-point hits and misses against the exact sportsbook line', () => {
    const history = buildNFLHistory(logs([34, 35, 36]), 'player_pass_attempts', 35.5, 'over');
    expect(history.windows.rolling).toMatchObject({ hits: 1, misses: 2, pushes: 0, decisions: 3, hitRate: 33.3 });
  });

  it.each(['over', 'under'] as const)('excludes integer-line pushes from %s win percentage', (side) => {
    const history = buildNFLHistory(logs([34, 35, 35, 36]), 'player_pass_attempts', 35, side);
    expect(history.windows.rolling).toMatchObject({ games: 4, hits: 1, misses: 1, pushes: 2, decisions: 2, hitRate: 50 });
    expect(history.observations.filter((entry) => entry.outcome === 'PUSH')).toHaveLength(2);
  });

  it('returns no win percentage for an all-push sample', () => {
    expect(buildNFLHistory(logs([35, 35, 35]), 'player_pass_attempts', 35, 'over').windows.rolling.hitRate).toBeNull();
    const input = buildNFLEliteCandidate({ candidateId: 'push', playerId: 1, player: 'QB', market: 'player_pass_attempts', line: 35, direction: 'over',
      logs: logs(Array(10).fill(35)), projection: 40, projectionUncertainty: 5, matchupAvailable: true, oddsAmerican: -110,
      lastUpdatedAt: new Date().toISOString(), isAlternate: false, marketSupport: 'full' });
    expect(input.historicalRates.every((rate) => rate == null)).toBe(true);
    expect(input.sampleSize).toBe(0);
  });

  it('does not let pushes inflate the usable qualification sample', () => {
    const input = buildNFLEliteCandidate({ candidateId: 'push', playerId: 1, player: 'QB', market: 'player_pass_attempts', line: 35, direction: 'over',
      logs: logs([36, 34, ...Array(8).fill(35)]), projection: 40, projectionUncertainty: 5, matchupAvailable: true, oddsAmerican: -110,
      lastUpdatedAt: new Date().toISOString(), isAlternate: false, marketSupport: 'full' });
    expect(input.sampleSize).toBe(2);
    expect(input.historicalRates[0]).toBe(50);
  });

  it('slices actual recent games before excluding missing stats', () => {
    const history = buildNFLHistory(logs([45, 45, 20, 20, null, 20, 20]), 'player_pass_attempts', 35, 'over');
    expect(history.windows.l5).toMatchObject({ gamesConsidered: 5, games: 4, missing: 1, hits: 0, misses: 4, hitRate: 0 });
    expect(history.recentValues).toEqual([45, 45, 20, 20, 20, 20]);
    expect(history.observations[4].outcome).toBe('MISSING');
  });

  it('exposes fewer than five observations without padding', () => {
    expect(buildNFLHistory(logs([34, 36]), 'player_pass_attempts', 35, 'over').windows.l5).toMatchObject({ games: 2, gamesConsidered: 2 });
  });

  it('keeps current, previous, and rolling season windows distinct', () => {
    const sample = buildNFLRollingHistory({ current: logs([34, 35, 36, 37]), previous: logs(Array(17).fill(35), 2025), season: 2026, teamId: 12, position: 'QB', market: 'player_pass_attempts' });
    const history = buildNFLHistory(sample.logs, 'player_pass_attempts', 35, 'over', sample);
    expect(history.windows.currentSeason.games).toBe(4);
    expect(history.windows.season).toEqual(history.windows.currentSeason);
    expect(history.windows.previousSeason.games).toBe(17);
    expect(history.windows.rolling.games).toBe(10);
    expect(history.sample).toMatchObject({ currentSeasonGames: 4, previousSeasonGames: 6, supplemented: true });
    expect(history.observations.filter((entry) => entry.source === 'PREVIOUS_SEASON').every((entry) => entry.season === 2025)).toBe(true);
    const workload = computeNFLOpportunityTrend(sample.logs, 'player_pass_attempts');
    expect(workload.season.games).toBe(4);
    expect(workload.rolling?.games).toBe(10);
  });

  it('uses rolling evidence for qualification without lowering the minimum or calling it current season', () => {
    const sample = buildNFLRollingHistory({ current: logs([33, 35, 37, 36]), previous: logs(Array(17).fill(35), 2025), season: 2026, teamId: 12, position: 'QB', market: 'player_pass_attempts' });
    const projection = projectNFLMarket({ logs: sample.logs, market: 'player_pass_attempts', historySample: sample });
    const input = buildNFLEliteCandidate({ candidateId: 'qb', playerId: 1, player: 'QB', market: 'player_pass_attempts', line: 29.5, direction: 'over', logs: sample.logs, historySample: sample,
      projection: projection.projection, projectionUncertainty: projection.uncertainty, matchupAvailable: true, oddsAmerican: -110, lastUpdatedAt: new Date().toISOString(), isAlternate: false, marketSupport: 'full' });
    expect(input.sampleSize).toBe(10);
    expect(projection.method).toBe('nfl_rolling_history');
    expect(projection.inputs.currentSeasonGames).toBe(4);
    expect(projection.inputs.previousSeasonGames).toBe(6);
    expect(projection.uncertainty).toBeGreaterThan(projectNFLMarket({ logs: sample.logs, market: 'player_pass_attempts' }).uncertainty!);
    expect(input.historicalRates).toEqual([100, 100, 100]);
  });
});