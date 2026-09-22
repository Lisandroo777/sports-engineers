import type { NormalizedProp } from './types';

export interface PropBookComparison {
  eventId: string;
  player: string;
  marketKey: string;
  sourceMarketKey: string;
  line: number;
  isAlternate: boolean;
  books: NormalizedProp[];
  bestOver: NormalizedProp | null;
  bestUnder: NormalizedProp | null;
}

export function buildBookComparisons(props: NormalizedProp[]): PropBookComparison[] {
  const groups = new Map<string, NormalizedProp[]>();
  for (const prop of props) {
    const key = `${prop.eventId}|${prop.player}|${prop.sourceMarketKey}|${prop.line}`;
    groups.set(key, [...(groups.get(key) ?? []), prop]);
  }

  return [...groups.values()].map((books) => ({
    eventId: books[0].eventId,
    player: books[0].player,
    marketKey: books[0].marketKey,
    sourceMarketKey: books[0].sourceMarketKey,
    line: books[0].line,
    isAlternate: books[0].isAlternate,
    books,
    bestOver: books.filter((book) => book.overOdds != null).sort((a, b) => b.overOdds! - a.overOdds!)[0] ?? null,
    bestUnder: books.filter((book) => book.underOdds != null).sort((a, b) => b.underOdds! - a.underOdds!)[0] ?? null,
  }));
}
