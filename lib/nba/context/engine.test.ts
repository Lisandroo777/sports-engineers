import { describe, expect, it } from 'vitest';
import { buildNBAResearchContext } from './engine';
import { fixtureEnvironment, fixtureGame } from './fixtures';

describe('standalone context orchestration', () => {
  it('excludes target, future, other seasons/phases and unverified finals', () => {
    const env = fixtureEnvironment();
    env.snapshot.games.push(env.snapshot.target, fixtureGame(22), fixtureGame(3, { phase: 'PRESEASON' }), fixtureGame(4, { seasonId: '2025' }), fixtureGame(5, { completedAt: null }));
    const context = buildNBAResearchContext(env.request, env.snapshot);
    expect(context.coverage.playerTeamGames).toBe(2);
    expect(context.coverage.priorCompletedGames).toBe(3);
    expect(context.evidence.find(entry => entry.id === 'season.samples')?.value).toMatchObject({ PRESEASON: 1, REGULAR: 2 });
    expect(context.cutoff).toBe(env.snapshot.asOf);
  });
  it('is deterministic and rejects conflicting duplicate game data', () => {
    const env = fixtureEnvironment();
    expect(buildNBAResearchContext(env.request, env.snapshot)).toEqual(buildNBAResearchContext(env.request, env.snapshot));
    env.snapshot.games.push({ ...env.snapshot.games[0], homeScore: 999 });
    expect(buildNBAResearchContext(env.request, env.snapshot).coverage.playerTeamGames).toBe(1);
  });
  it('rejects mismatched identities and future observation time', () => {
    const env = fixtureEnvironment();
    expect(() => buildNBAResearchContext({ ...env.request, teamId: 99 }, env.snapshot)).toThrow('identity');
    expect(() => buildNBAResearchContext({ ...env.request, asOf: '2026-02-01' }, env.snapshot)).toThrow('asOf');
  });
  it('does not reconstruct historical facts from later-collected results or current injuries', () => {
    const env = fixtureEnvironment();
    const request = { ...env.request, asOf: '2026-01-10T18:00:00Z' };
    const context = buildNBAResearchContext(request, env.snapshot);
    expect(context.coverage.priorCompletedGames).toBe(0);
    expect(context.sections.availability.status).toBe('UNKNOWN');
    expect(context.marketViews.points.missing.length).toBeGreaterThan(0);
  });
  it('keeps small playoff samples separate and does not manufacture eligibility failure', () => {
    const env = fixtureEnvironment();
    env.snapshot.target.phase = 'POSTSEASON';
    env.snapshot.games.push(fixtureGame(3, { phase: 'POSTSEASON' }));
    const context = buildNBAResearchContext(env.request, env.snapshot);
    expect(context.coverage.playerTeamGames).toBe(1);
    expect(context.evidence.find(entry => entry.id === 'rotation.minutes.l5')?.sample?.measured).toBe(1);
    expect(context.evidence.find(entry => entry.id === 'rotation.minutes.l5')?.reliability).toBe('LOW');
    expect(context).not.toHaveProperty('eligible');
  });
});