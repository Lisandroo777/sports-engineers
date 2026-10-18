import { NFL_ELITE_MARKETS, getNFLMarketMetadata, type NFLAnalyzableMarketKey } from './oddsTypes';
import type { NormalizedProp, OddsEvent } from '../odds/types';
import { OddsBudgetGuardError, OddsRefreshNotAuthorizedError, withBoundedOddsRequest } from '../odds/client';
import { readStalePersistentCache, writePersistentCache, writeCreditStatus } from '../odds/persistentCache';
import { withNFLRefreshLease } from './refreshLease';
import { AsyncLocalStorage } from 'node:async_hooks';
import { recordNFLCacheRead, recordNFLProviderFailure, recordNFLProviderRequest, recordNFLProviderResponse } from './spendTelemetry';
import { fetchWithReadRetry } from '../reliability/retry';

export type NFLProviderFailure = 'TIMEOUT' | 'AUTHENTICATION' | 'CONFIGURATION' | 'RATE_LIMIT' | 'MALFORMED_RESPONSE' | 'NETWORK' | 'PROVIDER_ERROR' | 'RESERVE' | 'STALE_PRICE' | 'EVENT_UNAVAILABLE' | 'RESEARCH_FAILED';
export class NFLSportsbookError extends Error {
  constructor(public readonly kind: NFLProviderFailure) { super(kind); }
}

export interface NFLSportsbookProp extends NormalizedProp { retrievedAt: string; sourceGameId?: string | null }
interface MarketSnapshot {
  retrievedAt: string;
  expiresAt: number;
  props: NFLSportsbookProp[];
  status: 'RETURNED' | 'ZERO_MARKETS' | 'FAILED';
  failure?: NFLProviderFailure;
}
interface EventSnapshot {
  version: 1;
  sport: 'nfl';
  date: string;
  gameId: string;
  eventId: string;
  kickoff: string;
  markets: Partial<Record<NFLAnalyzableMarketKey, MarketSnapshot>>;
}
export interface NFLRetrievalResult {
  props: NFLSportsbookProp[];
  requestedMarkets: NFLAnalyzableMarketKey[];
  returnedMarkets: NFLAnalyzableMarketKey[];
  zeroMarkets: NFLAnalyzableMarketKey[];
  failedMarkets: NFLAnalyzableMarketKey[];
  failure: NFLProviderFailure | null;
  complete: boolean;
  fromCache: boolean;
  retrievedAt: string | null;
  expiresAt: number;
}

const BASE = 'https://api.the-odds-api.com/v4';
const memory = new Map<string, EventSnapshot>();
const locks = new Map<string, Promise<unknown>>();
let eventsCache: { events: OddsEvent[]; expiresAt: number } | null = null;
let eventsFailure: { kind: NFLProviderFailure; expiresAt: number } | null = null;
let providerCircuit: { kind: NFLProviderFailure; expiresAt: number } | null = null;
const recordedResearch = new AsyncLocalStorage<{ event: OddsEvent; snapshot: EventSnapshot }>();

export async function withNFLRecordedSportsbook<T>(input: { date: string; gameId: string; event: OddsEvent }, operation: () => Promise<T>): Promise<T> {
  const cached = await readStalePersistentCache<EventSnapshot>(`nfl-sportsbook:v1:${input.date}:${input.gameId}:${input.event.id}`);
  if (!cached || cached.data.version !== 1 || cached.data.sport !== 'nfl' || cached.data.date !== input.date || cached.data.gameId !== input.gameId
    || cached.data.eventId !== input.event.id || Date.parse(cached.data.kickoff) !== Date.parse(input.event.commenceTime)) throw new Error('Recorded NFL sportsbook snapshot does not match the requested game.');
  return recordedResearch.run({ event: input.event, snapshot: cached.data }, operation);
}

export function nflFreshnessMs(kickoff: string, now = Date.now()): number {
  const hours = (Date.parse(kickoff) - now) / 3600000;
  return hours > 6 ? 30 * 60000 : hours > 1 ? 10 * 60000 : 5 * 60000;
}

export function classifyNFLProviderFailure(error: unknown): NFLProviderFailure {
  if (error instanceof NFLSportsbookError) return error.kind;
  if (error instanceof OddsBudgetGuardError || error instanceof OddsRefreshNotAuthorizedError) return 'RESERVE';
  if (error instanceof Error && /not configured/i.test(error.message)) return 'CONFIGURATION';
  if (error instanceof Error && /timeout|abort/i.test(error.name)) return 'TIMEOUT';
  return 'NETWORK';
}

async function exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
  while (locks.has(key)) {
    try { await locks.get(key); } catch { /* the next caller reads the stored failure */ }
  }
  const promise = Promise.resolve().then(operation);
  locks.set(key, promise);
  try { return await promise; } finally { if (locks.get(key) === promise) locks.delete(key); }
}

async function request(path: string, markets?: string[]): Promise<unknown> {
  if (providerCircuit && providerCircuit.expiresAt > Date.now()) throw new NFLSportsbookError(providerCircuit.kind);
  const key = process.env.THE_ODDS_API_KEY?.trim();
  if (!key) throw new NFLSportsbookError('CONFIGURATION');
  const params: Record<string, string> = markets
    ? { regions: 'us', markets: markets.join(','), oddsFormat: 'american', includeSids: 'true' } : {};
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apiKey', key);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
  const performRequest = async () => {
    recordNFLProviderRequest(markets ? path.split('/').at(-2) : undefined, markets);
    let response: Response;
    try {
      response = markets
        ? await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) })
        : await fetchWithReadRetry(url, { headers: { accept: 'application/json' } });
    }
    catch (error) { recordNFLProviderFailure(markets != null); throw error; }
    recordNFLProviderResponse(response.headers, markets != null);
    if (markets) {
      try { await writeCreditStatus({ lastCost: response.headers.get('x-requests-last'), remaining: response.headers.get('x-requests-remaining'), used: response.headers.get('x-requests-used'), path, updatedAt: Date.now() }); }
      catch { /* spend persistence cannot retry or invalidate a purchased response */ }
    }
    return { data: response, credits: response.headers.get('x-requests-last'), remaining: response.headers.get('x-requests-remaining') };
  };
  const response = markets ? await withBoundedOddsRequest(path, params, performRequest) : (await performRequest()).data;
  if (response.status === 401 || response.status === 403 || response.status === 429 || response.status === 503) {
    const kind = response.status === 429 ? 'RATE_LIMIT' : response.status === 503 ? 'PROVIDER_ERROR' : 'AUTHENTICATION';
    const retryAfter = response.headers.get('retry-after')?.trim();
    const retryDelay = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
    providerCircuit = { kind, expiresAt: Date.now() + Math.min(24 * 3600000, Math.max(60000, Number.isNaN(retryDelay) ? 0 : retryDelay)) };
    throw new NFLSportsbookError(kind);
  }
  if (!response.ok) throw new NFLSportsbookError('PROVIDER_ERROR');
  try { return await response.json(); } catch { throw new NFLSportsbookError('MALFORMED_RESPONSE'); }
}

function object(value: unknown): value is Record<string, unknown> { return value != null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

function marketSnapshotFresh(entry: MarketSnapshot | undefined, kickoff: string, now = Date.now()): entry is MarketSnapshot {
  if (!entry || entry.status === 'FAILED') return false;
  const retrievedAt = Date.parse(entry.retrievedAt);
  const freshness = nflFreshnessMs(kickoff, now);
  if (!Number.isFinite(retrievedAt) || now - retrievedAt > freshness || retrievedAt - now > 60000) return false;
  if (entry.status === 'ZERO_MARKETS') return true;
  return entry.expiresAt > now && entry.props.every((prop) => Boolean(prop.lastUpdate)
    && now - Date.parse(prop.lastUpdate!) <= freshness && Date.parse(prop.lastUpdate!) - now <= 60000);
}

function marketSnapshotNeedsRefresh(entry: MarketSnapshot | undefined, kickoff: string, now = Date.now()): boolean {
  if (entry?.status === 'FAILED') return entry.expiresAt <= now;
  return !marketSnapshotFresh(entry, kickoff, now);
}

function marketSnapshotExpiry(entry: MarketSnapshot, kickoff: string): number {
  return entry.status === 'ZERO_MARKETS' ? Date.parse(entry.retrievedAt) + nflFreshnessMs(kickoff) : entry.expiresAt;
}

function snapshotMatches(snapshot: EventSnapshot | undefined, input: Pick<EventSnapshot, 'date' | 'gameId' | 'eventId' | 'kickoff'>): snapshot is EventSnapshot {
  return snapshot?.version === 1 && snapshot.sport === 'nfl' && snapshot.date === input.date && snapshot.gameId === input.gameId
    && snapshot.eventId === input.eventId && snapshot.kickoff === input.kickoff;
}

function mergeSnapshots(persisted: EventSnapshot | undefined, local: EventSnapshot | undefined, kickoff: string): EventSnapshot | undefined {
  if (!persisted || !local) return persisted || local ? structuredClone((persisted ?? local)!) : undefined;
  const snapshot = structuredClone(persisted);
  const now = Date.now();
  for (const market of NFL_ELITE_MARKETS) {
    const stored = snapshot.markets[market];
    const cached = local.markets[market];
    if (!cached) continue;
    const storedFresh = marketSnapshotFresh(stored, kickoff, now);
    const cachedFresh = marketSnapshotFresh(cached, kickoff, now);
    if (!stored || (cachedFresh !== storedFresh ? cachedFresh : Date.parse(cached.retrievedAt) > Date.parse(stored.retrievedAt))) {
      snapshot.markets[market] = structuredClone(cached);
    }
  }
  return snapshot;
}

export async function getNFLSportsbookEvents(): Promise<OddsEvent[]> {
  if (recordedResearch.getStore()) return [recordedResearch.getStore()!.event];
  return exclusive('nfl-events', async () => {
    if (eventsCache && eventsCache.expiresAt > Date.now()) return eventsCache.events;
    if (eventsFailure && eventsFailure.expiresAt > Date.now()) throw new NFLSportsbookError(eventsFailure.kind);
    try {
      const raw = await request('/sports/americanfootball_nfl/events');
      if (!Array.isArray(raw) || raw.some((event) => !object(event) || !text(event.id) || !text(event.home_team) || !text(event.away_team) || !text(event.commence_time) || !Number.isFinite(Date.parse(event.commence_time)))) throw new NFLSportsbookError('MALFORMED_RESPONSE');
      const events = raw.map((event) => ({ id: event.id as string, homeTeam: event.home_team as string, awayTeam: event.away_team as string, commenceTime: event.commence_time as string }));
      eventsCache = { events, expiresAt: Date.now() + 60000 };
      eventsFailure = null;
      return events;
    } catch (error) {
      const kind = classifyNFLProviderFailure(error);
      eventsFailure = { kind, expiresAt: Date.now() + 60000 };
      throw new NFLSportsbookError(kind);
    }
  });
}

function parseProps(raw: unknown, eventId: string, requested: NFLAnalyzableMarketKey[], kickoff: string): { props: NFLSportsbookProp[]; malformed: boolean; stale: Set<string> } {
  if (!object(raw) || raw.id !== eventId || !Array.isArray(raw.bookmakers)) throw new NFLSportsbookError('MALFORMED_RESPONSE');
  if (raw.sport_key != null && raw.sport_key !== 'americanfootball_nfl') throw new NFLSportsbookError('MALFORMED_RESPONSE');
  if (raw.commence_time != null && (!text(raw.commence_time) || Math.abs(Date.parse(raw.commence_time) - Date.parse(kickoff)) > 15 * 60000 || !Number.isFinite(Date.parse(raw.commence_time)))) throw new NFLSportsbookError('MALFORMED_RESPONSE');
  const props = new Map<string, NFLSportsbookProp>();
  const stale = new Set<string>();
  let malformed = false;
  const retrievedAt = new Date().toISOString();
  for (const book of raw.bookmakers) {
    if (!object(book) || !text(book.key) || !text(book.title) || !Array.isArray(book.markets)) { malformed = true; continue; }
    for (const market of book.markets) {
      if (!object(market) || !text(market.key)) { malformed = true; continue; }
      const metadata = getNFLMarketMetadata(market.key);
      if (!metadata || metadata.isAlternate || !requested.includes(metadata.canonicalMarketKey as NFLAnalyzableMarketKey)) continue;
      if (!Array.isArray(market.outcomes)) { malformed = true; continue; }
      const updatedAt = market.last_update;
      if (!text(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) { malformed = true; continue; }
      const age = Date.now() - Date.parse(updatedAt);
      if (age < -60000 || age > nflFreshnessMs(kickoff)) { stale.add(market.key); continue; }
      for (const outcome of market.outcomes) {
        if (!object(outcome) || !text(outcome.description) || !['Over', 'Under'].includes(String(outcome.name))
          || typeof outcome.point !== 'number' || !Number.isFinite(outcome.point) || outcome.point < 0
          || typeof outcome.price !== 'number' || !Number.isInteger(outcome.price) || Math.abs(outcome.price) < 100) { malformed = true; continue; }
        const player = outcome.description.trim();
        const key = JSON.stringify([player.toLowerCase(), market.key, outcome.point, book.key]);
        const prop = props.get(key) ?? { player, sport: 'nfl', marketKey: market.key, sourceMarketKey: market.key, marketLabel: metadata.label,
          line: outcome.point, overOdds: null, underOdds: null, sportsbookKey: book.key, sportsbookName: book.title,
          eventId, sourceGameId: text(book.sid) ? book.sid : null, isAlternate: false, historicalAnalysisAvailable: true, lastUpdate: updatedAt, retrievedAt };
        if (outcome.name === 'Over') prop.overOdds = prop.overOdds == null ? outcome.price : Math.max(prop.overOdds, outcome.price);
        else prop.underOdds = prop.underOdds == null ? outcome.price : Math.max(prop.underOdds, outcome.price);
        props.set(key, prop);
      }
    }
  }
  return { props: [...props.values()], malformed, stale };
}

export async function retrieveNFLSportsbookGame(input: { date: string; gameId: string; eventId: string; kickoff: string; markets?: NFLAnalyzableMarketKey[] }): Promise<NFLRetrievalResult> {
  const requested = [...new Set(input.markets ?? NFL_ELITE_MARKETS)].filter((market) => NFL_ELITE_MARKETS.includes(market)).sort();
  const recorded = recordedResearch.getStore();
  if (recorded) {
    const snapshot = recorded.snapshot;
    if (snapshot.date !== input.date || snapshot.gameId !== input.gameId || snapshot.eventId !== input.eventId || Date.parse(snapshot.kickoff) !== Date.parse(input.kickoff)) throw new Error('Recorded research cannot expand its game scope.');
    const entries = requested.map((market) => snapshot.markets[market]);
    if (entries.some((entry) => !entry || entry.status === 'FAILED')) throw new Error('Recorded market coverage is incomplete.');
    recordNFLCacheRead(true, entries.some((entry) => entry!.expiresAt <= Date.now()));
    return { props: entries.flatMap((entry) => entry!.props), requestedMarkets: requested,
      returnedMarkets: requested.filter((market) => snapshot.markets[market]!.status === 'RETURNED'), zeroMarkets: requested.filter((market) => snapshot.markets[market]!.status === 'ZERO_MARKETS'),
      failedMarkets: [], complete: true, failure: null, fromCache: true, retrievedAt: entries.map((entry) => entry!.retrievedAt).sort()[0] ?? null,
      expiresAt: Math.min(...entries.map((entry) => entry!.expiresAt)),
    };
  }
  const key = `nfl-sportsbook:v1:${input.date}:${input.gameId}:${input.eventId}`;
  return exclusive(key, () => withNFLRefreshLease(key, async () => {
    const cached = memory.get(key);
    const local = snapshotMatches(cached, input) ? cached : undefined;
    let persisted: EventSnapshot | undefined;
    try { persisted = (await readStalePersistentCache<EventSnapshot>(key))?.data; }
    catch (error) {
      if (!local || !requested.every((market) => marketSnapshotFresh(local.markets[market], input.kickoff))) throw error;
    }
    let snapshot = mergeSnapshots(snapshotMatches(persisted, input) ? persisted : undefined, local, input.kickoff);
    if (!snapshot) {
      snapshot = { version: 1, sport: 'nfl', date: input.date, gameId: input.gameId, eventId: input.eventId, kickoff: input.kickoff, markets: {} };
      const discovery = await readStalePersistentCache<{ bookmakers?: Array<{ markets?: Array<{ key: string }> }> }>(`${BASE}/sports/americanfootball_nfl/events/${input.eventId}/markets?regions=us`);
      const legacyMarkets = [...new Set((discovery?.data.bookmakers ?? []).flatMap((book) => book.markets ?? []).map((market) => market.key))].filter((market) => market.startsWith('player_'));
      if (legacyMarkets.length) {
        const cached = await readStalePersistentCache(`${BASE}/sports/americanfootball_nfl/events/${input.eventId}/odds?regions=us&markets=${legacyMarkets.join(',')}&oddsFormat=american`);
        if (cached && cached.expiresAt > Date.now()) {
          try {
            const parsed = parseProps(cached.data, input.eventId, requested, input.kickoff);
            if (!parsed.malformed) for (const market of requested.filter((market) => legacyMarkets.includes(market) && !parsed.stale.has(market))) {
              const props = parsed.props.filter((prop) => prop.marketKey === market).map((prop) => ({ ...prop, retrievedAt: new Date(cached.cachedAt).toISOString() }));
              snapshot.markets[market] = { props, retrievedAt: new Date(cached.cachedAt).toISOString(), status: props.length ? 'RETURNED' : 'ZERO_MARKETS',
                expiresAt: Math.min(cached.expiresAt, cached.cachedAt + (props.length ? nflFreshnessMs(input.kickoff) : 120000), ...props.map((prop) => Date.parse(prop.lastUpdate!) + nflFreshnessMs(input.kickoff))) };
            }
          } catch { /* incompatible legacy payloads cannot establish coverage */ }
        }
      }
    }
    const now = Date.now();
    const needed = requested.filter((market) => {
      const cached = snapshot!.markets[market];
      return marketSnapshotNeedsRefresh(cached, input.kickoff, now);
    });
    recordNFLCacheRead(needed.length === 0);
    if (needed.length) {
      try {
        const parsed = parseProps(await request(`/sports/americanfootball_nfl/events/${input.eventId}/odds`, needed), input.eventId, needed, input.kickoff);
        for (const market of needed) {
          const props = parsed.props.filter((prop) => prop.marketKey === market);
          const failure = parsed.malformed ? 'MALFORMED_RESPONSE' : parsed.stale.has(market) ? 'STALE_PRICE' : undefined;
          const priceExpiry = props.length ? Math.min(...props.map((prop) => Date.parse(prop.lastUpdate!) + nflFreshnessMs(input.kickoff))) : Infinity;
          snapshot.markets[market] = { props, status: failure ? 'FAILED' : props.length ? 'RETURNED' : 'ZERO_MARKETS', failure,
            retrievedAt: new Date().toISOString(), expiresAt: failure ? Date.now() + 60000 : Math.min(priceExpiry, Date.now() + (props.length ? nflFreshnessMs(input.kickoff) : 2 * 60000)) };
        }
      } catch (error) {
        const failure = classifyNFLProviderFailure(error);
        for (const market of needed) snapshot.markets[market] = { props: [], status: 'FAILED', failure, retrievedAt: new Date().toISOString(), expiresAt: Date.now() + 60000 };
      }
      memory.set(key, snapshot);
      try { await writePersistentCache(key, snapshot, Math.max(...Object.values(snapshot.markets).map((market) => market!.expiresAt))); } catch { /* memory still prevents duplicate local purchases */ }
    }
    memory.set(key, snapshot);
    const assembledAt = Date.now();
    const fresh = requested.filter((market) => marketSnapshotFresh(snapshot!.markets[market], input.kickoff, assembledAt));
    const returned = fresh.filter((market) => snapshot!.markets[market]?.status === 'RETURNED');
    const zero = fresh.filter((market) => snapshot!.markets[market]?.status === 'ZERO_MARKETS');
    const failed = requested.filter((market) => !fresh.includes(market));
    const stale = failed.some((market) => snapshot!.markets[market]?.status !== 'FAILED');
    const entries = requested.map((market) => snapshot!.markets[market]!);
    return { props: returned.flatMap((market) => snapshot!.markets[market]!.props), requestedMarkets: requested, returnedMarkets: returned, zeroMarkets: zero, failedMarkets: failed,
      complete: failed.length === 0, failure: stale ? 'STALE_PRICE' : failed.length ? snapshot.markets[failed[0]]!.failure! : null,
      fromCache: needed.length === 0, retrievedAt: entries.map((market) => market.retrievedAt).sort()[0] ?? null,
      expiresAt: entries.length ? Math.min(...entries.map((market) => marketSnapshotExpiry(market, input.kickoff))) : now + 120000 };
  }));
}

export async function inspectNFLSportsbookCoverage(input: { date: string; gameId: string; eventId: string; kickoff: string; markets: NFLAnalyzableMarketKey[] }): Promise<{ state: 'CACHE_FRESH' | 'CACHE_STALE' | 'CACHE_MISSING'; missingMarkets: number }> {
  const key = `nfl-sportsbook:v1:${input.date}:${input.gameId}:${input.eventId}`;
  const snapshot = memory.get(key) ?? (await readStalePersistentCache<EventSnapshot>(key))?.data;
  if (!snapshot || snapshot.version !== 1 || snapshot.date !== input.date || snapshot.eventId !== input.eventId || snapshot.kickoff !== input.kickoff) return { state: 'CACHE_MISSING', missingMarkets: input.markets.length };
  const missing = input.markets.filter((market) => {
    const entry = snapshot.markets[market];
    return !marketSnapshotFresh(entry, input.kickoff);
  });
  return { state: missing.length ? 'CACHE_STALE' : 'CACHE_FRESH', missingMarkets: missing.length };
}