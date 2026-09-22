import type { NBAGameLogEntry } from './types';
import { getNBAHistoricalValue, type NBAAnalyzableMarket } from './market';

export interface NBAOutlierWindow {
  games: number;
  total: number;
  mean: number | null;
}

export interface NBAOutlierDependency {
  available: boolean;
  market: NBAAnalyzableMarket;
  sampleGames: number;
  raw: NBAOutlierWindow;
  withoutTopGame: NBAOutlierWindow;
  withoutTop2Games: NBAOutlierWindow;
  /** Share of total recent production contributed by the single best game, 0-100. */
  explosiveDependencePercent: number | null;
  median: number | null;
  standardDeviation: number | null;
}

function summarize(values: number[]): NBAOutlierWindow {
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

/**
 * Same CONCEPT as MLB's outlier dependency (lib/finder/outlierAnalysis.ts), reimplemented for NBA's
 * own game-log shape and market set. Line/market aware: e.g. flags a points projection driven by
 * one 50-point game, or a 3PM projection driven by one abnormal shooting night.
 */
export function computeNBAOutlierDependency(logs: NBAGameLogEntry[], market: NBAAnalyzableMarket, windowSize = 20): NBAOutlierDependency {
  const recent = logs.filter((log) => log.result != null).slice(-windowSize);
  const values = recent.map((log) => getNBAHistoricalValue(market, log.stats)).filter((value): value is number => value != null);

  if (values.length < 3) {
    return {
      available: false, market, sampleGames: values.length, raw: summarize(values),
      withoutTopGame: summarize([]), withoutTop2Games: summarize([]),
      explosiveDependencePercent: null, median: null, standardDeviation: null,
    };
  }

  const sortedDesc = [...values].sort((a, b) => b - a);
  const raw = summarize(values);
  const withoutTopGame = summarize(sortedDesc.slice(1));
  const withoutTop2Games = summarize(sortedDesc.slice(2));
  const explosiveDependencePercent = raw.total > 0 ? Number(((sortedDesc[0] / raw.total) * 100).toFixed(1)) : null;

  return {
    available: true, market, sampleGames: values.length, raw, withoutTopGame, withoutTop2Games,
    explosiveDependencePercent, median: median(values), standardDeviation: standardDeviation(values),
  };
}
