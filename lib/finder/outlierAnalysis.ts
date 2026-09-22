import type { MLBGameLog } from '../mlb/types';
import { getStatForCanonicalMarket } from './signals';

export interface OutlierWindow {
  games: number;
  total: number;
  mean: number | null;
}

export interface OutlierDependency {
  available: boolean;
  sampleGames: number;
  raw: OutlierWindow;
  withoutTopGame: OutlierWindow;
  withoutTop2Games: OutlierWindow;
  /** Share of total recent production contributed by the single best game, 0-100. */
  explosiveDependencePercent: number | null;
  median: number | null;
  standardDeviation: number | null;
}

function summarize(values: number[]): OutlierWindow {
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
 * Determines how much of a player's recent production depends on one or two standout games,
 * using only real per-game box-score values. Never fabricates a "film" or "process" signal —
 * see the failure-modes and evidence-board modules for those honest "unavailable" markers.
 */
export function computeOutlierDependency(games: MLBGameLog[], canonicalMarketKey: string, windowSize = 20): OutlierDependency {
  const recent = games.slice(-windowSize);
  const values = recent.map((game) => getStatForCanonicalMarket(game, canonicalMarketKey)).filter((value): value is number => value != null);

  if (values.length < 3) {
    return {
      available: false,
      sampleGames: values.length,
      raw: summarize(values),
      withoutTopGame: summarize([]),
      withoutTop2Games: summarize([]),
      explosiveDependencePercent: null,
      median: null,
      standardDeviation: null,
    };
  }

  const sortedDesc = [...values].sort((a, b) => b - a);
  const raw = summarize(values);
  const withoutTopGame = summarize(sortedDesc.slice(1));
  const withoutTop2Games = summarize(sortedDesc.slice(2));
  const explosiveDependencePercent = raw.total > 0 ? Number(((sortedDesc[0] / raw.total) * 100).toFixed(1)) : null;

  return {
    available: true,
    sampleGames: values.length,
    raw,
    withoutTopGame,
    withoutTop2Games,
    explosiveDependencePercent,
    median: median(values),
    standardDeviation: standardDeviation(values),
  };
}
