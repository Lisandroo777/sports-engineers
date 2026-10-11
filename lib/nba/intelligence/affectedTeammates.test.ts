import { describe, expect, it } from 'vitest';
import { buildNBAIntelligence } from './engine';
import { fixtureInput } from './fixtures';
import { buildNBAResearchContext } from '../context/engine';
import { fixtureEnvironment } from '../context/fixtures';

describe('read-only existing Injury Network handoff', () => {
  it('uses only measured existing edges and does not manufacture beneficiaries or mutate context', () => {
    const env = fixtureEnvironment();
    const baseline = buildNBAResearchContext(env.request, env.snapshot);
    const input = fixtureInput();
    input.claims[0] = { ...input.claims[0], topic: 'INJURY', playerIds: [1], value: 'OUT', lineupLevel: null };
    const context = { ...baseline, gameId: '100', teamId: 1, playerId: 2, asOf: '2026-10-07T21:00:00Z', cutoff: '2026-10-07T21:00:00Z',
      evidence: [{ ...baseline.evidence[0], id: 'measured-cohort', kind: 'DERIVED' as const, value: { difference: 2 }, sample: { gameIds: ['one'], from: '2026-10-01', to: '2026-10-01', seasonId: '2027', phase: 'REGULAR' as const, conditions: [], measured: 1, eligible: 1, excluded: [] } }],
      sections: { ...baseline.sections, injuryNetwork: { evidenceIds: ['measured-cohort'], edges: [{ teammateId: 1, currentStatus: 'OUT' as const, state: 'PARTIAL' as const, evidenceIds: ['measured-cohort'], cohorts: { with: ['one'], without: ['two'], excluded: [] }, matchedOtherDnpPatterns: ['none'], confounders: ['Small cohort'] }] } } };
    const original = JSON.stringify(context);
    const snapshot = buildNBAIntelligence({ ...input, researchContexts: [context] });
    expect(snapshot.affectedTeammates[0]).toMatchObject({ playerId: 2, unavailableTeammateId: 1, contextEvidenceIds: ['measured-cohort'] });
    expect(snapshot.affectedTeammates[0].detail).toContain('No automatic');
    expect(JSON.stringify(context)).toBe(original);
    expect(buildNBAIntelligence({ ...input, researchContexts: [{ ...context, gameId: 'other' }] }).affectedTeammates).toEqual([]);
    expect(buildNBAIntelligence({ ...input, researchContexts: [{ ...context, asOf: '2026-10-08T21:00:00Z' }] }).affectedTeammates).toEqual([]);
  });
});