import { describe, expect, it } from 'vitest';
import type { NBAObservedGame } from './types';
import { nbaHistoricalWindowRates, selectNBAAsOfHistory } from './history';

function observation(gameId: string, date: string, value: number, phase: NBAObservedGame['phase'] = 'REGULAR', season = 2025): NBAObservedGame {
  return { log: { gameId, date, opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats: { points: value, minutes: 30 } }, season, phase, source: 'mock-ESPN' };
}

describe('NBA V1 as-of and season-phase history', () => {
  it('excludes the target, future games, uncompleted games, wrong season, preseason and unrelated phase', () => {
    const observations = [
      observation('old', '2025-01-01T00:00:00Z', 10),
      observation('same-day-before', '2025-01-02T17:00:00Z', 20),
      observation('target', '2025-01-02T19:00:00Z', 99),
      observation('future', '2025-01-03T00:00:00Z', 80),
      observation('no-result', '2025-01-01T10:00:00Z', 5),
      observation('preseason', '2024-10-01T00:00:00Z', 60, 'PRESEASON'),
      observation('playoff', '2025-04-01T00:00:00Z', 70, 'POSTSEASON'),
      observation('wrong-season', '2024-12-01T00:00:00Z', 90, 'REGULAR', 2024),
    ].map((row) => row.log.gameId === 'no-result' ? { ...row, log: { ...row.log, result: null } } : row);
    expect(selectNBAAsOfHistory({ observations, targetTipoff: '2025-01-02T18:00:00Z', targetGameId: 'target', targetSeason: 2025, targetPhase: 'REGULAR' }).map((row) => row.log.gameId))
      .toEqual(['old', 'same-day-before']);
  });

  it('calculates true rolling L5/L10/L20/season rates, with null for unavailable windows', () => {
    const rates = nbaHistoricalWindowRates([0, 0, 1, 1, 1, 1], 1, 'under');
    expect(rates).toEqual({ l5: 1 / 5, l10: 1 / 3, l20: 1 / 3, season: 1 / 3 });
    expect(nbaHistoricalWindowRates([], 1, 'over')).toEqual({ l5: null, l10: null, l20: null, season: null });
  });

  it('does not mix postseason observations into regular-season windows', () => {
    const observations = [observation('r1', '2025-01-01T00:00:00Z', 10), observation('p1', '2025-04-01T00:00:00Z', 99, 'POSTSEASON')];
    expect(selectNBAAsOfHistory({ observations, targetTipoff: '2025-04-02T00:00:00Z', targetGameId: 'target', targetSeason: 2025, targetPhase: 'REGULAR' }).map((row) => row.log.gameId)).toEqual(['r1']);
    expect(selectNBAAsOfHistory({ observations, targetTipoff: '2025-04-02T00:00:00Z', targetGameId: 'target', targetSeason: 2025, targetPhase: 'POSTSEASON' }).map((row) => row.log.gameId)).toEqual(['p1']);
  });
});
