import { describe, expect, it } from 'vitest';
import { calculateHitRate } from './stats';
import type { MLBGameLog, MLBRange, PropSide } from './types';

function game(date: string, hits: number | null, gamePk?: number): MLBGameLog {
  return { date, hits, gamePk, opponent: 'Padres', homeAway: 'home' };
}

function hitRate(games: MLBGameLog[], sampleSize: MLBRange, line = 0.5, side: PropSide = 'Over') {
  return calculateHitRate({ games, sampleSize, market: 'hits', line, side });
}

const windows = [['L5', 5], ['L10', 10], ['L20', 20], ['L40', 40]] as const;

describe('MLB recent hit-rate windows (offline)', () => {
  it.each(windows)('%s selects the newest games regardless of input order without mutation', (sampleSize, size) => {
    const ascending = Array.from({ length: 60 }, (_, index) => game(
      new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      index >= 60 - size ? 2 : 0,
      60 - index,
    ));
    const shuffled = [...ascending.filter((_, index) => index % 2 === 0),
      ...ascending.filter((_, index) => index % 2 !== 0).reverse()];

    for (const games of [ascending, [...ascending].reverse(), shuffled]) {
      const before = games.map((entry) => ({ ...entry }));
      games.forEach(Object.freeze);
      Object.freeze(games);
      expect(hitRate(games, sampleSize)).toEqual({ hits: size, games: size, percentage: 100 });
      expect(games).toEqual(before);
    }
  });

  it.each(windows)('%s breaks same-date ties by descending numeric gamePk', (sampleSize, size) => {
    const newer = Array.from({ length: size - 1 }, (_, index) => game('2026-09-02', 2, index + 20));
    const boundary = [game('2026-09-01', 0, 9), game('2026-09-01', 2, 10)];
    for (const games of [[...boundary, ...newer], [...newer, ...boundary].reverse()]) {
      expect(hitRate(games, sampleSize)).toEqual({ hits: size, games: size, percentage: 100 });
    }
  });

  it.each(['Over', 'Under'] as const)('excludes nulls and integer pushes for %s without backfilling the window', (side) => {
    const games = [
      game('2026-09-01', 2),
      game('2026-09-02', 2),
      game('2026-09-03', null),
      game('2026-09-04', 1),
      game('2026-09-05', 0),
      game('2026-09-06', 2),
    ];
    expect(hitRate(games, 'L5', 1, side)).toEqual({
      hits: side === 'Over' ? 2 : 1,
      games: 3,
      percentage: side === 'Over' ? 66.7 : 33.3,
    });
    expect(hitRate([game('2026-09-01', null), game('2026-09-02', 1)], 'L5', 1, side))
      .toEqual({ hits: 0, games: 0, percentage: 0 });
  });

  it('keeps logs without game IDs eligible', () => {
    const games = Array.from({ length: 6 }, (_, index) => game(`2026-09-0${index + 1}`, index === 0 ? 0 : 2));
    expect(hitRate(games, 'L5')).toEqual({ hits: 5, games: 5, percentage: 100 });
  });

  it.each(windows)('%s handles empty and shorter histories', (sampleSize) => {
    expect(hitRate([], sampleSize)).toEqual({ hits: 0, games: 0, percentage: 0 });
    expect(hitRate([game('2026-09-01', 0), game('2026-09-02', 2)], sampleSize))
      .toEqual({ hits: 1, games: 2, percentage: 50 });
  });

  it.each(['2025', '2026'] as const)('%s retains all and only that season with unchanged null/push rules', (sampleSize) => {
    const games = ['2024', '2025', '2026', '2027'].flatMap((year) => [
      game(`${year}-09-01`, 0),
      game(`${year}-09-02`, 2),
      game(`${year}-09-03`, null),
      game(`${year}-09-04`, 1),
      ...Array.from({ length: 45 }, (_, index) => game(`${year}-08-01`, 2, index + 1)),
    ]);
    const before = games.map((entry) => ({ ...entry }));
    expect(hitRate(games, sampleSize, 1)).toEqual({ hits: 46, games: 47, percentage: 97.9 });
    expect(hitRate([...games].reverse(), sampleSize, 1, 'Under'))
      .toEqual({ hits: 1, games: 47, percentage: 2.1 });
    expect(games).toEqual(before);
  });
});