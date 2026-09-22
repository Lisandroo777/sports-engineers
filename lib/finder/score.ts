import { FINDER_SCORE_WEIGHTS, getFinderGrade } from './weights';
import type { HistoricalSignal } from './signals';
import type { MatchupSignal } from './matchup';

export interface FinderScoreInputs {
  historical: HistoricalSignal;
  matchup: MatchupSignal;
  evPercent: number | null;
  marketAgreement: number | null;
  availableBooks: number;
  historicalAnalysisAvailable: boolean;
}

export interface FinderScoreResult {
  score: number;
  grade: string | null;
  components: Record<keyof typeof FINDER_SCORE_WEIGHTS, number | null>;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function historicalComponent(historical: HistoricalSignal): number | null {
  if (!historical.available) return null;
  const windows = [historical.windows.l5, historical.windows.l10, historical.windows.l20];
  const rated = windows.filter((window) => window.rate != null);
  if (!rated.length) return null;
  return clamp(rated.reduce((sum, window) => sum + (window.rate ?? 0), 0) / rated.length);
}

function trendComponent(historical: HistoricalSignal): number | null {
  if (!historical.available || historical.trend === 'unavailable') return null;
  return historical.trend === 'up' ? 75 : historical.trend === 'down' ? 35 : 55;
}

function marketValueComponent(evPercent: number | null): number | null {
  if (evPercent == null) return null;
  return clamp(50 + evPercent * 4);
}

function marketAgreementComponent(marketAgreement: number | null): number | null {
  if (marketAgreement == null) return null;
  return clamp(marketAgreement);
}

function dataQualityComponent(inputs: FinderScoreInputs): number {
  let available = 0;
  const total = 4;
  if (inputs.historical.available) available += 1;
  if (inputs.matchup.available) available += 1;
  if (inputs.evPercent != null) available += 1;
  if (inputs.historicalAnalysisAvailable) available += 1;
  return clamp((available / total) * 100);
}

/** Deterministic weighted composite. Missing components are excluded and remaining weights are renormalized. */
export function computeFinderScore(inputs: FinderScoreInputs): FinderScoreResult {
  const components: Record<keyof typeof FINDER_SCORE_WEIGHTS, number | null> = {
    historicalPerformance: historicalComponent(inputs.historical),
    matchupQuality: inputs.matchup.available ? inputs.matchup.qualityScore : null,
    marketValue: marketValueComponent(inputs.evPercent),
    marketAgreement: marketAgreementComponent(inputs.marketAgreement),
    recentTrend: trendComponent(inputs.historical),
    dataQuality: dataQualityComponent(inputs),
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const key of Object.keys(FINDER_SCORE_WEIGHTS) as Array<keyof typeof FINDER_SCORE_WEIGHTS>) {
    const value = components[key];
    if (value == null) continue;
    weightedSum += value * FINDER_SCORE_WEIGHTS[key];
    weightTotal += FINDER_SCORE_WEIGHTS[key];
  }

  const rawScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;

  // Renormalizing over few signals can otherwise let one strong-but-narrow component (e.g. EV alone)
  // reach an Elite/Strong grade on thin evidence — cap the achievable score by how many real,
  // independent signals (excluding dataQuality itself) actually back it.
  const independentSignalCount = ([
    'historicalPerformance', 'matchupQuality', 'marketValue', 'marketAgreement', 'recentTrend',
  ] as const).filter((key) => components[key] != null).length;
  const scoreCap = independentSignalCount >= 3 ? 100 : independentSignalCount === 2 ? 84 : 74;
  const score = Math.min(rawScore, scoreCap);

  return { score, grade: getFinderGrade(score), components };
}
