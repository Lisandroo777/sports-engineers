/**
 * DeepSide market probability model.
 *
 * Estimates P(stat clears the sportsbook line) from the modelled distribution of a player's
 * expected outcome — NOT from historical hit rate, and never from researchScore. Historical
 * performance enters only later, as bounded calibration evidence (see calibrateProbability).
 *
 * Every market is mapped to a distribution family appropriate to the underlying stat. When the
 * inputs required by that family are missing, the model returns null and the caller fails closed.
 */

export type MarketFamily = 'RARE_COUNT' | 'COUNT' | 'VOLUME';
export type DistributionUsed = 'poisson' | 'negative_binomial' | 'normal';

export interface ModelProbabilityResult {
  probability: number;
  distribution: DistributionUsed;
  family: MarketFamily;
  /** Standardised separation between projection and line; sign follows the bet direction. */
  zSeparation: number | null;
  basis: string;
}

/**
 * Market -> distribution family.
 * RARE_COUNT: low-mean integer events where variance ≈ mean; Poisson is the natural model.
 * COUNT:      integer counts that are usually overdispersed; negative binomial when we have a
 *             variance estimate that exceeds the mean, Poisson otherwise.
 * VOLUME:     large counts/continuous-ish totals where a normal approximation is reasonable.
 */
const MARKET_FAMILY: Record<string, MarketFamily> = {
  batter_home_runs: 'RARE_COUNT',
  batter_doubles: 'RARE_COUNT',
  batter_triples: 'RARE_COUNT',
  batter_stolen_bases: 'RARE_COUNT',
  batter_hits: 'COUNT',
  batter_runs_scored: 'COUNT',
  batter_rbis: 'COUNT',
  batter_walks: 'COUNT',
  batter_total_bases: 'COUNT',
  batter_hits_runs_rbis: 'COUNT',
  batter_strikeouts: 'COUNT',
  pitcher_strikeouts: 'COUNT',
  pitcher_hits_allowed: 'COUNT',
  pitcher_earned_runs: 'COUNT',
  pitcher_walks: 'COUNT',
  pitcher_outs: 'VOLUME',
  player_pass_yds: 'VOLUME',
  player_rush_yds: 'VOLUME',
  player_reception_yds: 'VOLUME',
  player_rush_rec_yds: 'VOLUME',
  player_receptions: 'COUNT',
  player_pass_attempts: 'COUNT',
  player_pass_completions: 'COUNT',
  player_rush_attempts: 'COUNT',
  player_tackles_assists: 'COUNT',
  player_solo_tackles: 'COUNT',
  player_pass_tds: 'RARE_COUNT',
  player_rush_tds: 'RARE_COUNT',
  player_reception_tds: 'RARE_COUNT',
  player_pass_interceptions: 'RARE_COUNT',
  player_defensive_interceptions: 'RARE_COUNT',
  player_sacks: 'RARE_COUNT',
  player_anytime_td: 'RARE_COUNT',
  // NBA — high-volume box-score totals behave continuously; low-count events stay count-based.
  points: 'VOLUME',
  rebounds: 'COUNT',
  assists: 'COUNT',
  pra: 'VOLUME',
  pr: 'VOLUME',
  pa: 'VOLUME',
  ra: 'VOLUME',
  minutes: 'VOLUME',
  '3pm': 'COUNT',
  steals: 'RARE_COUNT',
  blocks: 'RARE_COUNT',
  turnovers: 'COUNT',
};

/** Minimum games required before a family's variance/mean estimates are trusted. */
export const MIN_SAMPLE_BY_FAMILY: Record<MarketFamily, number> = {
  RARE_COUNT: 10,
  COUNT: 10,
  VOLUME: 10,
};

export function getMarketFamily(marketKey: string): MarketFamily | null {
  return MARKET_FAMILY[marketKey] ?? null;
}

// ── distribution helpers ──────────────────────────────────────────────────────

/** Lanczos log-gamma, used for negative-binomial terms with non-integer r. */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < g.length; i += 1) a += g[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(X <= k) for Poisson(lambda). */
function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return 1;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i;
    sum += term;
  }
  return Math.min(1, sum);
}

/** P(X <= k) for a negative binomial with mean `mean` and variance `variance` (variance > mean). */
function negBinomCdf(k: number, mean: number, variance: number): number {
  if (k < 0) return 0;
  const r = (mean * mean) / (variance - mean);
  const p = r / (r + mean);
  let sum = 0;
  for (let i = 0; i <= k; i += 1) {
    const logPmf = logGamma(i + r) - logGamma(r) - logGamma(i + 1) + r * Math.log(p) + i * Math.log1p(-p);
    sum += Math.exp(logPmf);
  }
  return Math.min(1, sum);
}

/** Standard normal CDF via Abramowitz-Stegun erf approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const prob = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - prob : prob;
}

/**
 * Models P(stat clears the line) for this candidate's direction.
 *
 * Inputs: projection (distribution mean), projectionUncertainty (spread), line, direction, market.
 * Returns null — never a guess — when the market is unmapped, the projection is missing, the sample
 * is too small for the family, or the family needs a spread estimate that is unavailable.
 */
export function modelProbability(params: {
  marketKey: string;
  line: number | null;
  direction: 'over' | 'under';
  projection: number | null;
  projectionUncertainty: number | null;
  sampleSize: number | null;
}): ModelProbabilityResult | null {
  const { marketKey, line, direction, projection, projectionUncertainty, sampleSize } = params;
  const family = getMarketFamily(marketKey);
  if (family == null || line == null || projection == null || projection < 0) return null;
  if (sampleSize == null || sampleSize < MIN_SAMPLE_BY_FAMILY[family]) return null;

  let probabilityOver: number;
  let distribution: DistributionUsed;

  if (family === 'VOLUME') {
    // Normal approximation needs a real spread estimate; without one we fail closed.
    if (projectionUncertainty == null || projectionUncertainty <= 0) return null;
    // Lines are x.5, so no continuity correction is needed for the tie case.
    probabilityOver = 1 - normalCdf((line - projection) / projectionUncertainty);
    distribution = 'normal';
  } else {
    // Integer counts: P(X > line) = 1 - P(X <= floor(line)).
    const k = Math.floor(line);
    const variance = projectionUncertainty != null && projectionUncertainty > 0 ? projectionUncertainty ** 2 : null;
    if (family === 'COUNT' && variance != null && variance > projection && projection > 0) {
      probabilityOver = 1 - negBinomCdf(k, projection, variance);
      distribution = 'negative_binomial';
    } else {
      probabilityOver = 1 - poissonCdf(k, projection);
      distribution = 'poisson';
    }
  }

  const probability = direction === 'over' ? probabilityOver : 1 - probabilityOver;
  // Epistemic bound: the projection itself is estimated from `sampleSize` games, so no finite sample
  // can justify more confidence than a Laplace-style 1 - 1/(n+2). Without this, a projection of ~0 in
  // a rare-event market returns ~99.9%, which the calibration backtest showed to be overconfident.
  const maxConfidence = 1 - 1 / (sampleSize + 2);
  const bounded = Math.max(1 - maxConfidence, Math.min(maxConfidence, probability));
  const zSeparation = projectionUncertainty != null && projectionUncertainty > 0
    ? (direction === 'over' ? projection - line : line - projection) / projectionUncertainty
    : null;

  return {
    probability: bounded,
    distribution,
    family,
    zSeparation: zSeparation != null ? Number(zSeparation.toFixed(2)) : null,
    basis: `${distribution} on ${family} market (mean=${projection}, spread=${projectionUncertainty ?? 'n/a'}, line=${line}, ${direction}), confidence bounded to ${(maxConfidence * 100).toFixed(1)}% by a ${sampleSize}-game sample`,
  };
}

export interface CalibratedProbability {
  modelProbability: number;
  historicalHitRate: number | null;
  calibratedProbability: number;
  /** Weight given to historical evidence; capped so history can never become the probability. */
  historicalWeight: number;
  /** |model - historical|; large values flag an unstable or biased projection. */
  divergence: number | null;
  basis: string;
}

/** Historical evidence may nudge the modelled probability, but is capped so it can never replace it. */
export const MAX_HISTORICAL_WEIGHT = 0.35;

/**
 * Blends the modelled probability with the observed hit rate as SUPPORTING evidence only.
 *   w = min(MAX_HISTORICAL_WEIGHT, n / (n + 20))
 *   calibrated = (1 - w) * model + w * historical
 * Clamped to [0.02, 0.98] so nothing is ever asserted as a near-certainty.
 */
export function calibrateProbability(params: {
  modelProbability: number;
  historicalHitRate: number | null;
  sampleSize: number | null;
}): CalibratedProbability {
  const { modelProbability: model, historicalHitRate, sampleSize } = params;
  const n = sampleSize ?? 0;
  const weight = historicalHitRate != null && n > 0
    ? Math.min(MAX_HISTORICAL_WEIGHT, n / (n + 20))
    : 0;
  const blended = historicalHitRate != null ? (1 - weight) * model + weight * historicalHitRate : model;
  return {
    modelProbability: model,
    historicalHitRate,
    calibratedProbability: Math.max(0.02, Math.min(0.98, blended)),
    historicalWeight: Number(weight.toFixed(3)),
    divergence: historicalHitRate != null ? Number(Math.abs(model - historicalHitRate).toFixed(3)) : null,
    basis: `Model probability calibrated with ${(weight * 100).toFixed(0)}% weight on ${n}-game historical hit rate`,
  };
}
