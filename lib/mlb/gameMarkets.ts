import {
  getEventMarkets, getMLBGameMarketOdds, MLB_GAME_MARKET_KEYS,
  OddsBudgetGuardError, OddsRefreshNotAuthorizedError,
} from '../odds/client';
import type { OddsEvent } from '../odds/types';

export type MLBGameMarketKey = typeof MLB_GAME_MARKET_KEYS[number];
export type MLBGameMarketDiscovery = Record<string, string[]>;
export const MLB_GAME_MODEL_UNAVAILABLE = 'MLB game-market model unavailable.';

export interface MLBGameQuote {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  marketKey: MLBGameMarketKey;
  kind: 'moneyline' | 'runline' | 'total' | 'team_total' | 'nrfi_yrfi';
  period: 'game' | 'first_five' | 'first_inning';
  isAlternate: boolean;
  team: string | null;
  outcome: string;
  selection: string;
  line: number | null;
  sportsbookKey: string;
  sportsbookName: string;
  americanOdds: number;
  lastUpdate: string | null;
  impliedProbability: number;
  settlement: 'two_way_push_on_tie' | 'three_way' | 'push_on_exact_line' | 'no_push';
  modelProbability: null;
  edge: null;
  recommendation: false;
  reason: typeof MLB_GAME_MODEL_UNAVAILABLE;
}

export interface MLBGameMarketIssue {
  stage: 'discovery' | 'odds' | 'parse';
  code: 'budget_blocked' | 'refresh_not_authorized' | 'provider_error' | 'missing_markets' | 'missing_books' | 'invalid_payload' | 'invalid_quotes';
  message: string;
}

export interface MLBGameMarketEventResearch {
  event: OddsEvent;
  status: 'complete' | 'partial' | 'unavailable' | 'empty';
  requestedMarkets: MLBGameMarketKey[];
  missingMarkets: MLBGameMarketKey[];
  quotes: MLBGameQuote[];
  issues: MLBGameMarketIssue[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function isMarketKey(value: unknown): value is MLBGameMarketKey {
  return MLB_GAME_MARKET_KEYS.some((key) => key === value);
}

export function parseMLBGameMarketOdds(event: OddsEvent, payload: unknown, markets: readonly MLBGameMarketKey[] = MLB_GAME_MARKET_KEYS): {
  quotes: MLBGameQuote[]; issues: MLBGameMarketIssue[];
} {
  const quotes: MLBGameQuote[] = [];
  const issues: MLBGameMarketIssue[] = [];
  const data = record(payload);
  if (!data || data.id !== event.id || !event.homeTeam || !event.awayTeam || event.homeTeam === event.awayTeam
    || (data.home_team != null && data.home_team !== event.homeTeam)
    || (data.away_team != null && data.away_team !== event.awayTeam)) {
    return { quotes, issues: [{ stage: 'parse', code: 'invalid_payload', message: 'Missing or mismatched MLB event identity.' }] };
  }
  if (!Array.isArray(data.bookmakers) || data.bookmakers.length === 0) {
    return { quotes, issues: [{ stage: 'parse', code: 'missing_books', message: 'No posted bookmakers returned.' }] };
  }
  let invalid = 0;
  for (const rawBook of data.bookmakers) {
    const book = record(rawBook);
    if (!book || typeof book.key !== 'string' || !book.key || typeof book.title !== 'string' || !book.title || !Array.isArray(book.markets)) {
      invalid += 1;
      continue;
    }
    for (const rawMarket of book.markets) {
      const market = record(rawMarket);
      if (!market || !isMarketKey(market.key) || !markets.includes(market.key)) continue;
      const marketKey = market.key;
      if (!Array.isArray(market.outcomes) || market.outcomes.length === 0) {
        invalid += 1;
        continue;
      }
      const period = marketKey.includes('1st_5_innings') ? 'first_five' : marketKey === 'totals_1st_1_innings' ? 'first_inning' : 'game';
      const kind = marketKey.startsWith('h2h') ? 'moneyline'
        : marketKey.includes('spreads') ? 'runline'
          : marketKey.includes('team_totals') ? 'team_total'
            : period === 'first_inning' ? 'nrfi_yrfi' : 'total';
      const threeWay = marketKey.includes('3_way') || market.outcomes.some((value) => record(value)?.name === 'Draw');
      for (const rawOutcome of market.outcomes) {
        const outcome = record(rawOutcome);
        if (!outcome || typeof outcome.name !== 'string' || typeof outcome.price !== 'number'
          || !Number.isFinite(outcome.price) || !Number.isInteger(outcome.price) || Math.abs(outcome.price) < 100) {
          invalid += 1;
          continue;
        }
        const teamName = kind === 'team_total' ? outcome.description : outcome.name;
        const team = teamName === event.homeTeam || teamName === event.awayTeam ? teamName : null;
        const line = kind === 'moneyline' ? null : outcome.point;
        const validSide = kind === 'moneyline' ? team !== null || outcome.name === 'Draw'
          : kind === 'runline' ? team !== null
            : (outcome.name === 'Over' || outcome.name === 'Under') && (kind !== 'team_total' || team !== null);
        if (!validSide || (kind === 'moneyline' ? outcome.point != null
          : typeof line !== 'number' || !Number.isFinite(line) || (kind !== 'runline' && line < 0))
          || (kind === 'nrfi_yrfi' && line !== 0.5)) {
          invalid += 1;
          continue;
        }
        const price = outcome.price;
        quotes.push({
          eventId: event.id, homeTeam: event.homeTeam, awayTeam: event.awayTeam,
          marketKey, kind, period, isAlternate: marketKey.startsWith('alternate_'),
          team: kind === 'moneyline' || kind === 'runline' || kind === 'team_total' ? team : null,
          outcome: outcome.name,
          selection: kind === 'nrfi_yrfi' ? outcome.name === 'Under' ? 'NRFI' : 'YRFI' : outcome.name,
          line: typeof line === 'number' ? line : null,
          sportsbookKey: book.key, sportsbookName: book.title,
          americanOdds: price, lastUpdate: timestamp(market.last_update) ?? timestamp(book.last_update),
          impliedProbability: price > 0 ? 100 / (price + 100) : -price / (-price + 100),
          settlement: kind === 'moneyline' ? threeWay ? 'three_way' : 'two_way_push_on_tie'
            : Number.isInteger(line) ? 'push_on_exact_line' : 'no_push',
          modelProbability: null, edge: null, recommendation: false, reason: MLB_GAME_MODEL_UNAVAILABLE,
        });
      }
    }
  }
  if (invalid) issues.push({ stage: 'parse', code: 'invalid_quotes', message: `${invalid} malformed or unsupported quote entries omitted.` });
  return { quotes, issues };
}

function failure(stage: 'discovery' | 'odds', error: unknown): MLBGameMarketIssue {
  return {
    stage,
    code: error instanceof OddsBudgetGuardError ? 'budget_blocked'
      : error instanceof OddsRefreshNotAuthorizedError ? 'refresh_not_authorized' : 'provider_error',
    message: error instanceof Error ? error.message : 'MLB game-market request failed.',
  };
}

export async function researchMLBGameMarkets(events: readonly OddsEvent[], options: {
  discoveryByEventId?: Readonly<Record<string, MLBGameMarketDiscovery>>;
  cacheTtlMs?: number;
} = {}): Promise<{ events: MLBGameMarketEventResearch[]; quotes: MLBGameQuote[] }> {
  const results: MLBGameMarketEventResearch[] = [];
  for (const event of events) {
    const result: MLBGameMarketEventResearch = { event, status: 'unavailable', requestedMarkets: [], missingMarkets: [], quotes: [], issues: [] };
    results.push(result);
    let discovery: MLBGameMarketDiscovery;
    try {
      discovery = options.discoveryByEventId?.[event.id] ?? await getEventMarkets(event.id, 'baseball_mlb');
    } catch (error) {
      result.issues.push(failure('discovery', error));
      continue;
    }
    const posted = new Set(Object.values(discovery).flat());
    result.requestedMarkets = MLB_GAME_MARKET_KEYS.filter((key) => posted.has(key));
    if (result.requestedMarkets.length === 0) {
      result.status = 'empty';
      result.issues.push({ stage: 'discovery', code: 'missing_markets', message: 'No supported MLB game markets are posted.' });
      continue;
    }
    try {
      const payload = await getMLBGameMarketOdds(event.id, result.requestedMarkets, options.cacheTtlMs);
      const parsed = parseMLBGameMarketOdds(event, payload, result.requestedMarkets);
      result.quotes = parsed.quotes;
      result.issues.push(...parsed.issues);
      const missingBooks = Object.entries(discovery)
        .filter(([, keys]) => keys.some(isMarketKey))
        .filter(([name]) => !result.quotes.some((quote) => quote.sportsbookName === name))
        .map(([name]) => name);
      if (result.quotes.length && missingBooks.length) result.issues.push({ stage: 'odds', code: 'missing_books', message: `No valid game quotes returned for posted books: ${missingBooks.join(', ')}.` });
      result.missingMarkets = result.requestedMarkets.filter((key) => !result.quotes.some((quote) => quote.marketKey === key));
      if (result.missingMarkets.length) result.issues.push({ stage: 'odds', code: 'missing_markets', message: `No valid quotes returned for: ${result.missingMarkets.join(', ')}.` });
      result.status = result.quotes.length ? result.issues.length ? 'partial' : 'complete' : 'unavailable';
    } catch (error) {
      result.missingMarkets = [...result.requestedMarkets];
      result.issues.push(failure('odds', error));
    }
  }
  return { events: results, quotes: results.flatMap((result) => result.quotes) };
}