export type AnalyzableMarketKey =
  | 'batter_hits'
  | 'batter_total_bases'
  | 'batter_home_runs'
  | 'batter_rbis'
  | 'batter_runs_scored'
  | 'batter_hits_runs_rbis'
  | 'batter_strikeouts'
  | 'pitcher_strikeouts'
  | 'pitcher_hits_allowed'
  | 'pitcher_earned_runs'
  | 'pitcher_outs';

export type OddsMarketKey = string;
export type SupportedOddsMarketKey = string;
export type AlternateOddsMarketKey = string;

export const HITTER_MARKETS: AnalyzableMarketKey[] = [
  'batter_hits', 'batter_total_bases', 'batter_home_runs', 'batter_rbis', 'batter_runs_scored', 'batter_hits_runs_rbis', 'batter_strikeouts',
];

export const PITCHER_MARKETS: AnalyzableMarketKey[] = [
  'pitcher_strikeouts', 'pitcher_hits_allowed', 'pitcher_earned_runs', 'pitcher_outs',
];

export const ALTERNATE_HITTER_MARKETS: string[] = [
  'batter_hits_alternate', 'batter_total_bases_alternate', 'batter_home_runs_alternate', 'batter_rbis_alternate', 'batter_runs_scored_alternate', 'batter_hits_runs_rbis_alternate', 'batter_strikeouts_alternate',
];

export const ALTERNATE_PITCHER_MARKETS: string[] = [
  'pitcher_strikeouts_alternate', 'pitcher_hits_allowed_alternate', 'pitcher_earned_runs_alternate', 'pitcher_outs_alternate',
];

export const MARKET_LABELS: Record<AnalyzableMarketKey, string> = {
  batter_hits: 'Hits',
  batter_total_bases: 'Total Bases',
  batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs',
  batter_runs_scored: 'Runs',
  batter_hits_runs_rbis: 'Hits + Runs + RBIs',
  batter_strikeouts: 'Strikeouts',
  pitcher_strikeouts: 'Pitcher Strikeouts',
  pitcher_hits_allowed: 'Hits Allowed',
  pitcher_earned_runs: 'Earned Runs',
  pitcher_outs: 'Outs Recorded',
};

const DISPLAY_LABELS: Record<string, string> = {
  ...MARKET_LABELS,
  batter_singles: 'Singles', batter_doubles: 'Doubles', batter_triples: 'Triples', batter_walks: 'Walks', batter_stolen_bases: 'Stolen Bases', batter_fantasy_score: 'Batter Fantasy Score',
  pitcher_walks: 'Walks Allowed', pitcher_home_runs_allowed: 'Home Runs Allowed', pitcher_fantasy_score: 'Pitcher Fantasy Score',
};

export interface MarketMetadata {
  sourceMarketKey: string;
  canonicalMarketKey: string;
  label: string;
  isAlternate: boolean;
  isPitcher: boolean;
  historicalAnalysisAvailable: boolean;
}

export function getMarketMetadata(sourceMarketKey: string): MarketMetadata | null {
  const isAlternate = sourceMarketKey.endsWith('_alternate');
  const canonicalMarketKey = isAlternate ? sourceMarketKey.slice(0, -'_alternate'.length) : sourceMarketKey;
  if (!canonicalMarketKey.startsWith('batter_') && !canonicalMarketKey.startsWith('pitcher_')) return null;
  const label = DISPLAY_LABELS[canonicalMarketKey] ?? canonicalMarketKey.replace(/^(batter|pitcher)_/, '').split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  return {
    sourceMarketKey,
    canonicalMarketKey,
    label,
    isAlternate,
    isPitcher: canonicalMarketKey.startsWith('pitcher_'),
    historicalAnalysisAvailable: canonicalMarketKey in MARKET_LABELS || ['batter_doubles', 'batter_triples', 'batter_walks'].includes(canonicalMarketKey),
  };
}

export interface OddsEvent {
  id: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
}

export interface NormalizedProp {
  sport?: 'mlb' | 'nfl' | 'nba';
  player: string;
  playerId?: number | null;
  marketKey: OddsMarketKey;
  sourceMarketKey: SupportedOddsMarketKey;
  isAlternate: boolean;
  historicalAnalysisAvailable: boolean;
  marketLabel: string;
  line: number;
  overOdds: number | null;
  underOdds: number | null;
  sportsbookKey: string;
  sportsbookName: string;
  eventId: string;
  lastUpdate: string;
}
