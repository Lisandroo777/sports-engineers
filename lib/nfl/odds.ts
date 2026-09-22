import { getNFLMarketMetadata } from './oddsTypes';
import type { NormalizedProp, OddsEvent } from '../odds/types';

interface RawNFLOutcome {
  name: 'Over' | 'Under' | 'Yes';
  description?: string;
  price: number;
  point?: number;
}

interface RawNFLMarket {
  key: string;
  last_update?: string;
  outcomes?: RawNFLOutcome[];
}

interface RawNFLBookmaker {
  key: string;
  title: string;
  last_update?: string;
  markets?: RawNFLMarket[];
}

export interface RawNFLEventOdds {
  id: string;
  bookmakers?: RawNFLBookmaker[];
}

/** Finds one NFL odds event by exact normalized home/away names and optional slate date. */
export function findNFLOddsEvent(
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
 * Normalizes one raw NFL event response into the existing sport-agnostic NormalizedProp contract.
 * Unknown markets and incomplete two-sided outcomes are skipped, never invented. Player IDs are
 * intentionally resolved by the caller because sportsbook descriptions are provider-specific names.
 */
export function normalizeNFLEventProps(
  payload: RawNFLEventOdds,
  playerIdByName: ReadonlyMap<string, number | null> = new Map(),
): NormalizedProp[] {
  const normalized: NormalizedProp[] = [];
  for (const bookmaker of payload.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      const metadata = getNFLMarketMetadata(market.key);
      if (!metadata) continue;
      const byPlayer = new Map<string, { over?: RawNFLOutcome; under?: RawNFLOutcome }>();
      for (const outcome of market.outcomes ?? []) {
        const anytimeTouchdown = metadata.canonicalMarketKey === 'player_anytime_td' && outcome.name === 'Yes';
        if (!outcome.description || (outcome.point == null && !anytimeTouchdown)) continue;
        const entry = byPlayer.get(outcome.description) ?? {};
        if (outcome.name === 'Over' || anytimeTouchdown) entry.over = outcome;
        if (outcome.name === 'Under') entry.under = outcome;
        byPlayer.set(outcome.description, entry);
      }
      for (const [player, outcomes] of byPlayer) {
        const line = outcomes.over?.point ?? outcomes.under?.point ?? (metadata.canonicalMarketKey === 'player_anytime_td' ? 0.5 : null);
        if (line == null) continue;
        normalized.push({
          sport: 'nfl',
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

export function isNFLHistoricalMarketSupported(marketKey: string): boolean {
  const metadata = getNFLMarketMetadata(marketKey);
  return metadata?.historicalSupport !== 'unsupported';
}
