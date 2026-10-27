import { readPersistentCache, readStalePersistentCache, writePersistentCache } from '../../odds/persistentCache';
import { NBA_RESEARCH_MARKETS, type NBAResearchFilter } from '../researchMarkets';
import type { OddsEvent } from '../../odds/types';

export function nbaResearchSlateDate(tipoff: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(tipoff));
}

export async function loadNBAResearchEvents(date: string): Promise<OddsEvent[]> {
  return (await readPersistentCache<OddsEvent[]>(`nba:research-events:v1:${date}`))?.data ?? [];
}

export const NBA_VERIFIED_RESEARCH_MARKETS = NBA_RESEARCH_MARKETS.filter(entry => ![
  'player_field_goals', 'player_frees_made', 'player_frees_attempts', 'player_turnovers', 'player_fantasy_points',
  'field_goals_attempted', 'three_pointers_attempted', 'two_pointers_made', 'dunks', 'defensive_rebounds',
  'offensive_rebounds', 'personal_fouls', 'points_q2', 'points_q3', 'points_q4',
].includes(entry.id)).map(entry => entry.id);

export interface NBAResearchReceipt {
  observedAt: string;
  marketObservedAt?: Record<string, string>;
  regions: ['us', 'us2'];
  requestedMarkets: string[];
  data: { id: string; sport_key: string; commence_time: string; home_team: string; away_team: string;
    bookmakers?: Array<{ key: string; title: string; markets?: Array<{ key: string; last_update?: string;
      outcomes?: Array<{ name: string; description?: string; point?: number; price: number }> }> }> };
}
export interface NBAResearchQuote {
  eventId: string; tipoff: string; homeTeam: string; awayTeam: string;
  sourceMarket: string; period: 'FULL_GAME' | 'Q1'; isAlternate: boolean;
  player: string | null; team: string | null; selection: string; line: number | null; odds: number;
  bookKey: string; book: string; updatedAt: string; observedAt: string; regions: ['us', 'us2'];
}

export function nbaResearchReceiptKey(eventId: string) {
  if (!/^[a-f0-9]{32}$/.test(eventId)) throw new Error('Exact NBA provider event ID required.');
  return `nba:research-receipt:v1:${eventId}:us,us2`;
}

export function normalizeNBAResearchReceipt(receipt: NBAResearchReceipt, expected: {
  id: string; tipoff: string; homeTeam: string; awayTeam: string;
}, filter?: NBAResearchFilter, now = Date.now()): NBAResearchQuote[] {
  const data = receipt.data;
  const observed = Date.parse(receipt.observedAt);
  if (!/^[a-f0-9]{32}$/.test(expected.id) || data.id !== expected.id || data.sport_key !== 'basketball_nba'
    || data.home_team !== expected.homeTeam || data.away_team !== expected.awayTeam
    || expected.homeTeam === expected.awayTeam || Date.parse(data.commence_time) !== Date.parse(expected.tipoff)
    || Date.parse(expected.tipoff) <= now || !Number.isFinite(observed) || observed > now || now - observed > 3600000
    || receipt.regions.join(',') !== 'us,us2') return [];
  const quotes: NBAResearchQuote[] = [];
  for (const book of data.bookmakers ?? []) for (const market of book.markets ?? []) {
    if (!receipt.requestedMarkets.includes(market.key) || !NBA_RESEARCH_MARKETS.some(entry => entry.id === market.key)
      || filter?.marketIds != null && !filter.marketIds.includes(market.key)) continue;
    const marketObservedAt = receipt.marketObservedAt?.[market.key] ?? receipt.observedAt;
    const marketObserved = Date.parse(marketObservedAt);
    const updated = Date.parse(market.last_update ?? '');
    if (!Number.isFinite(updated) || !Number.isFinite(marketObserved) || marketObserved > now || updated > marketObserved
      || now - updated > (market.key.endsWith('_q1') ? 120000 : 300000) || !book.key || !book.title) continue;
    for (const outcome of market.outcomes ?? []) {
      if (!Number.isInteger(outcome.price) || Math.abs(outcome.price) < 100) continue;
      const player = market.key.startsWith('player_');
      const binary = ['player_double_double', 'player_triple_double'].includes(market.key);
      const moneyline = market.key === 'h2h' || market.key === 'h2h_q1';
      const spread = market.key.includes('spreads');
      if (player && !outcome.description?.trim()) continue;
      if (binary ? !['Yes', 'No'].includes(outcome.name) : moneyline || spread
        ? ![data.home_team, data.away_team].includes(outcome.name) : !['Over', 'Under'].includes(outcome.name)) continue;
      if (!binary && !moneyline && !Number.isFinite(outcome.point)) continue;
      if (market.key.includes('team_totals') && ![data.home_team, data.away_team].includes(outcome.description ?? '')) continue;
      const side = binary ? outcome.name === 'Yes' ? 'over' : 'under' : outcome.name.toLowerCase();
      if (filter && ['over', 'under'].includes(side) && !filter.sides.includes(side as 'over' | 'under')) continue;
      quotes.push({ eventId: data.id, tipoff: data.commence_time, homeTeam: data.home_team, awayTeam: data.away_team,
        sourceMarket: market.key, period: market.key.endsWith('_q1') ? 'Q1' : 'FULL_GAME', isAlternate: market.key.startsWith('alternate_'),
        player: player ? outcome.description! : null, team: moneyline || spread ? outcome.name : market.key.includes('team_totals') ? outcome.description! : null,
        selection: outcome.name, line: binary ? 0.5 : moneyline ? null : outcome.point!, odds: outcome.price,
        bookKey: book.key, book: book.title, updatedAt: market.last_update!, observedAt: marketObservedAt, regions: ['us', 'us2'] });
    }
  }
  return quotes;
}

export async function loadNBAResearchReceipt(eventId: string): Promise<NBAResearchReceipt | null> {
  const key = nbaResearchReceiptKey(eventId);
  const stored = await readPersistentCache<NBAResearchReceipt>(key) ?? await readStalePersistentCache<NBAResearchReceipt>(key);
  return stored?.key === key ? stored.data : null;
}

export async function storeNBAResearchReceipt(receipt: NBAResearchReceipt): Promise<void> {
  const expected = { id: receipt.data.id, tipoff: receipt.data.commence_time, homeTeam: receipt.data.home_team, awayTeam: receipt.data.away_team };
  if (!validResearchReceipt(receipt, expected)) throw new Error('Invalid research receipt identity or observation; receipt not stored.');
  const old = await loadNBAResearchReceipt(receipt.data.id);
  const merged = mergeNBAResearchReceipts(old, receipt);
  await writePersistentCache(nbaResearchReceiptKey(receipt.data.id), merged, Date.parse(receipt.observedAt) + 3600000);
  const confirmed = await loadNBAResearchReceipt(receipt.data.id);
  if (!confirmed || receipt.requestedMarkets.some(id => confirmed.marketObservedAt?.[id] !== (receipt.marketObservedAt?.[id] ?? receipt.observedAt))) {
    throw new Error('Research receipt storage unavailable; quote acquisition not safely persisted.');
  }
  const date = nbaResearchSlateDate(receipt.data.commence_time);
  const events = await loadNBAResearchEvents(date);
  await writePersistentCache(`nba:research-events:v1:${date}`, [...events.filter(event => event.id !== receipt.data.id), {
    id: receipt.data.id, commenceTime: receipt.data.commence_time, homeTeam: receipt.data.home_team, awayTeam: receipt.data.away_team,
  }], Date.parse(receipt.data.commence_time));
}

export function validResearchReceipt(receipt: NBAResearchReceipt, expected: { id: string; tipoff: string; homeTeam: string; awayTeam: string }, now = Date.now()): boolean {
  return receipt.data.id === expected.id && /^[a-f0-9]{32}$/.test(expected.id) && receipt.data.sport_key === 'basketball_nba'
    && receipt.data.home_team === expected.homeTeam && receipt.data.away_team === expected.awayTeam && expected.homeTeam !== expected.awayTeam
    && Date.parse(receipt.data.commence_time) === Date.parse(expected.tipoff) && Date.parse(expected.tipoff) > now
    && Number.isFinite(Date.parse(receipt.observedAt)) && Date.parse(receipt.observedAt) <= now
    && receipt.regions.join(',') === 'us,us2';
}

export function nbaResearchMarketCoverage(receipt: NBAResearchReceipt | null, expected: { id: string; tipoff: string; homeTeam: string; awayTeam: string }, markets: string[], now = Date.now()) {
  return markets.map(id => {
    if (!receipt || !validResearchReceipt(receipt, expected, now) || !receipt.requestedMarkets.includes(id)) return { id, state: 'MISSING' as const, needsRefresh: true };
    const observed = Date.parse(receipt.marketObservedAt?.[id] ?? receipt.observedAt);
    const rows = (receipt.data.bookmakers ?? []).flatMap(book => (book.markets ?? []).filter(market => market.key === id));
    const freshness = /_q1$/.test(id) ? 120000 : 300000;
    const hasValidQuote = normalizeNBAResearchReceipt(receipt, expected, { marketIds: [id], sides: ['over', 'under'], ranking: 'BEST' }, now).length > 0;
    const pricedRows = hasValidQuote ? rows : [];
    const current = pricedRows.length > 0 && rows.every(row => Number.isFinite(Date.parse(row.last_update ?? ''))
      && Date.parse(row.last_update!) <= observed && now - Date.parse(row.last_update!) <= freshness);
    if (observed > now || !Number.isFinite(observed)) return { id, state: 'STALE' as const, needsRefresh: true };
    if (current && now - observed <= freshness) return { id, state: 'FRESH' as const, needsRefresh: false };
    if (!rows.some(row => (row.outcomes ?? []).some(outcome => Number.isInteger(outcome.price) && Math.abs(outcome.price) >= 100))
      && now - observed <= 60000) return { id, state: 'NOT_POSTED' as const, needsRefresh: false };
    return { id, state: 'STALE' as const, needsRefresh: true };
  });
}

export function mergeNBAResearchReceipts(old: NBAResearchReceipt | null, incoming: NBAResearchReceipt): NBAResearchReceipt {
  const compatible = old && old.data.id === incoming.data.id && old.data.commence_time === incoming.data.commence_time
    && old.data.home_team === incoming.data.home_team && old.data.away_team === incoming.data.away_team;
  if (!compatible) return { ...incoming, marketObservedAt: Object.fromEntries(incoming.requestedMarkets.map(id => [id, incoming.marketObservedAt?.[id] ?? incoming.observedAt])) };
  const accepted = incoming.requestedMarkets.filter(id => Date.parse(incoming.marketObservedAt?.[id] ?? incoming.observedAt)
    >= Date.parse(old.marketObservedAt?.[id] ?? old.observedAt));
  const books = new Map<string, NonNullable<NBAResearchReceipt['data']['bookmakers']>[number]>();
  for (const book of old.data.bookmakers ?? []) books.set(book.key, { ...book, markets: (book.markets ?? []).filter(market => !accepted.includes(market.key)) });
  for (const book of incoming.data.bookmakers ?? []) books.set(book.key, { ...book, markets: [...(books.get(book.key)?.markets ?? []), ...(book.markets ?? []).filter(market => accepted.includes(market.key))] });
  return { ...incoming, requestedMarkets: [...new Set([...old.requestedMarkets, ...incoming.requestedMarkets])],
    marketObservedAt: { ...Object.fromEntries(old.requestedMarkets.map(id => [id, old.marketObservedAt?.[id] ?? old.observedAt])),
      ...Object.fromEntries(accepted.map(id => [id, incoming.marketObservedAt?.[id] ?? incoming.observedAt])) },
    data: { ...incoming.data, bookmakers: [...books.values()] } };
}