import { describe, expect, it } from 'vitest';
import type { NBAProbabilityDistribution } from './types';
import { americanFairOdds, nbaExpectedValuePercent, nbaFairAmericanOdds, noVigMarketProbability, settleNBAProbabilities } from './pricing';

function distribution(): NBAProbabilityDistribution {
  const masses = new Map([[9, 0.2], [10, 0.3], [11, 0.5]]);
  return { kind: 'NEGATIVE_BINOMIAL', mean: 10.3, variance: 0.6, sampleSize: 100,
    cdf: (value) => [...masses].filter(([stat]) => stat <= value).reduce((sum, [, probability]) => sum + probability, 0),
    pmf: (value) => masses.get(value) ?? 0 };
}

describe('NBA discrete outcomes, fair odds and EV', () => {
  it('allocates integer-line push mass explicitly and half-lines have no push', () => {
    expect(settleNBAProbabilities(distribution(), 10)).toEqual({ over: 0.5, under: 0.2, push: 0.3 });
    expect(settleNBAProbabilities(distribution(), 10.5)).toEqual({ over: 0.5, under: 0.5, push: 0 });
  });

  it('uses push-aware net return for EV and fair odds', () => {
    const outcomes = settleNBAProbabilities(distribution(), 10);
    expect(nbaExpectedValuePercent({ outcomes, direction: 'over', americanOdds: 120 })).toBeCloseTo(40);
    expect(nbaFairAmericanOdds({ outcomes, direction: 'over' })).toBe(-250);
    expect(americanFairOdds(0.5)).toBe(-100);
  });

  it('computes raw implied probability separately from same-line two-way no-vig probability', () => {
    expect(noVigMarketProbability(-110, -110)).toBeCloseTo(0.5);
    expect(noVigMarketProbability(-110, null as unknown as number)).toBeNull();
  });
});
