import type { NBAGameStatMap } from './types';

export type NBAAnalyzableMarket = 'points' | 'rebounds' | 'assists' | 'pra' | 'pr' | 'pa' | 'ra' | '3pm' | 'steals' | 'blocks' | 'turnovers' | 'minutes';
export type NBAHistoricalSupport = 'SUPPORTED' | 'DERIVED' | 'PARTIAL' | 'UNAVAILABLE';

export const NBA_MARKET_LABELS: Record<NBAAnalyzableMarket, string> = {
  points: 'Points', rebounds: 'Rebounds', assists: 'Assists', pra: 'Points + Rebounds + Assists', pr: 'Points + Rebounds', pa: 'Points + Assists', ra: 'Rebounds + Assists', '3pm': 'Three-Pointers Made', steals: 'Steals', blocks: 'Blocks', turnovers: 'Turnovers', minutes: 'Minutes',
};

export const NBA_MARKET_SUPPORT: Record<NBAAnalyzableMarket, NBAHistoricalSupport> = {
  points: 'SUPPORTED', rebounds: 'SUPPORTED', assists: 'SUPPORTED', pra: 'DERIVED', pr: 'DERIVED', pa: 'DERIVED', ra: 'DERIVED', '3pm': 'SUPPORTED', steals: 'SUPPORTED', blocks: 'SUPPORTED', turnovers: 'SUPPORTED', minutes: 'PARTIAL',
};

export function getNBAHistoricalValue(market: NBAAnalyzableMarket, stats: NBAGameStatMap): number | null {
  const threePointMade = stats['threePointFieldGoalsMade-threePointFieldGoalsAttempted'];
  switch (market) {
    case 'points': return stats.points ?? null;
    case 'rebounds': return stats.totalRebounds ?? null;
    case 'assists': return stats.assists ?? null;
    case 'pra': return stats.points != null && stats.totalRebounds != null && stats.assists != null ? stats.points + stats.totalRebounds + stats.assists : null;
    case 'pr': return stats.points != null && stats.totalRebounds != null ? stats.points + stats.totalRebounds : null;
    case 'pa': return stats.points != null && stats.assists != null ? stats.points + stats.assists : null;
    case 'ra': return stats.totalRebounds != null && stats.assists != null ? stats.totalRebounds + stats.assists : null;
    case '3pm': return threePointMade ?? null;
    case 'steals': return stats.steals ?? null;
    case 'blocks': return stats.blocks ?? null;
    case 'turnovers': return stats.turnovers ?? null;
    case 'minutes': return stats.minutes ?? null;
  }
}

export function getNBAHistoricalSupport(market: NBAAnalyzableMarket): NBAHistoricalSupport {
  return NBA_MARKET_SUPPORT[market];
}
