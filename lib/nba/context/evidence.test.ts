import { describe, expect, it } from 'vitest';
import { freshness, priorCompleted } from './evidence';
import type { ContextGame, SourceReference } from './types';

const source: SourceReference = { id: 'injury', provider: 'ESPN', url: 'https://site.api.espn.com', recordId: null, publishedAt: '2026-01-01T10:00:00Z', updatedAt: null, fetchedAt: '2026-01-02T10:00:00Z', freshness: 'UNKNOWN' };
describe('temporal evidence boundaries', () => {
  it('distinguishes stale and post-cutoff fetches from current facts', () => {
    expect(freshness(source, '2026-01-02T12:00:00Z', 6)).toBe('STALE');
    expect(freshness(source, '2026-01-01T12:00:00Z', 6)).toBe('AFTER_CUTOFF');
    expect(freshness({ ...source, publishedAt: null }, '2026-01-02T12:00:00Z', 6)).toBe('UNKNOWN');
  });
  it('requires completion proof and excludes target/future/other-season games', () => {
    const target = { gameId: 'target', seasonId: '2026' } as ContextGame;
    const prior = { gameId: 'prior', seasonId: '2026', completed: true, completedAt: '2026-01-01T22:00:00Z', startsAt: '2026-01-01T20:00:00Z', source } as ContextGame;
    const cutoff = '2026-01-02T18:00:00Z';
    expect(priorCompleted(prior, target, cutoff)).toBe(true);
    for (const change of [{ gameId: 'target' }, { seasonId: '2025' }, { completedAt: null }, { completedAt: '2026-01-03T22:00:00Z' }]) expect(priorCompleted({ ...prior, ...change }, target, cutoff)).toBe(false);
  });
});