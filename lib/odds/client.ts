import { AsyncLocalStorage } from 'node:async_hooks';
import type { NormalizedProp, OddsEvent, SupportedOddsMarketKey } from './types';
import { getMarketMetadata, HITTER_MARKETS, PITCHER_MARKETS, ALTERNATE_HITTER_MARKETS, ALTERNATE_PITCHER_MARKETS } from './types';
import { getNFLMarketMetadata } from '../nfl/oddsTypes';
import { getNBAMarketMetadata } from '../nba/oddsTypes';
import { readPersistentCache, readStalePersistentCache, writePersistentCache, writeCreditStatus, readCreditStatus } from './persistentCache';
import { getOddsBudgetStatus, OddsBudgetGuardError } from './budget';
import {
  AUTO_REFRESH_LIMITS, AutoRefreshLedgerError, acquireRefreshLock, isAutomaticOddsRefreshEnabled, recordProviderRemaining,
  releaseRefreshLock, reserveDailyCredits, settleDailyCredits, type DailyReservation,
} from './autoRefreshLedger';

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

export function isPaidRefreshAllowed(): boolean {
  return oneRunPaidRefreshAuthorization.getStore() != null || process.env.ODDS_ALLOW_PAID_REFRESH === 'true';
}

interface PaidRequestAuthorization {
  active: boolean;
  forceFresh: boolean;
  maxRequests: number;
  maxCredits: number;
  requestsReserved: number;
  creditsReserved: number;
  allowedRequestKeys?: readonly string[];
  automatic?: boolean;
}
const oneRunPaidRefreshAuthorization = new AsyncLocalStorage<PaidRequestAuthorization>();

/**
 * Scopes a cache-bypassing refresh to one awaited operation. Normal refreshes remain automatic and
 * cache-first; `forceFresh` is reserved for an explicit user request to disregard fresh cache.
 */
export function withOneRunPaidRefresh<T>(operation: () => Promise<T>, options: {
  forceFresh?: boolean; maxRequests?: number; maxCredits?: number; allowedRequestKeys?: readonly string[]; automatic?: boolean;
} = {}): Promise<T> {
  const existing = oneRunPaidRefreshAuthorization.getStore();
  if (existing) {
    if (!existing.active) throw new OddsRefreshNotAuthorizedError('Paid authorization scope has closed.');
    return operation();
  }
  const maxRequests = options.maxRequests ?? 1;
  const maxCredits = options.maxCredits ?? 7;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 50 || !Number.isInteger(maxCredits) || maxCredits < 1 || maxCredits > 50) {
    throw new OddsRefreshNotAuthorizedError('Explicit positive paid request and credit limits required.');
  }
  const approval: PaidRequestAuthorization = { active: true, forceFresh: options.forceFresh === true, maxRequests, maxCredits,
    requestsReserved: 0, creditsReserved: 0, allowedRequestKeys: options.allowedRequestKeys, automatic: true };
  return oneRunPaidRefreshAuthorization.run(approval, async () => {
    try { return await operation(); } finally { approval.active = false; }
  });
}

function estimatedPaidCredits(path: string, params: Record<string, string>): number {
  if (/^\/sports\/[^/]+\/events\/[^/]+\/markets$/.test(path)) return 1;
  if (!/^\/sports\/[^/]+\/(?:events\/[^/]+\/)?odds$/.test(path)) {
    throw new OddsRefreshNotAuthorizedError('This paid endpoint has no approved bounded cost estimator.');
  }
  const markets = [...new Set((params.markets ?? 'h2h').split(',').filter(Boolean))];
  const regions = params.bookmakers ? Math.ceil(new Set(params.bookmakers.split(',').filter(Boolean)).size / 10)
    : new Set((params.regions ?? '').split(',').filter(Boolean)).size;
  if (!markets.length || !regions) throw new OddsRefreshNotAuthorizedError('Explicit markets and regions required for paid cost estimate.');
  return markets.length * regions;
}

/**
 * Server-only automatic search scope: per-search cap is fixed here and every paid request also
 * reserves against the durable daily ledger. Disabled unless ODDS_AUTO_REFRESH=true.
 */
export function withAutomaticOddsRefresh<T>(operation: () => Promise<T>): Promise<T> {
  if (!isAutomaticOddsRefreshEnabled()) return operation();
  return withOneRunPaidRefresh(operation, { automatic: true,
    maxRequests: AUTO_REFRESH_LIMITS.perSearchCredits, maxCredits: AUTO_REFRESH_LIMITS.perSearchCredits });
}

function reservePaidRequest(path: string, params: Record<string, string>, key: string): number {
  const approval = oneRunPaidRefreshAuthorization.getStore();
  if (!approval?.active || !isPaidRefreshAllowed()) throw new OddsRefreshNotAuthorizedError('Paid refresh disabled: an active explicit bounded request scope is required.');
  const credits = estimatedPaidCredits(path, params);
  if (approval.allowedRequestKeys && !approval.allowedRequestKeys.includes(key)) throw new OddsRefreshNotAuthorizedError('Paid request is outside the explicitly approved scope.');
  if (approval.requestsReserved >= approval.maxRequests || approval.creditsReserved + credits > approval.maxCredits) {
    throw new OddsRefreshNotAuthorizedError('Paid request or credit ceiling reached. No provider request made.');
  }
  approval.requestsReserved += 1;
  approval.creditsReserved += credits;
  return credits;
}

async function reserveAutomaticDailyCredits(credits: number): Promise<DailyReservation | null> {
  if (!oneRunPaidRefreshAuthorization.getStore()?.automatic) return null;
  return asBudgetGuard(() => reserveDailyCredits(credits));
}

async function asBudgetGuard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AutoRefreshLedgerError) {
      const blocked = new OddsBudgetGuardError(`Automatic refresh blocked: ${error.reason}.`);
      blocked.cause = error;
      throw blocked;
    }
    throw error;
  }
}

async function waitForSharedRefresh<T>(cacheKey: string): Promise<T | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const hit = await readPersistentCache<T>(cacheKey);
    if (hit) return hit.data;
  }
  return null;
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
  const forcePaidRefresh = oneRunPaidRefreshAuthorization.getStore()?.forceFresh === true && !isFreePath(path);

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
    if (!oneRunPaidRefreshAuthorization.getStore()) {
      throw new OddsRefreshNotAuthorizedError('Paid refresh disabled: normal searches may use fresh cache only.');
    }
    const budget = await getOddsBudgetStatus();
    if (budget.belowReserve) {
      throw new OddsBudgetGuardError(
        `Blocked: ${budget.remaining} credits remaining is below the configured reserve of ${budget.minReserve} (ODDS_MIN_CREDIT_RESERVE). No cached data was available for this request.`,
      );
    }
  }

  const concurrent = inFlight.get(cacheKey);
  if (concurrent) return concurrent as Promise<T>;
  const reservedCredits = isFreePath(path) ? 0 : reservePaidRequest(path, params, cacheKey);
  const automatic = !isFreePath(path) && oneRunPaidRefreshAuthorization.getStore()?.automatic === true;
  const promise = (async () => {
    const owner = automatic ? await asBudgetGuard(() => acquireRefreshLock(cacheKey)) : null;
    if (automatic && !owner) {
      const shared = await waitForSharedRefresh<T>(cacheKey);
      if (shared != null) return shared;
      throw new OddsRefreshNotAuthorizedError('An identical refresh is already in progress.');
    }
    let reservation: DailyReservation | null = null;
    let actualCost: number | null = null;
    let cachedSuccessfully = false;
    let declinedWithoutSpend = false;
    try {
      if (automatic) {
        const shared = await readPersistentCache<T>(cacheKey);
        if (shared) { cachedSuccessfully = true; return shared.data; }
      }
      try {
        reservation = await reserveAutomaticDailyCredits(reservedCredits);
      } catch (error) {
        declinedWithoutSpend = error instanceof OddsBudgetGuardError && error.cause instanceof AutoRefreshLedgerError
          && error.cause.reason !== 'STORAGE_UNAVAILABLE';
        throw error;
      }
      return await fetchAndStore();
    } finally {
      if (reservation) await settleDailyCredits(reservation, actualCost);
      if (owner && (cachedSuccessfully || declinedWithoutSpend)) await releaseRefreshLock(cacheKey, owner);
    }

  async function fetchAndStore(): Promise<T> {
    const response = await fetch(url.toString(), { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');
    const last = response.headers.get('x-requests-last');
    actualCost = last == null ? null : Number(last);
    if (response.ok) await recordProviderRemaining(remaining);
    lastCreditInfo = { lastCost: last, used, remaining, path, cached: false, source: 'network', cacheState: isFreePath(path) ? 'FREE' : 'PAID', cacheAgeMs: null };
    recordSpend(lastCreditInfo);
    console.log(`[odds] path=${path} lastCost=${last ?? '0'} used=${used ?? '?'} remaining=${remaining ?? '?'}`);
    await writeCreditStatus({ lastCost: last, used, remaining, path, updatedAt: Date.now() });

    if (!response.ok) {
      throw new OddsApiUnavailableError(`Odds API request failed (${response.status})`);
    }

    const data = (await response.json()) as T;
    const expires = Date.now() + cacheTtlMs;
    await writePersistentCache(cacheKey, data, expires);
    cache.set(cacheKey, { expires, data });
    cachedSuccessfully = true;
    return data;
  }
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

export const APPROVED_NBA_ACTIVATION_MARKETS = 'player_points,player_rebounds,player_assists,h2h,spreads,totals,team_totals';

export function nbaActivationQuoteCacheKey(eventId: string): string {
  if (!/^[a-f0-9]{32}$/.test(eventId)) throw new OddsRefreshNotAuthorizedError('A verified upcoming NBA provider event ID is required.');
  const url = new URL(`${BASE_URL}/sports/basketball_nba/events/${eventId}/odds`);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', APPROVED_NBA_ACTIVATION_MARKETS);
  url.searchParams.set('oddsFormat', 'american');
  return url.toString();
}

export async function getAuthorizedNBAActivationOdds(event: OddsEvent): Promise<unknown> {
  const key = nbaActivationQuoteCacheKey(event.id);
  if (!event.homeTeam || !event.awayTeam || event.homeTeam === event.awayTeam || Date.parse(event.commenceTime) <= Date.now()
    || !Number.isFinite(Date.parse(event.commenceTime))) throw new OddsRefreshNotAuthorizedError('Exact upcoming event identity required.');
  return withOneRunPaidRefresh(() => oddsFetch<unknown>(`/sports/basketball_nba/events/${event.id}/odds`, {
    regions: 'us', markets: APPROVED_NBA_ACTIVATION_MARKETS, oddsFormat: 'american',
  }), { forceFresh: true, maxRequests: 1, maxCredits: 7, allowedRequestKeys: [key] });
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
