import { describe, expect, it } from 'vitest';
import { nbaHistoricalResearch, nbaResearchStatValue } from './researchHistory';
import type { NBAGameLogEntry } from './types';

describe('research-only NBA historical values', () => {
  it.each([
    ['3pm', 3], ['player_threes', 3], ['pra', 36], ['player_points_rebounds', 29],
    ['player_points_assists', 27], ['ra', 16], ['steals', 2], ['blocks', 1], ['turnovers', 4],
  ])('evaluates existing core/combo identities exactly: %s', (market, expected) => {
    expect(nbaResearchStatValue(market, { points: 20, totalRebounds: 9, assists: 7,
      'threePointFieldGoalsMade-threePointFieldGoalsAttempted': 3, steals: 2, blocks: 1, turnovers: 4 })).toBe(expected);
  });
  it('keeps opponent evidence in the same phase/season as the overall sample', () => {
    const base: NBAGameLogEntry = { gameId: 'recent', date: '2026-01-20T18:00:00Z', season: 2026,
      phase: 'REGULAR', opponent: 'Boston Celtics', opponentAbbreviation: 'BOS', homeAway: 'home', result: 'W', stats: { blocks: 2 } };
    const logs = [base, { ...base, gameId: 'other', date: '2026-01-19T18:00:00Z', opponent: 'Detroit Pistons', stats: { blocks: 0 } },
      { ...base, gameId: 'playoff', date: '2025-12-20T18:00:00Z', phase: 'POSTSEASON' as const, stats: { blocks: 99 } }];
    expect(nbaHistoricalResearch('blocks', logs, 1.5, 'over', '2026-01-22T18:00:00Z')).toContain('2 completed REGULAR games');
    expect(nbaHistoricalResearch('blocks', logs, 1.5, 'over', '2026-01-22T18:00:00Z', 'Boston Celtics')).toContain('1 completed REGULAR games');
    expect(nbaHistoricalResearch('blocks', logs, 1.5, 'over', '2026-01-22T18:00:00Z', 'Boston Celtics')).toContain('mean 2.00');
    expect(nbaHistoricalResearch('blocks', logs, 1.5, 'over', '2026-01-22T18:00:00Z', 'Miami Heat')).toContain('unavailable against Miami Heat');
  });
  it('uses exact attempts, shot differences and required combined components', () => {
    expect(nbaResearchStatValue('player_frees_attempts', { freeThrowsMade: 4 })).toBeNull();
    expect(nbaResearchStatValue('player_frees_attempts', { freeThrowsAttempted: 7 })).toBe(7);
    expect(nbaResearchStatValue('two_pointers_made', { fieldGoalsMade: 8, threePointFieldGoalsMade: 3 })).toBe(5);
    expect(nbaResearchStatValue('player_blocks_steals', { blocks: 2 })).toBeNull();
    expect(nbaResearchStatValue('player_blocks_steals', { blocks: 2, steals: 1 })).toBe(3);
  });
  it('evaluates Yes/No double and triple doubles without treating missing categories as zero', () => {
    const stats = { points: 20, totalRebounds: 10, assists: 11, blocks: 0, steals: 0 };
    expect(nbaResearchStatValue('player_double_double', stats)).toBe(1);
    expect(nbaResearchStatValue('player_triple_double', stats)).toBe(1);
    expect(nbaResearchStatValue('player_triple_double', { points: 20, totalRebounds: 10, assists: 11 })).toBeNull();
  });
  it('never invents a fantasy formula, quarter split or dunk count', () => {
    for (const key of ['player_fantasy_points', 'points_q2', 'points_q3', 'points_q4', 'dunks']) {
      expect(nbaResearchStatValue(key, { points: 40 })).toBeNull();
    }
  });
  it('excludes future, incomplete, unknown-phase and other-phase games from descriptive evidence', () => {
    const log: NBAGameLogEntry = { gameId: 'prior', date: '2026-01-01T18:00:00Z', season: 2026, phase: 'REGULAR', result: 'W',
      opponent: 'Fixture', opponentAbbreviation: 'FIX', homeAway: 'home', stats: { blocks: 1, steals: 2 } };
    const evidence = nbaHistoricalResearch('player_blocks_steals', [log, { ...log, phase: 'POSTSEASON', date: '2025-12-31' },
      { ...log, date: '2026-01-03' }, { ...log, result: null }, { ...log, phase: 'UNKNOWN' }], 2.5, 'over', '2026-01-02T18:00:00Z');
    expect(evidence).toContain('1 completed REGULAR games');
    expect(evidence).toContain('1 wins, 0 losses');
    expect(evidence).toContain('not a predicted probability');
  });
});