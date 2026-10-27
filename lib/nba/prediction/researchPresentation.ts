import type { PickPresentationInput } from '../presentation';
import { NBA_RESEARCH_MARKETS } from '../researchMarkets';
import type { NBAResearchQuote } from './researchReceipt';

export function nbaResearchQuotePresentation(quote: NBAResearchQuote, history: string): PickPresentationInput {
  const entry = NBA_RESEARCH_MARKETS.find(market => market.id === quote.sourceMarket)!;
  const binary = ['player_double_double', 'player_triple_double'].includes(quote.sourceMarket);
  const playerSide = quote.selection === 'Over' || quote.selection === 'Yes' ? 'over' : 'under';
  const selection = quote.selection === quote.homeTeam ? 'HOME' : quote.selection === quote.awayTeam ? 'AWAY' : playerSide === 'over' ? 'OVER' : 'UNDER';
  const team = quote.team === quote.homeTeam ? 'HOME' : quote.team === quote.awayTeam ? 'AWAY' : null;
  const type = quote.sourceMarket.includes('team_totals') ? 'TEAM_TOTAL' : quote.sourceMarket.includes('totals') ? 'TOTAL'
    : quote.sourceMarket.includes('spreads') ? 'SPREAD' : 'MONEYLINE';
  const market = { key: quote.sourceMarket, label: `${entry.label}${binary ? ' (Yes = Over 0.5; No = Under 0.5)' : ''}`, line: quote.line };
  return { candidateId: `research26.${JSON.stringify([quote.eventId, quote.sourceMarket, quote.player, quote.team, quote.selection, quote.line, quote.bookKey])}`,
    subject: quote.player ? { kind: 'PLAYER_PROP', gameId: quote.eventId, player: { id: null, name: quote.player, team: quote.team }, market: { ...market, side: playerSide } }
      : { kind: 'GAME_LINE', gameId: quote.eventId, home: { id: null, name: quote.homeTeam }, away: { id: null, name: quote.awayTeam }, market: { ...market, type, selection, team } },
    sportsbook: quote.book, americanOdds: quote.odds, quoteStatus: 'CURRENT', tierDecision: null,
    trueProbability: null, modelProbability: null, evPercent: null, researchScore: null, seasonPhase: null, seasonPhaseCertainty: 'MISSING',
    missing: ['Research-only quote: validated probability/EV model and publication readiness are not established for this exact contract.'],
    researchEvidence: [{ id: 'quote-provenance', category: 'VERIFIED_QUOTE', source: 'THE_ODDS_API', observedAt: quote.updatedAt, stance: 'CONTEXT',
      detail: `Event ${quote.eventId}; ${quote.awayTeam} @ ${quote.homeTeam}; tipoff ${quote.tipoff}; market ${quote.sourceMarket}; period ${quote.period}; alternate ${quote.isAlternate}; exact line ${quote.line}; selection ${quote.selection}; book ${quote.bookKey}; odds ${quote.odds}; quote updated ${quote.updatedAt}; receipt observed ${quote.observedAt}; requested regions ${quote.regions.join(',')}. Regions describe the query, not the bookmaker's individual jurisdiction.` },
      { id: 'exact-history', category: 'DESCRIPTIVE_HISTORY', source: 'ESPN', observedAt: new Date().toISOString(), stance: 'CONTEXT', detail: history }],
  };
}