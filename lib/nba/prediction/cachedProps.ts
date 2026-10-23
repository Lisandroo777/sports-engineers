import { readPersistentCache, readStalePersistentCache } from '../../odds/persistentCache';
import type { NormalizedProp } from '../../odds/types';
import { getNBAMarketMetadata } from '../oddsTypes';
import { nbaActivationCacheKey } from './activationCache';

interface CachedEventOdds {
  id: string;
  commence_time?: string;
  bookmakers?: Array<{ key: string; title: string; last_update?: string; markets?: Array<{
    key: string; last_update?: string; outcomes?: Array<{ name: string; description?: string; point?: number; price: number }>;
  }> }>;
}

export async function hasCachedNBAEventOdds(eventId: string): Promise<boolean> {
  return /^[a-f0-9]{32}$/.test(eventId) && await readStalePersistentCache(nbaActivationCacheKey(eventId)) != null;
}

export async function loadCachedNBAPlayerProps(eventId: string, expectedTipoff?: string): Promise<NormalizedProp[]> {
  const base = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${encodeURIComponent(eventId)}`;
  const discovery = await readPersistentCache<{ bookmakers?: Array<{ markets?: Array<{ key: string }> }> }>(`${base}/markets?regions=us`);
  const markets = [...new Set((discovery?.data.bookmakers ?? []).flatMap(book => book.markets ?? []).map(market => market.key))]
    .filter(key => key.startsWith('player_'));
  const legacyKey = `${base}/odds?regions=us&markets=${markets.join(',')}&oddsFormat=american`;
  const cached = (markets.length ? await readPersistentCache<CachedEventOdds>(legacyKey) : null)
    ?? (/^[a-f0-9]{32}$/.test(eventId) ? await readPersistentCache<CachedEventOdds>(nbaActivationCacheKey(eventId))
      ?? await readStalePersistentCache<CachedEventOdds>(nbaActivationCacheKey(eventId)) : null);
  if (!cached || cached.data.id !== eventId || cached.cachedAt > Date.now()) return [];
  if (/^[a-f0-9]{32}$/.test(eventId) && ![legacyKey, nbaActivationCacheKey(eventId)].includes(cached.key)) return [];
  if (expectedTipoff && Date.parse(cached.data.commence_time ?? '') !== Date.parse(expectedTipoff)) return [];
  const props: NormalizedProp[] = [];
  for (const book of cached.data.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      const metadata = getNBAMarketMetadata(market.key);
      if (!metadata || metadata.historicalSupport === 'unsupported') continue;
      const updatedAt = market.last_update ?? book.last_update;
      if (!updatedAt || !Number.isFinite(Date.parse(updatedAt)) || Date.parse(updatedAt) > cached.cachedAt
        || Date.now() - Date.parse(updatedAt) > 3600000) continue;
      const selections = new Map<string, { player: string; line: number; over: number | null; under: number | null }>();
      for (const outcome of market.outcomes ?? []) {
        if (!outcome.description || outcome.point == null || !Number.isFinite(outcome.point)
          || !Number.isInteger(outcome.price) || Math.abs(outcome.price) < 100 || !['Over', 'Under'].includes(outcome.name)) continue;
        const identity = JSON.stringify([outcome.description, outcome.point]);
        const selection = selections.get(identity) ?? { player: outcome.description, line: outcome.point, over: null, under: null };
        if (outcome.name === 'Over') selection.over = outcome.price;
        else selection.under = outcome.price;
        selections.set(identity, selection);
      }
      for (const selection of selections.values()) props.push({ player: selection.player, marketKey: metadata.canonicalMarketKey,
        sourceMarketKey: market.key as NormalizedProp['sourceMarketKey'], isAlternate: metadata.isAlternate,
        historicalAnalysisAvailable: true, marketLabel: metadata.label, line: selection.line,
        overOdds: selection.over, underOdds: selection.under, sportsbookKey: book.key, sportsbookName: book.title,
        eventId, lastUpdate: updatedAt });
    }
  }
  return props;
}