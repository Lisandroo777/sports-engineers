import { describe, expect, it } from 'vitest';
import { buildOpponent } from './opponent';
import { fixtureEnvironment } from './fixtures';

describe('opponent allowance semantics', () => {
  it('uses the other team stats, not the opponent own offensive production', () => {
    const env = fixtureEnvironment();
    for (const game of env.games) {
      game.teams[0].stats.points = 120;
      game.teams[1].stats.points = 80;
    }
    buildOpponent(env);
    expect(env.evidence.find(entry => entry.id === 'opponent.allowed.points')?.value).toMatchObject({ mean: 120 });
    expect(env.evidence.find(entry => entry.id === 'opponent.allowed.paint')?.value).toMatchObject({ mean: 40 });
    expect(env.evidence.find(entry => entry.id === 'opponent.rimProfile')?.kind).toBe('UNAVAILABLE');
  });
  it('never invents pace when possessions inputs or period coverage are missing', () => {
    const env = fixtureEnvironment();
    buildOpponent(env);
    expect(env.evidence.find(entry => entry.id === 'opponent.paceEstimate')?.value).toBeNull();
    expect(env.evidence.find(entry => entry.id === 'opponent.spreadTotal')?.kind).toBe('UNAVAILABLE');
  });
  it('labels pace as an estimate and normalizes overtime rather than counting it as extra pace', () => {
    const env = fixtureEnvironment();
    for (const game of env.games) game.plays = [{ id: 'end', sequence: 1, period: 5, secondsRemaining: 0, wallclock: game.completedAt, type: 'End Game', text: 'End Game', teamId: null, participantIds: [], homeScore: 100, awayScore: 90 }];
    buildOpponent(env);
    const estimated = ((80 + 0.44 * 5 - 8 + 12) + (85 + 0.44 * 5 - 10 + 15)) / 2 * 48 / 53;
    expect(env.evidence.find(entry => entry.id === 'opponent.paceEstimate')?.value).toMatchObject({ mean: estimated });
    expect(env.evidence.find(entry => entry.id === 'opponent.paceEstimate')?.detail).toContain('Not official pace');
    expect(env.evidence.find(entry => entry.id === 'opponent.offense.points')?.metric).toBe('opponentOffensivePoints');
  });
});