import { describe, expect, it } from 'vitest';
import { buildRotation, reconstructRotation } from './rotation';
import { fixtureEnvironment, fixtureGame, fixturePlayer, fixtureStats } from './fixtures';

describe('observed rotation intelligence', () => {
  it('distinguishes bench, explicit DNP and missing rows', () => {
    const games = [fixtureGame(1), fixtureGame(2), fixtureGame(3)];
    games[0].teams[0].players[0] = fixturePlayer(10, { starter: false });
    games[1].teams[0].players[0] = fixturePlayer(10, { didNotPlay: true, stats: fixtureStats({ minutes: null }), dnpReason: 'INJURY' });
    games[2].teams[0].players = [];
    const result = buildRotation(fixtureEnvironment(games));
    expect(result).toMatchObject({ recentRole: 'BENCH', playedGames: 1, dnpGames: 1, missingGames: 1, currentStarter: 'UNKNOWN', restriction: 'UNKNOWN' });
  });
  it('reconciles full starter stints and rejects missing boundaries or totals', () => {
    const game = fixtureGame(1);
    game.teams[0].players = [1, 2, 3, 4, 5].map(id => fixturePlayer(id, { stats: fixtureStats({ minutes: 48 }) }));
    game.plays = [1, 2, 3, 4].map(period => ({ id: String(period), sequence: period, period, secondsRemaining: 0, wallclock: game.completedAt, type: 'End Quarter', text: 'End Quarter', teamId: null, participantIds: [], homeScore: 100, awayScore: 90 }));
    expect(reconstructRotation(game, 1).byPlayer[1].minutes).toBe(48);
    expect(reconstructRotation({ ...game, plays: game.plays.slice(1) }, 1).state).toBe('UNAVAILABLE');
    game.teams[0].players[0].stats.minutes = 35;
    expect(reconstructRotation(game, 1).reason).toContain('reconcile');
  });
  it('does not label low minutes or a large margin as a guaranteed blowout cause', () => {
    const env = fixtureEnvironment([fixtureGame(1, { homeScore: 140, awayScore: 90 })]);
    buildRotation(env);
    expect(env.evidence.find(entry => entry.id === 'rotation.stints')?.value).toBeNull();
    expect(env.evidence.find(entry => entry.id === 'rotation.stints')?.detail).toContain('not proof');
  });
  it('attributes exact substitution participants and reconciles overtime minutes', () => {
    const game = fixtureGame(1);
    game.teams[0].players = [1, 2, 3, 4, 5].map(id => fixturePlayer(id, { stats: fixtureStats({ minutes: id === 1 ? 6 : 53 }) }));
    game.teams[0].players.push(fixturePlayer(6, { starter: false, stats: fixtureStats({ minutes: 47 }) }));
    const substitute = { id: 'sub', sequence: 1, period: 1, secondsRemaining: 360, wallclock: null, type: 'Substitution', text: 'Player 6 enters the game for Player 1', teamId: 1, participantIds: [6, 1], homeScore: 10, awayScore: 5 };
    const endings = [1, 2, 3, 4, 5].map(period => ({ id: `end-${period}`, sequence: period + 1, period, secondsRemaining: 0, wallclock: game.completedAt, type: 'End Quarter', text: 'End Quarter', teamId: null, participantIds: [], homeScore: 100, awayScore: 90 }));
    game.plays = [substitute, ...endings];
    const result = reconstructRotation(game, 1);
    expect(result.state).toBe('AVAILABLE');
    expect(result.byPlayer[6].minutes).toBe(47);
    expect(result.byPlayer[2].periods[5]).toBe(5);
    expect(result.byPlayer[1].exits).toEqual([{ period: 1, secondsRemaining: 360, margin: 5 }]);
    expect(reconstructRotation({ ...game, plays: [{ ...substitute, participantIds: [6] }, ...endings] }, 1).state).toBe('UNAVAILABLE');
    expect(reconstructRotation({ ...game, plays: game.plays.filter(play => play.id !== 'end-4') }, 1).state).toBe('UNAVAILABLE');
  });
  it('keeps zero-rounded minutes distinct from a documented DNP and reports return observations', () => {
    const games = [fixtureGame(1), fixtureGame(2), fixtureGame(3)];
    games[0].teams[0].players[0] = fixturePlayer(10, { didNotPlay: true, dnpReason: 'REST', stats: fixtureStats({ minutes: null }) });
    games[1].teams[0].players[0].stats.minutes = 0;
    const env = fixtureEnvironment(games);
    const rotation = buildRotation(env);
    expect(rotation).toMatchObject({ dnpGames: 1, missingGames: 1, playedGames: 1 });
    expect(env.evidence.find(entry => entry.id === 'rotation.return')?.value).toMatchObject({ reportedDnpReason: 'REST', playedAfter: 'game-3' });
  });
});