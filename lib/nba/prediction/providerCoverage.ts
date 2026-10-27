import { NBA_RESEARCH_MARKETS } from '../researchMarkets';

const UNDOCUMENTED_IDS = new Set(['field_goals_attempted', 'three_pointers_attempted', 'two_pointers_made',
  'dunks', 'defensive_rebounds', 'offensive_rebounds', 'personal_fouls', 'points_q2', 'points_q3', 'points_q4']);

export const NBA_DOCUMENTED_QUOTE_MARKETS = NBA_RESEARCH_MARKETS.filter(entry => !UNDOCUMENTED_IDS.has(entry.id)).map(entry => entry.id);

interface ProviderMarket {
  key: string;
  last_update?: string;
  outcomes?: Array<{ name: string; description?: string; point?: number; price: number }>;
}
export interface NBAProviderCoverageReceipt {
  observedAt: string;
  expectedEventId: string;
  expectedTipoff: string;
  data: { id: string; sport_key: string; commence_time: string;
    bookmakers?: Array<{ key: string; markets?: ProviderMarket[] }> };
}

export function auditNBAProviderCoverage(receipts: NBAProviderCoverageReceipt[], now = Date.now()) {
  const valid = receipts.filter(receipt => receipt.data.id === receipt.expectedEventId
    && receipt.data.sport_key === 'basketball_nba' && /^[a-f0-9]{32}$/.test(receipt.expectedEventId)
    && Date.parse(receipt.expectedTipoff) === Date.parse(receipt.data.commence_time)
    && Date.parse(receipt.expectedTipoff) > now
    && Number.isFinite(Date.parse(receipt.observedAt)) && Date.parse(receipt.observedAt) <= now
    && now - Date.parse(receipt.observedAt) <= 3600000);
  return NBA_RESEARCH_MARKETS.map(entry => {
    const advertised = new Set<string>();
    const priced = new Set<string>();
    let quoteCount = 0;
    for (const receipt of valid) for (const book of receipt.data.bookmakers ?? []) for (const market of book.markets ?? []) {
      if (market.key !== entry.id) continue;
      advertised.add(book.key);
      const updated = Date.parse(market.last_update ?? '');
      if (!Number.isFinite(updated) || updated > Date.parse(receipt.observedAt) || now - updated > 3600000) continue;
      for (const outcome of market.outcomes ?? []) {
        if (!Number.isInteger(outcome.price) || Math.abs(outcome.price) < 100) continue;
        const player = entry.id.startsWith('player_');
        const binary = ['player_double_double', 'player_triple_double'].includes(entry.id);
        if (player && !outcome.description?.trim()) continue;
        if (binary ? !['Yes', 'No'].includes(outcome.name)
          : /^(?:h2h)(?:_q1)?$/.test(entry.id) ? !outcome.name.trim()
            : !Number.isFinite(outcome.point) || (player || entry.id.includes('total')) && !['Over', 'Under'].includes(outcome.name)) continue;
        priced.add(book.key);
        quoteCount += 1;
      }
    }
    return { id: entry.id, label: entry.label, documented: !UNDOCUMENTED_IDS.has(entry.id),
      status: quoteCount ? 'CURRENT_QUOTES_OBSERVED' : advertised.size ? 'ADVERTISED_NO_CURRENT_QUOTES' : 'NOT_OBSERVED',
      quoteCount, advertisedBooks: [...advertised].sort(), pricedBooks: [...priced].sort(),
      scope: 'Supplied receipts only; absence does not establish provider-wide unavailability.' };
  });
}