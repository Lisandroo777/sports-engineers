import { describe, it, expect } from 'vitest';
import { buildNFLFailureModes } from './failureModes';
import type { NFLRoleContext } from './roleContext';

function roleCtx(overrides: Partial<NFLRoleContext> = {}): NFLRoleContext {
  return {
    requirement: 'CRITICAL', status: 'STABLE', confidence: 'MEDIUM',
    workloadTrend: 'WORKLOAD_STABLE',
    stability: { status: 'STABLE', games: 10, recentMean: 10, earlierSeasonMean: 10, relativeChange: 0, evidence: [] },
    opportunity: {
      available: true, statKey: 'rushingAttempts', l3: { games: 3, mean: 10 }, l5: { games: 5, mean: 10 },
      l10: { games: 10, mean: 10 }, season: { games: 10, mean: 10 }, trend: 'WORKLOAD_STABLE', volatility: 0,
    },
    evidence: [], unavailableEvidence: [], reasons: [],
    ...overrides,
  };
}

describe('NFL How It Loses (deterministic, no invented text)', () => {
  it('flags declining rushing/receiving workload when detected', () => {
    const modes = buildNFLFailureModes({
      rawEdge: 3, sampleSize: 12, projection: 80, projectionUncertainty: 15,
      roleContext: roleCtx({ workloadTrend: 'WORKLOAD_DECREASE', reasons: ['Falling rushingAttempts: L3 avg diverges 20%+ from season avg.'] }),
    });
    expect(modes.some((m) => /declining|falling/i.test(m))).toBe(true);
  });

  it('flags uncertain role context when status is UNCERTAIN/UNAVAILABLE', () => {
    const modes = buildNFLFailureModes({
      rawEdge: 2, sampleSize: 10, projection: 60, projectionUncertainty: 10,
      roleContext: roleCtx({ status: 'UNCERTAIN' }),
    });
    expect(modes.some((m) => /role\/opportunity context is uncertain/i.test(m))).toBe(true);
  });

  it('flags small sample size', () => {
    const modes = buildNFLFailureModes({
      rawEdge: 2, sampleSize: 4, projection: 60, projectionUncertainty: 10, roleContext: roleCtx(),
    });
    expect(modes.some((m) => /small sample size/i.test(m))).toBe(true);
  });

  it('always returns at least one bullet, never empty', () => {
    const modes = buildNFLFailureModes({
      rawEdge: 10, sampleSize: 20, projection: 100, projectionUncertainty: 2, roleContext: roleCtx(),
    });
    expect(modes.length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces cross-season, uncertainty, availability, partial matchup and proxy caveats', () => {
    const modes = buildNFLFailureModes({ rawEdge: 46.81, sampleSize: 10, projection: 301.31, projectionUncertainty: 76.22, roleContext: roleCtx(),
      historySample: { supplemented: true, currentObservations: 3, previousObservations: 7, reasons: ['Historical registered position unavailable'] } as never,
      injuryContext: { player: { availabilityDesignation: 'EXPECTED_AVAILABLE' } } as never,
      opponentContext: { status: 'PARTIAL' } as never,
    });
    expect(modes.join(' ')).toMatch(/3 current-season.*7 older/);
    expect(modes.join(' ')).toContain('76.2'); expect(modes.join(' ')).toContain('not officially confirmed');
    expect(modes.join(' ')).toContain('Opponent evidence is partial'); expect(modes.join(' ')).toContain('recorded workload');
    expect(modes.join(' ')).not.toContain('No specific statistical');
  });
});
