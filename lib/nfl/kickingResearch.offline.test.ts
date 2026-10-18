import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNFLKickingResearch, type NFLKickingFact, type NFLKickingOpportunityInput } from './kickingResearch';
import { normalizeNFLKickingStats } from './stats';
import type { NFLGameLogEntry } from './types';
import type { NFLWeatherContext } from './weather';
import type { NFLInjuryContext } from './injuries';

function log(game: number, stats: NFLGameLogEntry['stats'], season = 2026): NFLGameLogEntry {
  return { gameId: String(game), date: `${season}-10-${String(game).padStart(2, '0')}T12:00:00Z`,
    season, week: game, opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats };
}

function fact(value: number, extra: Partial<NFLKickingFact> = {}): NFLKickingFact {
  return { value, source: 'Offline charting fixture', retrievedAt: '2026-10-17T12:00:00Z', sampleId: 'team-1-season-2026', ...extra };
}

describe('pure NFL kicking research (network blocked)', () => {
  const blockedFetch = vi.fn(() => { throw new Error('Network forbidden in kicking research tests'); });
  beforeEach(() => { vi.stubGlobal('fetch', blockedFetch); });
  afterEach(() => { expect(blockedFetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('sums exact totals and weights accuracy by attempts, not mean percentages', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [
      log(1, { fgm: 1, fga: 1, kickingPoints: 4, fieldGoalPct: 100 }),
      log(2, { fieldGoalsMade: 1, fieldGoalsAttempted: 4, kickingPoints: 6, fieldGoalPct: 25 }),
    ] });
    expect(result.currentSeason.made).toEqual({ total: 2, observedGames: 2, perGame: 1 });
    expect(result.currentSeason.attempted).toEqual({ total: 5, observedGames: 2, perGame: 2.5 });
    expect(result.currentSeason.accuracy).toEqual({ numerator: 2, denominator: 5, rate: 0.4, observedGames: 2 });
    expect(result.currentSeason.kickingPoints.total).toBe(10);
    expect(result.career).toBeNull();
  });

  it('uses canonical counts once when aliases coexist and never invents kicking points', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [log(1, {
      fgm: 9, fga: 10, fieldGoalsMade: 2, fieldGoalAttempts: 3, fieldGoalsAttempted: 8,
      longestFieldGoal: 49, longFieldGoal: 60, fieldGoalsMade40_49: 1, fieldGoalsMade40To49: 7,
    })] });
    expect(result.currentSeason.accuracy?.rate).toBe(2 / 3);
    expect(result.currentSeason.longestFieldGoal).toBe(49);
    expect(result.currentSeason.distance.from40To49.made.total).toBe(1);
    expect(result.currentSeason.kickingPoints.total).toBeNull();
  });

  it('retains attempts, weighted accuracy, longest FG and 40-49 makes across the real normalization boundary', () => {
    const stats = normalizeNFLKickingStats(
      ['fieldGoalsMade', 'longFieldGoal', 'fieldGoalsMade40_49'], ['2/3', '49', '2'],
    );
    const secondStats = normalizeNFLKickingStats(['fieldGoalsMade'], ['1/1']);
    const result = getNFLKickingResearch({ season: 2026, logs: [log(1, stats), log(2, secondStats)] });
    expect(result.currentSeason.made.total).toBe(3);
    expect(result.currentSeason.attempted).toEqual({ total: 4, observedGames: 2, perGame: 2 });
    expect(result.currentSeason.accuracy).toEqual({ numerator: 3, denominator: 4, rate: 0.75, observedGames: 2 });
    expect(result.currentSeason.longestFieldGoal).toBe(49);
    expect(result.currentSeason.longestFieldGoalObservedGames).toBe(1);
    expect(result.currentSeason.distance.from40To49.made).toEqual({ total: 2, observedGames: 1, perGame: 2 });
    for (const band of Object.values(result.currentSeason.distance)) {
      expect(band.attempted).toEqual({ total: null, observedGames: 0, perGame: null });
      expect(band.accuracy).toBeNull();
    }
  });

  it('prioritizes explicit canonical zero counts over legacy distance aliases', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [log(1, {
      fieldGoalsMade: 0, fgm: 2, fieldGoalAttempts: 0, fieldGoalsAttempted: 3,
      longestFieldGoal: 0, longFieldGoal: 52,
      fieldGoalsMadeUnder40: 0, fieldGoalAttemptsUnder40: 0, fieldGoalsAttemptedUnder40: 2,
      fieldGoalsMade40_49: 0, fieldGoalsMade40To49: 1, fieldGoalAttempts40_49: 0, fieldGoalsAttempted40To49: 2,
      fieldGoalsMade50Plus: 0, fieldGoalAttempts50Plus: 0, fieldGoalsAttempted50Plus: 2,
    })] });
    expect(result.currentSeason.attempted.total).toBe(0);
    expect(result.currentSeason.accuracy).toMatchObject({ numerator: 0, denominator: 0, rate: null });
    expect(result.currentSeason.longestFieldGoal).toBe(0);
    for (const band of Object.values(result.currentSeason.distance)) {
      expect(band.made.total).toBe(0);
      expect(band.attempted.total).toBe(0);
      expect(band.accuracy).toMatchObject({ numerator: 0, denominator: 0, rate: null });
    }
  });

  it('sorts and deduplicates games and keeps recent samples separate from season and supplied career', () => {
    const logs = [log(1, { fga: 1 }), log(6, { fga: 6 }), log(3, { fga: 3 }), log(2, { fga: 2 }),
      log(5, { fga: 5 }), log(4, { fga: 4 }), log(6, { fga: 6 }), log(7, { fga: 20 }, 2025)];
    const before = JSON.stringify(logs);
    const result = getNFLKickingResearch({ season: 2026, logs,
      careerLogs: [log(1, { fga: 2 }, 2024), log(1, { fga: 3 }, 2025)].map((entry) => ({ ...entry, gameId: `${entry.season}-${entry.gameId}` })) });
    expect(result.recentL3.attempted.total).toBe(15);
    expect(result.recentL5.attempted.total).toBe(20);
    expect(result.currentSeason.games).toBe(6);
    expect(result.currentSeason.attempted.total).toBe(21);
    expect(result.career).toMatchObject({ games: 2, seasons: [2024, 2025], seasonCount: 2, attempted: { total: 5 } });
    expect(result.career?.label).toContain('not verified full career');
    expect(JSON.stringify(logs)).toBe(before);
  });

  it('never substitutes rolling logs for career or assigns unknown seasons to current season', () => {
    const unknownSeason = { ...log(1, { fga: 2 }), season: undefined };
    const result = getNFLKickingResearch({ season: 2026, logs: [unknownSeason] });
    expect(result.currentSeason.games).toBe(0);
    expect(result.recentL3.gamesWithoutSeason).toBe(1);
    expect(result.career).toBeNull();
    expect(getNFLKickingResearch({ season: 2026, logs: [log(1, {})], careerLogs: [] }).career?.games).toBe(0);
  });

  it('filters incomplete and cutoff-or-later games before deduplication and sample selection', () => {
    const completed = log(1, { fieldGoalAttempts: 2 });
    const logs = [completed, { ...completed, result: null, stats: {} },
      { ...completed, date: '2026-10-04T12:00:00Z', stats: { fieldGoalAttempts: 99 } },
      log(2, { fieldGoalAttempts: 3 }), log(3, { fieldGoalAttempts: 50 }),
      log(4, { fieldGoalAttempts: 50 }), { ...log(5, {}), result: null },
      { ...log(6, { fieldGoalAttempts: 50 }), date: 'invalid' }];
    const snapshot = JSON.stringify(logs);
    const result = getNFLKickingResearch({ season: 2026, logs, careerLogs: logs, before: '2026-10-03T12:00:00Z' });
    for (const sample of [result.recentL3, result.recentL5, result.currentSeason, result.career]) {
      expect(sample).toMatchObject({ games: 2, attempted: { total: 5, observedGames: 2 } });
    }
    expect(result.career?.label).toContain('not verified full career');
    expect(JSON.stringify(logs)).toBe(snapshot);
  });

  it('requires completed results without implicitly applying the wall clock to supplied history', () => {
    const future = log(1, { fieldGoalAttempts: 2 }, 2027);
    const result = getNFLKickingResearch({ season: 2027, logs: [future, { ...log(2, {}), result: null }],
      careerLogs: [{ ...future, result: null }] });
    expect(result.currentSeason.games).toBe(1);
    expect(result.recentL3.attempted.total).toBe(2);
    expect(result.career?.games).toBe(0);
  });

  it('only divides by games with observed attempts and only pairs accuracy within the same game', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [
      log(1, { fgm: 2 }), log(2, { fga: 4 }), log(3, {}), log(4, { fgm: 1, fga: 2 }),
    ] });
    expect(result.currentSeason.attempted).toEqual({ total: 6, observedGames: 2, perGame: 3 });
    expect(result.currentSeason.accuracy).toEqual({ numerator: 1, denominator: 2, rate: 0.5, observedGames: 1 });
  });

  it('retains zero attempts with no accuracy and rejects invalid or inferred statistics', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [
      log(1, { fgm: 0, fga: 0 }), log(2, { fgm: 2, fga: 1 }),
      log(3, { fga: NaN, kickingPoints: -1 }), log(4, { fga: Infinity }), log(5, { fga: 1.5 }),
    ] });
    expect(result.currentSeason.accuracy).toEqual({ numerator: 0, denominator: 0, rate: null, observedGames: 1 });
    expect(result.currentSeason.kickingPoints.total).toBeNull();
    expect(result.unavailableEvidence.some((entry) => entry.id === 'currentSeason.accuracy')).toBe(true);
  });

  it('uses exact distance counts and observed longest kick without deriving attempts from a long kick', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [log(1, {
      longFieldGoal: 58, fieldGoalsMadeUnder40: 2, fieldGoalsAttemptedUnder40: 2,
      fieldGoalsMade40To49: 1, fieldGoalsAttempted40To49: 2,
      fieldGoalsMade50Plus: 1, fieldGoalsAttempted50Plus: 3,
    }), log(2, { longFieldGoal: 51 })] });
    expect(result.currentSeason.longestFieldGoal).toBe(58);
    expect(result.currentSeason.longestFieldGoalObservedGames).toBe(2);
    expect(result.currentSeason.distance.under40.accuracy?.rate).toBe(1);
    expect(result.currentSeason.distance.from40To49.accuracy?.rate).toBe(0.5);
    expect(result.currentSeason.distance.from50Plus.accuracy?.rate).toBe(1 / 3);
    expect(result.currentSeason.attempted.total).toBeNull();
  });

  it('derives opportunity rates only from matching exact sourced count pairs', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [], opportunity: {
      teamDrives: fact(40), teamRedZoneTrips: fact(10), teamRedZoneTouchdowns: fact(6),
      opponentRedZoneTrips: fact(8), opponentRedZoneTouchdowns: fact(3),
      fourthDownAttempts: fact(4), fourthDownOpportunities: fact(10),
      expectedDrives: fact(10.5), teamTotal: fact(24.5),
    } });
    expect(result.opportunity.teamRedZoneTouchdownRate).toMatchObject({ numerator: 6, denominator: 10, rate: 0.6 });
    expect(result.opportunity.opponentRedZoneTouchdownRate?.rate).toBe(3 / 8);
    expect(result.opportunity.teamRedZoneTripsPerDrive?.rate).toBe(0.25);
    expect(result.opportunity.fourthDownAttemptRate).toMatchObject({ rate: 0.4,
      source: 'Offline charting fixture', retrievedAt: '2026-10-17T12:00:00Z', sampleId: 'team-1-season-2026' });
    expect(result.opportunity.facts.expectedDrives?.value).toBe(10.5);
    expect(result.evidence.find((entry) => entry.id === 'opportunity.teamDrives')).toMatchObject({
      source: 'Offline charting fixture', retrievedAt: '2026-10-17T12:00:00Z', status: 'AVAILABLE',
    });
  });

  it('distinguishes zero opportunity counts from missing denominators without dividing by zero', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [], opportunity: {
      fourthDownAttempts: fact(0), fourthDownOpportunities: fact(0), teamRedZoneTouchdowns: fact(0),
    } });
    expect(result.opportunity.fourthDownAttemptRate).toMatchObject({ numerator: 0, denominator: 0, rate: null });
    expect(result.opportunity.teamRedZoneTouchdownRate).toBeNull();
    expect(result.unavailableEvidence.some((entry) => entry.id === 'opportunity.fourthDownAttemptRate')).toBe(true);
  });

  it.each([
    { sampleId: 'different-games' }, { source: 'different-provider' }, { retrievedAt: '2026-10-16T12:00:00Z' },
    { source: '' }, { retrievedAt: 'invalid' }, { value: -1 }, { value: Infinity }, { value: 1.5 }, { value: 11 },
  ])('does not combine invalid or mismatched opportunity evidence %j', (extra) => {
    const result = getNFLKickingResearch({ season: 2026, logs: [], opportunity: {
      fourthDownAttempts: fact(4, extra), fourthDownOpportunities: fact(10),
    } });
    expect(result.opportunity.fourthDownAttemptRate).toBeNull();
  });

  it('never infers coaching opportunities from conversions or estimates field goals from team totals', () => {
    const opportunity = { fourthDownAttempts: fact(4), fourthDownConversions: fact(2),
      fourthDownConversionRate: fact(0.5), expectedDrives: fact(12), teamTotal: fact(30) };
    const result = getNFLKickingResearch({ season: 2026, logs: [], opportunity: opportunity as NFLKickingOpportunityInput });
    expect(result.opportunity.fourthDownAttemptRate).toBeNull();
    expect(result.opportunity.facts.fourthDownOpportunities).toBeNull();
    expect(result.currentSeason.attempted.perGame).toBeNull();
    expect(result).not.toHaveProperty('projection');
    expect(result).not.toHaveProperty('ranking');
  });

  it('retains weather, venue and injury source facts without numeric adjustments or assuming a closed roof', () => {
    const weather: NFLWeatherContext = {
      venue: { id: '1', name: 'Test venue', indoor: true, city: null, state: null, country: null },
      environment: 'INDOOR', kickoff: '2026-10-18T12:00:00Z', wind: { speed: 24, unit: 'mph' },
      gusts: { speed: 35, unit: 'mph' }, temperature: { value: 38, unit: 'F' },
      precipitation: { amount: 0.3, unit: 'in' }, conditions: 'Rain', severeConditions: [],
      forecastTimestamp: '2026-10-17T12:00:00Z', sourceStatus: 'UNKNOWN',
      sources: { venue: 'ESPN', geocode: null, forecast: 'Open-Meteo' }, missingFields: ['roof open/closed status'],
    };
    const injury: NFLInjuryContext = {
      player: { playerId: 1, player: 'Kicker', teamId: 1, team: 'Team', injury: 'Leg', status: 'Questionable',
        availabilityDesignation: 'QUESTIONABLE', position: 'K', evidence: 'Report', updatedAt: '2026-10-17T12:00:00Z',
        sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] },
      team: 'Team', teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' },
      lastUpdated: '2026-10-17T12:00:00Z', missingFields: [],
    };
    const input = { season: 2026, logs: [log(1, { fgm: 2, fga: 3 })] };
    const baseline = getNFLKickingResearch(input);
    const result = getNFLKickingResearch({ ...input, weatherContext: weather, injuryContext: injury });
    expect(result.weatherContext).toEqual(weather);
    expect(result.injuryContext).toEqual(injury);
    expect(result.currentSeason).toEqual(baseline.currentSeason);
    expect(result.unavailableEvidence.some((entry) => entry.id === 'weather.roofOpenClosed')).toBe(true);
    expect(result.evidence.find((entry) => entry.id === 'weather.wind')).toMatchObject({ source: 'Open-Meteo', retrievedAt: weather.forecastTimestamp });
  });

  it('makes all absent contexts and missing distance evidence explicit without favorable defaults', () => {
    const result = getNFLKickingResearch({ season: 2026, logs: [] });
    expect(result.weatherContext).toBeNull();
    expect(result.injuryContext).toBeNull();
    expect(result.unavailableEvidence.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      'career.sample', 'weather.wind', 'weather.temperature', 'weather.precipitation', 'weather.roofOpenClosed',
      'injury.context', 'opportunity.fourthDownOpportunities', 'currentSeason.from50Plus.accuracy',
    ]));
    expect(result.unavailableEvidence.every((entry) => entry.reason)).toBe(true);
    expect(result).toEqual(getNFLKickingResearch({ season: 2026, logs: [] }));
  });
});