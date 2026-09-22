import { getNBAMarketMetadata } from './oddsTypes';
import type { NormalizedProp, OddsEvent } from '../odds/types';

interface RawNBAOutcome {
  name: 'Over' | 'Under';
  description?: string;
  price: number;
  point?: number;
}

interface RawNBAMarket {
  key: string;
  last_update?: string;
  outcomes?: RawNBAOutcome[];
}

interface RawNBABookmaker {
  key: string;
  title: string;
  last_update?: string;
  markets?: RawNBAMarket[];
}

export interface RawNBAEventOdds {
  id: string;
  bookmakers?: RawNBABookmaker[];
}

/** Finds one NBA odds event by exact normalized home/away names and optional slate date. */
export function findNBAOddsEvent(
  homeTeam: string,
  awayTeam: string,
  events: OddsEvent[],
  slateDate?: string,
): OddsEvent | null {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
  return events.find((event) => {
    if (slateDate && event.commenceTime.slice(0, 10) !== slateDate) return false;
    return normalize(event.homeTeam) === normalize(homeTeam) && normalize(event.awayTeam) === normalize(awayTeam);
  }) ?? null;
}

/**
 * Normalizes one raw NBA event response into the shared sport-agnostic NormalizedProp contract.
 * Unknown markets and incomplete two-sided outcomes are skipped, never invented. Player IDs are
 * resolved by the caller since sportsbook descriptions are provider-specific display names.
 */
export function normalizeNBAEventProps(
  payload: RawNBAEventOdds,
  playerIdByName: ReadonlyMap<string, number | null> = new Map(),
): NormalizedProp[] {
  const normalized: NormalizedProp[] = [];
  for (const bookmaker of payload.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      const metadata = getNBAMarketMetadata(market.key);
      if (!metadata) continue;
      const byPlayer = new Map<string, { over?: RawNBAOutcome; under?: RawNBAOutcome }>();
      for (const outcome of market.outcomes ?? []) {
        if (!outcome.description || outcome.point == null) continue;
        const entry = byPlayer.get(outcome.description) ?? {};
        if (outcome.name === 'Over') entry.over = outcome;
        if (outcome.name === 'Under') entry.under = outcome;
        byPlayer.set(outcome.description, entry);
      }
      for (const [player, outcomes] of byPlayer) {
        const line = outcomes.over?.point ?? outcomes.under?.point;
        if (line == null) continue;
        normalized.push({
          sport: 'nba',
          player,
          playerId: playerIdByName.get(player) ?? null,
          marketKey: metadata.canonicalMarketKey,
          sourceMarketKey: market.key,
          isAlternate: metadata.isAlternate,
          historicalAnalysisAvailable: metadata.historicalSupport !== 'unsupported',
          marketLabel: metadata.label,
          line,
          overOdds: outcomes.over?.price ?? null,
          underOdds: outcomes.under?.price ?? null,
          sportsbookKey: bookmaker.key,
          sportsbookName: bookmaker.title,
          eventId: payload.id,
          lastUpdate: market.last_update ?? bookmaker.last_update ?? new Date(0).toISOString(),
        });
      }
    }
  }
  return normalized;
}
