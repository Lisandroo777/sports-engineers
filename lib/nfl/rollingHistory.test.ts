import { describe, expect, it } from 'vitest';
import { buildNFLRollingHistory } from './rollingHistory';
import { ELITE_THRESHOLDS } from '../ai/eliteResearchFilter';
import type { NFLGameLogEntry } from './types';

function games(count: number, season: number, overrides: Partial<NFLGameLogEntry> = {}): NFLGameLogEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    gameId: `${season}-${index}`, season, teamId: 12, position: 'QB', started: true, week: index + 1,
    date: `${season}-09-${String(index + 1).padStart(2, '0')}`, opponent: 'Opponent', opponentAbbreviation: 'OPP',
    homeAway: 'home', result: 'W', stats: { passingAttempts: 35, passingYards: 280 + index }, ...overrides,
  }));
}

function sample(current: NFLGameLogEntry[], previous = games(17, 2025)) {
  return buildNFLRollingHistory({ current, previous, season: 2026, teamId: 12, position: 'QB', market: 'player_pass_yds' });
}

describe('defensible early-season NFL history', () => {
  it.each([[1, 9], [4, 6], [8, 2]])('supplements Week %s with %s comparable prior games', (currentCount, previousCount) => {
    const history = sample(games(currentCount, 2026));
    expect(history.currentObservations).toBe(currentCount);
    expect(history.previousObservations).toBe(previousCount);
    expect(history.observations).toBe(10);
    expect(history.currentSeason).toHaveLength(currentCount);
    expect(history.previousSeason).toHaveLength(17);
    expect(history.logs.filter((log) => log.historySource === 'PREVIOUS_SEASON')).toHaveLength(previousCount);
    expect(history.logs.filter((log) => log.season === 2026)).toHaveLength(currentCount);
    expect(history.logs[0].gameId).toBe(`2025-${17 - previousCount}`);
    expect(history.uncertaintyMultiplier).toBeGreaterThan(1);
    expect(history.logs[0].historyWeight).toBe(0.6);
    expect(ELITE_THRESHOLDS.minSampleSize).toBe(10);
  });

  it('does not supplement 10+ current-season observations', () => {
    const history = sample(games(12, 2026));
    expect(history.logs).toHaveLength(12);
    expect(history.previousObservations).toBe(0);
    expect(history.confidence).toBe('CURRENT_ONLY');
    expect(history.uncertaintyMultiplier).toBe(1);
  });

  it('rejects old-team and unknown-team games', () => {
    expect(sample(games(4, 2026), games(17, 2025, { teamId: 13 })).observations).toBe(4);
    expect(sample(games(4, 2026), games(17, 2025, { teamId: null })).observations).toBe(4);
  });

  it('rejects a major starter/usage change instead of borrowing backup games', () => {
    const previous = games(17, 2025, { stats: { passingAttempts: 8, passingYards: 55 }, started: false });
    const history = sample(games(4, 2026), previous);
    expect(history.previousObservations).toBe(0);
    expect(history.confidence).toBe('INSUFFICIENT');
    expect(history.reasons.join(' ')).toContain('workload');
  });

  it('rejects an explicit starter change even if recorded workload looks similar', () => {
    expect(sample(games(4, 2026), games(17, 2025, { started: false })).previousObservations).toBe(0);
  });

  it('rejects a position change and unverified historical position', () => {
    expect(sample(games(4, 2026), games(17, 2025, { position: 'WR' })).previousObservations).toBe(0);
    expect(sample(games(4, 2026), games(17, 2025, { position: null })).previousObservations).toBe(0);
  });

  it('does not manufacture a comparable current role before any current games', () => {
    expect(sample([]).observations).toBe(0);
    expect(sample([]).confidence).toBe('INSUFFICIENT');
  });

  it('discloses and discounts recorded workload proxies when historical position is unavailable', () => {
    const history = sample(games(4, 2026), games(17, 2025, { position: null, roleEvidence: ['PASSING'] }));
    expect(history.observations).toBe(10);
    expect(history.reasons.join(' ')).toContain('registered position is unavailable');
    expect(history.uncertaintyMultiplier).toBeGreaterThan(sample(games(4, 2026)).uncertaintyMultiplier);
  });

  it('does not count missing stats as sample observations', () => {
    const current = games(4, 2026);
    current[3].stats = { passingAttempts: 35 };
    const history = sample(current);
    expect(history.currentSeason).toHaveLength(4);
    expect(history.currentObservations).toBe(3);
    expect(history.previousObservations).toBe(7);
    expect(history.observations).toBe(10);
    expect(history.logs).toHaveLength(11);
  });

  it('deduplicates games and excludes explicitly wrong seasons', () => {
    const current = games(4, 2026);
    const history = sample([...current, current[0], { ...current[0], gameId: 'bad', season: 2024 }]);
    expect(history.currentSeason).toHaveLength(4);
    expect(new Set(history.logs.map((log) => log.gameId)).size).toBe(history.logs.length);
  });

  it('provider response order does not change the selected historical observations', () => {
    const current = games(4, 2026);
    const previous = games(17, 2025);
    expect(sample([...current].reverse(), [...previous].reverse())).toEqual(sample(current, previous));
  });
});