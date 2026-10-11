import { describe, expect, it } from 'vitest';
import { buildNBAIntelligence } from './engine';
import { fixtureInput } from './fixtures';

describe('market-specific intelligence without model effects', () => {
  it('separates facts from market interpretations and keeps combinations correlated', () => {
    const snapshot = buildNBAIntelligence(fixtureInput());
    expect(snapshot.evidence.find(entry => entry.markets.length === 1 && entry.markets[0] === 'assists')?.detail).toContain('ball-handling');
    expect(snapshot.evidence.find(entry => entry.markets.length === 1 && entry.markets[0] === 'rebounds')?.counterarguments.join(' ')).toContain('absent center');
    expect(snapshot.marketViews['3pm'].evidenceIds).toHaveLength(2);
    expect(snapshot.marketViews.pra.evidenceIds).toHaveLength(4);
    expect(Object.keys(snapshot.marketViews.pra.groupedEvidence)).toHaveLength(1);
    expect(snapshot.evidence.filter(entry => entry.markets.length === 1).every(entry => entry.kind === 'INFERENCE')).toBe(true);
  });
  it('retains cited provenance without duplicating the same story evidence', () => {
    const input = fixtureInput();
    input.claims.push({ ...input.claims[0], id: 'cited-copy', originalClaimId: input.claims[0].id, originalUrls: [input.documents[0].url], independence: 'CITED' });
    const snapshot = buildNBAIntelligence(input);
    expect(snapshot.claims).toHaveLength(2);
    expect(snapshot.marketViews.points.evidenceIds).toHaveLength(2);
    expect(snapshot.evidence[0].claimIds).toContain('cited-copy');
  });
});