import { describe, expect, it } from 'vitest';
import { rankNBARecommendations } from './ranking';
import type { ResearchCandidateRecord } from '../../ai/agent/session';

function row(id: string, probability: number, evPercent: number, quality: number, reliability: string, status: string, role: string, trapRisk: number) {
  return { candidateId: id, trueProbability: probability, evPercent, researchScore: quality, dataQuality: 95, trapRisk, odds: -110,
    priceEdgePercent: 5, nbaPrediction: { reliability, contextEvidence: [{ id: 'availability.current', kind: 'FACT', state: status === 'AVAILABLE' ? 'AVAILABLE' : 'UNKNOWN',
      metric: 'reportedAvailability', value: status, units: null, detail: 'Fixture status', direction: 'NEUTRAL', directionBasis: null,
      markets: ['points'], reliability: 'MEDIUM', reliabilityReasons: [], sourceRefs: [], sample: null, missingReasons: [], dependencyIds: [], correlationGroup: 'availability' }] },
    roleContext: { status: role } } as unknown as ResearchCandidateRecord;
}

describe('NBA evidence-aware ranking', () => {
  const candidates = [row('likely', 70, 1, 90, 'MEDIUM', 'UNKNOWN', 'MIXED', 10), row('value', 65, 10, 90, 'HIGH', 'AVAILABLE', 'STARTER', 4)];
  it('orders most-likely by V1 model probability then certainty/evidence', () => {
    expect(rankNBARecommendations(candidates, 'MOST_LIKELY').map((candidate) => candidate.candidateId)).toEqual(['likely', 'value']);
  });
  it('orders best-value by push-aware EV before probability while retaining evidence and risk tie-breaks', () => {
    expect(rankNBARecommendations(candidates, 'BEST_VALUE').map((candidate) => candidate.candidateId)).toEqual(['value', 'likely']);
  });
  it('uses evidence quality first for BEST and does not add or force candidates', () => {
    expect(rankNBARecommendations(candidates, 'BEST').map((candidate) => candidate.candidateId)).toEqual(['likely', 'value']);
    expect(rankNBARecommendations([], 'BEST')).toEqual([]);
  });
});
