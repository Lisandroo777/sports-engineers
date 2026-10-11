export type NFLResearchMode = 'STANDARD' | 'DEEP';
export type NFLRankingIntent = 'BEST' | 'MOST_LIKELY' | 'BEST_VALUE';

export function parseNFLResearchIntent(query: string) {
  const explicitDeep = /\b(?:deep\s+research|deeply\s+research|deep\s+dive|research\s+(?:this\s+)?deeply|full\s+(?:deep\s+)?research|in[-\s]depth\s+(?:research|analysis)|comprehensive\s+(?:research|analysis)|thorough(?:ly)?\s+(?:research|analysis))\b/i.test(query);
  const researchMode: NFLResearchMode = explicitDeep ? 'DEEP' : 'STANDARD';
  const lowThreshold = /\b(?:low[-\s]threshold|low(?:er)?\s+lines?|low(?:er)?\s+thresholds?)\b/i.test(query);
  const rankingIntent: NFLRankingIntent = /\bbest\s+value|\bvalue\s+(?:plays|props|picks)\b/i.test(query) ? 'BEST_VALUE'
    : lowThreshold || /\b(?:safest|safe|safer|most\s+likely|high\s+probability)\b/i.test(query) ? 'MOST_LIKELY' : 'BEST';
  return { researchMode, rankingIntent, lowThreshold };
}

export function matchesNFLLowThreshold(candidate: { marketKey: string; direction: string; line: number | null; projection: number | null }) {
  const volumeMarkets = new Set(['player_reception_yds', 'player_receptions', 'player_pass_yds', 'player_pass_completions', 'player_pass_attempts', 'player_rush_yds', 'player_rush_attempts']);
  return volumeMarkets.has(candidate.marketKey) && candidate.direction === 'over' && candidate.line != null && candidate.line >= 0
    && candidate.projection != null && Number.isFinite(candidate.projection) && candidate.projection > 0
    && candidate.line / candidate.projection <= 0.8;
}