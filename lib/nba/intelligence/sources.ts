import { canonicalUrl, freeze } from './documents';
import type { IntelligenceSource } from './types';

export const INTELLIGENCE_SOURCES: readonly IntelligenceSource[] = freeze([
  { id: 'nba-official-injuries', name: 'NBA Official Injury Reports', category: 'OFFICIAL_LEAGUE', origins: ['https://official.nba.com', 'https://ak-static.cms.nba.com'], pathPrefixes: ['/nba-injury-report-', '/referee/injury/Injury-Report_'], teamIds: [], authors: [],
    access: { mode: 'PERMISSION_REQUIRED', minIntervalMs: 120000, notes: 'Public document access is not a redistribution license. Caller must verify permitted use, robots and rate policy. Discover published links; do not guess report filenames.' } },
  { id: 'celtics-team-editorial', name: 'Celtics Team Coverage', category: 'TEAM_EDITORIAL', origins: ['https://www.nba.com'], pathPrefixes: ['/celtics/news/', '/celtics/author/'], teamIds: [2], authors: [{ name: 'Taylor Snow', profileUrl: 'https://www.nba.com/celtics/author/70/taylor-snow', verifiedAt: '2026-10-07T00:00:00Z' }],
    access: { mode: 'PERMISSION_REQUIRED', minIntervalMs: 300000, notes: 'Team editorial is not automatically an official roster/lineup announcement. Structured accessible pages only; no bypass of restrictions.' } },
  { id: 'lakers-team-news', name: 'Lakers Team News', category: 'TEAM_EDITORIAL', origins: ['https://www.nba.com'], pathPrefixes: ['/lakers/news/'], teamIds: [13], authors: [],
    access: { mode: 'PERMISSION_REQUIRED', minIntervalMs: 300000, notes: 'Discovery seed only. Byline/announcement authority requires explicit verification; no automatic full-team coverage.' } },
  { id: 'forsberg-nbcsb', name: 'Chris Forsberg / NBC Sports Boston', category: 'VERIFIED_REPORTER', origins: ['https://www.nbcsportsboston.com'], pathPrefixes: ['/nba/boston-celtics/', '/author/chris-forsberg/'], teamIds: [2], authors: [{ name: 'Chris Forsberg', profileUrl: 'https://www.nbcsportsboston.com/author/chris-forsberg/', verifiedAt: '2026-10-07T00:00:00Z' }],
    access: { mode: 'PERMISSION_REQUIRED', minIntervalMs: 300000, notes: 'Verify article byline; commentary/rumors stay separate. Public accessibility does not authorize bulk scraping or full-article redistribution.' } },
  { id: 'mcmenamin-espn', name: 'Dave McMenamin / ESPN', category: 'VERIFIED_REPORTER', origins: ['https://www.espn.com'], pathPrefixes: ['/nba/story/', '/nba/'], teamIds: [13], authors: [{ name: 'Dave McMenamin', profileUrl: 'https://espnpressroom.com/us/bios/dave-mcmenamin/', verifiedAt: '2026-10-07T00:00:00Z' }],
    access: { mode: 'MANUAL_ONLY', minIntervalMs: 300000, notes: 'Reviewed accessible linked articles only in V1; no paywall or social-platform bypass.' } },
  { id: 'espn-nba-injuries', name: 'ESPN NBA Injury Feed', category: 'SECONDARY', origins: ['https://site.api.espn.com'], pathPrefixes: ['/apis/site/v2/sports/basketball/nba/injuries'], teamIds: [], authors: [],
    access: { mode: 'PERMISSION_REQUIRED', minIntervalMs: 120000, notes: 'Secondary, not game-specific by default. Retain provider publication timestamps and do not infer ACTIVE from missing entries.' } },
]);

export function sourceAllowsUrl(source: IntelligenceSource, value: string): boolean {
  try { const url = new URL(canonicalUrl(value)); return source.origins.includes(url.origin) && source.pathPrefixes.some(prefix => url.pathname.startsWith(prefix)); } catch { return false; }
}

export function verifiedAuthor(source: IntelligenceSource, author: string | null, at: string): boolean {
  return author != null && source.authors.some(entry => entry.name.toLocaleLowerCase() === author.toLocaleLowerCase()
    && Number.isFinite(Date.parse(entry.verifiedAt)) && Date.parse(entry.verifiedAt) <= Date.parse(at)
    && Date.parse(at) - Date.parse(entry.verifiedAt) <= 180 * 86400000);
}