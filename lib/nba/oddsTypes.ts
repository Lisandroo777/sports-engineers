/**
 * NBA sportsbook market normalization.
 *
 * Market key strings below match The Odds API's PUBLICLY DOCUMENTED `basketball_nba` player-prop
 * markets (https://the-odds-api.com/sports-odds-data/betting-markets.html, "NBA, NCAAB, WNBA Player
 * Props API" section, audited live during Phase 2 — not guessed). Only markets we can also compute
 * from real ESPN game logs (lib/nba/market.ts) are wired to a canonical internal market; every other
 * real Odds API NBA market key is classified 'unsupported' rather than silently dropped or guessed.
 */

import { NBA_MARKET_LABELS, NBA_MARKET_SUPPORT, type NBAAnalyzableMarket } from './market';

/** Real Odds API `basketball_nba` player-prop market keys we can map to a supported internal market. */
export const NBA_SOURCE_MARKET_TO_CANONICAL: Record<string, NBAAnalyzableMarket> = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: '3pm',
  player_blocks: 'blocks',
  player_steals: 'steals',
  player_turnovers: 'turnovers',
  player_points_rebounds_assists: 'pra',
  player_points_rebounds: 'pr',
  player_points_assists: 'pa',
  player_rebounds_assists: 'ra',
};

/**
 * Real Odds API NBA market keys that exist but have NO connected internal support yet
 * (no ESPN-derived historical value / projection). Documented so we never silently mis-map them —
 * they are explicitly rejected, not guessed into a nearby market.
 *   player_blocks_steals, player_field_goals, player_frees_made, player_frees_attempts,
 *   player_first_basket, player_first_team_basket, player_double_double, player_triple_double,
 *   player_method_of_first_basket, player_fantasy_points, and the *_q1 quarter variants.
 * There is also no `player_minutes` market documented by the provider at all — NBA's internal
 * 'minutes' market is used only for the projection engine's expected-minutes step, never as a
 * sportsbook-facing prop.
 */
export const NBA_ALTERNATE_MARKET_SUFFIX = '_alternate';

export interface NBAMarketMetadata {
  sourceMarketKey: string;
  canonicalMarketKey: NBAAnalyzableMarket;
  label: string;
  isAlternate: boolean;
  /** SUPPORTED/DERIVED markets have a real ESPN-computable historical value; PARTIAL/UNAVAILABLE do not. */
  historicalSupport: 'full' | 'partial' | 'unsupported';
}

function historicalSupportFor(market: NBAAnalyzableMarket): NBAMarketMetadata['historicalSupport'] {
  const support = NBA_MARKET_SUPPORT[market];
  if (support === 'SUPPORTED' || support === 'DERIVED') return 'full';
  if (support === 'PARTIAL') return 'partial';
  return 'unsupported';
}

/** Returns null (not a guess) for any market key not explicitly mapped above. */
export function getNBAMarketMetadata(sourceMarketKey: string): NBAMarketMetadata | null {
  const isAlternate = sourceMarketKey.endsWith(NBA_ALTERNATE_MARKET_SUFFIX);
  const baseKey = isAlternate ? sourceMarketKey.slice(0, -NBA_ALTERNATE_MARKET_SUFFIX.length) : sourceMarketKey;
  const canonicalMarketKey = NBA_SOURCE_MARKET_TO_CANONICAL[baseKey];
  if (!canonicalMarketKey) return null;
  return {
    sourceMarketKey,
    canonicalMarketKey,
    label: NBA_MARKET_LABELS[canonicalMarketKey],
    isAlternate,
    historicalSupport: historicalSupportFor(canonicalMarketKey),
  };
}

export function isNBAHistoricalMarketSupported(sourceMarketKey: string): boolean {
  const metadata = getNBAMarketMetadata(sourceMarketKey);
  return metadata?.historicalSupport !== 'unsupported' && metadata != null;
}
