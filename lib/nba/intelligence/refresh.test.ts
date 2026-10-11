import { describe, expect, it, vi } from 'vitest';
import { createIntelligenceRefresher } from './refresh';
import { MemoryIntelligenceStore } from './store';
import { fixtureInput, source, target } from './fixtures';

const grant = { sourceId: source.id, checkedAt: '2026-10-07T19:00:00Z', expiresAt: '2026-10-08T00:00:00Z', permittedUse: true, robotsAllowed: true, notes: 'Fixture access reviewed' };
const request = { sourceId: source.id, url: 'https://team.example/news/report', adapter: 'ARTICLE' as const };
const body = '<article><p>Report</p></article><meta property="article:published_time" content="2026-10-07T20:00:00Z">';
describe('manual bounded permitted refresh', () => {
  it('does not fetch absent permissions, out-of-scope URLs or unrelated adapters', async () => {
    const fetcher = vi.fn<typeof fetch>(); const store = new MemoryIntelligenceStore();
    const refresher = createIntelligenceRefresher({ store, fetcher, sources: [source], now: () => new Date('2026-10-07T22:00:00Z') });
    const result = await refresher.refresh({ requests: [request], grants: [], target, identities: fixtureInput().identities, teams: [] });
    expect(fetcher).not.toHaveBeenCalled(); expect(result.mode).toBe('MANUAL'); expect(result.missing[0]).toContain('permission');
    await refresher.refresh({ requests: [{ ...request, url: 'https://localhost/private' }], grants: [grant], target, identities: [], teams: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent refreshes, enforces intervals, uses ETags and preserves revisions on 304', async () => {
    let time = new Date('2026-10-07T22:00:00Z');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'text/html', etag: 'v1' } })).mockResolvedValueOnce(new Response(null, { status: 304 }));
    const store = new MemoryIntelligenceStore(); const refresher = createIntelligenceRefresher({ store, fetcher, sources: [source], now: () => time });
    const input = { requests: [request], grants: [grant], target, identities: [], teams: [] };
    const [first, second] = await Promise.all([refresher.refresh(input), refresher.refresh(input)]);
    expect(first).toBe(second); expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await refresher.refresh(input)).requestsUsed).toBe(0);
    time = new Date('2026-10-07T22:00:02Z');
    expect((await refresher.refresh(input)).unchanged).toHaveLength(1);
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ 'if-none-match': 'v1' });
    expect(await store.listDocuments()).toHaveLength(1);
  });
  it('honors Retry-After and rejects oversized or unexpected bodies without automatic retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('limited', { status: 429, headers: { 'retry-after': '600' } }));
    const refresher = createIntelligenceRefresher({ store: new MemoryIntelligenceStore(), fetcher, sources: [source], now: () => new Date('2026-10-07T22:00:00Z') });
    const input = { requests: [request], grants: [grant], target, identities: [], teams: [] };
    expect((await refresher.refresh(input)).missing[0]).toContain('backoff');
    await refresher.refresh(input); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses expired permissions and oversized or mismatched content without archiving it', async () => {
    const store = new MemoryIntelligenceStore();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/html', 'content-length': '9000000' } }));
    const refresher = createIntelligenceRefresher({ store, fetcher, sources: [source], now: () => new Date('2026-10-07T22:00:00Z') });
    const input = { requests: [request], grants: [{ ...grant, expiresAt: '2026-10-07T21:00:00Z' }], target, identities: [], teams: [] };
    await refresher.refresh(input); expect(fetcher).not.toHaveBeenCalled();
    expect((await refresher.refresh({ ...input, grants: [grant] })).missing.join(' ')).toContain('size limit');
    expect(await store.listDocuments()).toEqual([]);
  });
  it('enforces the manual request ceiling without source discovery crawling', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(body, { headers: { 'content-type': 'text/html' } }));
    const refresher = createIntelligenceRefresher({ store: new MemoryIntelligenceStore(), fetcher, sources: [source], maxRequests: 1, now: () => new Date('2026-10-07T22:00:00Z') });
    const result = await refresher.refresh({ requests: [request, { ...request, url: 'https://team.example/news/second' }], grants: [grant], target, identities: [], teams: [] });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(result.missing.join(' ')).toContain('truncated');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
  });
});