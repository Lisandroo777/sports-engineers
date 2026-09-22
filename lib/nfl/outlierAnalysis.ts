import type { NFLGameLogEntry } from './types';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';

export type NFLOutlierApplicability = 'APPLICABLE' | 'OUTLIER_ANALYSIS_NOT_APPLICABLE';

/** Volume markets where one huge game can meaningfully skew a recency-weighted mean. */
const NFL_OUTLIER_APPLICABLE_MARKETS: NFLAnalyzableMarketKey[] = [
  'player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_rush_rec_yds',
  'player_receptions', 'player_pass_attempts', 'player_rush_attempts', 'player_pass_completions',
];

export interface NFLOutlierWindow {
  games: number;
  total: number;
  mean: number | null;
}

export interface NFLOutlierDependency {
  applicability: NFLOutlierApplicability;
  available: boolean;
  market: NFLAnalyzableMarketKey;
  sampleGames: number;
  raw: NFLOutlierWindow;
  withoutTopGame: NFLOutlierWindow;
  withoutTop2Games: NFLOutlierWindow;
  explosiveDependencePercent: number | null;
  median: number | null;
  standardDeviation: number | null;
}

function summarize(values: number[]): NFLOutlierWindow {
  if (!values.length) return { games: 0, total: 0, mean: null };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { games: values.length, total: Number(total.toFixed(2)), mean: Number((total / values.length).toFixed(2)) };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Number(Math.sqrt(variance).toFixed(2));
}

const NOT_APPLICABLE: Omit<NFLOutlierDependency, 'market'> = {
  applicability: 'OUTLIER_ANALYSIS_NOT_APPLICABLE', available: false, sampleGames: 0,
  raw: { games: 0, total: 0, mean: null }, withoutTopGame: { games: 0, total: 0, mean: null },
  withoutTop2Games: { games: 0, total: 0, mean: null }, explosiveDependencePercent: null, median: null, standardDeviation: null,
};

/**
 * Lightweight NFL outlier module for VOLUME markets only (yards/attempts/receptions). Rare-event
 * markets (TDs, INTs, sacks) are explicitly NOT applicable — a single anytime-TD is not "explosive
 * dependence" the way one 180-yard rushing game is, and applying this concept there would be
 * statistically misleading.
 */
export function computeNFLOutlierDependency(logs: NFLGameLogEntry[], market: NFLAnalyzableMarketKey, windowSize = 17): NFLOutlierDependency {
  if (!NFL_OUTLIER_APPLICABLE_MARKETS.includes(market)) return { ...NOT_APPLICABLE, market };

  const recent = logs.filter((log) => log.result != null).slice(-windowSize);
  const values = recent.map((log) => getNFLMarketHistoricalValue(market, log.stats)).filter((value): value is number => value != null);

  if (values.length < 3) {
    return { applicability: 'APPLICABLE', available: false, market, sampleGames: values.length, raw: summarize(values), withoutTopGame: summarize([]), withoutTop2Games: summarize([]), explosiveDependencePercent: null, median: null, standardDeviation: null };
  }

  const sortedDesc = [...values].sort((a, b) => b - a);
  const raw = summarize(values);
  const withoutTopGame = summarize(sortedDesc.slice(1));
  const withoutTop2Games = summarize(sortedDesc.slice(2));
  const explosiveDependencePercent = raw.total > 0 ? Number(((sortedDesc[0] / raw.total) * 100).toFixed(1)) : null;

  return {
    applicability: 'APPLICABLE', available: true, market, sampleGames: values.length, raw, withoutTopGame, withoutTop2Games,
    explosiveDependencePercent, median: median(values), standardDeviation: standardDeviation(values),
  };
}
