import { describe, expect, it } from 'vitest';
import { parseCandidateSearchConstraints, selectRankedCandidates } from './tools';
import type { ResearchCandidateRecord } from './session';
import { classifyPickTier, qualityFloorFromQuery } from './pickTiers';

const gateNames = ['currentPrice', 'majorInjuryResolved', 'roleClear', 'requiredDataPresent', 'currentLineReEvaluated',
  'footballThesisExplained', 'sourceConflictsResolved', 'projectionAdvantage', 'priceValueRemains', 'evidenceQuality'] as const;

function candidate(overrides: Partial<ResearchCandidateRecord> = {}): ResearchCandidateRecord {
  const eliteQualified = overrides.eliteQualified ?? false;
  const profile = {
    hardGates: Object.fromEntries(gateNames.map((name) => [name, { passed: true, reason: null }])),
    productionEliteQualified: eliteQualified,
    evidence: { verdict: 'PLAY', counterCaseReviewed: true, conflictStatus: 'NONE', for: [{}], against: [{}], unresolvedRisks: [] },
    role: { value: { roleStatus: 'STABLE' } },
  } as never;
  return {
    candidateId: 'candidate', rank: 1, playerId: 1, teamId: 1, player: 'Test Player', team: 'Kansas City Chiefs', opponent: 'Las Vegas Raiders',
    market: 'Passing Yards', marketKey: 'player_pass_yds', line: 245.5, direction: 'over', book: 'Book A', odds: -200,
    availableBooks: 3, projection: 280, projectionUncertainty: 20, edge: 2, l5Rate: 60, l10Rate: 65, l20Rate: null, seasonRate: 63,
    researchScore: 90, signalAgreement: 5, signalsAvailable: 6, evidenceCoverage: 95, priceFreshness: 'LIVE', priceCurrent: true,
    trueProbability: 75, evPercent: 10, priceEdgePercent: 8, playerEdgePercent: 9, breakEvenProbability: 66.7,
    isAlternate: false, dataQuality: 95, trapRisk: 10, qualification: eliteQualified ? 'ELITE' : 'WATCH', eliteQualified, rejectionReasons: [],
    grade: 'A', priceGrade: 'A', projectedRange: null, bestAlternateLine: null, howItLoses: ['Volume can fall if game script changes.'], evidenceBoard: [],
    outlierDependencePercent: null, position: 'qb', modelProbability: 77, historicalHitRate: 65, sampleSize: 10, projectionReliability: 'HIGH',
    valueQualified: true, crossBookThreshold: null, marketMovement: null, outlierAnalysis: null, roleContext: { status: 'STABLE' } as never,
    opponentContext: null, injuryContext: null, weatherContext: null,
    ...overrides,
    nflResearchProfile: overrides.nflResearchProfile ?? profile,
  } as ResearchCandidateRecord;
}

describe('deterministic pick tiers', () => {
  it.each([
    ['99 score, 95% probability, -110', { researchScore: 99, trueProbability: 95, odds: -110 }],
    ['100 score below 80% probability', { researchScore: 100, trueProbability: 79.9 }],
    ['100 score at -450', { researchScore: 100, trueProbability: 90, odds: -450 }],
    ['100 score with negative value', { researchScore: 100, trueProbability: 90, odds: -200, valueQualified: false, evPercent: -1, priceEdgePercent: -0.5 }],
    ['100 score with unresolved conflict', { researchScore: 100, trueProbability: 90, odds: -200, nflResearchProfile: {
      ...candidate().nflResearchProfile, evidence: { verdict: 'PASS', counterCaseReviewed: true, conflictStatus: 'UNRESOLVED', for: [{}], against: [{}], unresolvedRisks: ['Conflicting reports'] },
      hardGates: { ...candidate().nflResearchProfile!.hardGates, sourceConflictsResolved: { passed: false, reason: 'Conflicting reports' } },
    } as never }],
    ['100 score with stale price', { researchScore: 100, trueProbability: 90, odds: -200, priceCurrent: false, priceFreshness: 'STALE' }],
    ['-401 is worse than the NUKE price floor', { researchScore: 100, trueProbability: 90, odds: -401 }],
  ] as Array<[string, Partial<ResearchCandidateRecord>]>)('%s cannot qualify as NUKE', (_label, overrides) => {
    expect(classifyPickTier(candidate({ eliteQualified: true, ...overrides })).pickTier).not.toBe('NUKE');
  });

  it.each([-400, -110, 100, 150])('allows qualifying price %s when all NUKE requirements pass', (odds) => {
    expect(classifyPickTier(candidate({ researchScore: 100, trueProbability: 90, odds, evPercent: 15, priceEdgePercent: 12, eliteQualified: true, howItLoses: ['Game pace may slow.'] })).pickTier).toBe('NUKE');
  });

  it('assigns each recommendation band by existing score boundaries and keeps failed gates PASS', () => {
    expect(classifyPickTier(candidate({ researchScore: 91, trueProbability: 79, eliteQualified: true })).pickTier).toBe('ELITE');
    expect(classifyPickTier(candidate({ researchScore: 85 })).pickTier).toBe('SHARP');
    expect(classifyPickTier(candidate({ researchScore: 84 })).pickTier).toBe('EDGE');
    expect(classifyPickTier(candidate({ researchScore: 74 })).pickTier).toBe('LEAN');
    const stale = classifyPickTier(candidate({ researchScore: 100, odds: -450, nflResearchProfile: {
      ...candidate().nflResearchProfile, hardGates: { ...candidate().nflResearchProfile!.hardGates, currentPrice: { passed: false, reason: 'Stale' } },
    } as never }));
    expect(stale.pickTier).toBe('PASS');
    expect(stale.tierRequirementsFailed).toContain('NUKE: Price is current and verified');
    expect(stale.tierRequirementsFailed).toContain('NUKE: Best current American price is -400 or better');
  });

  it('parses quality floors without changing the requested ranking intent', () => {
    expect(qualityFloorFromQuery('Only give me Nukes')).toBe('NUKE');
    expect(qualityFloorFromQuery('Give me Elite or better')).toBe('ELITE');
    expect(qualityFloorFromQuery('Best value Sharp or better')).toBe('SHARP');
    expect(qualityFloorFromQuery('Show me everything you like')).toBe('LEAN');
  });

  it('keeps tier identity fixed while BEST, MOST LIKELY, and BEST VALUE reorder one pool', () => {
    const pool = [
      candidate({ candidateId: 'nuke', player: 'Player Nuke', line: 240.5, researchScore: 100, trueProbability: 83, evPercent: 8, priceEdgePercent: 6, odds: -150, eliteQualified: true }),
      candidate({ candidateId: 'elite', player: 'Player Elite', line: 241.5, researchScore: 92, trueProbability: 90, evPercent: 2, priceEdgePercent: 1, eliteQualified: true }),
      candidate({ candidateId: 'sharp', player: 'Player Sharp', line: 242.5, researchScore: 88, trueProbability: 62, evPercent: 24, priceEdgePercent: 18 }),
      candidate({ candidateId: 'edge', player: 'Player Edge', line: 243.5, researchScore: 80, trueProbability: 78, evPercent: 5, priceEdgePercent: 4 }),
      candidate({ candidateId: 'lean', player: 'Player Lean', line: 244.5, researchScore: 68, trueProbability: 54, evPercent: 3, priceEdgePercent: 2 }),
      candidate({ candidateId: 'pass', player: 'Player Pass', line: 245.5, researchScore: 99, trueProbability: 90, evPercent: 20, priceEdgePercent: 15, priceCurrent: false, priceFreshness: 'STALE' }),
    ];
    const tiersBefore = new Map(pool.map((row) => [row.candidateId, classifyPickTier(row, 'nfl').pickTier]));
    const best = selectRankedCandidates(pool, 'Best NFL props', { sport: 'nfl' }).selected;
    const mostLikely = selectRankedCandidates(pool, 'Safest NFL props', { sport: 'nfl' }).selected;
    const bestValue = selectRankedCandidates(pool, 'Best value NFL props', { sport: 'nfl' }).selected;
    expect(new Set(best.map((row) => row.pickTier))).toEqual(new Set(['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN']));
    expect(mostLikely[0].candidateId).toBe('elite');
    expect(bestValue[0].candidateId).toBe('sharp');
    for (const rows of [best, mostLikely, bestValue]) {
      expect(rows.every((row) => row.pickTier === tiersBefore.get(row.candidateId))).toBe(true);
      expect(rows.some((row) => row.candidateId === 'pass')).toBe(false);
    }
    const rejectedQuery = 'Show rejected plays';
    expect(parseCandidateSearchConstraints(rejectedQuery, pool, 'nfl').showPasses).toBe(true);
    expect(classifyPickTier(pool.find((row) => row.candidateId === 'pass')!, 'nfl').pickTier).toBe('PASS');
    expect(selectRankedCandidates(pool, rejectedQuery, { sport: 'nfl' }).selected.map((row) => row.candidateId)).toContain('pass');
  });

  it('applies explicit floors and result ceilings without changing the underlying tier', () => {
    const pool = [
      candidate({ candidateId: 'nuke', player: 'Player Nuke', line: 240.5, researchScore: 100, trueProbability: 85, evPercent: 8, priceEdgePercent: 6, odds: -150, eliteQualified: true }),
      candidate({ candidateId: 'elite', player: 'Player Elite', line: 241.5, researchScore: 92, trueProbability: 86, evPercent: 2, priceEdgePercent: 1, eliteQualified: true }),
      candidate({ candidateId: 'sharp', player: 'Player Sharp', line: 242.5, researchScore: 88, trueProbability: 62, evPercent: 24, priceEdgePercent: 18 }),
      candidate({ candidateId: 'edge', player: 'Player Edge', line: 243.5, researchScore: 80, trueProbability: 78, evPercent: 5, priceEdgePercent: 4 }),
      candidate({ candidateId: 'lean', player: 'Player Lean', line: 244.5, researchScore: 68, trueProbability: 54, evPercent: 3, priceEdgePercent: 2 }),
    ];
    const nukeOnly = selectRankedCandidates(pool, 'Only give me Nukes', { sport: 'nfl' }).selected;
    const eliteOrBetter = selectRankedCandidates(pool, 'Give me Elite or better', { sport: 'nfl' }).selected;
    const sharpValue = selectRankedCandidates(pool, 'Give me the best value Sharp or better', { sport: 'nfl' }).selected;
    const safestElite = selectRankedCandidates(pool, 'Give me the safest Elite plays', { sport: 'nfl' }).selected;
    const topThree = selectRankedCandidates(pool, 'Give me the best 3 plays', { sport: 'nfl' }).selected;

    expect(nukeOnly.map((row) => row.pickTier)).toEqual(['NUKE']);
    expect(new Set(eliteOrBetter.map((row) => row.pickTier))).toEqual(new Set(['NUKE', 'ELITE']));
    expect(sharpValue.every((row) => ['NUKE', 'ELITE', 'SHARP'].includes(row.pickTier!))).toBe(true);
    expect(sharpValue[0].candidateId).toBe('sharp');
    expect(safestElite.every((row) => ['NUKE', 'ELITE'].includes(row.pickTier!))).toBe(true);
    expect(safestElite[0].candidateId).toBe('elite');
    expect(topThree).toHaveLength(3);
    expect(topThree.every((row) => row.pickTier !== 'PASS')).toBe(true);
  });
});
