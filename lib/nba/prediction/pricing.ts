import type { NBAProbabilityDistribution } from './types';

export interface NBAOutcomeProbabilities { over: number; under: number; push: number }

export function settleNBAProbabilities(distribution: NBAProbabilityDistribution, line: number): NBAOutcomeProbabilities {
  if (!Number.isFinite(line)) throw new Error('NBA prop line must be finite.');
  const isIntegerLine = Number.isInteger(line) && line >= 0;
  const push = isIntegerLine ? distribution.pmf(line) : 0;
  const under = isIntegerLine ? distribution.cdf(line - 1) : distribution.cdf(Math.floor(line));
  const over = Math.max(0, 1 - under - push);
  const total = over + under + push;
  return total > 0 ? { over: over / total, under: under / total, push: push / total } : { over: 0, under: 0, push: 0 };
}

export function americanImpliedProbability(americanOdds: number): number | null {
  if (!Number.isInteger(americanOdds) || americanOdds === 0) return null;
  return americanOdds > 0 ? 100 / (americanOdds + 100) : -americanOdds / (-americanOdds + 100);
}

export function americanFairOdds(probability: number): number | null {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return null;
  return Math.round(probability >= 0.5 ? -100 * probability / (1 - probability) : 100 * (1 - probability) / probability);
}

export function noVigMarketProbability(sideOdds: number, oppositeOdds: number): number | null {
  const side = americanImpliedProbability(sideOdds);
  const opposite = americanImpliedProbability(oppositeOdds);
  return side == null || opposite == null ? null : side / (side + opposite);
}

export function nbaExpectedValuePercent(input: { outcomes: NBAOutcomeProbabilities; direction: 'over' | 'under'; americanOdds: number }): number | null {
  if (!Number.isInteger(input.americanOdds) || input.americanOdds === 0) return null;
  const win = input.direction === 'over' ? input.outcomes.over : input.outcomes.under;
  const loss = input.direction === 'over' ? input.outcomes.under : input.outcomes.over;
  const netPayout = input.americanOdds > 0 ? input.americanOdds / 100 : 100 / -input.americanOdds;
  return (win * netPayout - loss) * 100;
}

export function nbaFairAmericanOdds(input: { outcomes: NBAOutcomeProbabilities; direction: 'over' | 'under' }): number | null {
  const win = input.direction === 'over' ? input.outcomes.over : input.outcomes.under;
  const loss = input.direction === 'over' ? input.outcomes.under : input.outcomes.over;
  return win + loss > 0 ? americanFairOdds(win / (win + loss)) : null;
}
