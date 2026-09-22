import { describe, it, expect } from 'vitest';
import { computeNBAOutlierDependency } from './outlierAnalysis';
import { estimateExpectedMinutes } from './projection';
import type { NBAGameLogEntry } from './types';

function gameLog(stats: Record<string, number>, index: number): NBAGameLogEntry {
  return { gameId: `g${index}`, date: '2024-01-01', opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats };
}

describe('NBA outlier dependency', () => {
  it('flags a points projection heavily dependent on one explosive game', () => {
    const logs = [
      ...Array.from({ length: 5 }, (_, i) => gameLog({ points: 10 }, i)),
      gameLog({ points: 50 }, 5),
    ];
    const outlier = computeNBAOutlierDependency(logs, 'points');
    expect(outlier.available).toBe(true);
    expect(outlier.explosiveDependencePercent).toBeGreaterThan(35);
    expect(outlier.withoutTopGame.mean).toBeLessThan(outlier.raw.mean!);
  });

  it('is market/line aware — a 3PM outlier does not appear in the points outlier', () => {
    const threeKey = 'threePointFieldGoalsMade-threePointFieldGoalsAttempted';
    const logs = [
      ...Array.from({ length: 9 }, (_, i) => gameLog({ points: 20, [threeKey]: 2 }, i)),
      gameLog({ points: 20, [threeKey]: 9 }, 9),
    ];
    const points = computeNBAOutlierDependency(logs, 'points');
    const threes = computeNBAOutlierDependency(logs, '3pm');
    expect(points.explosiveDependencePercent).toBeLessThan(20);
    expect(threes.explosiveDependencePercent).toBeGreaterThan(30);
  });

  it('is unavailable with fewer than 3 games', () => {
    const logs = [gameLog({ points: 20 }, 0), gameLog({ points: 22 }, 1)];
    expect(computeNBAOutlierDependency(logs, 'points').available).toBe(false);
  });
});

describe('NBA minutes stability trend', () => {
  it('detects STABLE_ROLE for a consistent minutes pattern', () => {
    const logs = Array.from({ length: 12 }, (_, i) => gameLog({ minutes: 32 }, i));
    expect(estimateExpectedMinutes(logs, 'ACTIVE').minutesTrend).toBe('STABLE_ROLE');
  });

  it('detects ROLE_INCREASE from a real rising-minutes pattern', () => {
    const logs = [
      ...Array.from({ length: 8 }, (_, i) => gameLog({ minutes: 15 }, i)),
      ...Array.from({ length: 5 }, (_, i) => gameLog({ minutes: 32 }, i + 8)),
    ];
    expect(estimateExpectedMinutes(logs, 'ACTIVE').minutesTrend).toBe('ROLE_INCREASE');
  });

  it('detects ROLE_DECREASE from a real falling-minutes pattern', () => {
    const logs = [
      ...Array.from({ length: 8 }, (_, i) => gameLog({ minutes: 28 }, i)),
      ...Array.from({ length: 5 }, (_, i) => gameLog({ minutes: 18 }, i + 8)),
    ];
    expect(estimateExpectedMinutes(logs, 'ACTIVE').minutesTrend).toBe('ROLE_DECREASE');
  });

  it('detects HIGH_MINUTES_VOLATILITY from erratic minutes', () => {
    const values = [5, 35, 6, 34, 5, 33, 6, 32, 5, 34];
    const logs = values.map((v, i) => gameLog({ minutes: v }, i));
    expect(estimateExpectedMinutes(logs, 'ACTIVE').minutesTrend).toBe('HIGH_MINUTES_VOLATILITY');
  });

  it('reports INSUFFICIENT_MINUTES_DATA with too few games', () => {
    const logs = [gameLog({ minutes: 20 }, 0)];
    expect(estimateExpectedMinutes(logs, 'ACTIVE').minutesTrend).toBe('INSUFFICIENT_MINUTES_DATA');
  });
});
