import { AsyncLocalStorage } from 'node:async_hooks';
import type { NormalizedProp, OddsEvent, SupportedOddsMarketKey } from './types';
import { getMarketMetadata, HITTER_MARKETS, PITCHER_MARKETS, ALTERNATE_HITTER_MARKETS, ALTERNATE_PITCHER_MARKETS } from './types';
import { getNFLMarketMetadata } from '../nfl/oddsTypes';
import { getNBAMarketMetadata } from '../nba/oddsTypes';
import { readPersistentCache, readStalePersistentCache, writePersistentCache, writeCreditStatus, readCreditStatus } from './persistentCache';
import { getOddsBudgetStatus, OddsBudgetGuardError } from './budget';

const BASE_URL = 'https://api.the-odds-api.com/v4';
const SPORT = 'baseball_mlb';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
/** Which markets a book offers barely changes intra-day, unlike the prices inside them. */
const MARKET_DISCOVERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Used only when per-event market discovery is unaffordable. */
const FALLBACK_PROP_MARKETS: string[] = [
  ...HITTER_MARKETS,
  ...PITCHER_MARKETS,
  ...ALTERNATE_HITTER_MARKETS,
  ...ALTERNATE_PITCHER_MARKETS,
];

export class OddsApiUnavailableError extends Error {
  constructor(message = 'Odds data is currently unavailable.') {
    super(message);
    this.name = 'OddsApiUnavailableError';
  }
}

/** Thrown when a paid refresh would be required but this environment has not explicitly authorized one. Distinct from OddsBudgetGuardError (which fires even when refreshes ARE authorized, if the credit reserve blocks it). */
export class OddsRefreshNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OddsRefreshNotAuthorizedError';
  }
}

export { OddsBudgetGuardError } from './budget';

/**
 * Paid Odds API refreshes are OFF by default outside production. A cache TTL expiring is not, by
 * itself, authorization to spend credits — development, tests, page reloads, and OpenAI follow-ups
 * must all be able to run against whatever is cached (fresh or stale) without ever spending money.
 * Set ODDS_ALLOW_PAID_REFRESH=true to explicitly opt in during local development.
 */
export function isPaidRefreshAllowed(): boolean {
  if (oneRunPaidRefreshAuthorization.getStore() === true) return true;
  if (process.env.ODDS_ALLOW_PAID_REFRESH === 'true') return true;
  if (process.env.ODDS_ALLOW_PAID_REFRESH === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

const oneRunPaidRefreshAuthorization = new AsyncLocalStorage<boolean>();

/** Authorizes paid Odds refreshes only for the awaited operation supplied by an explicit UI approval. */
export function withOneRunPaidRefresh<T>(operation: () => Promise<T>): Promise<T> {
  return oneRunPaidRefreshAuthorization.run(true, operation);
}

function getApiKey() {
  const key = process.env.THE_ODDS_API_KEY?.trim();
  if (!key) throw new OddsApiUnavailableError('THE_ODDS_API_KEY is not configured.');
  return key;
}

export function isOddsApiConfigured() {
  return Boolean(process.env.THE_ODDS_API_KEY?.trim());
}

export interface OddsCreditInfo {
  lastCost: string | null;
  used: string | null;
  remaining: string | null;
  path: string;
  cached: boolean;
  source: 'memory' | 'disk' | 'stale-disk' | 'network' | 'blocked';
  cacheAgeMs: number | null;
  /** Explicit, unambiguous cache state for observability — never inferred, always set. */
  cacheState: 'CACHE_FRESH' | 'CACHE_STALE' | 'CACHE_MISSING' | 'PAID' | 'FREE';
}

let lastCreditInfo: OddsCreditInfo | null = null;
export function getLastOddsCreditInfo() {
  return lastCreditInfo;
}

export interface OddsSpendTracker {
  creditsBefore: number | null;
  creditsAfter: number | null;
  creditsSpent: number;
  paidRequestsMade: number;
  cacheHits: number;
  staleCacheHits: number;
  cacheMisses: number;
}

function createSpendTracker(): OddsSpendTracker {
  return { creditsBefore: null, creditsAfter: null, creditsSpent: 0, paidRequestsMade: 0, cacheHits: 0, staleCacheHits: 0, cacheMisses: 0 };
}

let activeSpendTracker: OddsSpendTracker | null = null;

/** Starts (or restarts) per-session provider-spend observability. Call once at the start of an AI research turn or Finder run. */
export function beginOddsSpendTracking(): OddsSpendTracker {
  activeSpendTracker = createSpendTracker();
  return activeSpendTracker;
}

export async function beginOddsSpendTrackingAsync(): Promise<OddsSpendTracker> {
  const status = await readCreditStatus();
  const remaining = status?.remaining != null ? Number(status.remaining) : null;
  activeSpendTracker = { creditsBefore: remaining, creditsAfter: remaining, creditsSpent: 0, paidRequestsMade: 0, cacheHits: 0, staleCacheHits: 0, cacheMisses: 0 };
  return activeSpendTracker;
}

export function getActiveOddsSpendTracker(): OddsSpendTracker | null {
  return activeSpendTracker;
}

function recordSpend(info: OddsCreditInfo) {
  if (!activeSpendTracker) return;
  if (info.remaining != null) activeSpendTracker.creditsAfter = Number(info.remaining);
  if (activeSpendTracker.creditsBefore != null && activeSpendTracker.creditsAfter != null) {
    activeSpendTracker.creditsSpent = Math.max(0, activeSpendTracker.creditsBefore - activeSpendTracker.creditsAfter);
  }
  switch (info.cacheState) {
    case 'CACHE_FRESH': activeSpendTracker.cacheHits += 1; break;
    case 'CACHE_STALE': activeSpendTracker.staleCacheHits += 1; break;
    case 'CACHE_MISSING': activeSpendTracker.cacheMisses += 1; break;
    case 'PAID': activeSpendTracker.paidRequestsMade += 1; break;
    case 'FREE': break;
  }
}

/** Free endpoint — always safe to call regardless of remaining credit budget. */
function isFreePath(path: string) {
  return /\/sports\/[^/]+\/events$/.test(path);
}

// In-memory cache/dedupe (fast path within one running process); the disk-backed
// persistentCache.ts layer behind it survives dev-server restarts.
const cache = new Map<string, { expires: number; data: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

async function oddsFetch<T>(path: string, params: Record<string, string>, cacheTtlMs = DEFAULT_CACHE_TTL_MS): Promise<T> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const cacheKey = url.toString();
  url.searchParams.set('apiKey', apiKey);
  const forcePaidRefresh = oneRunPaidRefreshAuthorization.getStore() === true && !isFreePath(path);

  const memoryHit = cache.get(cacheKey);
  if (!forcePaidRefresh && memoryHit && memoryHit.expires > Date.now()) {
    const status = await readCreditStatus();
    lastCreditInfo = { lastCost: '0', used: status?.used ?? null, remaining: status?.remaining ?? null, path, cached: true, source: 'memory', cacheState: 'CACHE_FRESH', cacheAgeMs: 0 };
    recordSpend(lastCreditInfo);
    return memoryHit.data as T;
  }

  const diskHit = await readPersistentCache<T>(cacheKey);
  if (!forcePaidRefresh && diskHit) {
    // Backfill the in-memory cache so subsequent calls in this process skip the disk read too.
    cache.set(cacheKey, { expires: diskHit.expiresAt, data: diskHit.data });
    const status = await readCreditStatus();
    lastCreditInfo = { lastCost: '0', used: status?.used ?? null, remaining: status?.remaining ?? null, path, cached: true, source: 'disk', cacheState: 'CACHE_FRESH', cacheAgeMs: Date.now() - diskHit.cachedAt };
    recordSpend(lastCreditInfo);
    return diskHit.data;
  }

  const pending = inFlight.get(cacheKey);
  if (pending) return pending as Promise<T>;

  if (!isFreePath(path)) {
    const staleHit = await readStalePersistentCache<T>(cacheKey);

    if (!isPaidRefreshAllowed()) {
      // Development-safe default: a merely-expired TTL is never enough to authorize spending credits.
      if (staleHit) {
        const ageMs = Date.now() - staleHit.cachedAt;
        const status = await readCreditStatus();
        lastCreditInfo = { lastCost: '0', used: status?.used ?? null, remaining: status?.remaining ?? null, path, cached: true, source: 'stale-disk', cacheState: 'CACHE_STALE', cacheAgeMs: ageMs };
        recordSpend(lastCreditInfo);
        console.warn(`[odds] paid refresh not authorized (set ODDS_ALLOW_PAID_REFRESH=true to allow); serving STALE cache for ${path} (age=${Math.round(ageMs / 60000)}m)`);
        return staleHit.data;
      }
      const status = await readCreditStatus();
      lastCreditInfo = { lastCost: '0', used: status?.used ?? null, remaining: status?.remaining ?? null, path, cached: false, source: 'blocked', cacheState: 'CACHE_MISSING', cacheAgeMs: null };
      recordSpend(lastCreditInfo);
      throw new OddsRefreshNotAuthorizedError(
        `No cached data for ${path} and paid Odds API refreshes are not authorized in this environment (set ODDS_ALLOW_PAID_REFRESH=true to allow).`,
      );
    }

    // Paid refreshes are authorized here (production, or explicit dev opt-in) — the credit reserve is a second, independent layer of protection.
    const budget = await getOddsBudgetStatus();
    if (budget.belowReserve) {
      // A paid refresh is not affordable. Prefer already-purchased (expired) data over
      // failing outright — this costs 0 credits and keeps the slate analysable.
      if (staleHit) {
        const ageMs = Date.now() - staleHit.cachedAt;
        const status = await readCreditStatus();
        lastCreditInfo = { lastCost: '0', used: status?.used ?? null, remaining: status?.remaining ?? null, path, cached: true, source: 'stale-disk', cacheState: 'CACHE_STALE', cacheAgeMs: ageMs };
        recordSpend(lastCreditInfo);
        console.warn(
          `[odds] budget reserve reached (${budget.remaining}<${budget.minReserve}); serving stale cache for ${path} (age=${Math.round(ageMs / 60000)}m)`,
        );
        return staleHit.data;
      }
      throw new OddsBudgetGuardError(
        `Blocked: ${budget.remaining} credits remaining is below the configured reserve of ${budget.minReserve} (ODDS_MIN_CREDIT_RESERVE). No cached data was available for this request.`,
      );
    }
  }

  const promise = (async () => {
    const response = await fetch(url.toString(), { headers: { accept: 'application/json' } });
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');
    const last = response.headers.get('x-requests-last');
    lastCreditInfo = { lastCost: last, used, remaining, path, cached: false, source: 'network', cacheState: isFreePath(path) ? 'FREE' : 'PAID', cacheAgeMs: null };
    recordSpend(lastCreditInfo);
    recordSpend(lastCreditInfo);
    console.log(`[odds] path=${path} lastCost=${last ?? '0'} used=${used ?? '?'} remaining=${remaining ?? '?'}`);
    await writeCreditStatus({ lastCost: last, used, remaining, path, updatedAt: Date.now() });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[odds] request failed (${response.status}): ${body.slice(0, 200)}`);
      throw new OddsApiUnavailableError(`Odds API request failed (${response.status})`);
    }

    const data = (await response.json()) as T;
    const expires = Date.now() + cacheTtlMs;
    cache.set(cacheKey, { expires, data });
    await writePersistentCache(cacheKey, data, expires);
    return data;
  })();

  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

export function getPropsCacheTtlMs(commenceTimeIso: string): number {
  const hoursUntilGame = (new Date(commenceTimeIso).getTime() - Date.now()) / (60 * 60 * 1000);
  if (hoursUntilGame > 6) return 30 * 60 * 1000;
  if (hoursUntilGame > 1) return 10 * 60 * 1000;
  return DEFAULT_CACHE_TTL_MS;
}

export async function getOddsEvents(): Promise<OddsEvent[]> {
  return getOddsEventsForSport(SPORT);
}

/** Generic events fetch for any Odds API sport key — this path is always free (see isFreePath). */
export async function getOddsEventsForSport(sport: string): Promise<OddsEvent[]> {
  const data = await oddsFetch<Array<{ id: string; commence_time: string; home_team: string; away_team: string }>>(
    `/sports/${sport}/events`,
    {},
  );
  return data.map((event) => ({ id: event.id, commenceTime: event.commence_time, homeTeam: event.home_team, awayTeam: event.away_team }));
}

interface RawOutcome {
  name: 'Over' | 'Under' | 'Yes';
  description?: string;
  price: number;
  point?: number;
}

interface RawMarket {
  key: string;
  last_update?: string;
  outcomes: RawOutcome[];
}

interface RawBookmaker {
  key: string;
  title: string;
  last_update?: string;
  markets: RawMarket[];
}

interface RawEventOdds {
  id: string;
  bookmakers: RawBookmaker[];
}

/**
 * Market metadata lookup is sport-specific: MLB, NFL and NBA each have their own real provider
 * market-key vocabulary (batter_/pitcher_ vs player_ vs player_ with a different key set). Before
 * this fix, every sport routed through the MLB-only lookup, so NFL/NBA player props were silently
 * dropped here regardless of what the sportsbook actually returned.
 */
function metadataForSport(sport: string, sourceMarketKey: string): { canonicalMarketKey: string; label: string; isAlternate: boolean; historicalAnalysisAvailable: boolean } | null {
  if (sport === 'americanfootball_nfl') {
    const meta = getNFLMarketMetadata(sourceMarketKey);
    return meta ? { canonicalMarketKey: meta.canonicalMarketKey, label: meta.label, isAlternate: meta.isAlternate, historicalAnalysisAvailable: meta.historicalSupport !== 'unsupported' } : null;
  }
  if (sport === 'basketball_nba') {
    const meta = getNBAMarketMetadata(sourceMarketKey);
    return meta ? { canonicalMarketKey: meta.canonicalMarketKey, label: meta.label, isAlternate: meta.isAlternate, historicalAnalysisAvailable: meta.historicalSupport !== 'unsupported' } : null;
  }
  return getMarketMetadata(sourceMarketKey);
}

function normalizeEventOdds(payload: RawEventOdds, sport: string = SPORT): NormalizedProp[] {
  const props: NormalizedProp[] = [];
  const seen = new Set<string>();

  for (const bookmaker of payload.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      const metadata = metadataForSport(sport, market.key);
      if (!metadata) continue;

      const byPlayer = new Map<string, { over?: RawOutcome; under?: RawOutcome }>();
      for (const outcome of market.outcomes ?? []) {
        const player = outcome.description;
        const anytimeTouchdown = metadata.canonicalMarketKey === 'player_anytime_td' && outcome.name === 'Yes';
        if (!player || (outcome.point == null && !anytimeTouchdown)) continue;
        const entry = byPlayer.get(player) ?? {};
        if (outcome.name === 'Over' || anytimeTouchdown) entry.over = outcome;
        if (outcome.name === 'Under') entry.under = outcome;
        byPlayer.set(player, entry);
      }

      for (const [player, entry] of byPlayer) {
        const line = entry.over?.point ?? entry.under?.point ?? (metadata.canonicalMarketKey === 'player_anytime_td' ? 0.5 : null);
        if (line == null) continue;
        const dedupeKey = `${player}|${market.key}|${line}|${bookmaker.key}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        props.push({
          player,
          marketKey: metadata.canonicalMarketKey,
          sourceMarketKey: market.key as SupportedOddsMarketKey,
          isAlternate: metadata.isAlternate,
          historicalAnalysisAvailable: metadata.historicalAnalysisAvailable,
          marketLabel: metadata.label,
          line,
          overOdds: entry.over?.price ?? null,
          underOdds: entry.under?.price ?? null,
          sportsbookKey: bookmaker.key,
          sportsbookName: bookmaker.title,
          eventId: payload.id,
          lastUpdate: market.last_update ?? bookmaker.last_update ?? '',
        });
      }
    }
  }

  return props;
}

export async function getEventPlayerProps(eventId: string, markets: SupportedOddsMarketKey[], cacheTtlMs?: number, sport: string = SPORT): Promise<NormalizedProp[]> {
  if (markets.length === 0) return [];
  const data = await oddsFetch<RawEventOdds>(`/sports/${sport}/events/${eventId}/odds`, {
    regions: 'us',
    markets: markets.join(','),
    oddsFormat: 'american',
  }, cacheTtlMs);
  return normalizeEventOdds(data, sport);
}

/**
 * Discovers which market keys each bookmaker actually returns for one event; costs 1 credit.
 * Which markets a book offers is stable intra-day, so this is cached far longer than the odds
 * themselves — otherwise this cheap gate expires before the priced data it guards, and a blocked
 * refresh here would strand still-fresh cached odds.
 */
export async function getEventMarkets(eventId: string, sport: string = SPORT): Promise<Record<string, string[]>> {
  const data = await oddsFetch<{ bookmakers?: Array<{ key: string; title: string; markets?: Array<{ key: string }> }> }>(
    `/sports/${sport}/events/${eventId}/markets`,
    { regions: 'us' },
    MARKET_DISCOVERY_CACHE_TTL_MS,
  );
  const result: Record<string, string[]> = {};
  for (const bookmaker of data.bookmakers ?? []) {
    result[bookmaker.title] = (bookmaker.markets ?? []).map((market) => market.key);
  }
  return result;
}

/** True when this event has been fetched before, so it can be served without spending credits. */
export async function hasCachedEventMarkets(eventId: string, sport: string = SPORT): Promise<boolean> {
  return await readStalePersistentCache(`${BASE_URL}/sports/${sport}/events/${eventId}/markets?regions=us`) != null;
}

export type EventCacheState = 'CACHE_FRESH' | 'CACHE_STALE' | 'CACHE_MISSING';

/** Cache state of the event's market-discovery request. Pure disk read — never spends credits.
 * The odds sub-request key embeds a dynamic market list, so its state is reported by the spend
 * tracker during a dry run rather than reconstructed here. */
export async function inspectEventCacheState(eventId: string, sport: string = SPORT): Promise<{ markets: EventCacheState }> {
  const key = `${BASE_URL}/sports/${sport}/events/${eventId}/markets?regions=us`;
  if (await readPersistentCache(key) != null) return { markets: 'CACHE_FRESH' };
  if (await readStalePersistentCache(key) != null) return { markets: 'CACHE_STALE' };
  return { markets: 'CACHE_MISSING' };
}

/** Pure disk inspection of the dynamic priced-props cache used by preflight. Never calls the API. */
export async function inspectEventPlayerPropsCacheState(eventId: string, sport: string = SPORT): Promise<{ props: EventCacheState }> {
  const discoveryKey = `${BASE_URL}/sports/${sport}/events/${eventId}/markets?regions=us`;
  const discovery = await readPersistentCache<{ bookmakers?: Array<{ markets?: Array<{ key: string }> }> }>(discoveryKey)
    ?? await readStalePersistentCache<{ bookmakers?: Array<{ markets?: Array<{ key: string }> }> }>(discoveryKey);
  const marketKeys = [...new Set((discovery?.data?.bookmakers ?? []).flatMap((bookmaker) => bookmaker.markets ?? []).map((market) => market.key))]
    .filter((key) => (PROP_MARKET_PREFIXES[sport] ?? ['player_']).some((prefix) => key.startsWith(prefix)));
  if (marketKeys.length === 0) return { props: discovery ? 'CACHE_STALE' : 'CACHE_MISSING' };
  const propsKey = `${BASE_URL}/sports/${sport}/events/${eventId}/odds?regions=us&markets=${marketKeys.join(',')}&oddsFormat=american`;
  if (await readPersistentCache(propsKey)) return { props: 'CACHE_FRESH' };
  if (await readStalePersistentCache(propsKey)) return { props: 'CACHE_STALE' };
  return { props: 'CACHE_MISSING' };
}

/** Sport-specific prop-market prefixes used to filter discovered market keys. */
const PROP_MARKET_PREFIXES: Record<string, string[]> = {
  baseball_mlb: ['batter_', 'pitcher_'],
  americanfootball_nfl: ['player_'],
  basketball_nba: ['player_'],
};

export async function getDiscoveredEventPlayerProps(eventId: string, cacheTtlMs?: number, sport: string = SPORT, fallbackMarkets: string[] = FALLBACK_PROP_MARKETS): Promise<NormalizedProp[]> {
  const prefixes = PROP_MARKET_PREFIXES[sport] ?? ['player_'];
  let marketKeys: string[];
  try {
    const byBook = await getEventMarkets(eventId, sport);
    marketKeys = [...new Set(Object.values(byBook).flat().filter((key) => prefixes.some((p) => key.startsWith(p))))];
  } catch (error) {
    if (!(error instanceof OddsBudgetGuardError) && !(error instanceof OddsRefreshNotAuthorizedError)) throw error;
    // Discovery is only an optimisation. If it is unaffordable, fall back to the canonical market
    // list so a cached odds payload for this event can still be served without spending credits.
    console.warn(`[odds] market discovery blocked for event=${eventId}; falling back to canonical market keys`);
    marketKeys = fallbackMarkets;
  }
  if (marketKeys.length === 0) return [];
  return getEventPlayerProps(eventId, marketKeys, cacheTtlMs, sport);
}
