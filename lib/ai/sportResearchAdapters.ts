export type SupportedSport = 'nba' | 'mlb' | 'nfl' | 'soccer' | 'tennis';
export type MarketSupport = 'SUPPORTED' | 'DERIVED' | 'PARTIAL' | 'UNAVAILABLE';

export interface SportResearchAdapter {
  sport: SupportedSport;
  label: string;
  requiredData: readonly string[];
  optionalData: readonly string[];
  supportedSignals: readonly string[];
  marketSupport: readonly string[];
  unavailableMarkets: readonly string[];
}

const SHARED_SIGNALS = ['long-term baseline', 'recent form', 'medium-term form', 'context-adjusted projection', 'secondary confirmation'] as const;

export const SPORT_RESEARCH_ADAPTERS: Record<SupportedSport, SportResearchAdapter> = {
  nba: {
    sport: 'nba',
    label: 'NBA',
    requiredData: ['player projection', 'game context', 'expected minutes or starting status', 'opponent matchup'],
    optionalData: ['usage rate', 'shot attempts', 'rebound opportunities', 'potential assists', 'pace', 'rest', 'teammate availability', 'blowout risk'],
    supportedSignals: [...SHARED_SIGNALS, 'minutes/usage opportunity', 'opponent defense', 'role stability'],
    marketSupport: ['points', 'rebounds', 'assists', 'pra', 'pr', 'pa', 'ra', '3pm', 'steals', 'blocks', 'turnovers'],
    unavailableMarkets: [],
  },
  mlb: {
    sport: 'mlb',
    label: 'MLB',
    requiredData: ['player projection', 'game context', 'historical game logs', 'opponent matchup'],
    optionalData: ['plate appearances', 'batting order', 'starting status', 'handedness', 'pitcher arsenal', 'weather', 'park', 'bullpen', 'pitch count'],
    supportedSignals: [...SHARED_SIGNALS, 'plate appearances/expected innings', 'starting pitcher', 'handedness matchup', 'park/weather context'],
    marketSupport: ['hits', 'total bases', 'home runs', 'rbis', 'runs', 'hits + runs + rbis', 'strikeouts', 'hits allowed', 'earned runs', 'outs recorded'],
    unavailableMarkets: [],
  },
  nfl: {
    sport: 'nfl',
    label: 'NFL',
    requiredData: ['player projection', 'game context', 'historical game logs', 'opponent matchup'],
    optionalData: ['snap share', 'route participation', 'targets', 'carries', 'passing attempts', 'red-zone usage', 'status', 'weather', 'team pace', 'game script'],
    supportedSignals: [...SHARED_SIGNALS, 'snap/route/volume opportunity', 'opponent defense', 'role stability'],
    marketSupport: ['passing', 'rushing', 'receiving', 'touchdowns', 'defensive tackles', 'defensive sacks', 'defensive interceptions'],
    unavailableMarkets: ['kicking points', 'field goals'],
  },
  soccer: {
    sport: 'soccer',
    label: 'MLS / Soccer',
    requiredData: ['player projection', 'game context', 'expected minutes or starting status', 'opponent matchup'],
    optionalData: ['position', 'shots', 'shots on target', 'goals', 'assists', 'chances created', 'passes', 'tackles', 'set-piece role', 'formation', 'rest'],
    supportedSignals: [...SHARED_SIGNALS, 'expected minutes/role', 'team attacking strength', 'opponent defensive strength'],
    marketSupport: ['shots', 'shots on target', 'goals', 'assists', 'passes', 'tackles', 'fouls', 'goalkeeper saves'],
    unavailableMarkets: [],
  },
  tennis: {
    sport: 'tennis',
    label: 'Tennis',
    requiredData: ['player projection', 'match context', 'surface', 'opponent matchup'],
    optionalData: ['ranking', 'surface performance', 'serve performance', 'return performance', 'aces', 'double faults', 'break points', 'hold percentage', 'break percentage', 'head-to-head', 'match format', 'rest', 'injury status'],
    supportedSignals: [...SHARED_SIGNALS, 'surface matchup', 'serve/return matchup', 'expected sets', 'player availability'],
    marketSupport: ['aces', 'double faults', 'games', 'sets', 'breaks', 'match winner'],
    unavailableMarkets: [],
  },
};

export function getSportResearchAdapter(sport: string): SportResearchAdapter | null {
  const normalized = sport.toLowerCase() as SupportedSport;
  return SPORT_RESEARCH_ADAPTERS[normalized] ?? null;
}

export function normalizeSport(sport: string): SupportedSport | null {
  const normalized = sport.toLowerCase();
  if (normalized === 'mls' || normalized === 'soccer' || normalized === 'football') return normalized === 'football' ? 'nfl' : 'soccer';
  return normalized in SPORT_RESEARCH_ADAPTERS ? normalized as SupportedSport : null;
}
