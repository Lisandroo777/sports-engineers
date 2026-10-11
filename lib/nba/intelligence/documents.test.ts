import { describe, expect, it } from 'vitest';
import { canonicalUrl, createRevision, parseArticle } from './documents';

const url = 'https://www.nba.com/celtics/news/fixture';
const html = '<script type="application/ld+json">{"@type":"NewsArticle","headline":"Report","author":{"name":"Taylor Snow"},"datePublished":"2026-10-07T12:00:00-04:00","articleBody":"Coach says the lineup is not decided."}</script>';
describe('revision-safe article normalization', () => {
  it('uses structured metadata and retains negation rather than extracting a lineup from a headline', () => {
    expect(parseArticle(html, url)).toMatchObject({ author: 'Taylor Snow', publishedAt: '2026-10-07T16:00:00.000Z', text: 'Coach says the lineup is not decided.' });
    expect(parseArticle('<h1>Player will start</h1>', url).text).toBe('');
  });
  it('preserves revisions and first observation without refreshing unchanged content', () => {
    const first = createRevision({ sourceId: 'team', url, bytes: html, mediaType: 'HTML', fetchedAt: '2026-10-07T17:00:00Z', parsed: parseArticle(html, url) });
    expect(createRevision({ sourceId: 'team', url, bytes: html, mediaType: 'HTML', fetchedAt: '2026-10-07T18:00:00Z', parsed: parseArticle(html, url), previous: first })).toBe(first);
    const changed = createRevision({ sourceId: 'team', url, bytes: `${html}new`, mediaType: 'HTML', fetchedAt: '2026-10-07T19:00:00Z', parsed: { ...parseArticle(html, url), text: 'Correction' }, previous: first });
    expect(changed.supersedesRevisionId).toBe(first.revisionId);
    expect(changed.firstSeenAt).toBe('2026-10-07T19:00:00.000Z');
    expect(Object.isFrozen(changed)).toBe(true);
  });
  it('does not guess timezone or tolerate private/non-HTTPS URLs', () => {
    expect(parseArticle(html.replace('2026-10-07T12:00:00-04:00', 'October 7'), url).publishedAt).toBeNull();
    expect(canonicalUrl(`${url}?utm_source=x#top`)).toBe(url);
    expect(() => canonicalUrl('http://localhost/private')).toThrow('HTTPS');
  });
});