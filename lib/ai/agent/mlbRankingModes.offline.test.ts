import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PICK_TIERS, classifyPickTier } from './pickTiers';
import type { ResearchCandidateRecord } from './session';
import { parseCandidateSearchConstraints, selectRankedCandidates } from './tools';

const fetchMock = vi.fn(() => { throw new Error('Network forbidden in MLB ranking tests'); });
const modes = [
  ['BEST', 'Best MLB props', 'balanced'],
  ['MOST_LIKELY', 'Most likely MLB props', 'safety'],
  ['BEST_VALUE', 'Best value MLB props', 'value'],
] as const;

function candidate(candidateId: string, overrides: Partial<ResearchCandidateRecord> = {}): ResearchCandidateRecord {
  const probability = overrides.trueProbability ?? 70;
  const odds = overrides.odds ?? -110;
  const payout = odds < 0 ? 100 / -odds : odds / 100;
  const breakEvenProbability = 100 / (1 + payout);
  return {
    candidateId, rank: 1, playerId: 100, teamId: 147, player: `Fixture ${candidateId}`,
    team: 'New York Yankees', opponent: 'Boston Red Sox',
    market: 'Hits', marketKey: 'batter_hits', line: 0.5, direction: 'over',
    book: 'Fixture Book', odds, availableBooks: 3,
    projection: 1.5, projectionUncertainty: 0.6, edge: 1,
    l5Rate: 80, l10Rate: 70, l20Rate: 75, seasonRate: 72,
    researchScore: 88, signalAgreement: 5, signalsAvailable: 6, evidenceCoverage: 95,
    priceFreshness: 'FRESH', priceCurrent: true, trueProbability: probability,
    evPercent: probability * (1 + payout) - 100,
    priceEdgePercent: probability - breakEvenProbability, playerEdgePercent: 8, breakEvenProbability,
    isAlternate: false, dataQuality: 95, trapRisk: 10, qualification: 'WATCH', eliteQualified: false,
    rejectionReasons: [], grade: 'A', priceGrade: 'A', projectedRange: null, bestAlternateLine: null,
    howItLoses: ['Fewer plate appearances or poor contact can keep the hitter below the line.'],
    evidenceBoard: [], outlierDependencePercent: null, position: 'OF',
    modelProbability: 72, historicalHitRate: 70, sampleSize: 20, projectionReliability: 'HIGH',
    valueQualified: true, crossBookThreshold: null, marketMovement: null, outlierAnalysis: null,
    roleContext: { requirement: 'Confirmed batting order', status: 'STABLE', confidence: 'HIGH',
      workloadTrend: 'STABLE', reasons: ['Confirmed in the offline batting order.'] },
    opponentContext: null,
    injuryContext: { playerId: 100, status: 'Active', explicitlyInjured: false },
    weatherContext: null, mlbEligibilityFailures: [],
    mlbEligibilityFacts: { roleKnown: true, statusKnown: true, matchupAvailable: true },
    ...overrides,
  };
}

function tierPool(): ResearchCandidateRecord[] {
  return [
    candidate('nuke', { researchScore: 100, trueProbability: 83, odds: -400, eliteQualified: true, qualification: 'ELITE' }),
    candidate('elite', { researchScore: 92, trueProbability: 90, odds: -800, eliteQualified: true, qualification: 'ELITE' }),
    candidate('sharp', { researchScore: 88, trueProbability: 62, odds: 110 }),
    candidate('edge', { researchScore: 80, trueProbability: 78, odds: -300 }),
    candidate('lean', { researchScore: 68, trueProbability: 54 }),
    candidate('pass', { researchScore: 100, trueProbability: 95, odds: 200,
      priceCurrent: false, priceFreshness: 'STALE', qualification: 'REJECT',
      rejectionReasons: ['Price is stale.'] }),
  ];
}

function select(pool: ResearchCandidateRecord[], query: string) {
  return selectRankedCandidates(pool, query, { sport: 'mlb' });
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  try {
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe('MLB ranking modes with real parser and selector (offline)', () => {
  it.each(modes)('parses %s without enabling Pass inspection or changing the floor', (_mode, query, sort) => {
    expect(parseCandidateSearchConstraints(query, tierPool(), 'mlb')).toMatchObject({
      sport: 'mlb', sort, qualityFloor: 'LEAN', showPasses: false,
    });
  });

  it('preserves all six tier identities and the source records across every mode', () => {
    const pool = tierPool();
    const original = structuredClone(pool);
    const tiers = pool.map(row => classifyPickTier(row, 'mlb').pickTier);
    expect(PICK_TIERS).toEqual(['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS']);
    expect(tiers).toEqual(PICK_TIERS);
    const expectedTiers = new Map(pool.map((row, index) => [row.candidateId, tiers[index]]));

    for (const [, query] of modes) {
      const { selected } = select(pool, query);
      expect(selected).toHaveLength(5);
      expect(new Set(selected.map(row => row.pickTier))).toEqual(new Set(PICK_TIERS.slice(0, -1)));
      expect(selected.some(row => row.candidateId === 'pass' || row.pickTier === 'PASS')).toBe(false);
      for (const row of selected) {
        expect(row.pickTier).toBe(expectedTiers.get(row.candidateId));
        expect(row.researchScore).toBe(pool.find(source => source.candidateId === row.candidateId)!.researchScore);
      }
    }
    expect(select(pool, modes[1][1]).selected[0].candidateId).toBe('elite');
    expect(select(pool, modes[2][1]).selected[0].candidateId).toBe('sharp');
    expect(pool).toEqual(original);
    expect(pool.map(row => classifyPickTier(row, 'mlb').pickTier)).toEqual(tiers);
  });

  it.each(modes)('%s allows explicit Pass inspection only as rejected records', (_mode, query, sort) => {
    const pool = tierPool();
    const inspection = `${query}; show rejected MLB props`;
    expect(parseCandidateSearchConstraints(inspection, pool, 'mlb')).toMatchObject({ sort, showPasses: true });
    const inspected = select(pool, inspection).selected;
    expect(inspected.map(row => [row.candidateId, row.pickTier, row.eliteQualified])).toEqual([
      ['pass', 'PASS', false],
    ]);
    expect(inspected[0].tierRequirementsFailed).toContain('Current verified price');
    expect(select(inspected, query).selected).toEqual([]);
    expect(select(pool, query).selected.every(row => row.pickTier !== 'PASS')).toBe(true);
  });

  it.each([
    ['Only give me Nukes in MLB', 'balanced', ['NUKE']],
    ['Most likely Elite MLB props', 'safety', ['NUKE', 'ELITE']],
    ['Best value Sharp or better MLB props', 'value', ['NUKE', 'ELITE', 'SHARP']],
  ] as const)('honors the existing quality floor for %s', (query, sort, tiers) => {
    const result = select(tierPool(), query);
    expect(result.constraints.sort).toBe(sort);
    expect(new Set(result.selected.map(row => row.pickTier))).toEqual(new Set(tiers));
  });

  it.each(modes)('%s respects an explicit result ceiling', (_mode, query) => {
    const result = select(tierPool(), `${query}; give me 2 picks`);
    expect(result.constraints.maxResults).toBe(2);
    expect(result.selected).toHaveLength(2);
    expect(result.selected.every(row => row.pickTier !== 'PASS')).toBe(true);
  });

  it('BEST keeps the probability/value/risk frontier ahead of a dominated MLB candidate', () => {
    const pool = [
      candidate('dominated', { trueProbability: 65, odds: -175, researchScore: 75,
        dataQuality: 90, trapRisk: 24, playerEdgePercent: 1 }),
      candidate('balanced', { trueProbability: 70, odds: -150, researchScore: 88,
        dataQuality: 94, trapRisk: 12, playerEdgePercent: 6 }),
      candidate('probability', { trueProbability: 80, odds: -300, researchScore: 90,
        dataQuality: 96, trapRisk: 10, playerEdgePercent: 2 }),
      candidate('value', { trueProbability: 60, odds: 100, researchScore: 85,
        dataQuality: 91, trapRisk: 18, playerEdgePercent: 10 }),
    ];
    const best = select(pool, modes[0][1]).selected;
    expect(new Set(best.slice(0, 3).map(row => row.candidateId))).toEqual(new Set(['balanced', 'probability', 'value']));
    expect(best.at(-1)?.candidateId).toBe('dominated');
    expect(select(pool, modes[1][1]).selected[0].candidateId).toBe('probability');
    expect(select(pool, modes[2][1]).selected[0].candidateId).toBe('value');
  });

  it('MOST_LIKELY prioritizes calibrated probability, then EV, then lower trap risk', () => {
    const pool = [
      candidate('high-ev', { trueProbability: 60, odds: 200, modelProbability: 99, historicalHitRate: 100 }),
      candidate('lower-ev', { trueProbability: 80, odds: -300 }),
      candidate('higher-risk', { trueProbability: 80, odds: -200, trapRisk: 20 }),
      candidate('safer', { trueProbability: 80, odds: -200, trapRisk: 5 }),
    ];
    expect(select(pool, modes[1][1]).selected.map(row => row.candidateId)).toEqual([
      'safer', 'higher-risk', 'lower-ev', 'high-ev',
    ]);
  });

  it('BEST_VALUE ranks EV before payout and uses probability and risk to resolve equal value', () => {
    const pool = [
      candidate('payout', { trueProbability: 35, odds: 200 }),
      candidate('lower-probability', { trueProbability: 60, odds: 100 }),
      candidate('higher-risk', { trueProbability: 80, odds: -200, trapRisk: 20 }),
      candidate('safer', { trueProbability: 80, odds: -200, trapRisk: 5 }),
    ];
    for (const row of pool.slice(1)) expect(row.evPercent).toBe(20);
    expect(select(pool, modes[2][1]).selected.map(row => row.candidateId)).toEqual([
      'safer', 'higher-risk', 'lower-probability', 'payout',
    ]);
  });

  it.each(modes)('%s prefers lower trap risk with all other ranking metrics equal', (_mode, query) => {
    const pool = [candidate('riskier', { trapRisk: 20 }), candidate('safer', { trapRisk: 5 })];
    expect(select(pool, query).selected.map(row => row.candidateId)).toEqual(['safer', 'riskier']);
  });

  it.each(modes)('%s cannot rank attractive numbers past the existing publication gates', (_mode, query) => {
    const blocked = [
      candidate('negative-ev', { trueProbability: 60, odds: -200, valueQualified: false }),
      candidate('zero-value', { trueProbability: 50, odds: 100 }),
      candidate('trap', { trapRisk: 100, trueProbability: 95, odds: 200 }),
      candidate('missing-probability', { trueProbability: null }),
      candidate('missing-model', { modelProbability: null }),
      candidate('stale', { priceCurrent: false, priceFreshness: 'STALE' }),
      candidate('short-price', { odds: -901, trueProbability: 99 }),
    ];
    expect(blocked.map(row => classifyPickTier(row, 'mlb').pickTier)).toEqual(blocked.map(() => 'PASS'));
    expect(select(blocked, query).selected).toEqual([]);
    const inspected = select(blocked, `${query}; show rejected MLB props`).selected;
    expect(new Set(inspected.map(row => row.candidateId))).toEqual(new Set(
      blocked.filter(row => row.odds! >= -900).map(row => row.candidateId),
    ));
    expect(inspected.every(row => row.pickTier === 'PASS')).toBe(true);
  });

  it.each(modes.flatMap(([mode, query]) => [NaN, Infinity].map(trueProbability => ({ mode, query, trueProbability }))))(
    '$mode must reject calibrated probability $trueProbability', ({ query, trueProbability }) => {
    const invalid = candidate('invalid-probability', { trueProbability, modelProbability: 72,
      evPercent: 10, priceEdgePercent: 5 });
    expect(classifyPickTier(invalid, 'mlb').pickTier).toBe('PASS');
    expect(select([invalid], query).selected).toEqual([]);
  });

  it.each(['trueProbability', 'modelProbability'] as const)('validates %s in percentage units with an inclusive upper bound', field => {
    for (const probability of [NaN, Infinity, -Infinity, -1, 0, 100.1]) {
      const invalid = candidate('invalid-bound', { [field]: probability, evPercent: 10, priceEdgePercent: 5 });
      expect(classifyPickTier(invalid, 'mlb').pickTier).toBe('PASS');
      for (const [, query] of modes) expect(select([invalid], query).selected).toEqual([]);
    }
    for (const probability of [0.1, 72, 100]) {
      const valid = candidate('valid-bound', { [field]: probability, evPercent: 10, priceEdgePercent: 5 });
      expect(classifyPickTier(valid, 'mlb').pickTier).toBe('SHARP');
      for (const [, query] of modes) expect(select([valid], query).selected).toHaveLength(1);
    }
  });

  it.each(['edge', 'evPercent', 'priceEdgePercent'] as const)('rejects non-finite %s in every ranking mode', field => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const invalid = candidate('invalid-value', { [field]: value });
      expect(classifyPickTier(invalid, 'mlb').pickTier).toBe('PASS');
      for (const [, query] of modes) expect(select([invalid], query).selected).toEqual([]);
    }
  });

  it('does not apply MLB numeric validity requirements to NFL candidates', () => {
    const row = candidate('nfl-unchanged', { trueProbability: Infinity, modelProbability: Infinity,
      edge: Infinity, evPercent: Infinity, priceEdgePercent: Infinity });
    expect(classifyPickTier(row, 'mlb').pickTier).toBe('PASS');
    const nfl = classifyPickTier(row, 'nfl');
    expect(nfl.pickTier).toBe('SHARP');
    expect(nfl.tierRequirementsPassed.some(requirement => requirement.startsWith('MLB'))).toBe(false);
    expect(nfl.tierRequirementsFailed.some(requirement => requirement.startsWith('MLB'))).toBe(false);
  });
});