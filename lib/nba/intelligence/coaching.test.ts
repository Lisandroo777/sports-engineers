import { describe, expect, it } from 'vitest';
import { createReviewedClaim } from './claims';
import { createRevision } from './documents';
import { buildNBAIntelligence } from './engine';
import { fixtureInput, source } from './fixtures';

describe('exact coaching statement attribution', () => {
  function inputFor(text: string, value = '24 minutes') {
    const input = fixtureInput();
    const document = createRevision({ sourceId: source.id, url: 'https://team.example/news/coach', mediaType: 'REVIEWED_TEXT', bytes: text, fetchedAt: '2026-10-07T21:00:00Z',
      parsed: { title: 'Pregame interview', author: null, text, publishedAt: '2026-10-07T20:00:00Z', updatedAt: null, originalUrls: [], issues: [] } });
    const base = input.claims[0];
    const claim = createReviewedClaim(document, { ...base, topic: 'MINUTES_RESTRICTION', playerIds: [1], lineupLevel: null, value,
      speaker: { name: 'Fixture Coach', role: 'COACH', teamId: 1, verifiedProfileUrl: 'https://team.example/coaches/fixture', verifiedAt: '2026-10-01T00:00:00Z', eventDate: '2026-10-07' },
      excerpt: text, reviewedAt: '2026-10-07T21:00:00Z' });
    return { ...input, documents: [document], claims: [claim] };
  }
  it('retains exact quote context, speaker date and non-guarantee counterarguments', () => {
    const snapshot = buildNBAIntelligence(inputFor('Fixture Coach said: "Player 1 will be limited to 24 minutes tonight."'));
    expect(snapshot.coaching[0].claim.speaker?.name).toBe('Fixture Coach');
    expect(snapshot.coaching[0].claim.evidence.excerpt).toContain('24 minutes tonight');
    expect(snapshot.evidence[0].direction).toBe('OPPOSING');
    expect(snapshot.evidence[0].detail).toContain('not a guaranteed');
  });
  it('never invents numeric limits or ignore explicit negation', () => {
    expect(buildNBAIntelligence(inputFor('Fixture Coach said the plan is undecided.')).coaching[0].state).toBe('UNKNOWN');
    expect(buildNBAIntelligence(inputFor('Fixture Coach said: "Player 1 has no minutes restriction."')).coaching[0].state).toBe('UNKNOWN');
  });
  it('requires statement date and does not make an old republished comment current', () => {
    const missing = inputFor('Fixture Coach said: "24 minutes tonight."');
    missing.claims[0] = { ...missing.claims[0], statementAt: null };
    expect(buildNBAIntelligence(missing).coaching[0].state).toBe('UNKNOWN');
    const old = inputFor('Fixture Coach said: "24 minutes tonight."');
    old.claims[0] = { ...old.claims[0], statementAt: '2026-10-01T20:00:00Z', speaker: { ...old.claims[0].speaker!, eventDate: '2026-10-01' } };
    expect(buildNBAIntelligence(old).coaching[0].state).toBe('STALE');
  });
});