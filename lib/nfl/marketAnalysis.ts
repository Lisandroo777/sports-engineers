import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLGameLogEntry } from './types';

export interface NFLHistoricalWindow {
  hits: number;
  total: number;
  rate: number | null;
  mean: number | null;
  median: number | null;
}

export interface NFLMarketHistory {
  supported: boolean;
  marketKey: NFLAnalyzableMarketKey;
  line: number;
  side: 'over' | 'under';
  windows: { l3: NFLHistoricalWindow; l5: NFLHistoricalWindow; l10: NFLHistoricalWindow; season: NFLHistoricalWindow };
}

const EMPTY_WINDOW: NFLHistoricalWindow = { hits: 0, total: 0, rate: null, mean: null, median: null };

function summarize(values: number[], line: number, side: 'over' | 'under'): NFLHistoricalWindow {
  if (values.length === 0) return EMPTY_WINDOW;
  const hits = values.filter((value) => side === 'over' ? value > line : value < line).length;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    hits,
    total: values.length,
    rate: Math.round((hits / values.length) * 100),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
  };
}

/** Exact-line NFL history using only completed logs strictly before the selected game's slate date. */
export function analyzeNFLMarketHistory(
  logs: NFLGameLogEntry[],
  marketKey: NFLAnalyzableMarketKey,
  line: number,
  side: 'over' | 'under',
  selectedSlateDate: string,
): NFLMarketHistory {
  const historicalValues = logs
    .filter((log) => log.date.slice(0, 10) < selectedSlateDate && log.result != null)
    .map((log) => getNFLMarketHistoricalValue(marketKey, log.stats))
    .filter((value): value is number => value != null);
  const window = (size: number | null) => summarize(size == null ? historicalValues : historicalValues.slice(-size), line, side);
  return {
    supported: historicalValues.length > 0,
    marketKey,
    line,
    side,
    windows: { l3: window(3), l5: window(5), l10: window(10), season: window(null) },
  };
}
