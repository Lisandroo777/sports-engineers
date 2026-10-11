import { describe, expect, it } from 'vitest';
import { articleRevision, discoverLinks } from './publicArticles';
import { source } from '../fixtures';

describe('bounded public article discovery', () => {
  it('deduplicates canonical links and never crawls outside verified source paths', () => {
    const html = '<a href="/news/a?utm_source=x">a</a><a href="/news/a">a</a><a href="https://evil.example/news/a">b</a><a href="/private">c</a>';
    expect(discoverLinks(html, source, 'https://team.example/news/index')).toEqual(['https://team.example/news/a']);
    expect(() => articleRevision(html, source, 'https://evil.example/a', '2026-10-07T21:00:00Z')).toThrow('scope');
  });
});