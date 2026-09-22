import { describe, it, expect } from 'vitest';
import { buildNBAOpponentContextCache, getNBAOpponentContext } from './opponentContext';
import type { NBATeamStat } from './teamStats';

function stat(name: string, value: number, category: string | null = 'defensive'): NBATeamStat {
  return { name, displayName: name, value, rank: null, category };
}

describe('NBA opponent context cache (Phase 4 task 2/3)', () => {
  it('fetches each unique team exactly once, even across many candidates', async () => {
    let calls = 0;
    const fetchStats = async (teamId: number) => {
      calls += 1;
      return [stat('avgPoints', 110)];
    };
    await buildNBAOpponentContextCache([1, 2, 1, 2, 1], fetchStats);
    expect(calls).toBe(2); // only 2 unique team ids, never once per candidate
  });

  it('reports AVAILABLE when at least one known metric name is present', async () => {
    const cache = await buildNBAOpponentContextCache([5], async () => [stat('avgPoints', 105), stat('avgRebounds', 44)]);
    const ctx = getNBAOpponentContext(cache, 5);
    expect(ctx?.status).not.toBe('UNAVAILABLE');
    expect(ctx?.availableMetrics.length).toBeGreaterThan(0);
  });

  it('reports UNAVAILABLE (never fabricated) when no known metric names are present', async () => {
    const cache = await buildNBAOpponentContextCache([6], async () => [stat('somethingUnknownEspnField', 42)]);
    const ctx = getNBAOpponentContext(cache, 6);
    expect(ctx?.status).toBe('UNAVAILABLE');
    expect(ctx?.availableMetrics).toEqual([]);
  });

  it('returns null (not a guess) for a team id never included in the cache build', async () => {
    const cache = await buildNBAOpponentContextCache([1], async () => [stat('avgPoints', 100)]);
    expect(getNBAOpponentContext(cache, 999)).toBeNull();
    expect(getNBAOpponentContext(cache, null)).toBeNull();
  });

  it('reports UNAVAILABLE (not a crash) when the fetch itself fails', async () => {
    const cache = await buildNBAOpponentContextCache([7], async () => { throw new Error('network down'); });
    expect(getNBAOpponentContext(cache, 7)?.status).toBe('UNAVAILABLE');
  });
});
