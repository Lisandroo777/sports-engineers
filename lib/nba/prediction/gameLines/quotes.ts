import { readPersistentCache, readStalePersistentCache } from '../../../odds/persistentCache';
import type { GameQuote, QuoteBinding } from './types';
import { NBA_ACTIVATION_MARKETS, nbaActivationCacheKey } from '../activationCache';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const nameKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const stamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validAmericanPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) >= 100;
}

export function normalizeNBAGameQuotes(payload: unknown, observedAt: string): { quotes: GameQuote[]; unsupported: string[] } {
  const event = record(payload);
  const quotes: GameQuote[] = [];
  const unsupported: string[] = [];
  if (typeof event.id !== 'string' || typeof event.home_team !== 'string' || typeof event.away_team !== 'string'
    || nameKey(event.home_team) === nameKey(event.away_team) || !stamp(event.commence_time) || !stamp(observedAt)) return { quotes, unsupported: ['Incomplete event identity, tipoff or observation receipt'] };
  const homeTeam = event.home_team;
  const awayTeam = event.away_team;
  const eventId = event.id;
  const commenceTime = event.commence_time;
  for (const bookValue of list(event.bookmakers)) {
    const book = record(bookValue);
    if (typeof book.key !== 'string' || !book.key.trim() || typeof book.title !== 'string' || !book.title.trim()) continue;
    for (const marketValue of list(book.markets)) {
      const market = record(marketValue);
      if (!['h2h', 'spreads', 'totals', 'team_totals'].includes(String(market.key))) {
        unsupported.push(`Unsupported provider market: ${String(market.key)}`); continue;
      }
      const updatedAt = market.last_update ?? book.last_update;
      if (!stamp(updatedAt)) { unsupported.push(`${String(market.key)}: quote timestamp missing`); continue; }
      for (const outcomeValue of list(market.outcomes)) {
        const outcome = record(outcomeValue);
        if (!validAmericanPrice(outcome.price) || typeof outcome.name !== 'string') continue;
        const teamSide = nameKey(outcome.name) === nameKey(homeTeam) ? 'HOME' : nameKey(outcome.name) === nameKey(awayTeam) ? 'AWAY' : null;
        const totalSide = outcome.name === 'Over' ? 'OVER' : outcome.name === 'Under' ? 'UNDER' : null;
        const teamTotal = typeof outcome.description === 'string'
          ? nameKey(outcome.description) === nameKey(homeTeam) ? 'HOME' : nameKey(outcome.description) === nameKey(awayTeam) ? 'AWAY' : null : null;
        if (market.key === 'h2h' && !teamSide || market.key === 'spreads' && !teamSide
          || market.key === 'totals' && !totalSide || market.key === 'team_totals' && (!totalSide || !teamTotal)) continue;
        const line = market.key === 'h2h' ? null : typeof outcome.point === 'number' && Number.isFinite(outcome.point) && Number.isInteger(outcome.point * 2) ? outcome.point : null;
        if (market.key !== 'h2h' && line == null || market.key !== 'spreads' && line != null && line < 0) continue;
        quotes.push({ provider: 'THE_ODDS_API', eventId, homeTeam, awayTeam, commenceTime,
          sportsbookKey: book.key, sportsbook: book.title, market: market.key === 'h2h' ? 'MONEYLINE' : market.key === 'spreads' ? 'SPREAD' : market.key === 'totals' ? 'TOTAL' : 'TEAM_TOTAL',
          selection: (teamSide ?? totalSide)!, team: market.key === 'team_totals' ? teamTotal : teamSide, line, americanOdds: outcome.price,
          updatedAt, observedAt, period: 'FULL_GAME' });
      }
    }
  }
  const unique = new Map(quotes.map(quote => [JSON.stringify(quote), quote]));
  return { quotes: [...unique.values()], unsupported: [...new Set(unsupported)] };
}

export async function loadCachedNBAGameQuotes(input: { cacheKey: string; binding: QuoteBinding; predictionAt: string }) {
  const unavailable = (reason: string) => ({ status: 'UNSUPPORTED_QUOTE' as const, quotes: [] as GameQuote[], reason });
  const time = Date.parse(input.predictionAt);
  if (!Number.isFinite(time)) return unavailable('Invalid prediction timestamp');
  let url: URL;
  try { url = new URL(input.cacheKey); } catch { return unavailable('Invalid cache request key'); }
  const markets = url.searchParams.get('markets')?.split(',') ?? [];
  const approvedMixedKey = url.searchParams.get('markets') === NBA_ACTIVATION_MARKETS
    && input.cacheKey === nbaActivationCacheKey(input.binding.eventId);
  if (url.origin !== 'https://api.the-odds-api.com' || !/^\/v4\/sports\/basketball_nba\/(?:events\/[^/]+\/)?odds$/.test(url.pathname)
    || url.searchParams.has('apiKey') || url.searchParams.get('oddsFormat') !== 'american' || !markets.length
    || !approvedMixedKey && markets.some(market => !['h2h', 'spreads', 'totals', 'team_totals'].includes(market))) return unavailable('Not an existing supported NBA game-odds cache key');
  const requestedEvent = url.pathname.match(/\/events\/([^/]+)\/odds$/)?.[1];
  if (requestedEvent && decodeURIComponent(requestedEvent) !== input.binding.eventId) return unavailable('Cache request event does not match target event');
  const entry = await readPersistentCache<unknown>(input.cacheKey)
    ?? (approvedMixedKey ? await readStalePersistentCache<unknown>(input.cacheKey) : null);
  if (!entry || !Number.isFinite(entry.cachedAt) || entry.cachedAt > time) return unavailable('No existing timestamped pre-prediction game-line cache receipt; no network request made');
  if (entry.key !== input.cacheKey) return unavailable('Stored request receipt does not match requested NBA cache key');
  const events = Array.isArray(entry.data) ? entry.data : [entry.data];
  const event = events.find(value => record(value).id === input.binding.eventId);
  if (record(event).sport_key != null && record(event).sport_key !== 'basketball_nba') return unavailable('Cached event sport does not match NBA');
  const normalized = normalizeNBAGameQuotes(event, new Date(entry.cachedAt).toISOString());
  const quotes = normalized.quotes.filter(quote => nameKey(quote.homeTeam) === nameKey(input.binding.homeTeam) && nameKey(quote.awayTeam) === nameKey(input.binding.awayTeam)
    && Date.parse(quote.updatedAt) <= Date.parse(quote.observedAt) && Date.parse(quote.observedAt) <= time
    && Date.now() - Date.parse(quote.updatedAt) <= 3600000 && time - Date.parse(quote.updatedAt) <= 3600000);
  return quotes.length ? { status: 'AVAILABLE' as const, quotes, reason: null } : unavailable('Cached event has no supported quotes matching verified home/away identity');
}