import { analyzePickCandidate, ELITE_THRESHOLDS, type EliteCandidateInput, type EliteResearchAnalysis } from '../ai/eliteResearchFilter';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import { buildNFLRoleContext, type NFLRoleContext } from './roleContext';
import { evaluateNFLPlayerAvailability, isNFLPlayerAvailabilityKnown, nflAvailabilityRisk, type NFLInjuryContext } from './injuries';
import type { NFLWeatherContext } from './weather';
import type { NFLGameLogEntry } from './types';
import { buildNFLHistory } from './history';
import type { NFLHistorySample } from './rollingHistory';

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
  historySample?: NFLHistorySample;
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
  const history = candidate.line == null ? null : buildNFLHistory(candidate.logs, candidate.market, candidate.line, candidate.direction, candidate.historySample);
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
    historicalRates: history ? [history.windows.rolling.hitRate, history.windows.l10.hitRate, history.windows.l5.hitRate] : [],
    sampleSize: history?.windows.rolling.decisions ?? values.length,
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
  const analysis = analyzePickCandidate(buildNFLEliteCandidate(candidate));
  const availability = evaluateNFLPlayerAvailability(candidate.injuryContext);
  const injuryRisk = nflAvailabilityRisk(candidate.injuryContext);
  const historyRisk = candidate.historySample?.supplemented ? candidate.historySample.confidence === 'LIMITED' ? 10 : 5 : 0;
  const additionalRisks = [
    ...(injuryRisk.points && injuryRisk.reason ? [{ reason: injuryRisk.reason, points: injuryRisk.points }] : []),
    ...(historyRisk ? [{ reason: 'Cross-season sample carries reduced confidence in older role/context evidence.', points: historyRisk }] : []),
  ];
  const trapRisk = Math.min(100, analysis.trapRisk + additionalRisks.reduce((total, risk) => total + risk.points, 0));
  const rejectedReasons = [...analysis.rejectedReasons,
    ...(!availability.eligible && availability.reason ? [availability.reason] : []),
    ...(trapRisk > ELITE_THRESHOLDS.trapRisk ? ['NFL availability/history risk exceeds the Elite trap threshold.'] : []),
  ];
  const passes = availability.eligible && trapRisk <= ELITE_THRESHOLDS.trapRisk;
  return { ...analysis, trapRisk, trapComponents: [...analysis.trapComponents, ...additionalRisks],
    trapReasons: [...analysis.trapReasons, ...additionalRisks.map((risk) => risk.reason)], rejectedReasons,
    riskFactors: [...analysis.riskFactors, ...additionalRisks.map((risk) => risk.reason), ...(!availability.eligible && availability.reason ? [availability.reason] : [])],
    eliteQualified: analysis.eliteQualified && passes, researchQualified: analysis.researchQualified && passes,
    qualification: passes ? analysis.qualification : 'REJECT', whyQualified: passes ? analysis.whyQualified : [],
  };
}
