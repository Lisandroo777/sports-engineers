import { describe, expect, it } from 'vitest';
import { buildNBAIntelligence } from './engine';
import { fixtureInput, source } from './fixtures';

describe('standalone intelligence and changes', () => {
  it('does not announce a late change on first collection and deduplicates combination evidence', () => {
    const snapshot = buildNBAIntelligence(fixtureInput());
    expect(snapshot.changes).toEqual([]);
    expect(snapshot.lineups[0].level).toBe('OFFICIALLY_CONFIRMED');
    expect(snapshot.marketViews.pra.evidenceIds).toHaveLength(4);
    expect(Object.keys(snapshot.marketViews.pra.groupedEvidence)).toHaveLength(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    for (const key of ['probability', 'projection', 'ev', 'rank', 'tier', 'score']) expect(snapshot).not.toHaveProperty(key);
  });
  it('retains conflicts and never resolves them merely by newest timestamp', () => {
    const input = fixtureInput();
    const previous = buildNBAIntelligence(input);
    const second = { ...input.claims[0], id: 'contradiction', value: 'DIFFERENT_FIVE', playerIds: [1, 2, 3, 4, 6], reportedAt: '2026-10-07T21:30:00Z' };
    input.claims.push(second);
    const current = buildNBAIntelligence({ ...input, previous });
    expect(current.lineups[0].state).toBe('CONFLICTED');
    expect(current.lineups[0].playerIds).toEqual([]);
  });
  it('does not promote rumors or old coaching comments into current facts', () => {
    const input = fixtureInput(); input.claims[0] = { ...input.claims[0], topic: 'MINUTES_RESTRICTION', qualifier: 'RUMOR', lineupLevel: null };
    const snapshot = buildNBAIntelligence(input);
    expect(snapshot.claims[0].verification).toBe('RUMOR');
    expect(snapshot.evidence[0].direction).toBe('UNKNOWN');
    expect(snapshot.evidence[0].kind).toBe('UNAVAILABLE');
  });
  it('tracks explicit corrections while preserving the old revision', () => {
    const input = fixtureInput(); const previous = buildNBAIntelligence(input);
    const original = input.claims[0];
    input.claims.push({ ...original, id: 'correction', reportedAt: '2026-10-07T21:30:00Z', value: 'UPDATED', correctionOf: original.id });
    const current = buildNBAIntelligence({ ...input, previous });
    expect(current.claims.find(record => record.claim.id === original.id)?.state).toBe('SUPERSEDED');
    expect(current.changes.some(change => change.type === 'CORRECTION')).toBe(true);
    expect(current.coverage.refreshMode).toBe('MANUAL');
    expect(source.id).toBe('official-fixture');
  });
});