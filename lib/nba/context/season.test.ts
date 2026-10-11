import { describe, expect, it } from 'vitest';
import { buildSeason } from './season';
import { fixtureEnvironment, fixtureGame } from './fixtures';

describe('official season and series context', () => {
  it('does not infer season progress from incomplete schedules', () => {
    const env = fixtureEnvironment();
    expect(buildSeason(env).progress).toBe('UNKNOWN');
  });
  it('reconstructs stakes without trusting final cumulative series wins', () => {
    const env = fixtureEnvironment([1, 2, 3, 4, 5, 6].map(index => fixtureGame(index, { phase: 'POSTSEASON', homeScore: index <= 3 ? 110 : 90, awayScore: 100 })));
    env.snapshot.target.phase = 'POSTSEASON';
    env.snapshot.target.round = 'NBA Finals';
    env.snapshot.target.seriesEventIds = [...env.games.map(game => game.gameId), env.snapshot.target.gameId];
    buildSeason(env);
    expect(env.evidence.find(entry => entry.id === 'season.series')?.value).toMatchObject({ homeWins: 3, awayWins: 3, homeFacingElimination: true, awayCanClinch: true });
  });
  it('keeps missing series members and play-in stakes unknown', () => {
    const env = fixtureEnvironment();
    env.snapshot.target.phase = 'POSTSEASON';
    env.snapshot.target.round = 'Play-In';
    env.snapshot.target.seriesEventIds = ['missing', env.snapshot.target.gameId];
    buildSeason(env);
    expect(env.evidence.find(entry => entry.id === 'season.series')?.value).toBeNull();
  });
  it('does not count a missing prior series result or future member as a win', () => {
    const env = fixtureEnvironment([fixtureGame(1, { phase: 'POSTSEASON' })]);
    env.snapshot.target.phase = 'POSTSEASON';
    env.snapshot.target.round = 'First Round';
    env.snapshot.target.seriesEventIds = ['game-1', 'game-2', env.snapshot.target.gameId, 'future'];
    env.snapshot.calendar.push(fixtureGame(2, { phase: 'POSTSEASON' }), fixtureGame(22, { gameId: 'future', phase: 'POSTSEASON', completed: false }));
    buildSeason(env);
    const series = env.evidence.find(entry => entry.id === 'season.series')!;
    expect(series.value).toBeNull();
    expect(series.missingReasons.join(' ')).toContain('game-2');
    expect(series.missingReasons.join(' ')).not.toContain('future:');
  });
  it('does not label a capped late-season history as early season', () => {
    const env = fixtureEnvironment();
    env.snapshot.calendar = Array.from({ length: 82 }, (_, index) => fixtureGame(1, { gameId: `schedule-${index}`, startsAt: new Date(Date.UTC(2025, 9, 1 + index)).toISOString() }));
    expect(buildSeason(env).progress).toBe('UNKNOWN');
  });
});