import { describe, expect, it } from 'vitest';
import { buildNFLGameEnvironment, type NFLTeamTendencyEvidence } from './gameEnvironment';
import { makeNFLResearchLayer, type NFLGameScriptResearch } from './researchModel';
import type { NFLInjuryContext } from './injuries';
import type { NFLWeatherContext } from './weather';
import { applyNFLGameEnvironmentToProjection, applyNFLMatchupToProjection, projectNFLMarket } from './projection';
import type { NFLGameLogEntry } from './types';

const script = (spread: number | null, total: number | null, side: 'HOME' | 'AWAY' = 'HOME') => makeNFLResearchLayer<NFLGameScriptResearch>('PARTIAL_DATA', {
  spread, total, homeAway: side, homeTeamTotal: total != null && spread != null ? (total - spread) / 2 : null,
  awayTeamTotal: total != null && spread != null ? (total + spread) / 2 : null, expectedLeader: spread == null || spread === 0 ? null : spread < 0 ? 'Home' : 'Away',
} as NFLGameScriptResearch);
const tendencies: NFLTeamTendencyEvidence = { teamId: 1, season: 2026, source: 'SYNTHETIC TEST current-system charting', retrievedAt: '2026-10-05T12:00:00Z',
  currentSystemVerified: true, games: 8, passRate: 0.65, rushRate: 0.35, leadingPassRate: 0.45, trailingPassRate: 0.75, closePassRate: 0.6, playsPerGame: 64 };
describe('NFL Phase4 game environment', () => {
  const analyze = (spread: number | null, total = 47.5) => buildNFLGameEnvironment({ market: 'player_pass_yds', position: 'QB', gameScript: script(spread, total) });
  it.each([[-3.5, 'MARKET_FAVORITE'], [3.5, 'MARKET_UNDERDOG'], [0, 'MARKET_PICK_EM']] as const)('models spread %s without a prop bonus', (spread, expectedScript) => {
    expect(analyze(spread)).toMatchObject({ expectedScript, volumeAdjustment: 0, projectionAdjustment: 0 });
    expect(analyze(spread).inputs.expectedMargin).toBe(-spread);
  });
  it('makes the away-team spread and totals candidate-relative', () => {
    const result = buildNFLGameEnvironment({ market: 'player_rush_yds', position: 'RB', gameScript: script(-3.5, 47.5, 'AWAY') });
    expect(result.inputs).toMatchObject({ candidateSpread: 3.5, expectedMargin: -3.5, teamTotal: 22, opponentTeamTotal: 25.5 });
  });
  it.each([[55, 'HIGH_MARKET_TOTAL'], [35, 'LOW_MARKET_TOTAL']] as const)('uses total %s as scoring context not universal yards value', (total, expectedScoringEnvironment) => {
    expect(analyze(-3.5, total)).toMatchObject({ expectedScoringEnvironment, volumeAdjustment: 0, expectedTeamVolume: { possessions: null } });
  });
  it('flags extreme-spread uncertainty without a generic blowout penalty', () => {
    const result = analyze(-14);
    expect(result.potentialBlowout).toBe(true);
    expect(result.counterCase.join(' ')).toContain('rotation');
    expect(result.volumeAdjustment).toBe(0);
  });
  it.each([0.65, 0.35])('discloses observed pass-heavy/rush-heavy rates %s separately from projected volume', (passRate) => {
    const result = buildNFLGameEnvironment({ market: 'player_pass_attempts', teamId: 1, season: 2026, now: new Date('2026-10-05T13:00:00Z'),
      tendencies: { ...tendencies, passRate, rushRate: 1 - passRate } });
    expect(result.inputs.observedTendencies?.leadingPassRate).toBe(0.45);
    expect(result.inputs.observedTendencies?.trailingPassRate).toBe(0.75);
    expect(result.expectedTeamVolume.passAttempts).toBeNull();
    expect(result.volumeAdjustment).toBe(0);
  });
  it('does not borrow tendencies from another team/system/season or stale record', () => {
    for (const update of [{ teamId: 2 }, { currentSystemVerified: false }, { season: 2025 }, { retrievedAt: '2026-09-01T00:00:00Z' }]) {
      expect(buildNFLGameEnvironment({ market: 'player_pass_yds', teamId: 1, season: 2026, now: new Date('2026-10-05T13:00:00Z'),
        tendencies: { ...tendencies, ...update } }).inputs.observedTendencies).toBeNull();
    }
  });
  it('keeps missing pace/PROE/possessions optional for Standard', () => {
    const result = analyze(-3.5);
    expect(result.confidence).toBe('LOW');
    expect(result.missingInputs).toEqual(expect.arrayContaining(['neutral-situation pace', 'PROE', 'possessions']));
    expect(result).not.toHaveProperty('hardGates');
    expect(result.scenarios).toEqual([]);
  });
  it('runs three distinct qualitative Deep scenarios without made-up probabilities', () => {
    const result = buildNFLGameEnvironment({ market: 'player_reception_yds', position: 'WR', researchMode: 'DEEP', gameScript: script(-3.5, 47.5) });
    expect(result.scenarios.map((scenario) => scenario.name)).toEqual(['FAVORABLE', 'BASE', 'ADVERSE']);
    expect(result.scenarios.every((scenario) => scenario.probability === null && scenario.projection === null)).toBe(true);
    expect(result.robustness).toBe('NOT_QUANTIFIED');
  });
  it('tests an Under against retained opportunity rather than an Over counter-scenario', () => {
    const over = buildNFLGameEnvironment({ market: 'player_receptions', position: 'WR', researchMode: 'DEEP', direction: 'over' });
    const under = buildNFLGameEnvironment({ market: 'player_receptions', position: 'WR', researchMode: 'DEEP', direction: 'under' });
    expect(under.scenarios[2].opportunityImpact).toBe(over.scenarios[0].opportunityImpact);
    expect(under.counterCase[0]).toContain('defeat this Under');
    expect(under.volumeAdjustment).toBe(0);
  });
  it.each([['player_pass_attempts', 'QB', 'QB_ATTEMPTS'], ['player_pass_completions', 'QB', 'QB_COMPLETIONS'],
    ['player_rush_yds', 'QB', 'QB_RUSHING'], ['player_rush_yds', 'RB', 'RB_RUSHING'], ['player_rush_attempts', 'RB', 'RB_CARRIES'],
    ['player_receptions', 'RB', 'RB_RECEIVING'], ['player_receptions', 'TE', 'RECEPTIONS'], ['player_reception_yds', 'WR', 'RECEIVING_YARDS']] as const)('routes %s %s to %s', (market, position, family) => {
    expect(buildNFLGameEnvironment({ market, position }).family).toBe(family);
  });
  it('does not triple-count injury and weather effects', () => {
    const injuryContext = { player: { position: 'QB', player: 'QB', sourceStatus: 'CURRENT', updatedAt: '2026-10-05T12:00:00Z', availabilityDesignation: 'OUT' },
      teammateAbsences: [], opponentAbsences: [] } as unknown as NFLInjuryContext;
    const weatherContext = { environment: 'OUTDOOR', wind: { speed: 30 }, sourceStatus: 'AVAILABLE' } as NFLWeatherContext;
    const result = buildNFLGameEnvironment({ market: 'player_pass_yds', injuryContext, weatherContext, now: new Date('2026-10-05T13:00:00Z') });
    expect(result.counterCase.join(' ')).toContain('strong wind');
    expect(result.inputs.injuryEvidence).toHaveLength(1);
    expect(result.volumeAdjustment).toBe(0);
    const indoor = buildNFLGameEnvironment({ market: 'player_pass_yds', weatherContext: { ...weatherContext, environment: 'INDOOR' } });
    expect(indoor.inputs.weather?.windMph).toBeNull();
    expect(indoor.counterCase.join(' ')).not.toContain('strong wind');
  });
  it.each(['EARLY', 'MID', 'LATE_REGULAR_SEASON', 'PLAYOFFS'])('persists %s season context without a bonus or double counting', (seasonPhase) => {
    const logs = Array.from({ length: 8 }, (_, index) => ({ gameId: `g${index}`, date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      week: index + 1, result: 'W', homeAway: 'home' as const, opponent: 'Opponent', opponentAbbreviation: 'OPP',
      stats: { passingYards: 240, passingAttempts: 30 } })) satisfies NFLGameLogEntry[];
    const phase2 = projectNFLMarket({ logs, market: 'player_pass_yds', position: 'QB', seasonPhase });
    const phase3 = applyNFLMatchupToProjection(phase2, { market: 'player_pass_yds', position: 'QB' });
    const params = { market: 'player_pass_yds', position: 'QB', gameScript: script(-14, 55), now: new Date('2026-10-05T12:00:00Z') };
    const phase4 = applyNFLGameEnvironmentToProjection(phase3, params);
    expect(phase4.projection).toBe(phase3.projection);
    expect(phase4.uncertainty).toBe(phase3.uncertainty);
    expect(phase4.projectionModel?.expectedOpportunity).toBe(phase2.projectionModel?.expectedOpportunity);
    expect(phase4.projectionModel?.matchupModel).toEqual(phase3.projectionModel?.matchupModel);
    expect(applyNFLGameEnvironmentToProjection(phase4, params)).toEqual(phase4);
    const saved = JSON.parse(JSON.stringify(phase4));
    expect(saved.projectionModel.gameEnvironmentModel.inputs.seasonPhase).toBe(seasonPhase);
    expect(saved.inputs).toMatchObject({ historicalModelVersion: 'nfl_weighted_history_v1', gameEnvironmentModelVersion: 'nfl_game_environment_v1', volumeAdjustment: 0 });
    expect(saved.projectionModel.gameEnvironmentModel).toMatchObject({ opportunityModelVersion: 'nfl_opportunity_v1', matchupModelVersion: 'nfl_matchup_efficiency_v1',
      probabilityModelVersion: 'shared_probability_model_v1', finalProjection: phase3.projection });
  });
});