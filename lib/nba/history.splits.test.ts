import { describe, expect, it } from 'vitest';
import { buildNBAHistory } from './history';
import type { NBAGameLogEntry } from './types';

const logs: NBAGameLogEntry[] = [10, 20, 30, 40].map((points, index) => ({ gameId: String(index), date: `2026-01-0${index + 1}`,
  opponent: 'Fixture', opponentAbbreviation: 'FIX', homeAway: index % 2 === 0 ? 'home' : 'away', result: 'W', stats: { points } }));

describe('descriptive NBA historical splits', () => {
  it('preserves aggregate windows and exposes exact home/away means medians and sample counts', () => {
    const history = buildNBAHistory(logs, 'points', 15.5, 'over');
    expect(history.windows.season).toEqual({ hits: 3, total: 4, rate: 75, mean: 25, median: 25 });
    expect(history.splits).toEqual({ home: { hits: 1, total: 2, rate: 50, mean: 20, median: 20 },
      away: { hits: 2, total: 2, rate: 100, mean: 30, median: 30 } });
  });
  it('does not invent samples for missing venue or post-cutoff history', () => {
    const history = buildNBAHistory(logs.filter(log => log.homeAway === 'home'), 'points', 15.5, 'over', '2026-01-03');
    expect(history.windows.season.total).toBe(1);
    expect(history.splits?.away).toEqual({ hits: 0, total: 0, rate: null, mean: null, median: null });
  });
});