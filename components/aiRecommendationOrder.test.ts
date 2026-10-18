import { describe, expect, it } from 'vitest';
import { withResponseDisplayRanks } from './aiRecommendationOrder';

describe('MLB recommendation display order', () => {
  it('preserves the response order instead of the original research-score ranks', () => {
    const candidates = [
      { candidateId: 'best', rank: 60, pickTier: 'ELITE', odds: 130 },
      { candidateId: 'second', rank: 1, pickTier: 'ELITE', odds: -700 },
    ];
    const ranked = withResponseDisplayRanks(candidates);
    expect([...ranked].sort((first, second) => first.rank - second.rank).map(candidate => candidate.candidateId))
      .toEqual(['best', 'second']);
    expect(ranked.map(candidate => candidate.rank)).toEqual([1, 2]);
    expect(ranked.map(({ candidateId, pickTier, odds }) => ({ candidateId, pickTier, odds })))
      .toEqual(candidates.map(({ candidateId, pickTier, odds }) => ({ candidateId, pickTier, odds })));
    expect(candidates.map(candidate => candidate.rank)).toEqual([60, 1]);
  });

  it('keeps Best, Most Likely and Best Value response orders authoritative', () => {
    for (const identifiers of [['best', 'safe', 'value'], ['safe', 'best', 'value'], ['value', 'best', 'safe']]) {
      expect(withResponseDisplayRanks(identifiers.map(candidateId => ({ candidateId, rank: 20 })))
        .map(candidate => candidate.candidateId)).toEqual(identifiers);
    }
    expect(withResponseDisplayRanks([])).toEqual([]);
  });
});