import { getMLBPitcherSeasonStats } from '../mlb/pitcherStats';
import type { MLBProbablePitcher } from '../mlb/types';

export interface MatchupSignal {
  available: boolean;
  opposingPitcher: MLBProbablePitcher | null;
  qualityScore: number | null; // 0-100, higher = more favorable for the evaluated side
}

const LEAGUE_AVERAGE_ERA = 4.0;
const LEAGUE_AVERAGE_HR9 = 1.2;

/** Deterministic, documented heuristic: NOT an xwOBA/barrel-rate model. Only uses real season ERA/HR9 for batter offensive props. */
export async function buildMatchupSignal(opposingPitcherId: number | null, canonicalMarketKey: string, side: 'over' | 'under'): Promise<MatchupSignal> {
  const isBatterOffense = ['batter_hits', 'batter_total_bases', 'batter_home_runs', 'batter_runs_scored', 'batter_rbis', 'batter_hits_runs_rbis'].includes(canonicalMarketKey);
  if (!opposingPitcherId || !isBatterOffense) {
    return { available: false, opposingPitcher: null, qualityScore: null };
  }

  try {
    const pitcher = await getMLBPitcherSeasonStats(opposingPitcherId);
    if (pitcher.era == null) return { available: false, opposingPitcher: pitcher, qualityScore: null };

    const eraFactor = (pitcher.era - LEAGUE_AVERAGE_ERA) / LEAGUE_AVERAGE_ERA;
    const hr9Factor = pitcher.hrPer9 != null ? (pitcher.hrPer9 - LEAGUE_AVERAGE_HR9) / LEAGUE_AVERAGE_HR9 : 0;
    const favorability = (eraFactor * 0.6 + hr9Factor * 0.4);
    const raw = 50 + favorability * 40;
    const scoreForOver = Math.max(0, Math.min(100, raw));
    return { available: true, opposingPitcher: pitcher, qualityScore: side === 'over' ? scoreForOver : 100 - scoreForOver };
  } catch {
    return { available: false, opposingPitcher: null, qualityScore: null };
  }
}
