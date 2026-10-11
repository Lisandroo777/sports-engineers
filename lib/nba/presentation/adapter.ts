import {
  PICK_PRESENTATION_SCHEMA_VERSION,
  type AuthoritativeTierDecision,
  type PickPresentation,
  type PickPresentationInput,
  type PickPresentationInputSet,
  type PresentedPick,
} from './types';

function copyTierDecision(decision: AuthoritativeTierDecision | null | undefined): AuthoritativeTierDecision | null {
  if (!decision) return null;
  return {
    ...decision,
    tierRequirementsPassed: [...decision.tierRequirementsPassed],
    tierRequirementsFailed: [...decision.tierRequirementsFailed],
  };
}

function dispositionFor(input: PickPresentationInput, evidence: readonly unknown[]): PresentedPick['disposition'] {
  if (!input.tierDecision || evidence.length === 0) return 'RESEARCH_ONLY';
  if (input.tierDecision.pickTier === 'PASS') return 'PASS';
  if (input.americanOdds == null) return 'UNPRICED';
  if (input.tierDecision.pickTier === 'LEAN') return 'LEAN';
  return 'RECOMMENDED';
}

function copySubject(input: PickPresentationInput['subject']): PickPresentationInput['subject'] {
  if (input.kind === 'PLAYER_PROP') {
    return { ...input, player: { ...input.player }, market: { ...input.market } };
  }
  return { ...input, home: { ...input.home }, away: { ...input.away }, market: { ...input.market } };
}

function presentPick(input: PickPresentationInput): PresentedPick {
  const researchEvidence = [...(input.researchEvidence ?? [])].map((entry) => ({ ...entry }));
  const missing = [...(input.missing ?? [])];
  if (input.americanOdds == null && !missing.includes('americanOdds')) missing.push('americanOdds');
  if (researchEvidence.length === 0 && !missing.includes('researchEvidence')) missing.push('researchEvidence');
  if (!input.tierDecision && !missing.includes('tierDecision')) missing.push('tierDecision');
  if (input.seasonPhase == null && !missing.includes('seasonPhase')) missing.push('seasonPhase');

  return {
    candidateId: input.candidateId,
    subject: copySubject(input.subject),
    tierDecision: copyTierDecision(input.tierDecision),
    disposition: dispositionFor(input, researchEvidence),
    pricing: {
      state: input.americanOdds == null ? 'UNPRICED' : 'PRICED',
      sportsbook: input.sportsbook ?? null,
      americanOdds: input.americanOdds ?? null,
      quoteStatus: input.quoteStatus ?? null,
    },
    metrics: {
      trueProbability: input.trueProbability ?? null,
      modelProbability: input.modelProbability ?? null,
      evPercent: input.evPercent ?? null,
      researchScore: input.researchScore ?? null,
      tierScore: input.tierDecision?.tierScore ?? null,
    },
    season: {
      phase: input.seasonPhase ?? null,
      certainty: input.seasonPhaseCertainty ?? (input.seasonPhase == null ? 'MISSING' : 'VERIFIED'),
      reason: input.seasonPhaseReason ?? null,
    },
    researchEvidence,
    missing,
  };
}

export function buildPickPresentation(input: PickPresentationInputSet): PickPresentation {
  const sourcePicks = input.picks.filter((pick) => input.includePasses || pick.tierDecision?.pickTier !== 'PASS');
  const byId = new Map(sourcePicks.map((pick) => [pick.candidateId, pick]));
  const upstreamOrder = input.upstreamRankings?.[input.requestedSort];
  const orderedPicks = upstreamOrder == null
    ? sourcePicks
    : [
      ...upstreamOrder.flatMap((candidateId) => {
        const pick = byId.get(candidateId);
        if (!pick) return [];
        byId.delete(candidateId);
        return [pick];
      }),
      ...sourcePicks.filter((pick) => byId.has(pick.candidateId)),
    ];
  const picks = orderedPicks.map(presentPick);
  const hasPricedRecommendation = picks.some((pick) => pick.pricing.state === 'PRICED'
    && pick.tierDecision != null
    && ['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN'].includes(pick.tierDecision.pickTier)
    && pick.researchEvidence.length > 0);
  const hasResearchOnly = picks.some((pick) => pick.disposition === 'RESEARCH_ONLY');

  return {
    schemaVersion: PICK_PRESENTATION_SCHEMA_VERSION,
    outcome: hasPricedRecommendation ? 'PICKS_AVAILABLE' : hasResearchOnly ? 'RESEARCH_ONLY' : 'NO_QUALIFIED_PICKS',
    requestedSort: input.requestedSort,
    sortStatus: upstreamOrder == null ? 'SOURCE_ORDER' : 'UPSTREAM_ORDER',
    picks,
  };
}