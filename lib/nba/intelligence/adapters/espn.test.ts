import { describe, expect, it } from 'vitest';
import { espnInjuryClaims, espnInjuryRevision } from './espn';
import { fixtureInput, target } from '../fixtures';
import { buildNBAIntelligence } from '../engine';

describe('secondary injury source applicability', () => {
  it('does not attach a non-game-specific injury report to tonight automatically', () => {
    const payload = { timestamp: '2026-10-07T20:00:00Z', injuries: [{ id: '1', injuries: [{ athlete: { id: '1' }, status: 'Questionable', date: '2026-10-07T19:00:00Z' }] }] };
    const document = espnInjuryRevision(payload, '2026-10-07T21:00:00Z');
    const input = fixtureInput();
    const claims = espnInjuryClaims(payload, document, target, input.identities);
    expect(claims[0].gameId).toBeNull();
    expect(buildNBAIntelligence({ ...input, sources: undefined, documents: [document], claims }).claims[0].state).toBe('UNKNOWN');
  });
  it('rejects malformed data and unknown/day-to-day status without inventing ACTIVE', () => {
    const payload = { timestamp: '2026-10-07T20:00:00Z', injuries: [{ id: '1', injuries: [{ athlete: { id: '1' }, status: 'Day-To-Day', date: '2026-10-07T19:00:00Z' }] }] };
    const document = espnInjuryRevision(payload, '2026-10-07T21:00:00Z');
    expect(espnInjuryClaims(payload, document, target, fixtureInput().identities)).toEqual([]);
    expect(espnInjuryRevision({}, '2026-10-07T21:00:00Z').issues).toContain('Malformed injury feed.');
  });
});