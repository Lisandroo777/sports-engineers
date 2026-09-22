import { describe, expect, it } from 'vitest';
import { mergeNFLGameLogs, nflSeasonYear } from './stats';
import type { NFLGameLogEntry } from './types';

function game(gameId: string, date: string, result: string | null = 'W'): NFLGameLogEntry {
  return { gameId, week: 1, date, opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home', result, stats: { rushingAttempts: 10 } };
}

describe('NFL rolling role workload logs', () => {
  it('merges cached season fixtures, deduplicates games, and caps the workload window at 17', () => {
    const prior = Array.from({ length: 17 }, (_, index) => game(`prior-${index}`, `2025-${String(index + 1).padStart(2, '0')}-01`));
    const current = [game('current-1', '2026-09-10'), game('prior-16', '2025-12-28')];
    const merged = mergeNFLGameLogs(prior, current);
    expect(merged).toHaveLength(17);
    expect(merged.at(-1)?.gameId).toBe('current-1');
    expect(new Set(merged.map((entry) => entry.gameId)).size).toBe(17);
  });

  it('excludes unfinished entries from role evidence', () => {
    expect(mergeNFLGameLogs([game('scheduled', '2026-09-20', null)])).toEqual([]);
  });

  it('uses the prior year during January and February', () => {
    expect(nflSeasonYear(new Date('2027-01-15T12:00:00Z'))).toBe(2026);
    expect(nflSeasonYear(new Date('2026-09-20T12:00:00Z'))).toBe(2026);
  });
});