import { describe, it, expect } from 'vitest';
import { buildNFLEliteCandidate, type NFLResearchCandidate } from './research';
import { buildNFLInjuryContext, parseNFLInjuryReports } from './injuries';

describe('NFL Elite candidate adapter', () => {
  it('keeps missing role context unavailable without declaring ESPN usage evidence unsupported', () => {
    const candidate: NFLResearchCandidate = {
      candidateId: 'c1', playerId: 1, player: 'Test QB', market: 'player_pass_yds', line: 250, direction: 'over',
      projection: 275, projectionUncertainty: 30, logs: [],
      matchupAvailable: true, oddsAmerican: -110, lastUpdatedAt: new Date().toISOString(),
      isAlternate: false, marketSupport: 'full',
    };
    const input = buildNFLEliteCandidate(candidate);
    expect(input.roleKnown).toBe(false);
    expect(input.usageAvailable).toBe(false);
    expect(input.statusKnown).toBe(false);
    expect(input.unsupportedSignals).not.toContain('usageOpportunity');
    expect(input.unsupportedSignals).toContain('opponentPersonnel');
    expect(input.unsupportedSignals).toContain('projectionAgreement');
  });

  it('fails closed (never Elite-qualified) for an unsupported market like kicking', () => {
    const candidate: NFLResearchCandidate = {
      candidateId: 'c2', playerId: 2, player: 'Test Kicker', market: 'player_kicking_points', line: 7.5, direction: 'over',
      projection: 8, projectionUncertainty: 2, logs: [],
      matchupAvailable: true, oddsAmerican: -110, lastUpdatedAt: new Date().toISOString(),
      isAlternate: false, marketSupport: 'unsupported',
    };
    const input = buildNFLEliteCandidate(candidate);
    expect(input.requiredMarketSupported).toBe(false);
    expect(input.marketSupport).toBe('UNAVAILABLE');
  });

  it('does not double-penalize a CHANGING role: roleKnown stays true (evidence available) even when reliability is separately capped LOW (Phase 5 audit)', () => {
    const logs = [
      ...Array.from({ length: 8 }, (_, i) => ({ gameId: `g${i}`, week: i, date: '2024-01-01', opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home' as const, result: 'W', stats: { receivingTargets: 9, receptions: 6, receivingYards: 70 } })),
      ...Array.from({ length: 5 }, (_, i) => ({ gameId: `g${i + 8}`, week: i + 8, date: '2024-02-01', opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home' as const, result: 'W', stats: { receivingTargets: 4, receptions: 3, receivingYards: 40 } })),
    ];
    const candidate: NFLResearchCandidate = {
      candidateId: 'c3', playerId: 3, player: 'Test WR', market: 'player_reception_yds', line: 55, direction: 'under',
      projection: 30, projectionUncertainty: 40, logs,
      matchupAvailable: true, oddsAmerican: -110, lastUpdatedAt: new Date().toISOString(),
      isAlternate: false, marketSupport: 'full',
    };
    const input = buildNFLEliteCandidate(candidate);
    // Real recent role evidence exists (CHANGING is still evidenced, not unknown) -> roleKnown true.
    expect(input.roleKnown).toBe(true);
  });

  it('feeds a fresh explicit player availability designation into statusKnown', () => {
    const reports = parseNFLInjuryReports({ injuries: [{ id: '29', displayName: 'Carolina Panthers', injuries: [
      { athlete: { id: '1', displayName: 'Test QB', position: { abbreviation: 'QB' } }, status: 'Questionable', date: '2026-09-20T12:00:00Z' },
    ] }] }, new Date('2026-09-20T16:00:00Z'));
    const injuryContext = buildNFLInjuryContext({ playerId: 1, player: 'Test QB', teamId: 29, team: 'Carolina Panthers', opponentTeamId: 1, market: 'player_pass_yds', position: 'QB', reports });
    const input = buildNFLEliteCandidate({
      candidateId: 'c4', playerId: 1, player: 'Test QB', market: 'player_pass_yds', line: 250, direction: 'over',
      projection: 275, projectionUncertainty: 30, logs: [], matchupAvailable: true, injuryContext,
      oddsAmerican: -110, lastUpdatedAt: new Date().toISOString(), isAlternate: false, marketSupport: 'full',
    });
    expect(input.statusKnown).toBe(true);
  });

  it('treats known outdoor or indoor-not-applicable weather as game context, but not missing weather', () => {
    const base: NFLResearchCandidate = {
      candidateId: 'weather', playerId: 1, player: 'Test QB', market: 'player_pass_yds', line: 250, direction: 'over',
      projection: 275, projectionUncertainty: 30,
      logs: [{ gameId: 'g1', week: 1, date: '2026-09-13', opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats: { passingYards: 275 } }],
      matchupAvailable: true, oddsAmerican: -110, lastUpdatedAt: new Date().toISOString(), isAlternate: false, marketSupport: 'full',
    };
    const venue = { id: '1', name: 'Venue', indoor: false, city: 'City', state: 'ST', country: 'USA' };
    const weather = { venue, environment: 'OUTDOOR' as const, kickoff: '2026-09-20T17:00Z', temperature: null, wind: null, gusts: null, precipitation: null, conditions: null, severeConditions: [], forecastTimestamp: null, sources: { venue: 'ESPN' as const, geocode: null, forecast: null }, missingFields: [] };
    expect(buildNFLEliteCandidate({ ...base, weatherContext: { ...weather, sourceStatus: 'AVAILABLE' } }).gameContextAvailable).toBe(true);
    expect(buildNFLEliteCandidate({ ...base, weatherContext: { ...weather, sourceStatus: 'NOT_APPLICABLE', environment: 'INDOOR' } }).gameContextAvailable).toBe(true);
    expect(buildNFLEliteCandidate({ ...base, weatherContext: { ...weather, sourceStatus: 'UNKNOWN' } }).gameContextAvailable).toBe(false);
  });
});
