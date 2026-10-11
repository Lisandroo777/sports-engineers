import { parseDocument, DomUtils } from 'htmlparser2';
import { canonicalUrl, createRevision, digest, timestamp } from './documents';
import { INTELLIGENCE_SOURCES, sourceAllowsUrl } from './sources';
import { articleRevision } from './adapters/publicArticles';
import { extractOfficialPdf, officialReportClaims, officialReportRevision, parseOfficialItems } from './adapters/officialInjuries';
import { espnInjuryClaims, espnInjuryRevision } from './adapters/espn';
import type { IdentityEntry, IntelligenceSource, IntelligenceStore, TargetEvent } from './types';

export interface AccessGrant {
  sourceId: string;
  checkedAt: string;
  expiresAt: string;
  permittedUse: boolean;
  robotsAllowed: boolean;
  notes: string;
}
export interface RefreshRequest { sourceId: string; url: string; adapter: 'ARTICLE' | 'OFFICIAL_INJURY_PDF' | 'INJURY_INDEX' | 'ESPN_INJURIES' }
export interface RefreshResult { mode: 'MANUAL'; lastAttemptAt: string; lastSuccessAt: string | null; fetched: string[]; unchanged: string[]; discovered: string[]; missing: string[]; requestsUsed: number }

export function createIntelligenceRefresher(options: { store: IntelligenceStore; fetcher?: typeof fetch; now?: () => Date; sources?: readonly IntelligenceSource[]; maxRequests?: number }) {
  if (typeof window !== 'undefined') throw new Error('Refresh requires Node server runtime.');
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetcher ?? fetch;
  const maxRequests = options.maxRequests ?? 12;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 30) throw new Error('Refresh budget must be between 1 and 30.');
  const registry = options.sources ?? INTELLIGENCE_SOURCES;
  const attempts = new Map<string, number>();
  const pending = new Map<string, Promise<RefreshResult>>();
  async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Source response size limit exceeded.');
    if (!response.body) throw new Error('Source body unavailable.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) { const result = await reader.read(); if (result.done) break; length += result.value.byteLength; if (length > limit) throw new Error('Source response size limit exceeded.'); chunks.push(result.value); }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  async function refresh(input: { requests: RefreshRequest[]; grants: AccessGrant[]; target: TargetEvent; identities: IdentityEntry[]; teams: Array<{ teamId: number; names: string[] }> }): Promise<RefreshResult> {
    const startedAt = now().toISOString();
    const result: RefreshResult = { mode: 'MANUAL', lastAttemptAt: startedAt, lastSuccessAt: null, fetched: [], unchanged: [], discovered: [], missing: [], requestsUsed: 0 };
    const records = await options.store.listDocuments();
    const requests = [...new Map(input.requests.map(request => [`${request.sourceId}:${request.url}`, request])).values()].slice(0, maxRequests);
    if (input.requests.length > requests.length) result.missing.push('Requests deduplicated or truncated to bounded manual-refresh budget.');
    for (const request of requests) {
      const source = registry.find(source => source.id === request.sourceId);
      const grant = input.grants.find(grant => grant.sourceId === request.sourceId);
      if (!source || source.access.mode === 'MANUAL_ONLY' || !sourceAllowsUrl(source, request.url) || !grant?.permittedUse || !grant.robotsAllowed
        || !grant.notes.trim() || !timestamp(grant.checkedAt) || !timestamp(grant.expiresAt) || Date.parse(grant.checkedAt) > now().getTime() || Date.parse(grant.expiresAt) <= now().getTime()) {
        result.missing.push(`${request.sourceId}: public-access permission/robots check or source scope not verified; request not made.`); continue;
      }
      const url = canonicalUrl(request.url);
      if (request.adapter === 'OFFICIAL_INJURY_PDF' && (source.id !== 'nba-official-injuries' || new URL(url).hostname !== 'ak-static.cms.nba.com')
        || request.adapter === 'INJURY_INDEX' && (source.id !== 'nba-official-injuries' || new URL(url).hostname !== 'official.nba.com')
        || request.adapter === 'ESPN_INJURIES' && source.id !== 'espn-nba-injuries') { result.missing.push('Adapter/source mismatch; request not made.'); continue; }
      const key = `${source.id}:${url}`;
      const previous = records.filter(document => document.documentId === digest(key)).sort((first, second) => Date.parse(second.firstSeenAt) - Date.parse(first.firstSeenAt))[0] ?? null;
      const last = Math.max(attempts.get(key) ?? 0, previous ? Date.parse(previous.fetchedAt) : 0);
      if (now().getTime() - last < source.access.minIntervalMs) { result.missing.push(`${url}: minimum refresh interval active; using archived revision.`); continue; }
      if (!await options.store.reserveRefresh(key, now().toISOString(), source.access.minIntervalMs)) { result.missing.push(`${url}: durable refresh interval/backoff active.`); continue; }
      attempts.set(key, now().getTime());
      result.requestsUsed += 1;
      try {
        const response = await fetcher(url, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { accept: request.adapter === 'OFFICIAL_INJURY_PDF' ? 'application/pdf' : request.adapter === 'ESPN_INJURIES' ? 'application/json' : 'text/html',
          ...(previous?.etag ? { 'if-none-match': previous.etag } : {}), ...(previous?.lastModified ? { 'if-modified-since': previous.lastModified } : {}) }, signal: AbortSignal.timeout(10000) });
        if (response.status === 304) { if (!previous) throw new Error('304 without archived document.'); result.unchanged.push(previous.revisionId); result.lastSuccessAt = now().toISOString(); continue; }
        if (response.status === 429 || response.status === 503) {
          const retry = response.headers.get('retry-after');
          const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry && Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - now().getTime()) : 300000;
          attempts.set(key, now().getTime() + Math.min(delay, 86400000));
          await options.store.recordBackoff(key, new Date(now().getTime() + Math.min(delay, 86400000)).toISOString());
          throw new Error(`Source rate/backoff response ${response.status}; no immediate retry.`);
        }
        if (!response.ok) throw new Error(`Source unavailable (${response.status}).`);
        const expectedType = request.adapter === 'OFFICIAL_INJURY_PDF' ? 'application/pdf' : request.adapter === 'ESPN_INJURIES' ? 'application/json' : 'text/html';
        if (!response.headers.get('content-type')?.includes(expectedType)) throw new Error('Unexpected source content type.');
        const bytes = await readBounded(response, request.adapter === 'OFFICIAL_INJURY_PDF' ? 5_000_000 : 2_000_000);
        const fetchedAt = now().toISOString();
        let document;
        if (request.adapter === 'OFFICIAL_INJURY_PDF') {
          const parsed = parseOfficialItems(await extractOfficialPdf(bytes));
          document = officialReportRevision(parsed, bytes, url, fetchedAt, previous);
          const parsedClaims = officialReportClaims(parsed, document, input.target, input.teams, input.identities);
          result.missing.push(...parsedClaims.missing);
          await options.store.putClaims(parsedClaims.claims);
        } else if (request.adapter === 'ESPN_INJURIES') {
          const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
          document = espnInjuryRevision(payload, fetchedAt, previous);
          await options.store.putClaims(espnInjuryClaims(payload, document, input.target, input.identities));
        } else if (request.adapter === 'ARTICLE') document = articleRevision(new TextDecoder().decode(bytes), source, url, fetchedAt, previous);
        else {
          const dom = parseDocument(new TextDecoder().decode(bytes));
          const links = DomUtils.getElementsByTagName('a', dom.children, true).flatMap(node => {
            try { const href = canonicalUrl(new URL(node.attribs.href, url).toString()); return new URL(href).hostname === 'ak-static.cms.nba.com' && /^\/referee\/injury\/Injury-Report_\d{4}-\d{2}-\d{2}_\d{2}_\d{2}(AM|PM)\.pdf$/.test(new URL(href).pathname) ? [href] : []; } catch { return []; }
          });
          result.discovered.push(...[...new Set(links)].slice(0, 20));
          document = createRevision({ sourceId: source.id, url, bytes, mediaType: 'HTML', fetchedAt, previous,
            parsed: { title: 'NBA injury-report discovery index', author: null, text: [...new Set(links)].join('\n'), publishedAt: null, updatedAt: null, originalUrls: [], issues: ['Discovery only: index title is not a report date or a player status.'] } });
        }
        if (document.revisionId !== previous?.revisionId) document = { ...document, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
        await options.store.putDocument(document);
        records.push(document);
        result.fetched.push(document.revisionId);
        result.lastSuccessAt = fetchedAt;
      } catch (error) { result.missing.push(`${url}: ${error instanceof Error ? error.message : 'Refresh failed'}`); }
    }
    return result;
  }
  return {
    refresh(input: Parameters<typeof refresh>[0]): Promise<RefreshResult> {
      const key = digest(JSON.stringify(input));
      if (!pending.has(key)) pending.set(key, refresh(input).finally(() => pending.delete(key)));
      return pending.get(key)!;
    },
  };
}