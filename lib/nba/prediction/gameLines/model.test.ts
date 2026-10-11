import { describe, expect, it } from 'vitest';
import { projectNBAGame } from './model';
import { historicalFixture } from './fixtures';

describe('Isolated NBA game-line joint foundation', () => {
  it('keeps score, margin, total, covariance and win probabilities internally consistent', () => {
    const model = projectNBAGame(historicalFixture());
    expect(model.status).toBe('AVAILABLE');
    expect(model.means!.margin).toBeCloseTo(model.means!.homeScore - model.means!.awayScore);
    expect(model.means!.total).toBeCloseTo(model.means!.homeScore + model.means!.awayScore);
    expect(model.scenarios.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(1);
    expect(model.scenarios.every(row => Number.isInteger(row.homeScore) && Number.isInteger(row.awayScore) && row.homeScore !== row.awayScore)).toBe(true);
    expect(model.uncertainty!.total ** 2).toBeCloseTo(model.uncertainty!.homeScore ** 2 + model.uncertainty!.awayScore ** 2 + 2 * model.uncertainty!.scoreCovariance);
    expect(model.validationStatus).toBe('UNVALIDATED');
    expect(model.epistemicPriorWeight).toBeCloseTo(2 / 22);
    expect(model.homeWinProbability).toBeLessThan(1);
    expect(model.homeWinProbability).toBeGreaterThan(0);
  });
  it('excludes future, target, post-cutoff retrieval and other-phase games without changing the forecast', () => {
    const fixture = historicalFixture();
    const baseline = projectNBAGame(fixture);
    const future = structuredClone(fixture.snapshot.games[0]);
    future.gameId = 'future'; future.source.fetchedAt = '2026-01-22T00:00:00Z';
    fixture.snapshot.games.push(future, fixture.snapshot.target, { ...future, gameId: 'preseason', phase: 'PRESEASON', source: { ...future.source, fetchedAt: fixture.predictionAt } });
    const result = projectNBAGame(fixture);
    expect(result.means).toEqual(baseline.means);
    expect(result.exclusions.map(row => row.gameId)).toEqual(expect.arrayContaining(['future', 'target', 'preseason']));
  });
  it('fails closed for early samples, missing possessions, unknown phase, and post-tipoff predictions', () => {
    const fixture = historicalFixture();
    fixture.snapshot.games = fixture.snapshot.games.slice(0, 9);
    expect(projectNBAGame(fixture).status).toBe('INSUFFICIENT_DATA');
    const missing = historicalFixture();
    missing.snapshot.games.forEach(game => { game.teams[0].stats.fga = null; });
    expect(projectNBAGame(missing).means).toBeNull();
    const unknown = historicalFixture(); unknown.snapshot.target.phase = 'UNKNOWN';
    expect(projectNBAGame(unknown).status).toBe('UNSUPPORTED_PHASE');
    const late = historicalFixture(); late.predictionAt = late.snapshot.target.startsAt;
    expect(projectNBAGame(late).status).toBe('INVALID_INPUT');
  });
  it('keeps playoffs and play-in separate and excludes preseason rather than guessing comparable games', () => {
    const fixture = historicalFixture(); fixture.snapshot.target.phase = 'POSTSEASON'; fixture.snapshot.target.round = 'Play-In';
    expect(projectNBAGame(fixture).status).toBe('INSUFFICIENT_DATA');
    fixture.snapshot.games.forEach(game => { game.phase = 'POSTSEASON'; game.round = 'First Round'; });
    expect(projectNBAGame(fixture).status).toBe('INSUFFICIENT_DATA');
    fixture.snapshot.games.forEach(game => { game.round = 'Play-In'; });
    expect(projectNBAGame(fixture)).toMatchObject({ status: 'AVAILABLE', phase: 'PLAY_IN' });
    fixture.snapshot.target.phase = 'PRESEASON';
    expect(projectNBAGame(fixture).status).toBe('UNSUPPORTED_PHASE');
  });
  it('reports observed venue/rest splits and missing injuries/lineups without inventing fatigue or injury points', () => {
    const fixture = historicalFixture();
    const original = projectNBAGame(fixture);
    expect(original.profiles!.home).toMatchObject({ venueSampleSize: 20, backToBack: false, scheduledRestDays: 1, restCoverage: 'PARTIAL' });
    fixture.snapshot.calendar.push({ ...fixture.snapshot.games[19], gameId: 'scheduled-prior-night', startsAt: '2026-01-20T23:00:00Z', completed: false, completedAt: null });
    expect(projectNBAGame(fixture).profiles!.home).toMatchObject({ backToBack: true, scheduledRestDays: 0, restCoverage: 'PARTIAL' });
    const teamInjury = { playerId: 10, teamId: 1, status: 'OUT' as const, rawStatus: 'Out', comment: null, source: fixture.snapshot.target.source };
    fixture.snapshot.injuries.push(teamInjury);
    const injured = projectNBAGame(fixture);
    expect(injured.means).toEqual(original.means);
    expect(injured.risks).toContain('Team injury reports require lineup/impact review; no generic points adjustment applied.');
    fixture.snapshot.target.neutralSite = true;
    expect(projectNBAGame(fixture).profiles!.home.venueSampleSize).toBe(0);
  });
  it('excludes conflicting duplicates, missing final period proof and overtime outcomes', () => {
    const fixture = historicalFixture();
    const conflicting = structuredClone(fixture.snapshot.games[0]); conflicting.homeScore! += 3;
    fixture.snapshot.games.push(conflicting);
    fixture.snapshot.games[1].plays = [];
    fixture.snapshot.games[2].plays.push({ ...fixture.snapshot.games[2].plays[3], period: 5 });
    const result = projectNBAGame(fixture);
    expect(result.profiles!.home.sampleSize).toBe(17);
    expect(result.exclusions.find(row => row.gameId === conflicting.gameId)?.reason).toMatch(/conflicting/i);
  });
  it('never uses future-observed intelligence or a later snapshot to claim a confirmed starting lineup', () => {
    const fixture = historicalFixture(); fixture.snapshot.asOf = '2026-01-21T19:00:00Z';
    expect(projectNBAGame(fixture).status).toBe('INVALID_INPUT');
  });
});