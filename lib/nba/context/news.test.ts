import { describe, expect, it } from 'vitest';
import { buildNews } from './news';
import { fixtureEnvironment, fixtureSource } from './fixtures';

describe('attributed news safety', () => {
  it('retains report attribution without turning comments into restrictions', () => {
    const env = fixtureEnvironment();
    env.snapshot.news = [{ id: 'report', headline: 'Coach discusses return', text: 'Might play limited minutes', playerIds: [10], teamIds: [], source: fixtureSource('report') }];
    buildNews(env);
    expect(env.evidence[0].kind).toBe('FACT');
    expect(env.evidence[0].detail).toContain('not independent verification');
  });
  it('excludes post-cutoff edits, missing timestamps and unrelated identities', () => {
    const env = fixtureEnvironment();
    env.snapshot.news = [{ id: 'future', headline: 'Future', text: null, playerIds: [10], teamIds: [], source: { ...fixtureSource(), updatedAt: '2026-01-22T12:00:00Z' } }, { id: 'unrelated', headline: 'Other', text: null, playerIds: [99], teamIds: [], source: fixtureSource() }];
    expect(buildNews(env).evidenceIds).toEqual(['news.coverage']);
  });
});