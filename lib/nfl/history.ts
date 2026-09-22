import type { NFLGameLogEntry } from './types';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import { mean, median, standardDeviation } from '../projection/types';

/**
 * Exact-line NFL history. NFL seasons are ~17 games, so the windows are L3/L5/L10/season — MLB's
 * L20 is deliberately absent rather than reported as a padded or misleading sample.
 *
 * A game where the stat is genuinely missing is EXCLUDED from the sample, never counted as 0.
 */

export interface NFLWindowResult {
  games: number;
  hits: number;
  hitRate: number | null;
}

export interface NFLMarketHistory {
  available: boolean;
  market: NFLAnalyzableMarketKey;
  line: number;
  side: 'over' | 'under';
  /** Completed games in the log, regardless of whether this stat was present. */
  gamesAvailable: number;
  /** Games that actually contributed a value for this market. */
  gamesUsed: number;
  windows: { l3: NFLWindowResult; l5: NFLWindowResult; l10: NFLWindowResult; season: NFLWindowResult };
  hitRate: number | null;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  splits: {
    home: { games: number; hitRate: number | null; mean: number | null };
    away: { games: number; hitRate: number | null; mean: number | null };
  };
  /** Most recent values, oldest→newest, for display and audit. */
  recentValues: number[];
}

function evaluateWindow(values: number[], line: number, side: 'over' | 'under'): NFLWindowResult {
  if (values.length === 0) return { games: 0, hits: 0, hitRate: null };
  const hits = values.filter((v) => (side === 'over' ? v > line : v < line)).length;
  return { games: values.length, hits, hitRate: Number(((hits / values.length) * 100).toFixed(1)) };
}

export function buildNFLHistory(
  logs: NFLGameLogEntry[],
  market: NFLAnalyzableMarketKey,
  line: number,
  side: 'over' | 'under',
): NFLMarketHistory {
  const completed = logs.filter((log) => log.result != null);
  const values = completed
    .map((log) => getNFLMarketHistoricalValue(market, log.stats))
    .filter((value): value is number => value != null);
  const split = (homeAway: 'home' | 'away') => {
    const splitValues = completed
      .filter((log) => log.homeAway === homeAway)
      .map((log) => getNFLMarketHistoricalValue(market, log.stats))
      .filter((value): value is number => value != null);
    return {
      games: splitValues.length,
      hitRate: evaluateWindow(splitValues, line, side).hitRate,
      mean: splitValues.length ? Number((mean(splitValues) ?? 0).toFixed(2)) : null,
    };
  };

  const base: NFLMarketHistory = {
    available: values.length > 0,
    market, line, side,
    gamesAvailable: completed.length,
    gamesUsed: values.length,
    windows: {
      l3: evaluateWindow(values.slice(-3), line, side),
      l5: evaluateWindow(values.slice(-5), line, side),
      l10: evaluateWindow(values.slice(-10), line, side),
      season: evaluateWindow(values, line, side),
    },
    hitRate: null,
    mean: null,
    median: null,
    stdDev: null,
    splits: { home: split('home'), away: split('away') },
    recentValues: values.slice(-10),
  };
  if (values.length === 0) return base;

  const m = mean(values);
  const sd = standardDeviation(values);
  const md = median(values);
  return {
    ...base,
    hitRate: base.windows.season.hitRate,
    mean: m != null ? Number(m.toFixed(2)) : null,
    median: md != null ? Number(md.toFixed(2)) : null,
    stdDev: sd != null ? Number(sd.toFixed(2)) : null,
  };
}
