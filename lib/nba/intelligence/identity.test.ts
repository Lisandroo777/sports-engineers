import { describe, expect, it } from 'vitest';
import { resolveIdentity } from './identity';
import { fixtureInput } from './fixtures';

describe('dated player identity matching', () => {
  it('requires exact team-scoped names/aliases and rejects ambiguous names or stale membership', () => {
    const identities = fixtureInput().identities;
    expect(resolveIdentity('Player 1', 1, '2026-10-07T23:00:00Z', identities).playerId).toBe(1);
    expect(resolveIdentity('Player', 1, '2026-10-07T23:00:00Z', identities).playerId).toBeNull();
    expect(resolveIdentity('Player 1', 2, '2026-10-07T23:00:00Z', identities).playerId).toBeNull();
    expect(resolveIdentity('Player 1', 1, '2026-10-07T23:00:00Z', [...identities, { ...identities[0], espnId: 99 }]).reason).toContain('Ambiguous');
    expect(resolveIdentity('Player 1', 1, '2026-10-07T23:00:00Z', [{ ...identities[0], validTo: '2026-09-01T00:00:00Z' }]).playerId).toBeNull();
  });
});