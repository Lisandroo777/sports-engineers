export type NBAMarketCategory = 'Team' | 'Scoring & Shooting' | 'Combined Stats' | 'Other Player Stats' | 'Quarter Props';
export type NBAMarketConnection = 'Connected' | 'Partial' | 'Not connected';
export interface NBAResearchMarket {
  id: string;
  label: string;
  category: NBAMarketCategory;
  connection: NBAMarketConnection;
  candidateKey: string | null;
}

const market = (id: string, label: string, category: NBAMarketCategory, connection: NBAMarketConnection,
  candidateKey: string | null = null): NBAResearchMarket => ({ id, label, category, connection, candidateKey });

export const NBA_RESEARCH_MARKETS: NBAResearchMarket[] = [
  market('h2h', 'Moneyline', 'Team', 'Partial', 'MONEYLINE'),
  market('spreads', 'Spread', 'Team', 'Partial', 'SPREAD'),
  market('totals', 'Game Total', 'Team', 'Partial', 'TOTAL'),
  market('team_totals', 'Team Total', 'Team', 'Partial', 'TEAM_TOTAL'),
  market('alternate_spreads', 'Alternate Spread', 'Team', 'Partial', 'alternate_spreads'),
  market('alternate_totals', 'Alternate Total', 'Team', 'Partial', 'alternate_totals'),
  market('alternate_team_totals', 'Alternate Team Total', 'Team', 'Partial', 'alternate_team_totals'),
  market('player_points', 'Points', 'Scoring & Shooting', 'Connected', 'points'),
  market('player_threes', 'Threes', 'Scoring & Shooting', 'Partial', '3pm'),
  market('player_field_goals', 'Field Goals Made', 'Scoring & Shooting', 'Partial', 'player_field_goals'),
  market('field_goals_attempted', 'Field Goals Attempted', 'Scoring & Shooting', 'Not connected'),
  market('three_pointers_attempted', '3-Pointers Attempted', 'Scoring & Shooting', 'Not connected'),
  market('two_pointers_made', '2-Pointers Made', 'Scoring & Shooting', 'Not connected'),
  market('dunks', 'Dunks', 'Scoring & Shooting', 'Not connected'),
  market('player_frees_made', 'Free Throws Made', 'Scoring & Shooting', 'Partial', 'player_frees_made'),
  market('player_frees_attempts', 'Free Throws Attempted', 'Scoring & Shooting', 'Partial', 'player_frees_attempts'),
  market('player_points_rebounds_assists', 'PRA', 'Combined Stats', 'Partial', 'pra'),
  market('player_points_rebounds', 'Points + Rebounds', 'Combined Stats', 'Partial', 'pr'),
  market('player_points_assists', 'Points + Assists', 'Combined Stats', 'Partial', 'pa'),
  market('player_rebounds_assists', 'Rebounds + Assists', 'Combined Stats', 'Partial', 'ra'),
  market('player_blocks_steals', 'Blocks + Steals', 'Combined Stats', 'Partial', 'player_blocks_steals'),
  market('player_rebounds', 'Rebounds', 'Other Player Stats', 'Connected', 'rebounds'),
  market('player_assists', 'Assists', 'Other Player Stats', 'Connected', 'assists'),
  market('player_steals', 'Steals', 'Other Player Stats', 'Partial', 'steals'),
  market('player_blocks', 'Blocks', 'Other Player Stats', 'Partial', 'blocks'),
  market('player_turnovers', 'Turnovers', 'Other Player Stats', 'Partial', 'turnovers'),
  market('player_double_double', 'Double-Double', 'Other Player Stats', 'Partial', 'player_double_double'),
  market('player_triple_double', 'Triple-Double', 'Other Player Stats', 'Partial', 'player_triple_double'),
  market('player_fantasy_points', 'Fantasy Score', 'Other Player Stats', 'Partial', 'player_fantasy_points'),
  market('defensive_rebounds', 'Defensive Rebounds', 'Other Player Stats', 'Not connected'),
  market('offensive_rebounds', 'Offensive Rebounds', 'Other Player Stats', 'Not connected'),
  market('personal_fouls', 'Personal Fouls', 'Other Player Stats', 'Not connected'),
  market('h2h_q1', '1Q Moneyline', 'Quarter Props', 'Partial', 'h2h_q1'),
  market('spreads_q1', '1Q Spread', 'Quarter Props', 'Partial', 'spreads_q1'),
  market('totals_q1', '1Q Total', 'Quarter Props', 'Partial', 'totals_q1'),
  market('player_points_q1', '1Q Points', 'Quarter Props', 'Partial', 'player_points_q1'),
  market('points_q2', '2Q Points', 'Quarter Props', 'Not connected'),
  market('points_q3', '3Q Points', 'Quarter Props', 'Not connected'),
  market('points_q4', '4Q Points', 'Quarter Props', 'Not connected'),
  market('player_rebounds_q1', '1Q Rebounds', 'Quarter Props', 'Partial', 'player_rebounds_q1'),
  market('player_assists_q1', '1Q Assists', 'Quarter Props', 'Partial', 'player_assists_q1'),
];

export const NBA_MARKET_CATEGORIES = [...new Set(NBA_RESEARCH_MARKETS.map(entry => entry.category))];
export function nbaMarketAvailability(entry: NBAResearchMarket): string {
  if (entry.id.endsWith('_q1') || entry.id.startsWith('alternate_')) return 'Partial: verified US/US2 quotes and exact-line research path connected. Exact period history required; missing data stays unavailable. Research-only, without probability or EV.';
  if (entry.connection === 'Connected') return 'Live activation and historical/model research connected. Quotes, sufficient samples and unchanged publication gates are required.';
  if (entry.id === 'player_fantasy_points') return 'Partial: documented DFS-only quote parsing connected when cached. Provider-specific fantasy scoring contract and prediction model unavailable.';
  if (entry.connection === 'Partial' && entry.candidateKey === entry.id) return 'Partial: cached provider quotes and completed-game historical evaluation connected. No prediction model or qualified picks for this market. Quotes are not included in the current seven-market activation request.';
  if (entry.category === 'Team' && entry.connection === 'Partial') return 'Partial: provider quotes and team model connected. Validated publication/readiness requirements still apply.';
  if (entry.connection === 'Partial') return 'Partial: historical/model research connected when matching quotes are cached. Quotes are not included in the current seven-market activation request.';
  if (['field_goals_attempted', 'three_pointers_attempted', 'two_pointers_made', 'defensive_rebounds', 'offensive_rebounds', 'personal_fouls'].includes(entry.id)) return 'Unsupported for live research: historical evaluator exists when exact ESPN stats are supplied, but this quote market is not documented by the connected provider. No substitute market used.';
  if (entry.id === 'dunks' || ['points_q2', 'points_q3', 'points_q4'].includes(entry.id)) return 'Unsupported: no documented quote contract or connected exact dunk/quarter historical data. Full-game points are never substituted.';
  return 'Unsupported in the current research pipeline. Provider may offer quotes, but the required market/period evaluation is not connected. No substitute market used.';
}
export interface NBAResearchFilter {
  marketIds: string[] | null;
  sides: Array<'over' | 'under'>;
  ranking: 'BEST' | 'MOST_LIKELY' | 'BEST_VALUE';
}

export const DEFAULT_NBA_RESEARCH_FILTER: NBAResearchFilter = {
  marketIds: null, sides: ['over', 'under'], ranking: 'BEST',
};

export function normalizeNBAResearchFilter(value: unknown): NBAResearchFilter {
  if (!value || typeof value !== 'object') return { ...DEFAULT_NBA_RESEARCH_FILTER };
  const input = value as Partial<NBAResearchFilter>;
  return {
    marketIds: Array.isArray(input.marketIds)
      ? [...new Set(input.marketIds.filter(id => NBA_RESEARCH_MARKETS.some(entry => entry.id === id)))] : null,
    sides: Array.isArray(input.sides) ? [...new Set(input.sides.filter(side => side === 'over' || side === 'under'))] : ['over', 'under'],
    ranking: input.ranking === 'MOST_LIKELY' || input.ranking === 'BEST_VALUE' ? input.ranking : 'BEST',
  };
}

export function matchesNBAResearchFilter(filter: NBAResearchFilter, candidateKey: string, side: string): boolean {
  const connected = NBA_RESEARCH_MARKETS.filter(entry => entry.candidateKey != null
    && (filter.marketIds == null || filter.marketIds.includes(entry.id)));
  if (!connected.some(entry => entry.candidateKey === candidateKey || entry.id === candidateKey)) return false;
  return !['over', 'under'].includes(side.toLowerCase()) || filter.sides.includes(side.toLowerCase() as 'over' | 'under');
}

export function nbaFilterRankingQuery(query: string, filter: NBAResearchFilter): string {
  const base = query.replace(/\bbest\s+value|\bmost\s+likely|\bhighest\s+probability|\bsafest\b/gi, '');
  return `${filter.ranking === 'BEST_VALUE' ? 'Best value' : filter.ranking === 'MOST_LIKELY' ? 'Most likely' : 'Best'} ${base}`;
}