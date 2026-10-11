import { describe, expect, it } from 'vitest';
import { buildNFLProjectionExplanation } from './opportunityProjection';
import { NFL_OPPORTUNITY_DATA_AUDIT } from './opportunityDataAudit';
import { projectNFLMarket } from './projection';
import { buildNFLRoleContext } from './roleContext';
import { buildNFLFailureModes } from './failureModes';
import type { NFLGameLogEntry } from './types';
import type { NFLInjuryContext } from './injuries';

function logs(targets: number[], yardsPerTarget = 8): NFLGameLogEntry[] {
  return targets.map((target, index) => ({ gameId: `game-${index}`, date: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
    week: index + 1, teamId: 18, position: 'WR', result: 'W', opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home',
    historySource: 'CURRENT_SEASON', historyWeight: 1,
    stats: { receivingTargets: target, receptions: Math.floor(target * 0.6), receivingYards: target * yardsPerTarget } }));
}

const explain = (entries: NFLGameLogEntry[], market: 'player_reception_yds' | 'player_receptions' = 'player_reception_yds') =>
  buildNFLProjectionExplanation({ logs: entries, market, historicalBaseline: 80, finalProjection: 80, position: 'WR' });

describe('NFL opportunity foundation boundaries', () => {
  it('inventories every requested position field and does not claim live advanced metrics', () => {
    expect(NFL_OPPORTUNITY_DATA_AUDIT.filter((field) => field.group === 'QB')).toHaveLength(7);
    expect(NFL_OPPORTUNITY_DATA_AUDIT.filter((field) => field.group === 'RB')).toHaveLength(14);
    expect(NFL_OPPORTUNITY_DATA_AUDIT.filter((field) => field.group === 'WR / TE')).toHaveLength(13);
    expect(NFL_OPPORTUNITY_DATA_AUDIT.some((field) => field.availability === 'LIVE AVAILABLE')).toBe(false);
    expect(NFL_OPPORTUNITY_DATA_AUDIT.filter((field) => /routes|share|snaps|air|scrambles|designed/.test(field.field.toLowerCase()))
      .every((field) => field.availability === 'NOT AVAILABLE')).toBe(true);
  });

  it('uses yards per target for yardage and catch rate for receptions', () => {
    const entries = logs([10, 10, 10, 10, 10, 10]);
    expect(explain(entries)).toMatchObject({ expectedOpportunity: 10, expectedEfficiency: 8, opportunityProjection: 80,
      finalProjection: 80, modelType: 'PARTIAL_OPPORTUNITY_MODEL' });
    expect(explain(entries, 'player_receptions')).toMatchObject({ expectedOpportunity: 10, expectedEfficiency: 0.6, opportunityProjection: 6,
      efficiencyLabel: 'Catch rate' });
  });

  it('does not claim shares or fabricate routes when targets exist', () => {
    const model = explain(logs([9, 10, 8, 10, 9, 10]));
    expect(model.missingInputs).toEqual(expect.arrayContaining(['routes', 'route participation', 'target share', 'air yards', 'aDOT']));
    expect(model.opportunityInputs.every((input) => Number.isFinite(input.opportunity))).toBe(true);
    expect(model.modelType).not.toBe('ADVANCED_OPPORTUNITY_MODEL');
  });

  it('requires three current-season pairs even if supplemented history is large', () => {
    const entries = logs(Array(10).fill(10)).map((entry, index) => index < 8 ? { ...entry, historySource: 'PREVIOUS_SEASON' as const, historyWeight: 0.6 } : entry);
    expect(explain(entries)).toMatchObject({ modelType: 'HISTORICAL_BASELINE_ONLY', finalProjection: 80, opportunityBlendWeight: 0 });
  });

  it('retains prior weighting early and excludes it when current-season data is established', () => {
    const early = logs(Array(10).fill(10)).map((entry, index) => index < 7 ? { ...entry, historySource: 'PREVIOUS_SEASON' as const, historyWeight: 0.6,
      stats: { receivingTargets: 10, receivingYards: 40 } } : entry);
    expect(explain(early)).toMatchObject({ currentSeasonOpportunityGames: 3, priorSeasonOpportunityGames: 7 });
    expect(explain(early).expectedEfficiency).toBeCloseTo((7 * 40 * 0.6 + 3 * 80) / (7 * 10 * 0.6 + 3 * 10), 3);
    const established = [...early.slice(0, 7), ...logs(Array(6).fill(10))];
    expect(explain(established).expectedEfficiency).toBe(8);
  });

  it('uses sustained increasing/declining usage once, not another role bonus', () => {
    const increasing = explain(logs([8, 8, 8, 8, 8, 8, 12, 12, 12]));
    expect(increasing.roleStability.status).toBe('INCREASING');
    expect(increasing.expectedOpportunity).toBe(12);
    expect(increasing.opportunityProjection).toBe(96);
    expect(increasing.finalProjection).toBe(85.6);
    const declining = explain(logs([12, 12, 12, 12, 12, 12, 8, 8, 8]));
    expect(declining.roleStability.status).toBe('DECLINING');
    expect(declining.expectedOpportunity).toBe(8);
    expect(declining.finalProjection).toBe(74.4);
  });

  it('does not extrapolate one isolated spike as a confirmed role change', () => {
    const model = explain(logs([8, 8, 8, 8, 8, 8, 8, 8, 24]));
    expect(model.roleStability.status).toBe('UNCERTAIN');
    expect(model.expectedOpportunity).toBeLessThan(24);
  });

  it('rejects nonfinite inputs, impossible catch pairs, and production without opportunities', () => {
    const invalid = logs([10, 10, 10, 10]).map((entry) => ({ ...entry, stats: { receivingTargets: 2, receptions: 3, receivingYards: Number.NaN } }));
    expect(explain(invalid).opportunityProjection).toBeNull();
    expect(explain(invalid, 'player_receptions').opportunityProjection).toBeNull();
    expect(explain(logs([0, 0, 0]).map((entry) => ({ ...entry, stats: { receivingTargets: 0, receivingYards: 10 } }))).opportunityProjection).toBeNull();
  });

  it('keeps QB rushing decomposition gaps distinct from RB team-volume gaps', () => {
    const entries = logs([4, 4, 4, 4]).map((entry) => ({ ...entry, stats: { rushingAttempts: 4, rushingYards: 24 } }));
    const qb = buildNFLProjectionExplanation({ logs: entries, position: 'QB', market: 'player_rush_yds', historicalBaseline: 24, finalProjection: 24 });
    const rb = buildNFLProjectionExplanation({ logs: entries, position: 'RB', market: 'player_rush_yds', historicalBaseline: 24, finalProjection: 24 });
    expect(qb.missingInputs).toEqual(['designed rushes', 'scrambles']);
    expect(rb.missingInputs).toEqual(['team rushing volume', 'carry share']);
    expect(qb.opportunityLabel).toBe('Expected QB rushing attempts');
  });

  it('never gives touchdowns the volume opportunity formula', () => {
    const model = buildNFLProjectionExplanation({ logs: logs([10, 10, 10]), market: 'player_reception_tds', historicalBaseline: 0.2, finalProjection: 0.2 });
    expect(model).toMatchObject({ modelType: 'HISTORICAL_BASELINE_ONLY', opportunityProjection: null, finalProjection: 0.2 });
  });

  it('season phase changes metadata, not a fabricated numeric multiplier', () => {
    const entries = logs([8, 9, 10, 8, 9, 10]);
    const early = projectNFLMarket({ logs: entries, market: 'player_reception_yds', seasonPhase: 'EARLY_REGULAR_SEASON' });
    const playoffs = projectNFLMarket({ logs: entries, market: 'player_reception_yds', seasonPhase: 'PLAYOFFS' });
    expect(playoffs.projection).toBe(early.projection);
    expect(playoffs.uncertainty).toBe(early.uncertainty);
    expect(playoffs.projectionModel?.seasonPhase).toBe('PLAYOFFS');
  });

  it('widens uncertainty with observed role separation, including otherwise constant production', () => {
    const entries = logs([8, 8, 8, 8, 8, 8, 12, 12, 12]).map((entry) => ({ ...entry, stats: { ...entry.stats, receivingYards: 80 } }));
    const projection = projectNFLMarket({ logs: entries, market: 'player_reception_yds' });
    expect(projection.uncertainty).toBeGreaterThan(0);
    expect(projection.inputs.roleSeparation).toBeGreaterThan(0);
    expect(projection.projectionModel?.uncertainty).toBe(projection.uncertainty);
  });

  it('injury-network absences do not assign vacated targets or double count a numeric bonus', () => {
    const entries = logs([8, 9, 10, 8, 9, 10]);
    const player = { availabilityDesignation: 'CONFIRMED_AVAILABLE', sourceStatus: 'CURRENT' };
    const healthy = { player, teammateAbsences: [], opponentAbsences: [] } as unknown as NFLInjuryContext;
    const absence = { ...healthy, teammateAbsences: [{ player: 'WR1', availabilityDesignation: 'OUT', affectedRole: 'RECEIVING_OPTION' }] } as NFLInjuryContext;
    const first = projectNFLMarket({ logs: entries, market: 'player_reception_yds', injuryContext: healthy });
    const second = projectNFLMarket({ logs: entries, market: 'player_reception_yds', injuryContext: absence });
    expect(second.projection).toBe(first.projection);
    expect(second.uncertainty).toBe(first.uncertainty);
    const modes = buildNFLFailureModes({ roleContext: buildNFLRoleContext(entries, 'player_reception_yds'), projection: second.projection,
      projectionUncertainty: second.uncertainty, rawEdge: 10, sampleSize: 6, injuryContext: absence });
    expect(modes.join(' ')).toContain('no vacated volume is assigned');
  });
});