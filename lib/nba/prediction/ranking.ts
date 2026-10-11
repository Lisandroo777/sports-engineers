import type { ResearchCandidateRecord } from '../../ai/agent/session';

export type NBARankingIntent = 'BEST' | 'MOST_LIKELY' | 'BEST_VALUE' | 'PAYOUT';

function reliability(candidate: ResearchCandidateRecord): number {
  const value = candidate.nbaPrediction?.reliability ?? candidate.projectionReliability;
  return value === 'HIGH' ? 3 : value === 'MEDIUM' ? 2 : value === 'LOW' ? 1 : 0;
}

function availability(candidate: ResearchCandidateRecord): number {
  const evidence = candidate.nbaPrediction?.contextEvidence.find((entry) => entry.id === 'availability.current');
  if (evidence?.state === 'AVAILABLE' && evidence.value === 'AVAILABLE') return 3;
  if (evidence?.state === 'AVAILABLE' && evidence.value === 'PROBABLE') return 2;
  if (evidence?.state === 'AVAILABLE' && evidence.value === 'QUESTIONABLE') return 1;
  return 0;
}

function roleCertainty(candidate: ResearchCandidateRecord): number {
  const status = candidate.roleContext?.status;
  return status === 'STARTER' || status === 'BENCH' ? 2 : status === 'MIXED' ? 1 : 0;
}

const by = (get: (candidate: ResearchCandidateRecord) => number | null, direction: 'desc' | 'asc' = 'desc') =>
  (first: ResearchCandidateRecord, second: ResearchCandidateRecord) => {
    const a = get(first) ?? (direction === 'desc' ? -Infinity : Infinity);
    const b = get(second) ?? (direction === 'desc' ? -Infinity : Infinity);
    return direction === 'desc' ? b - a : a - b;
  };

export function rankNBARecommendations(candidates: ResearchCandidateRecord[], intent: NBARankingIntent): ResearchCandidateRecord[] {
  const ranked = [...candidates];
  const quality = by((candidate) => candidate.researchScore);
  const probability = by((candidate) => candidate.trueProbability);
  const ev = by((candidate) => candidate.evPercent);
  const reliabilityRank = by(reliability);
  const availabilityRank = by(availability);
  const roleRank = by(roleCertainty);
  const trapRisk = by((candidate) => candidate.trapRisk, 'asc');
  const price = by((candidate) => candidate.odds);
  const comparisons = intent === 'MOST_LIKELY' ? [probability, reliabilityRank, quality, ev, availabilityRank, roleRank, trapRisk]
    : intent === 'BEST_VALUE' ? [ev, quality, probability, reliabilityRank, availabilityRank, roleRank, trapRisk]
      : intent === 'PAYOUT' ? [price, quality, probability, ev, reliabilityRank, availabilityRank, roleRank, trapRisk]
        : [quality, probability, ev, reliabilityRank, availabilityRank, roleRank, trapRisk];
  return ranked.sort((first, second) => {
    for (const compare of comparisons) {
      const result = compare(first, second);
      if (result !== 0) return result;
    }
    return first.candidateId.localeCompare(second.candidateId);
  });
}
