import { ELITE_THRESHOLDS } from '../eliteResearchFilter';
import type { ResearchCandidateRecord } from './session';
import { getMarketMetadata } from '../../odds/types';

export const PICK_TIERS = ['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS'] as const;
export type PickTier = typeof PICK_TIERS[number];

export interface PickTierDecision {
  pickTier: PickTier;
  tierReason: string;
  tierScore: number;
  tierRequirementsPassed: string[];
  tierRequirementsFailed: string[];
}

const TIER_ORDER: Record<PickTier, number> = { NUKE: 5, ELITE: 4, SHARP: 3, EDGE: 2, LEAN: 1, PASS: 0 };

export function qualityFloorFromQuery(query: string): PickTier {
  if (/\b(?:only\s+(?:(?:give|show)\s+(?:me\s+)?)?(?:the\s+)?nukes?|nukes?\s+only)\b/i.test(query)) return 'NUKE';
  if (/\b(?:safest|most\s+likely)\s+(?:nuke|elite|sharp)\b/i.test(query)) {
    const requestedTier = query.match(/\b(?:safest|most\s+likely)\s+(nuke|elite|sharp)\b/i)?.[1].toUpperCase();
    if (requestedTier === 'NUKE' || requestedTier === 'ELITE' || requestedTier === 'SHARP') return requestedTier;
  }
  if (/\b(?:elite\s+or\s+better|elite\s+and\s+above|elite\s+quality\s+or\s+better)\b/i.test(query)) return 'ELITE';
  if (/\b(?:sharp\s+or\s+better|sharp\s+and\s+above|sharp\s+quality\s+or\s+better)\b/i.test(query)) return 'SHARP';
  return 'LEAN';
}

export function queryRequestsPasses(query: string): boolean {
  return /\b(?:show\s+(?:me\s+)?(?:the\s+)?(?:rejected|pass(?:es)?\s+plays?)|show\s+passes|why\s+didn.t\s+.+\s+qualify|why\s+didn.t\s+this\s+prop\s+qualify)\b/i.test(query);
}

export function tierMeetsFloor(tier: PickTier, floor: PickTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[floor];
}

export function classifyPickTier(candidate: ResearchCandidateRecord, sport?: string): PickTierDecision {
  const profile = candidate.nflResearchProfile;
  const isNFL = sport === 'nfl' || profile != null;
  const isMLB = sport === 'mlb';
  const mlbEligibilityFailures = isMLB ? [...(candidate.mlbEligibilityFailures ?? [])] : [];
  if (isMLB && candidate.mlbContext?.playerInjuries.status === 'AVAILABLE'
    && candidate.mlbContext.playerInjuries.value.some((player) => player.playerId === candidate.playerId && player.explicitlyInjured === true)) {
    mlbEligibilityFailures.push('MLB player explicitly injured');
  }
  const gates = profile?.hardGates;
  const nflGateFailures = gates ? Object.entries(gates).filter(([, gate]) => !gate.passed).map(([key, gate]) => gate.reason ?? `${key} failed.`) : [];
  const profileEvidenceReady = !profile || Boolean(gates
    && profile.evidence.verdict === 'PLAY'
    && profile.evidence.counterCaseReviewed
    && profile.evidence.conflictStatus !== 'UNRESOLVED'
    && nflGateFailures.length === 0);
  const sufficientHistory = (candidate.sampleSize ?? candidate.nflHistory?.gamesUsed ?? 0) >= 5;
  const requirements: Array<[string, boolean]> = [
    ['Current verified price', candidate.priceCurrent && ['LIVE', 'FRESH'].includes(candidate.priceFreshness)],
    ['Official price floor', candidate.odds != null && candidate.odds >= -900],
    ['Supported primary market', !candidate.isAlternate && (!isNFL || !gates || gates.requiredDataPresent.passed)],
    ['At least five usable history observations', sufficientHistory],
    ['Projection supports the selected side', candidate.edge != null && candidate.edge > 0],
    ['Positive current probability-to-price value', candidate.valueQualified && candidate.trueProbability != null
      && candidate.evPercent != null && candidate.evPercent > 0 && candidate.priceEdgePercent != null && candidate.priceEdgePercent > 0],
    ['Minimum research quality', candidate.dataQuality >= 70],
    [`Risk within the existing ${ELITE_THRESHOLDS.trapRisk}-point ceiling`, candidate.trapRisk <= ELITE_THRESHOLDS.trapRisk],
    ['NFL hard gates, availability, role, evidence, and counter-case pass', profileEvidenceReady],
    ...(isMLB ? [
      ['MLB source eligibility has no explicit rejection', mlbEligibilityFailures.length === 0],
      ['MLB market has supported historical analysis', getMarketMetadata(candidate.marketKey)?.historicalAnalysisAvailable === true],
      ['MLB model probability is valid', candidate.modelProbability != null && Number.isFinite(candidate.modelProbability)
        && candidate.modelProbability > 0 && candidate.modelProbability <= 100],
      ['MLB calibrated probability is valid', candidate.trueProbability != null && Number.isFinite(candidate.trueProbability)
        && candidate.trueProbability > 0 && candidate.trueProbability <= 100],
      ['MLB edge and EV are finite', [candidate.edge, candidate.evPercent, candidate.priceEdgePercent]
        .every(value => value != null && Number.isFinite(value))],
    ] as Array<[string, boolean]> : []),
  ];
  const tierRequirementsPassed = requirements.filter(([, passed]) => passed).map(([name]) => name);
  const tierRequirementsFailed = [
    ...requirements.filter(([, passed]) => !passed).map(([name]) => name),
    ...nflGateFailures,
    ...new Set(mlbEligibilityFailures),
    ...(isNFL && profile && !profile.evidence.counterCaseReviewed ? ['Counter-case was not reviewed.'] : []),
    ...(isNFL && profile?.evidence.conflictStatus === 'UNRESOLVED' ? ['Material evidence conflict is unresolved.'] : []),
  ];
  const tierScore = Number.isFinite(candidate.researchScore) ? candidate.researchScore : 0;
  const nukeRequirements: Array<[string, boolean]> = [
    ['Validated research score is exactly 100/100', tierScore === 100],
    ['DeepSide probability is at least 80%', candidate.trueProbability != null && candidate.trueProbability >= 80],
    ['Best current American price is -400 or better', candidate.odds != null && candidate.odds >= -400],
    ['Positive EV and price edge', candidate.evPercent != null && candidate.evPercent > 0 && candidate.priceEdgePercent != null && candidate.priceEdgePercent > 0],
    ['Price is current and verified', candidate.priceCurrent && ['LIVE', 'FRESH'].includes(candidate.priceFreshness) && (!profile || gates?.currentPrice.passed === true)],
    ['Availability is verified acceptable', isNFL ? gates?.majorInjuryResolved.passed === true : candidate.injuryContext != null],
    ['Required research and history are complete', candidate.dataQuality >= ELITE_THRESHOLDS.dataQuality && (candidate.sampleSize ?? candidate.nflHistory?.gamesUsed ?? 0) >= ELITE_THRESHOLDS.minSampleSize],
    ['No material source conflict is unresolved', !profile || profile.evidence.conflictStatus !== 'UNRESOLVED'],
    ['Counter-case review is documented', profile ? profile.evidence.counterCaseReviewed : (candidate.howItLoses?.length ?? 0) > 0],
    [`Trap risk stays within the existing ${ELITE_THRESHOLDS.trapRisk}-point ceiling`, candidate.trapRisk <= ELITE_THRESHOLDS.trapRisk],
    ['Existing Elite qualification passes', candidate.eliteQualified && (!profile || profile.productionEliteQualified)],
    ['Role evidence is stable for a NUKE', isNFL ? profile?.role.value?.roleStatus === 'STABLE' : candidate.roleContext?.status === 'STABLE'],
  ];
  const failedNukeRequirements = nukeRequirements.filter(([, passed]) => !passed).map(([name]) => name);
  if (tierRequirementsFailed.length) return {
    pickTier: 'PASS', tierScore, tierRequirementsPassed,
    tierRequirementsFailed: [...tierRequirementsFailed, ...failedNukeRequirements.map((requirement) => `NUKE: ${requirement}`)],
    tierReason: `Not recommendable: ${tierRequirementsFailed[0]}.`,
  };

  if (!failedNukeRequirements.length) return {
    pickTier: 'NUKE', tierScore, tierRequirementsPassed: [...tierRequirementsPassed, ...nukeRequirements.map(([name]) => name)],
    tierRequirementsFailed: [], tierReason: 'All NUKE requirements passed, including the existing Elite qualification.',
  };

  if (candidate.eliteQualified && (!profile || profile.productionEliteQualified)) return {
    pickTier: 'ELITE', tierScore, tierRequirementsPassed,
    tierRequirementsFailed: failedNukeRequirements,
    tierReason: 'Passed all publication gates and the existing Elite qualification; one or more rare NUKE requirements were not met.',
  };
  if (tierScore >= ELITE_THRESHOLDS.researchScore) return {
    pickTier: 'SHARP', tierScore, tierRequirementsPassed: [...tierRequirementsPassed, 'Research score is in the established 85+ Strong band.'],
    tierRequirementsFailed: ['Existing Elite qualification was not met.', ...failedNukeRequirements],
    tierReason: 'Strong research score (85+) with current positive value and every publication gate passed.',
  };
  if (tierScore >= 75) return {
    pickTier: 'EDGE', tierScore, tierRequirementsPassed: [...tierRequirementsPassed, 'Research score is in the established 75-84 Watch band.'],
    tierRequirementsFailed: ['Existing Elite qualification was not met.', ...failedNukeRequirements],
    tierReason: 'Watch-band research score (75-84) with current positive value and every publication gate passed.',
  };
  return {
    pickTier: 'LEAN', tierScore, tierRequirementsPassed: [...tierRequirementsPassed, 'Directional evidence and every publication gate passed.'],
    tierRequirementsFailed: ['Research score is below the established 75 Watch band.', ...failedNukeRequirements],
    tierReason: 'Directional research case with current positive value and every publication gate passed; confidence is below the Edge band.',
  };
}