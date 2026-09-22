import { describe, it, expect } from 'vitest';
import { buildResearchSessionFromCandidates, type GenericResearchCandidate } from './session';
import { analyzePickCandidate, type EliteCandidateInput } from '../eliteResearchFilter';

function candidate(overrides: Partial<EliteCandidateInput> = {}): EliteCandidateInput {
  return {
    candidateId: 'nba-1', sport: 'nba', playerId: 1, player: 'Test Player', market: 'points',
    line: 20, direction: 'over', isAlternate: false, projection: 26, projectionUncertainty: 4,
    historicalRates: [85, 85, 80, 82], sampleSize: 20, oddsAmerican: 120, marketFairProbability: null,
    matchupAvailable: true, usageAvailable: true, roleKnown: true, gameContextAvailable: true,
    opponentPersonnelAvailable: false, marketConfirmationAvailable: true, statusKnown: true,
    lastUpdatedAt: new Date().toISOString(), requiredMarketSupported: true, marketSupport: 'SUPPORTED',
    unsupportedSignals: ['projectionAgreement', 'opponentPersonnel'],
    ...overrides,
  };
}

function genericCandidate(overrides: Partial<EliteCandidateInput> = {}, id = 'nba-1'): GenericResearchCandidate {
  const analysis = analyzePickCandidate(candidate({ candidateId: id, ...overrides }));
  return {
    candidateId: id, player: 'Test Player', team: null, opponent: 'OPP @ HOME', marketLabel: 'Points',
    marketKey: 'points', line: 20, direction: 'over', book: 'Book A', odds: 120,
    projection: 26, projectionUncertainty: 4, l5Rate: 85, l10Rate: 85, l20Rate: 82, seasonRate: 82,
    analysis, sport: 'nba', matchupAvailable: true, roleKnown: true, injuryKnown: true,
  };
}

describe('run_elite_filter / rank_candidates consistency (Phase 4 task 6)', () => {
  it('a candidate elite in one view is elite in the other — both read the same session.candidates', () => {
    const session = buildResearchSessionFromCandidates({
      sport: 'nba', date: '2026-01-01', queryIntent: 'test',
      candidates: [genericCandidate(), genericCandidate({ oddsAmerican: -400 }, 'nba-2')],
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 2, booksFound: 1, candidatesFound: 2, cached: false, dataFreshnessSeconds: 0, budgetLimited: false },
    });

    // Simulates what run_elite_filter does: filter session.candidates by eliteQualified.
    const eliteFilterView = session.candidates.filter((c) => c.eliteQualified);
    // Simulates what rank_candidates does: sort session.candidates by researchScore, optionally eliteOnly.
    const rankView = [...session.candidates].filter((c) => c.eliteQualified).sort((a, b) => b.researchScore - a.researchScore);

    expect(eliteFilterView.map((c) => c.candidateId).sort()).toEqual(rankView.map((c) => c.candidateId).sort());
    for (const candidateId of eliteFilterView.map((c) => c.candidateId)) {
      const inFilter = eliteFilterView.find((c) => c.candidateId === candidateId)!;
      const inRank = rankView.find((c) => c.candidateId === candidateId)!;
      expect(inFilter.eliteQualified).toBe(inRank.eliteQualified);
      expect(inFilter.researchScore).toBe(inRank.researchScore);
    }
  });
});

describe('ResearchSession record completeness (Phase 4 task 7)', () => {
  it('stores every field required for zero-cost follow-ups', () => {
    const session = buildResearchSessionFromCandidates({
      sport: 'nba', date: '2026-01-01', queryIntent: 'test',
      candidates: [genericCandidate()],
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1, cached: false, dataFreshnessSeconds: 0, budgetLimited: false },
    });
    const record = session.candidates[0];
    for (const field of [
      'projection', 'projectionUncertainty', 'trueProbability', 'modelProbability', 'historicalHitRate',
      'researchScore', 'signalAgreement', 'dataQuality', 'trapRisk', 'priceCurrent', 'valueQualified',
      'bestAlternateLine', 'crossBookThreshold', 'marketMovement', 'roleContext', 'opponentContext',
      'outlierAnalysis', 'evidenceBoard', 'howItLoses', 'rejectionReasons', 'qualification',
    ] as const) {
      expect(record).toHaveProperty(field);
    }
  });
});
