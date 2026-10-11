import { getNBAHistoricalValue, type NBAAnalyzableMarket } from '../market';
import type { NBAObservedGame, NBAProbabilityDistribution } from './types';
import { sampleMean, sampleVariance } from './history';

const COMPONENTS: Partial<Record<NBAAnalyzableMarket, NBAAnalyzableMarket[]>> = {
  pra: ['points', 'rebounds', 'assists'], pr: ['points', 'rebounds'], pa: ['points', 'assists'], ra: ['rebounds', 'assists'],
};
const NORMAL: NBAAnalyzableMarket[] = ['points', 'pra', 'pr', 'pa', 'ra', 'minutes'];
const RARE: NBAAnalyzableMarket[] = ['steals', 'blocks'];

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = 0.3989422804014327 * Math.exp(-z * z / 2);
  const tail = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - tail : tail;
}

function normalDistribution(mean: number, variance: number, sampleSize: number, kind: 'NORMAL' | 'EMPIRICAL_COMBO' = 'NORMAL'): NBAProbabilityDistribution {
  const sd = Math.sqrt(Math.max(variance, 1e-9));
  const cdf = (value: number) => normalCdf((Math.floor(value) + 0.5 - mean) / sd);
  return { kind, mean, variance, sampleSize, cdf, pmf: (value) => Number.isInteger(value) ? Math.max(0, cdf(value) - cdf(value - 1)) : 0 };
}

function countDistribution(mean: number, variance: number, sampleSize: number, poisson: boolean): NBAProbabilityDistribution {
  const safeMean = Math.max(mean, 1e-8);
  const safeVariance = poisson ? safeMean : Math.max(variance, safeMean + 1e-8);
  const size = safeVariance > safeMean ? safeMean ** 2 / (safeVariance - safeMean) : Infinity;
  const p = size / (size + safeMean);
  const pmf = (value: number) => {
    if (!Number.isInteger(value) || value < 0) return 0;
    if (poisson || !Number.isFinite(size)) {
      let probability = Math.exp(-safeMean);
      for (let index = 1; index <= value; index += 1) probability *= safeMean / index;
      return probability;
    }
    let probability = Math.exp(size * Math.log(p));
    for (let index = 1; index <= value; index += 1) probability *= ((index - 1 + size) / index) * (1 - p);
    return probability;
  };
  const cdf = (value: number) => {
    const upper = Math.floor(value);
    if (upper < 0) return 0;
    let sum = 0;
    for (let index = 0; index <= upper; index += 1) sum += pmf(index);
    return Math.max(0, Math.min(1, sum));
  };
  return { kind: poisson ? 'POISSON' : 'NEGATIVE_BINOMIAL', mean: safeMean, variance: safeVariance, sampleSize, cdf, pmf };
}

function empiricalComboDistribution(input: { observations: NBAObservedGame[]; components: NBAAnalyzableMarket[]; targetMean: number }): NBAProbabilityDistribution | null {
  const totals = input.observations.flatMap(({ log }) => {
    const values = input.components.map((component) => getNBAHistoricalValue(component, log.stats));
    return values.every((value) => value != null) ? [values.reduce((sum, value) => sum + value!, 0)] : [];
  });
  if (totals.length < 5) return null;
  const baseline = sampleMean(totals)!;
  const variance = sampleVariance(totals) ?? 0;
  const integerShift = Math.round(input.targetMean - baseline);
  const samples = totals.map((total) => Math.max(0, total + integerShift));
  return { kind: 'EMPIRICAL_COMBO', mean: input.targetMean, variance, sampleSize: totals.length,
    cdf: (value) => samples.filter((sample) => sample <= value).length / samples.length,
    pmf: (value) => samples.filter((sample) => sample === value).length / samples.length };
}

export function buildNBAMarketDistribution(input: {
  market: NBAAnalyzableMarket;
  observations: NBAObservedGame[];
  expectedMean: number;
  uncertainty: number;
}): NBAProbabilityDistribution {
  const comboComponents = COMPONENTS[input.market];
  if (comboComponents) {
    const combo = empiricalComboDistribution({ observations: input.observations, components: comboComponents, targetMean: input.expectedMean });
    if (combo) return combo;
    return normalDistribution(input.expectedMean, input.uncertainty ** 2, input.observations.length, 'EMPIRICAL_COMBO');
  }
  const values = input.observations.flatMap(({ log }) => {
    const value = getNBAHistoricalValue(input.market, log.stats);
    return value == null ? [] : [value];
  });
  const empiricalVariance = sampleVariance(values) ?? input.expectedMean;
  if (NORMAL.includes(input.market)) return normalDistribution(input.expectedMean, Math.max(empiricalVariance, input.uncertainty ** 2), values.length);
  return countDistribution(input.expectedMean, Math.max(empiricalVariance, input.uncertainty ** 2), values.length, RARE.includes(input.market));
}

export function nbaComponentCorrelations(observations: NBAObservedGame[], components: NBAAnalyzableMarket[]): Record<string, number> | null {
  if (components.length < 2) return null;
  const aligned = observations.flatMap(({ log }) => {
    const values = components.map((component) => getNBAHistoricalValue(component, log.stats));
    return values.every((value) => value != null) ? [values as number[]] : [];
  });
  if (aligned.length < 5) return null;
  const correlations: Record<string, number> = {};
  for (let left = 0; left < components.length; left += 1) for (let right = left + 1; right < components.length; right += 1) {
    const first = aligned.map((row) => row[left]);
    const second = aligned.map((row) => row[right]);
    const firstMean = sampleMean(first)!;
    const secondMean = sampleMean(second)!;
    const covariance = aligned.reduce((sum, row) => sum + (row[left] - firstMean) * (row[right] - secondMean), 0) / (aligned.length - 1);
    const denominator = Math.sqrt((sampleVariance(first) ?? 0) * (sampleVariance(second) ?? 0));
    correlations[`${components[left]}:${components[right]}`] = denominator > 0 ? Math.max(-1, Math.min(1, covariance / denominator)) : 0;
  }
  return correlations;
}
