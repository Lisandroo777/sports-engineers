import { getNBAHistoricalValue, type NBAAnalyzableMarket } from './market';
import type { NBAGameLogEntry } from './types';

export interface NBAHistoricalWindow {
  hits: number;
  total: number;
  rate: number | null;
  mean: number | null;
  median: number | null;
}

export interface NBAMarketHistory {
  supported: boolean;
  marketKey: NBAAnalyzableMarket;
  line: number;
  side: 'over' | 'under';
  windows: { l5: NBAHistoricalWindow; l10: NBAHistoricalWindow; l20: NBAHistoricalWindow; season: NBAHistoricalWindow };
}

const EMPTY_WINDOW: NBAHistoricalWindow = { hits: 0, total: 0, rate: null, mean: null, median: null };

function summarize(values: number[], line: number, side: 'over' | 'under'): NBAHistoricalWindow {
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

/** Exact-line NBA history using only completed logs strictly before the selected game's slate date. */
export function buildNBAHistory(
  logs: NBAGameLogEntry[],
  marketKey: NBAAnalyzableMarket,
  line: number,
  side: 'over' | 'under',
  selectedSlateDate?: string,
): NBAMarketHistory {
  const historicalValues = logs
    .filter((log) => (selectedSlateDate == null || log.date.slice(0, 10) < selectedSlateDate) && log.result != null)
    .map((log) => getNBAHistoricalValue(marketKey, log.stats))
    .filter((value): value is number => value != null);
  const window = (size: number | null) => summarize(size == null ? historicalValues : historicalValues.slice(-size), line, side);
  return {
    supported: historicalValues.length > 0,
    marketKey,
    line,
    side,
    windows: { l5: window(5), l10: window(10), l20: window(20), season: window(null) },
  };
}
