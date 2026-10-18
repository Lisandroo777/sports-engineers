/**
 * NFL sportsbook market normalization — mirrors lib/odds/types.ts's structure exactly so the same
 * Finder pipeline (anyOpportunities math, engine scoring, AI Finder cards) can consume NFL props
 * the moment real odds are connected, with zero redesign.
 *
 * Market key strings below match The Odds API's publicly documented NFL player-prop markets
 * (confirmed during the NFL Phase 1 provider audit). They have NOT been verified against a live
 * NFL odds response yet — no NFL Odds API request has ever been made, by design, to protect the
 * shared credit reserve. Verify this list against one real response before connecting real props.
 */

export type NFLAnalyzableMarketKey =
  | 'player_pass_yds'
  | 'player_pass_tds'
  | 'player_pass_completions'
  | 'player_pass_attempts'
  | 'player_pass_interceptions'
  | 'player_pass_longest_completion'
  | 'player_rush_yds'
  | 'player_rush_attempts'
  | 'player_rush_longest'
  | 'player_rush_tds'
  | 'player_reception_yds'
  | 'player_receptions'
  | 'player_reception_longest'
  | 'player_reception_tds'
  | 'player_rush_rec_yds'
  | 'player_anytime_td'
  | 'player_kicking_points'
  | 'player_field_goals'
  | 'player_tackles_assists'
  | 'player_sacks'
  | 'player_solo_tackles'
  | 'player_defensive_interceptions';

export const NFL_QB_MARKETS: NFLAnalyzableMarketKey[] = [
  'player_pass_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts', 'player_pass_interceptions',
  'player_pass_longest_completion',
  'player_rush_yds', 'player_rush_attempts', 'player_rush_longest', 'player_anytime_td',
];

export const NFL_RB_MARKETS: NFLAnalyzableMarketKey[] = [
  'player_rush_yds', 'player_rush_attempts', 'player_rush_tds', 'player_reception_yds', 'player_receptions', 'player_reception_tds',
  'player_rush_longest', 'player_rush_rec_yds', 'player_anytime_td',
];

export const NFL_WR_TE_MARKETS: NFLAnalyzableMarketKey[] = [
  'player_reception_yds', 'player_receptions', 'player_reception_longest', 'player_reception_tds', 'player_anytime_td',
];

export const NFL_KICKER_MARKETS: NFLAnalyzableMarketKey[] = [
  'player_kicking_points', 'player_field_goals',
];

export const NFL_DEFENSE_MARKETS: NFLAnalyzableMarketKey[] = [
  'player_tackles_assists', 'player_sacks', 'player_solo_tackles', 'player_defensive_interceptions',
];

export const NFL_ELITE_MARKETS: NFLAnalyzableMarketKey[] = [
  'player_pass_yds', 'player_pass_attempts', 'player_pass_completions', 'player_pass_tds', 'player_pass_interceptions',
  'player_rush_yds', 'player_rush_attempts', 'player_rush_tds',
  'player_reception_yds', 'player_receptions', 'player_reception_tds',
  'player_field_goals', 'player_kicking_points',
];

export const NFL_UNSUPPORTED_FIELD_GOAL_CONCEPTS = [
  { label: 'field goals attempted', pattern: /\b(?:(?:fgs?|field[\s-]*goals?)\s+(?:attempts?|attempted)|(?:attempted|attempting)\s+(?:fgs?|field[\s-]*goals?))\b/i },
  { label: 'longest field goal', pattern: /\blongest\s+(?:made\s+)?(?:fgs?|field[\s-]*goals?)\b/i },
  { label: 'team field goals', pattern: /\b(?:teams?\s+(?:total\s+)?(?:fgs?|field[\s-]*goals?)|(?:fgs?|field[\s-]*goals?)(?:\s+made)?\s+(?:by|for|per)\s+(?:the\s+)?teams?)\b/i },
] as const;

export function getNFLUnsupportedFieldGoalConcept(query: string): string | null {
  if (!/\b(?:fgs?|field[\s-]*goals?)\b/i.test(query)) return null;
  return NFL_UNSUPPORTED_FIELD_GOAL_CONCEPTS.find(({ pattern }) => pattern.test(query))?.label ?? null;
}

export const NFL_ALTERNATE_MARKET_SUFFIX = '_alternate';

export const NFL_MARKET_LABELS: Record<NFLAnalyzableMarketKey, string> = {
  player_pass_yds: 'Passing Yards',
  player_pass_tds: 'Passing Touchdowns',
  player_pass_completions: 'Completions',
  player_pass_attempts: 'Pass Attempts',
  player_pass_interceptions: 'Interceptions',
  player_pass_longest_completion: 'Longest Completion',
  player_rush_yds: 'Rushing Yards',
  player_rush_attempts: 'Rushing Attempts',
  player_rush_longest: 'Longest Rush',
  player_rush_tds: 'Rushing Touchdowns',
  player_reception_yds: 'Receiving Yards',
  player_receptions: 'Receptions',
  player_reception_longest: 'Longest Reception',
  player_reception_tds: 'Receiving Touchdowns',
  player_rush_rec_yds: 'Rush + Receiving Yards',
  player_anytime_td: 'Anytime Touchdown',
  player_kicking_points: 'Kicking Points',
  player_field_goals: 'Field Goals Made',
  player_tackles_assists: 'Tackles + Assists',
  player_sacks: 'Sacks',
  player_solo_tackles: 'Solo Tackles',
  player_defensive_interceptions: 'Interceptions',
};

/** Maps our real ESPN game-log stat keys (lib/nfl/stats.ts) to the matching market, for historical hit-rate analysis. */
export const NFL_MARKET_TO_GAMELOG_STAT: Record<NFLAnalyzableMarketKey, string> = {
  player_pass_yds: 'passingYards',
  player_pass_tds: 'passingTouchdowns',
  player_pass_completions: 'completions',
  player_pass_attempts: 'passingAttempts',
  player_pass_interceptions: 'interceptions',
  player_pass_longest_completion: 'longPassing',
  player_rush_yds: 'rushingYards',
  player_rush_attempts: 'rushingAttempts',
  player_rush_longest: 'longRushing',
  player_rush_tds: 'rushingTouchdowns',
  player_reception_yds: 'receivingYards',
  player_receptions: 'receptions',
  player_reception_longest: 'longReception',
  player_reception_tds: 'receivingTouchdowns',
  player_rush_rec_yds: 'rushingYards+receivingYards',
  player_anytime_td: 'rushingTouchdowns+receivingTouchdowns',
  player_kicking_points: 'kickingPoints',
  player_field_goals: 'fieldGoalsMade',
  player_tackles_assists: 'totalTackles',
  player_sacks: 'sacks',
  player_solo_tackles: 'soloTackles',
  player_defensive_interceptions: 'interceptions',
};

export interface NFLMarketMetadata {
  sourceMarketKey: string;
  canonicalMarketKey: string;
  label: string;
  isAlternate: boolean;
  gameLogStatKey: string | null;
  historicalSupport: 'full' | 'partial' | 'unsupported';
}

export type NFLHistoricalValue = number | null;

function yardageSourcePairIsValid(marketKey: NFLAnalyzableMarketKey, value: number, stats: Record<string, number>): boolean {
  const opportunityKey = marketKey === 'player_pass_yds' ? 'passingAttempts'
    : marketKey === 'player_rush_yds' ? 'rushingAttempts'
      : marketKey === 'player_reception_yds' ? 'receivingTargets' : null;
  const opportunity = opportunityKey ? stats[opportunityKey] : null;
  if (opportunityKey && opportunity != null && (!Number.isFinite(opportunity) || opportunity < 0)) return false;
  if (value >= 0) return true;
  if (marketKey === 'player_pass_yds') {
    // ESPN passing yards can be negative from sacks even when no pass attempt was recorded.
    return Number.isFinite(opportunity) && opportunity! > 0 || Number.isFinite(stats.sacks) && stats.sacks > 0;
  }
  if (marketKey === 'player_rush_yds' || marketKey === 'player_reception_yds') return Number.isFinite(opportunity) && opportunity! > 0;
  return true;
}

/** Returns only values that can be calculated from the normalized ESPN game log. */
export function getNFLMarketHistoricalValue(
  marketKey: NFLAnalyzableMarketKey,
  stats: Record<string, number>,
): NFLHistoricalValue {
  let value: number | null;
  switch (marketKey) {
    case 'player_rush_rec_yds':
      value = stats.rushingYards != null && stats.receivingYards != null ? stats.rushingYards + stats.receivingYards : null;
      break;
    case 'player_anytime_td':
      value = stats.rushingTouchdowns != null && stats.receivingTouchdowns != null ? stats.rushingTouchdowns + stats.receivingTouchdowns : null;
      break;
    case 'player_pass_yds': value = stats.passingYards ?? null; break;
    case 'player_pass_tds': value = stats.passingTouchdowns ?? null; break;
    case 'player_pass_completions': value = stats.completions ?? null; break;
    case 'player_pass_attempts': value = stats.passingAttempts ?? null; break;
    case 'player_pass_interceptions': value = stats.interceptions ?? null; break;
    case 'player_pass_longest_completion': value = stats.longPassing ?? null; break;
    case 'player_rush_yds': value = stats.rushingYards ?? null; break;
    case 'player_rush_attempts': value = stats.rushingAttempts ?? null; break;
    case 'player_rush_longest': value = stats.longRushing ?? null; break;
    case 'player_rush_tds': value = stats.rushingTouchdowns ?? null; break;
    case 'player_reception_yds': value = stats.receivingYards ?? null; break;
    case 'player_receptions': value = stats.receptions ?? null; break;
    case 'player_reception_longest': value = stats.longReception ?? null; break;
    case 'player_reception_tds': value = stats.receivingTouchdowns ?? null; break;
    case 'player_field_goals': value = stats.fieldGoalsMade ?? null; break;
    case 'player_kicking_points': value = stats.kickingPoints ?? null; break;
    case 'player_tackles_assists': value = stats.totalTackles ?? null; break;
    case 'player_sacks': value = stats.sacks ?? null; break;
    case 'player_solo_tackles': value = stats.soloTackles ?? null; break;
    case 'player_defensive_interceptions': value = stats.interceptions ?? null; break;
    default: value = null;
  }
  if ((marketKey === 'player_field_goals' || marketKey === 'player_kicking_points')
    && value != null && (!Number.isInteger(value) || value < 0)) return null;
  return value != null && (!Number.isFinite(value) || !yardageSourcePairIsValid(marketKey, value, stats)) ? null : value;
}

function historicalSupportFor(marketKey: NFLAnalyzableMarketKey): NFLMarketMetadata['historicalSupport'] {
  if (['player_pass_longest_completion', 'player_rush_longest', 'player_reception_longest', 'player_rush_rec_yds', 'player_anytime_td'].includes(marketKey)) return 'partial';
  return 'full';
}

export function getNFLMarketMetadata(sourceMarketKey: string): NFLMarketMetadata | null {
  const isAlternate = sourceMarketKey.endsWith(NFL_ALTERNATE_MARKET_SUFFIX);
  const baseKey = isAlternate ? sourceMarketKey.slice(0, -NFL_ALTERNATE_MARKET_SUFFIX.length) : sourceMarketKey;
  const canonicalMarketKey = (baseKey === 'player_rush_reception_yds' ? 'player_rush_rec_yds' : baseKey) as NFLAnalyzableMarketKey;
  const label = NFL_MARKET_LABELS[canonicalMarketKey];
  if (!label) return null;
  return {
    sourceMarketKey,
    canonicalMarketKey,
    label,
    isAlternate,
    gameLogStatKey: NFL_MARKET_TO_GAMELOG_STAT[canonicalMarketKey] ?? null,
    historicalSupport: historicalSupportFor(canonicalMarketKey),
  };
}
