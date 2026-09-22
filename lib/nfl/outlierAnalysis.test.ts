import { describe, it, expect } from 'vitest';
import { computeNFLOutlierDependency } from './outlierAnalysis';
import type { NFLGameLogEntry } from './types';

function log(stats: Record<string, number>, index: number): NFLGameLogEntry {
  return { gameId: `g${index}`, week: index, date: '2024-01-01', opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats };
}

describe('NFL outlier dependence (Phase 4 task 4)', () => {
  it('flags a rushing-yards projection heavily dependent on one explosive game', () => {
    const logs = [
      ...Array.from({ length: 5 }, (_, i) => log({ rushingYards: 40 }, i)),
      log({ rushingYards: 180 }, 5),
    ];
    const outlier = computeNFLOutlierDependency(logs, 'player_rush_yds');
    expect(outlier.applicability).toBe('APPLICABLE');
    expect(outlier.available).toBe(true);
    expect(outlier.explosiveDependencePercent).toBeGreaterThan(35);
  });

  it('is APPLICABLE for volume markets: passing/rushing/receiving yards, receptions, attempts', () => {
    for (const market of ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_rush_rec_yds', 'player_receptions', 'player_pass_attempts'] as const) {
      const logs = Array.from({ length: 5 }, (_, i) => log({ passingYards: 250, rushingYards: 50, receivingYards: 60, receptions: 5, passingAttempts: 30 }, i));
      expect(computeNFLOutlierDependency(logs, market).applicability).toBe('APPLICABLE');
    }
  });

  it('reports OUTLIER_ANALYSIS_NOT_APPLICABLE for rare-event markets (TDs, INTs, sacks)', () => {
    const logs = Array.from({ length: 10 }, (_, i) => log({ passingTouchdowns: 2 }, i));
    for (const market of ['player_pass_tds', 'player_rush_tds', 'player_reception_tds', 'player_pass_interceptions', 'player_sacks', 'player_anytime_td'] as const) {
      const result = computeNFLOutlierDependency(logs, market);
      expect(result.applicability).toBe('OUTLIER_ANALYSIS_NOT_APPLICABLE');
      expect(result.available).toBe(false);
    }
  });
});
