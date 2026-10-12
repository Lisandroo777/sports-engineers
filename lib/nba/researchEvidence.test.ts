import { describe, expect, it } from 'vitest';
import { buildNBAResearchContext } from './context/engine';
import { fixtureEnvironment } from './context/fixtures';
import { buildNBAIntelligence } from './intelligence/engine';
import { fixtureInput } from './intelligence/fixtures';
import { buildNBAResearchEvidence } from './researchEvidence';

function fixtureContext() {
  const env = fixtureEnvironment();
  const asOf = '2026-10-07T22:00:00Z';
  env.request = { ...env.request, gameId: '100', asOf };
  env.snapshot.asOf = asOf;
  env.snapshot.target = { ...env.snapshot.target, gameId: '100', startsAt: '2026-10-07T23:00:00Z', seasonId: '2026', phase: 'REGULAR', completed: false, completedAt: null };
  return buildNBAResearchContext(env.request, env.snapshot);
}

describe('active NBA research evidence adapter', () => {
  it('carries market context and cited current reports without converting them into scores', () => {
    const context = fixtureContext();
    const intelligence = buildNBAIntelligence(fixtureInput());
    const evidence = buildNBAResearchEvidence({ gameId: '100', market: 'points', playerId: 10, teamIds: [1, 2], context, intelligence });
    const report = evidence.intelligence.reports.find(item => item.topic === 'LINEUP');

    expect(evidence.context.state).toBe('PARTIAL');
    expect(evidence.context.schedule?.homeAway).toBe('HOME');
    expect(evidence.context.evidence.some(item => item.id === 'schedule.rest')).toBe(true);
    expect(evidence.context.evidence.some(item => item.id === 'opponent.allowed.points')).toBe(true);
    expect(evidence.intelligence.state).toBe('PARTIAL');
    expect(report).toMatchObject({ verification: 'OFFICIAL', state: 'CURRENT', value: 'STARTING_FIVE' });
    expect(report?.source).toMatchObject({ url: 'https://team.example/news/lineup', publishedAt: '2026-10-07T20:00:00Z', fetchedAt: '2026-10-07T21:00:00.000Z' });
    expect(report?.excerpt).toContain('Starting five');
    expect(evidence.intelligence.lineups[0].level).toBe('OFFICIALLY_CONFIRMED');
    expect(evidence).not.toHaveProperty('probability');
    expect(evidence).not.toHaveProperty('ev');
    expect(evidence).not.toHaveProperty('tier');
  });

  it('keeps missing sources unavailable and omits reports learned after cutoff', () => {
    const absent = buildNBAResearchEvidence({ gameId: '100', market: 'points', playerId: 1, teamIds: [1, 2] });
    const input = fixtureInput();
    input.claims[0] = { ...input.claims[0], reportedAt: '2026-10-07T23:01:00Z', statementAt: '2026-10-07T23:01:00Z' };
    const late = buildNBAIntelligence(input);
    const afterCutoff = buildNBAResearchEvidence({ gameId: '100', market: 'points', playerId: 1, teamIds: [1, 2], intelligence: late });

    expect(absent.context.state).toBe('UNAVAILABLE');
    expect(absent.context.availability).toBeNull();
    expect(absent.intelligence.state).toBe('UNAVAILABLE');
    expect(afterCutoff.intelligence.reports).toEqual([]);
    expect(afterCutoff.intelligence.missing).toContain('One or more reports were excluded because they were first observed, updated, reviewed or reported after the target cutoff.');
  });

  it('rejects an intelligence snapshot for a different matchup', () => {
    const evidence = buildNBAResearchEvidence({
      gameId: '100', market: 'points', playerId: 1, teamIds: [1, 2],
      intelligence: buildNBAIntelligence({ ...fixtureInput(), target: { ...fixtureInput().target, homeTeamId: 8, awayTeamId: 9 } }),
    });
    expect(evidence.intelligence.state).toBe('UNAVAILABLE');
    expect(evidence.intelligence.reports).toEqual([]);
  });

  it('rejects context for a different player or game', () => {
    const context = fixtureContext();
    const mismatched = buildNBAResearchEvidence({ gameId: 'other-game', market: 'points', playerId: 1, teamIds: [1, 2], context });
    expect(mismatched.context.state).toBe('UNAVAILABLE');
    expect(mismatched.context.evidence).toEqual([]);
    expect(mismatched.context.missing[0]).toContain('identity did not match');
  });
});