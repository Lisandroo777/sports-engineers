import { espnSiteFetch } from './client';
import { normalizedNFLInput } from './researchSnapshot';
import type { NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLDataStatus, NFLIntelligenceActionability, NFLIntelligenceItem, NFLIntelligenceReliability, NFLEvidenceDirection, NFLSourceProvenance } from './researchModel';

const NFL_NEWS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const NFL_NEWS_CACHE_MS = 10 * 60 * 1000;

interface RawNewsCategory {
  type?: string;
  description?: string;
  athleteId?: number | string;
  teamId?: number | string;
}

interface RawNFLNewsArticle {
  id?: number | string;
  type?: string;
  headline?: string;
  description?: string;
  byline?: string;
  source?: string;
  published?: string;
  lastModified?: string;
  premium?: boolean;
  links?: { web?: { href?: string } };
  categories?: RawNewsCategory[];
}

interface RawNFLNewsResponse { articles?: RawNFLNewsArticle[] }

export interface NFLNewsArticle {
  id: string;
  type: string;
  headline: string;
  description: string;
  byline: string | null;
  source: string;
  publishedAt: string;
  articleUrl: string | null;
  playerIds: number[];
  playerNames: string[];
  teamIds: number[];
  teamNames: string[];
}

export interface NFLNewsSnapshot {
  status: NFLDataStatus;
  fetchedAt: string;
  windowStart: string;
  articles: NFLNewsArticle[];
  missingFields: string[];
}

function uniqueNumbers(values: Array<number | string | undefined>): number[] {
  return [...new Set(values.map(Number).filter(Number.isSafeInteger))];
}

export function parseNFLNewsResponse(response: RawNFLNewsResponse, now = new Date()): NFLNewsSnapshot {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - NFL_NEWS_WINDOW_MS;
  const articles = (response.articles ?? []).flatMap((article): NFLNewsArticle[] => {
    const publishedAt = article.published ?? article.lastModified;
    const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
    if (!article.id || !article.headline?.trim() || !publishedAt || !Number.isFinite(publishedMs)
      || publishedMs < windowStartMs || publishedMs > nowMs + 60_000 || article.premium === true
      || !['Story', 'HeadlineNews', 'Preview'].includes(article.type ?? '')) return [];
    const categories = article.categories ?? [];
    if (categories.some((category) => category.type === 'topic' && /fantasy/i.test(category.description ?? ''))) return [];
    const playerCategories = categories.filter((category) => category.type === 'athlete');
    const teamCategories = categories.filter((category) => category.type === 'team');
    return [{
      id: String(article.id), type: article.type!, headline: article.headline.trim(), description: article.description?.trim() ?? '',
      byline: article.byline?.trim() || null, source: article.source?.trim() || 'ESPN', publishedAt,
      articleUrl: article.links?.web?.href ?? null,
      playerIds: uniqueNumbers(playerCategories.map((category) => category.athleteId)),
      playerNames: [...new Set(playerCategories.map((category) => category.description?.trim()).filter((name): name is string => Boolean(name)))],
      teamIds: uniqueNumbers(teamCategories.map((category) => category.teamId)),
      teamNames: [...new Set(teamCategories.map((category) => category.description?.trim()).filter((name): name is string => Boolean(name)))],
    }];
  }).sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id));
  return { status: Array.isArray(response.articles) ? 'AVAILABLE' : 'UNAVAILABLE',
    fetchedAt: now.toISOString(), windowStart: new Date(windowStartMs).toISOString(), articles,
    missingFields: ['official team/NFL reports and press conferences are not separately connected', 'full article text is not ingested'] };
}

export function getNFLNewsSnapshot(now = new Date()): Promise<NFLNewsSnapshot> {
  const windowStart = new Date(now.getTime() - NFL_NEWS_WINDOW_MS).toISOString().slice(0, 10);
  return normalizedNFLInput(`news:${windowStart}`, NFL_NEWS_CACHE_MS, async () => {
    const response = await espnSiteFetch<RawNFLNewsResponse>('news', { limit: '100' }, 0);
    return parseNFLNewsResponse(response, now);
  });
}

function classifyDirection(text: string): NFLEvidenceDirection {
  const positive = /activated|cleared|full participant|full practice|returns? to|increased role|expanded role|more targets|more carries|will start|starting|no (?:injury )?limitations?|no restrictions?|unlimited/i.test(text);
  const negative = /ruled out|will not play|injured reserve|suspended|setback|limited practice|missed practice|workload restriction|workload will be limited|limited workload|snap restriction|snap count|downgraded|injury update|suffered a|day.to.day|not expected to play/i.test(text);
  return positive && negative ? 'MIXED' : positive ? 'POSITIVE' : negative ? 'NEGATIVE' : 'NEUTRAL';
}

function classifyReliability(text: string, direction: NFLEvidenceDirection): NFLIntelligenceReliability {
  if (/coach|coordinator|said|says|expects? him|needs? to get him|wants? to get him/i.test(text)) return 'COACH_SPEAK_UNCERTAIN';
  if (/coach|coordinator|said|says|expects? him|needs? to get him|wants? to get him|no (?:injury )?limitations?|no restrictions?/i.test(text)) return 'COACH_SPEAK_UNCERTAIN';
  if (/could|might|may|potential|reportedly|believed to|expected to|projected to/i.test(text)) return 'SPECULATION';
  return direction === 'NEUTRAL' || direction === 'MIXED' ? 'STRONG_SIGNAL' : 'STRONG_SIGNAL';
}

function classifyActionability(text: string): NFLIntelligenceActionability {
  if (/ruled out|will not play|injured reserve|activated|suspended|signed|released|waived|limited practice|missed practice|workload will be limited|limited workload/i.test(text)) return 'HIGH';
  if (/role|workload|targets|carries|routes|starter|starting|returns? to practice|practice/i.test(text)) return 'MEDIUM';
  return 'LOW';
}

export function buildNFLPlayerIntelligence(params: {
  snapshot: NFLNewsSnapshot;
  playerId: number;
  player: string;
  teamId: number | null;
  team: string | null;
  opponentTeamId?: number | null;
  market: NFLAnalyzableMarketKey;
  retrievedAt?: string;
}): NFLIntelligenceItem[] {
  const retrievedAt = params.retrievedAt ?? params.snapshot.fetchedAt;
  return params.snapshot.articles.flatMap((article): NFLIntelligenceItem[] => {
    const playerMatch = article.playerIds.includes(params.playerId);
    const teamIds = [params.teamId, params.opponentTeamId].filter((id): id is number => id != null);
    const matchedTeams = article.teamIds.filter((id) => teamIds.includes(id));
    if (!playerMatch && matchedTeams.length === 0) return [];
    const text = `${article.headline}. ${article.description}`;
    const direction = playerMatch ? classifyDirection(text) : 'NEUTRAL';
    const source: NFLSourceProvenance = { source: `${article.source}${article.byline ? ` · ${article.byline}` : ''}`,
      sourceType: 'NATIONAL', publishedAt: article.publishedAt, retrievedAt,
      affectedPlayer: playerMatch ? params.player : null,
      affectedTeam: matchedTeams.includes(params.teamId ?? -1) ? params.team : article.teamNames[0] ?? null };
    const scope = playerMatch ? 'Player-tagged' : 'Team-tagged';
    return [{ ...source, quoteOrSummary: article.description ? `${article.headline}: ${article.description}` : article.headline,
      articleUrl: article.articleUrl,
      marketImpact: !playerMatch ? `${scope} context for ${params.market}; no candidate-specific directional effect is established.`
        : direction === 'NEUTRAL' ? `${scope} context for ${params.market}; no directional projection effect is established.`
        : `${scope} ${direction.toLowerCase()} context for ${params.market}; no numeric projection adjustment is applied.`,
      affectedMarkets: [params.market], actionability: playerMatch ? classifyActionability(text) : 'LOW', reliability: classifyReliability(text, direction),
      direction, confidence: null } as NFLIntelligenceItem];
  });
}