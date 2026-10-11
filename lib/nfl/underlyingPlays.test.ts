import { describe, expect, it } from 'vitest';
import { groupNFLUnderlyingPlays } from './underlyingPlays';
import { selectRankedCandidates } from '../ai/agent/tools';
import type { ResearchCandidateRecord } from '../ai/agent/session';
import { toClientResult } from '../ai/agent/runner';
const injuryTimestamp = new Date().toISOString();
const freshInjury = { player: { player: 'Tyler Shough', playerId: 1, teamId: 18, team: 'New Orleans Saints', position: 'QB',
  injury: null, status: 'Active', availabilityDesignation: 'CONFIRMED_AVAILABLE' as const, updatedAt: injuryTimestamp, sourceStatus: 'CURRENT' as const,
  evidence: null, affectedRole: 'PLAYER' as const, missingFields: [] }, team: 'New Orleans Saints', teammateAbsences: [], opponentAbsences: [],
  sourceStatus: { provider: 'ESPN' as const, status: 'CURRENT' as const }, lastUpdated: injuryTimestamp, missingFields: [] };

function row(overrides: Partial<ResearchCandidateRecord> = {}): ResearchCandidateRecord {
  const profile = {
    hardGates: Object.fromEntries(['currentPrice', 'majorInjuryResolved', 'roleClear', 'requiredDataPresent', 'currentLineReEvaluated',
      'footballThesisExplained', 'sourceConflictsResolved', 'projectionAdvantage', 'priceValueRemains', 'evidenceQuality']
      .map((key) => [key, { passed: true, reason: null }])),
    productionEliteQualified: true,
    evidence: { verdict: 'PLAY', counterCaseReviewed: true, conflictStatus: 'NONE', for: [{}], against: [{}], unresolvedRisks: [] },
    role: { value: { roleStatus: 'STABLE' } },
  } as never;
  return { candidateId: 'fanduel', playerId: 1, gameId: 'game', player: 'Tyler Shough', team: 'New Orleans Saints', opponent: 'Atlanta Falcons', market: 'Passing Yards',
    marketKey: 'player_pass_yds', direction: 'over', line: 254.5, book: 'FanDuel', odds: -113, eliteQualified: true, isAlternate: false,
    priceCurrent: true, priceFreshness: 'LIVE', valueQualified: true, trueProbability: 70, evPercent: 12, priceEdgePercent: 8,
    sampleSize: 10, edge: 2, dataQuality: 95, trapRisk: 10, researchScore: 86, rejectionReasons: [], injuryContext: freshInjury, nflResearchProfile: profile, ...overrides } as ResearchCandidateRecord;
}

describe('NFL underlying plays and best price', () => {
  it('collapses equivalent book rows and preserves the other prices', () => {
    const rows = [row({ candidateId: 'mgm', book: 'BetMGM', odds: -115 }), row()];
    const result = groupNFLUnderlyingPlays(rows);
    expect(result).toHaveLength(1); expect(result[0].book).toBe('FanDuel'); expect(result[0].odds).toBe(-113);
    expect(result[0].availablePrices?.map((price) => price.odds)).toEqual([-113, -115]); expect(result[0].availableBooks).toBe(2);
  });
  it('does not merge different lines, sides, players, or games', () => {
    expect(groupNFLUnderlyingPlays([row(), row({ line: 259.5 }), row({ direction: 'under' }), row({ playerId: 2 }), row({ gameId: 'other' })])).toHaveLength(5);
  });
  it('best price is selected before the result ceiling', () => {
    const result = selectRankedCandidates([row({ candidateId: 'mgm', book: 'BetMGM', odds: -115 }), row()], 'Best NFL passing props Falcons vs Saints', { maxResults: 1 });
    expect(result.selected).toHaveLength(1); expect(result.selected[0].book).toBe('FanDuel'); expect(result.selected[0].availablePrices).toHaveLength(2);
  });
  it('a better-valued non-Elite price remains eligible at its lower quality tier', () => {
    const result = selectRankedCandidates([row(), row({ candidateId: 'reject', book: 'Other', odds: 110, eliteQualified: false })], 'Best NFL passing props');
    expect(result.selected[0].book).toBe('Other'); expect(result.selected[0].eliteQualified).toBe(false);
    expect(result.selected[0].pickTier).toBe('SHARP');
    expect(result.selected[0].availablePrices?.find((price) => price.sportsbook === 'Other')?.eliteQualified).toBe(false);
  });
  it('keeps explicit sportsbook and odds constraints authoritative', () => {
    const rows = [row(), row({ candidateId: 'mgm', book: 'BetMGM', odds: -115 })];
    expect(selectRankedCandidates(rows, 'Best NFL passing props BetMGM').selected[0].book).toBe('BetMGM');
    expect(selectRankedCandidates(rows, 'Best NFL passing props under -114').selected[0].availablePrices).toHaveLength(1);
  });

  it('replaces inherited sportsbook-row rank gaps after final sorting and limiting', () => {
    const gaps = [1, 2, 4, 9, 11, 12, 13, 15, 17, 18, 19];
    const candidates = gaps.map((rank, index) => row({ candidateId: String(rank), rank, line: 84.5 + index, researchScore: 100 - index }));
    const selected = selectRankedCandidates(candidates, 'Best NFL props').selected;
    expect(selected.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(selected.map((candidate) => candidate.candidateId)).toEqual(candidates.map((candidate) => candidate.candidateId));
    expect(selected.map((candidate) => candidate.researchScore)).toEqual(candidates.map((candidate) => candidate.researchScore));
    expect(selectRankedCandidates(candidates, 'Best NFL props', { maxResults: 3 }).selected.map((candidate) => candidate.rank)).toEqual([1, 2, 3]);
  });

  it('the final response boundary independently preserves sequential grouped ranks', () => {
    const result = toClientResult({ reply: '', results: [row({ rank: 18 }), row({ candidateId: 'other', line: 259.5, rank: 19 })],
      closestMisses: [], meta: { sport: 'nfl' }, toolTrace: [], researchSessionId: null }, false);
    expect(result.results.map((candidate) => (candidate as ResearchCandidateRecord).rank)).toEqual([1, 2]);
    expect(result.results.map((candidate) => (candidate as ResearchCandidateRecord).line)).toEqual([254.5, 259.5]);
  });
});