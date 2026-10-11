import { describe, expect, it } from 'vitest';
import { buildNFLMatchupEfficiency, type NFLMatchupReference } from './matchupEfficiency';
import { buildNFLOpponentContext, type NFLDefenseGame } from './opponentContext';
import { applyNFLMatchupToProjection, projectNFLMarket } from './projection';
import type { NFLGameLogEntry } from './types';
import type { NFLInjuryContext, NFLInjuryContextEntry } from './injuries';

const logs = Array.from({ length: 8 }, (_, index) => ({ gameId: `player-${index}`, date: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`, result: 'W',
  week: index + 1, opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home' as const,
  stats: { passingAttempts: 30, passingYards: 240, completions: 20, rushingAttempts: 20, rushingYards: 90, receivingTargets: 8, receivingYards: 70, receptions: 6 } })) satisfies NFLGameLogEntry[];
function analyze(market: 'player_pass_yds' | 'player_pass_completions' | 'player_rush_yds' | 'player_receptions' | 'player_reception_yds', position: string, efficiency: number, reference?: NFLMatchupReference) {
  const games: NFLDefenseGame[] = Array.from({ length: 8 }, (_, index) => ({ eventId: `defense-${index}`, date: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`, season: 2026,
    metrics: { passingYardsAllowed: 30 * efficiency, passAttemptsAllowed: 30, completionsAllowed: 20, sacksGenerated: 2, rushingAttemptsAllowed: 20, rushingYardsAllowed: 20 * efficiency } }));
  const projection = projectNFLMarket({ logs, market, position });
  return buildNFLMatchupEfficiency({ market, position, season: 2026, projectionModel: projection.projectionModel,
    opponentContext: buildNFLOpponentContext({ opponentTeamId: 1, games, market, position, season: 2026 }), reference });
}
const passReference: NFLMatchupReference = { metric: 'yardsPerPassAttemptAllowed', value: 7, observations: 200, source: 'TEST ONLY schedule-adjusted reference', season: 2026, scheduleAdjusted: true, methodology: 'FACED_OFFENSE_EXPECTATION' };
describe('NFL market-specific matchup efficiency', () => {
  it.each([[9, 'FAVORABLE'], [5, 'UNFAVORABLE']] as const)('handles pass efficiency %s conservatively', (efficiency, overall) => {
    const result = analyze('player_pass_yds', 'QB', efficiency, passReference);
    expect(result.overall).toBe(overall);
    expect(Math.abs(result.efficiencyAdjustment)).toBeLessThanOrEqual(0.03);
    expect(result.expectedOpportunity).toBe(30);
    expect(result.finalProjection).toBeCloseTo(result.phase2Projection! + 0.35 * 30 * 8 * result.efficiencyAdjustment, 2);
  });
  it.each([[6, 'FAVORABLE'], [3, 'UNFAVORABLE']] as const)('handles RB run efficiency %s with matched units', (efficiency, overall) => {
    expect(analyze('player_rush_yds', 'RB', efficiency, { ...passReference, metric: 'yardsPerRushAttemptAllowed', value: 4.5 }).overall).toBe(overall);
  });
  it('keeps missing advanced data partial and leaves production projections unchanged', () => {
    const result = analyze('player_pass_yds', 'QB', 9);
    expect(result.status).toBe('PARTIAL');
    expect(result.confidence).toBe('MEDIUM');
    expect(result.efficiencyAdjustment).toBe(0);
    expect(result.finalProjection).toBe(result.phase2Projection);
    expect(result.missingInputs).toContain('pressure rate');
    expect(result.inputs.sackRate).toBeCloseTo(2 / 32);
  });
  it('does not convert passing YPA into WR yards/target, or team rush efficiency into QB rushes', () => {
    expect(analyze('player_reception_yds', 'WR', 9, passReference).efficiencyAdjustment).toBe(0);
    expect(analyze('player_rush_yds', 'QB', 6, { ...passReference, metric: 'yardsPerRushAttemptAllowed', value: 4.5 }).inputs.efficiencyMetric).toBeNull();
    expect(analyze('player_receptions', 'WR', 9).family).toBe('WR_RECEPTIONS');
    expect(analyze('player_reception_yds', 'TE', 9).priorities).toContain('LB/S matchup');
    expect(analyze('player_receptions', 'RB', 9).priorities).toContain('pressure/checkdown environment');
    expect(analyze('player_pass_completions', 'QB', 9).inputs.efficiencyMetric).toBe('completionRateAllowed');
  });
  it('never uses an unadjusted or stale reference as a numerical modifier', () => {
    expect(analyze('player_pass_yds', 'QB', 9, { ...passReference, scheduleAdjusted: false }).efficiencyAdjustment).toBe(0);
    expect(analyze('player_pass_yds', 'QB', 9, { ...passReference, season: 2025 }).efficiencyAdjustment).toBe(0);
  });
  it.each(['STANDARD', 'DEEP'] as const)('discloses gaps without creating new %s gates', (researchMode) => {
    const result = buildNFLMatchupEfficiency({ market: 'player_reception_yds', position: 'WR', researchMode });
    expect(result.researchMode).toBe(researchMode);
    expect(result.confidence).toBe('UNAVAILABLE');
    expect(result).not.toHaveProperty('hardGates');
  });
  it('persists versions and inputs with a JSON-compatible zero adjustment', () => {
    const result = JSON.parse(JSON.stringify(analyze('player_pass_yds', 'QB', 9)));
    expect(result.modelVersion).toBe('nfl_matchup_efficiency_v1');
    expect(result.opportunityModelVersion).toBe('nfl_opportunity_v1');
    expect(result.probabilityModelVersion).toBe('shared_probability_model_v1');
    expect(result.inputs.games).toHaveLength(8);
    expect(result.antiDoubleCounting).toHaveLength(5);
  });
  it.each([['CB', false], ['EDGE', false], ['LT', true]] as const)('records %s injury without a numerical injury bonus', (position, ownTeam) => {
    const entry = { player: 'Recorded Player', position, sourceStatus: 'CURRENT', availabilityDesignation: 'OUT', updatedAt: new Date().toISOString() } as NFLInjuryContextEntry;
    const injuryContext = { teammateAbsences: ownTeam ? [entry] : [], opponentAbsences: ownTeam ? [] : [entry] } as NFLInjuryContext;
    const result = buildNFLMatchupEfficiency({ market: 'player_pass_yds', position: 'QB', injuryContext });
    expect(result.injuryEvidence[0]).toContain(`${position} Recorded Player: OUT`);
    expect(result.efficiencyAdjustment).toBe(0);
    expect(result.trenchEvidence.length).toBe(position === 'CB' ? 0 : 1);
  });
  it('applies the efficiency adjustment once even when re-evaluated', () => {
    const baseline = projectNFLMarket({ logs, market: 'player_pass_yds', position: 'QB' });
    const games = analyze('player_pass_yds', 'QB', 9).inputs.games;
    const params = { market: 'player_pass_yds' as const, position: 'QB', season: 2026, reference: passReference,
      now: new Date('2026-10-05T12:00:00Z'),
      opponentContext: buildNFLOpponentContext({ opponentTeamId: 1, games, market: 'player_pass_yds', season: 2026 }) };
    const once = applyNFLMatchupToProjection(baseline, params);
    expect(once.projection).toBeGreaterThan(baseline.projection!);
    expect(applyNFLMatchupToProjection(once, params)).toEqual(once);
    expect(baseline.projectionModel?.expectedOpportunity).toBe(once.projectionModel?.expectedOpportunity);
  });
  it('does not infer a full season or overweight prior-year defense', () => {
    const games = analyze('player_pass_yds', 'QB', 9).inputs.games.map((game, index) => ({ ...game, season: index < 6 ? 2025 : 2026 }));
    const result = buildNFLMatchupEfficiency({ market: 'player_pass_yds', position: 'QB', season: 2026, reference: passReference,
      opponentContext: buildNFLOpponentContext({ opponentTeamId: 1, games, market: 'player_pass_yds', season: 2026 }) });
    expect(result.inputs.seasonalGames).toBe(2);
    expect(result.confidence).toBe('LOW');
    expect(result.efficiencyAdjustment).toBe(0);
    expect(result.defensiveState).toBe('UNCERTAIN');
  });
  it('does not describe a stale saved CURRENT injury flag as current matchup evidence', () => {
    const entry = { player: 'Old Corner', position: 'CB', sourceStatus: 'CURRENT', availabilityDesignation: 'OUT', updatedAt: '2026-09-01T00:00:00Z' } as NFLInjuryContextEntry;
    const result = buildNFLMatchupEfficiency({ market: 'player_reception_yds', position: 'WR', now: new Date('2026-10-05T12:00:00Z'),
      injuryContext: { teammateAbsences: [], opponentAbsences: [entry] } as unknown as NFLInjuryContext });
    expect(result.injuryEvidence).toEqual([]);
  });
  it('never projects more completions than attempts from an efficiency adjustment', () => {
    const projection = projectNFLMarket({ logs: logs.map((log) => ({ ...log, stats: { ...log.stats, completions: 30 } })), market: 'player_pass_completions', position: 'QB' });
    const games = analyze('player_pass_completions', 'QB', 9).inputs.games;
    const result = buildNFLMatchupEfficiency({ market: 'player_pass_completions', position: 'QB', projectionModel: projection.projectionModel,
      opponentContext: buildNFLOpponentContext({ opponentTeamId: 1, games, market: 'player_pass_completions', season: 2026 }),
      reference: { ...passReference, metric: 'completionRateAllowed', value: 0.5 } });
    expect(result.adjustedEfficiency).toBeLessThanOrEqual(1);
    expect(result.efficiencyAdjustment).toBe(0);
  });
  it('excludes future-dated defensive observations instead of leaking them into a replay', () => {
    const result = buildNFLMatchupEfficiency({ market: 'player_pass_yds', position: 'QB', now: new Date('2026-09-04T00:00:00Z'),
      opponentContext: buildNFLOpponentContext({ opponentTeamId: 1, games: analyze('player_pass_yds', 'QB', 9).inputs.games, market: 'player_pass_yds', season: 2026 }) });
    expect(result.inputs.games).toHaveLength(4);
    expect(result.confidence).toBe('LOW');
  });
});