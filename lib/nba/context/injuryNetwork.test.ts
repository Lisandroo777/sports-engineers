import { describe, expect, it } from 'vitest';
import { buildInjuryNetwork } from './injuryNetwork';
import { fixtureEnvironment, fixtureGame, fixturePlayer, fixtureSource, fixtureStats } from './fixtures';

describe('participation-conditioned injury network', () => {
  function environment(count = 10) {
    const games = Array.from({ length: count }, (_, index) => {
      const game = fixtureGame(index + 1);
      game.teams[0].players[0].stats = fixtureStats({ minutes: index < count / 2 ? 25 : 35, assists: index < count / 2 ? 3 : 7 });
      if (index >= count / 2) game.teams[0].players[1] = fixturePlayer(11, { didNotPlay: true, stats: fixtureStats({ minutes: null }), dnpReason: 'INJURY' });
      return game;
    });
    const env = fixtureEnvironment(games);
    env.snapshot.injuries = [{ playerId: 11, teamId: 1, status: 'QUESTIONABLE', rawStatus: 'Questionable', comment: null, source: fixtureSource() }];
    return env;
  }
  it('uses measured cohorts and labels future opportunity as conditional inference', () => {
    const env = environment();
    const result = buildInjuryNetwork(env);
    expect(result.edges[0].cohorts.with).toHaveLength(5);
    expect(result.edges[0].cohorts.without).toHaveLength(5);
    expect(env.evidence.find(entry => entry.id === 'injuryNetwork.11.assists')?.value).toMatchObject({ difference: 4 });
    const scenario = env.evidence.find(entry => entry.id === 'injuryNetwork.11.assists.scenario')!;
    expect(scenario.kind).toBe('INFERENCE');
    expect(scenario.detail).toContain('IF');
    expect(scenario.reliability).toBe('LOW');
  });
  it('does not use missing teammate rows, changed roles or unmatched additional absences', () => {
    const env = environment();
    env.teamGames[5].teams[0].players = [fixturePlayer()];
    env.teamGames[6].teams[0].players[0].starter = false;
    for (const game of env.teamGames.slice(7)) game.teams[0].players.push(fixturePlayer(12, { didNotPlay: true }));
    const edge = buildInjuryNetwork(env).edges[0];
    expect(edge.cohorts.without).toHaveLength(0);
    expect(edge.state).toBe('UNKNOWN');
    expect(edge.cohorts.excluded.join(' ')).toContain('unmatched other-DNP');
  });
  it('keeps tiny samples descriptive without a benefit inference', () => {
    const env = environment(2);
    buildInjuryNetwork(env);
    expect(env.evidence.some(entry => entry.kind === 'INFERENCE')).toBe(false);
    expect(env.evidence.find(entry => entry.id === 'injuryNetwork.11.minutes')?.reliability).toBe('LOW');
  });
  it('does not pool roster changes or stale reports into opportunity inference', () => {
    const env = environment();
    for (const game of env.teamGames.slice(5)) game.teams[0].players.push(fixturePlayer(99, { starter: false }));
    const result = buildInjuryNetwork(env);
    expect(result.edges[0].cohorts.without).toHaveLength(0);
    expect(env.evidence.some(entry => entry.kind === 'INFERENCE')).toBe(false);
    const stale = environment();
    stale.snapshot.injuries[0].source.updatedAt = '2025-12-01T12:00:00Z';
    expect(buildInjuryNetwork(stale).edges[0].currentStatus).toBe('UNKNOWN');
    expect(stale.evidence.some(entry => entry.kind === 'INFERENCE')).toBe(false);
  });
});