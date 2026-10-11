import type { NFLGameLogEntry } from './types';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import { mean, median, standardDeviation } from '../projection/types';
import type { NFLHistorySample } from './rollingHistory';

/**
 * Exact-line NFL history. NFL seasons are ~17 games, so the windows are L3/L5/L10/season — MLB's
 * L20 is deliberately absent rather than reported as a padded or misleading sample.
 *
 * A game where the stat is genuinely missing is EXCLUDED from the sample, never counted as 0.
 */

export interface NFLWindowResult {
  games: number;
  gamesConsidered: number;
  missing: number;
  hits: number;
  misses: number;
  pushes: number;
  decisions: number;
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
  windows: { l3: NFLWindowResult; l5: NFLWindowResult; l10: NFLWindowResult; season: NFLWindowResult; currentSeason: NFLWindowResult; rolling: NFLWindowResult; previousSeason: NFLWindowResult };
  sourceSeason: number | null;
  sample: { currentSeasonGames: number; previousSeasonGames: number; supplemented: boolean; confidence: NFLHistorySample['confidence']; reasons: string[] };
  observations: Array<{ gameId: string; date: string; season: number | null; source: 'CURRENT_SEASON' | 'PREVIOUS_SEASON'; weight: number; value: number | null; outcome: 'HIT' | 'MISS' | 'PUSH' | 'MISSING' }>;
  hitRate: number | null;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  splits: {
    home: NFLWindowResult & { mean: number | null };
    away: NFLWindowResult & { mean: number | null };
  };
  /** Most recent values, oldest→newest, for display and audit. */
  recentValues: number[];
}

function evaluateWindow(values: number[], line: number, side: 'over' | 'under', gamesConsidered = values.length): NFLWindowResult {
  const hits = values.filter((v) => (side === 'over' ? v > line : v < line)).length;
  const pushes = values.filter((value) => value === line).length;
  const decisions = values.length - pushes;
  return { games: values.length, gamesConsidered, missing: gamesConsidered - values.length, hits, pushes,
    misses: decisions - hits, decisions, hitRate: decisions ? Number(((hits / decisions) * 100).toFixed(1)) : null };
}

export function buildNFLHistory(
  logs: NFLGameLogEntry[],
  market: NFLAnalyzableMarketKey,
  line: number,
  side: 'over' | 'under',
  sample?: NFLHistorySample,
): NFLMarketHistory {
  const completed = logs.filter((log) => log.result != null).sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime());
  const valuesFor = (entries: NFLGameLogEntry[]) => entries.map((log) => getNFLMarketHistoricalValue(market, log.stats)).filter((value): value is number => value != null && Number.isFinite(value));
  const window = (entries: NFLGameLogEntry[]) => evaluateWindow(valuesFor(entries), line, side, entries.length);
  const currentSeason = sample?.currentSeason ?? completed.filter((log) => log.historySource !== 'PREVIOUS_SEASON');
  const previousSeason = sample?.previousSeason ?? completed.filter((log) => log.historySource === 'PREVIOUS_SEASON');
  const values = completed
    .map((log) => getNFLMarketHistoricalValue(market, log.stats))
    .filter((value): value is number => value != null && Number.isFinite(value));
  const split = (homeAway: 'home' | 'away') => {
    const splitGames = completed.filter((log) => log.homeAway === homeAway);
    const splitValues = valuesFor(splitGames);
    return {
      ...evaluateWindow(splitValues, line, side, splitGames.length),
      mean: splitValues.length ? Number((mean(splitValues) ?? 0).toFixed(2)) : null,
    };
  };

  const base: NFLMarketHistory = {
    available: values.length > 0,
    market, line, side,
    sourceSeason: sample?.season ?? completed.find((log) => log.historySource !== 'PREVIOUS_SEASON')?.season ?? null,
    sample: { currentSeasonGames: sample?.currentObservations ?? valuesFor(currentSeason).length,
      previousSeasonGames: sample?.previousObservations ?? valuesFor(previousSeason).length,
      supplemented: sample?.supplemented ?? previousSeason.length > 0, confidence: sample?.confidence ?? 'CURRENT_ONLY', reasons: sample?.reasons ?? [] },
    observations: completed.map((log) => {
      const raw = getNFLMarketHistoricalValue(market, log.stats);
      const value = raw != null && Number.isFinite(raw) ? raw : null;
      return { gameId: log.gameId, date: log.date, season: log.season ?? null, source: log.historySource ?? 'CURRENT_SEASON', weight: log.historyWeight ?? 1, value,
        outcome: value == null ? 'MISSING' : value === line ? 'PUSH' : (side === 'over' ? value > line : value < line) ? 'HIT' : 'MISS' };
    }),
    gamesAvailable: completed.length,
    gamesUsed: values.length,
    windows: {
      l3: window(completed.slice(-3)),
      l5: window(completed.slice(-5)),
      l10: window(completed.slice(-10)),
      season: window(currentSeason),
      currentSeason: window(currentSeason),
      rolling: window(completed),
      previousSeason: window(previousSeason),
    },
    hitRate: null,
    mean: null,
    median: null,
    stdDev: null,
    splits: { home: split('home'), away: split('away') },
    recentValues: valuesFor(completed.slice(-10)),
  };
  if (values.length === 0) return base;

  const m = mean(values);
  const sd = standardDeviation(values);
  const md = median(values);
  return {
    ...base,
    hitRate: base.windows.rolling.hitRate,
    mean: m != null ? Number(m.toFixed(2)) : null,
    median: md != null ? Number(md.toFixed(2)) : null,
    stdDev: sd != null ? Number(sd.toFixed(2)) : null,
  };
}
