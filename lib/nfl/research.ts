import { analyzePickCandidate, type EliteCandidateInput, type EliteResearchAnalysis } from '../ai/eliteResearchFilter';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import { buildNFLRoleContext, type NFLRoleContext } from './roleContext';
import { isNFLPlayerAvailabilityKnown, type NFLInjuryContext } from './injuries';
import type { NFLWeatherContext } from './weather';
import type { NFLGameLogEntry } from './types';

export interface NFLResearchCandidate {
  candidateId: string;
  playerId: number;
  player: string;
  market: NFLAnalyzableMarketKey;
  line: number | null;
  direction: 'over' | 'under';
  projection: number | null;
  projectionUncertainty: number | null;
  logs: NFLGameLogEntry[];
  matchupAvailable: boolean;
  oddsAmerican: number | null;
  lastUpdatedAt: string | null;
  isAlternate: boolean;
  marketSupport: 'full' | 'partial' | 'unsupported';
  /** Real workload/role verdict from lib/nfl/roleContext.ts. Computed by the caller if omitted. */
  roleContext?: NFLRoleContext;
  injuryContext?: NFLInjuryContext | null;
  weatherContext?: NFLWeatherContext | null;
}

/**
 * NFL has no connected snap share, route participation, target share, depth chart, or opponent
 * personnel data. ESPN per-game attempts and targets can support usageOpportunity when the role
 * context is evidenced; opponentPersonnel and projectionAgreement remain unsupported.
 */
export const NFL_UNSUPPORTED_SIGNALS: Array<keyof typeof import('../ai/eliteResearchFilter').ELITE_RESEARCH_WEIGHTS> = [
  'opponentPersonnel', 'projectionAgreement',
];

/** Converts real NFL logs into the shared Elite input without inventing projection, role, matchup, odds, or timestamp values. */
export function buildNFLEliteCandidate(candidate: NFLResearchCandidate): EliteCandidateInput {
  const values = candidate.logs
    .filter((log) => log.result != null)
    .map((log) => getNFLMarketHistoricalValue(candidate.market, log.stats))
    .filter((value): value is number => value != null);
  const roleContext = candidate.roleContext ?? buildNFLRoleContext(candidate.logs, candidate.market);
  // Real workload evidence now backs both signals: roleKnown/usageAvailable are true only when the
  // market's own opportunity trend is genuinely STABLE or CHANGING (a real, evidenced verdict) —
  // never when it's UNAVAILABLE/UNCERTAIN, so ROLE_CONTEXT_UNAVAILABLE stays meaningful.
  const roleEvidenced = roleContext.status === 'STABLE' || roleContext.status === 'CHANGING';
  return {
    candidateId: candidate.candidateId,
    sport: 'nfl',
    playerId: candidate.playerId,
    player: candidate.player,
    market: candidate.market,
    line: candidate.line,
    direction: candidate.direction,
    isAlternate: candidate.isAlternate,
    projection: candidate.projection,
    projectionUncertainty: candidate.projectionUncertainty,
    historicalRates: candidate.line == null ? [] : values.map((value) => candidate.direction === 'over' ? value > candidate.line! ? 100 : 0 : value < candidate.line! ? 100 : 0),
    sampleSize: values.length,
    oddsAmerican: candidate.oddsAmerican,
    marketFairProbability: null,
    matchupAvailable: candidate.matchupAvailable,
    usageAvailable: roleEvidenced,
    roleKnown: roleEvidenced,
    gameContextAvailable: candidate.logs.length > 0 && (candidate.weatherContext?.sourceStatus === 'AVAILABLE' || candidate.weatherContext?.sourceStatus === 'NOT_APPLICABLE'),
    opponentPersonnelAvailable: false,
    marketConfirmationAvailable: candidate.line != null,
    statusKnown: isNFLPlayerAvailabilityKnown(candidate.injuryContext),
    lastUpdatedAt: candidate.lastUpdatedAt,
    requiredMarketSupported: candidate.marketSupport !== 'unsupported',
    marketSupport: candidate.marketSupport === 'full' ? 'SUPPORTED' : candidate.marketSupport === 'partial' ? 'PARTIAL' : 'UNAVAILABLE',
    unsupportedSignals: NFL_UNSUPPORTED_SIGNALS,
  };
}

/** Fail-closed NFL candidate analysis; the central engine remains the only qualification authority. */
export function analyzeNFLCandidate(candidate: NFLResearchCandidate): EliteResearchAnalysis {
  return analyzePickCandidate(buildNFLEliteCandidate(candidate));
}
