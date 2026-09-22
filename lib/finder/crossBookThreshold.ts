import type { NormalizedProp } from '../odds/types';

export interface CrossBookThresholdResult {
  available: boolean;
  standardLines: Array<{ line: number; books: string[] }>;
  discrepancy: boolean;
  spread: number | null;
}

/** Flags when sportsbooks disagree on the standard-line threshold for the same player+market, from data already fetched for this event. */
export function computeCrossBookThreshold(eventProps: NormalizedProp[], player: string, canonicalMarketKey: string): CrossBookThresholdResult {
  const standard = eventProps.filter((prop) => prop.player === player && prop.marketKey === canonicalMarketKey && !prop.isAlternate);
  if (standard.length === 0) return { available: false, standardLines: [], discrepancy: false, spread: null };

  const byLine = new Map<number, Set<string>>();
  for (const prop of standard) {
    const books = byLine.get(prop.line) ?? new Set<string>();
    books.add(prop.sportsbookName);
    byLine.set(prop.line, books);
  }

  const standardLines = [...byLine.entries()].map(([line, books]) => ({ line, books: [...books] })).sort((a, b) => a.line - b.line);
  const lines = standardLines.map((entry) => entry.line);
  const spread = lines.length > 1 ? Number((Math.max(...lines) - Math.min(...lines)).toFixed(2)) : 0;
  return { available: true, standardLines, discrepancy: lines.length > 1, spread };
}
