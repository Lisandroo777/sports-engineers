import type { ResearchSession } from '../ai/agent/session';
import { classifyNBAMarketIntent, type NBAGameLineMarket } from './prediction/marketIntent';
import { matchesNBAResearchFilter, NBA_RESEARCH_MARKETS, type NBAResearchFilter } from './researchMarkets';

export function nbaResearchMarketIntent(query: string, filter?: NBAResearchFilter) {
  const intent = classifyNBAMarketIntent(query);
  if (!filter || filter.marketIds == null) return intent;
  const entries = NBA_RESEARCH_MARKETS.filter(entry => filter.marketIds!.includes(entry.id));
  const gameLineMarkets = entries.flatMap(entry => entry.category === 'Team' && entry.candidateKey != null
    ? [entry.id.includes('spreads') ? 'SPREAD' : entry.id.includes('team_totals') ? 'TEAM_TOTAL' : entry.id.includes('totals') ? 'FULL_GAME_TOTAL' : 'MONEYLINE'] as NBAGameLineMarket[] : []);
  const playerPropsRequested = entries.some(entry => entry.candidateKey != null && entry.category !== 'Team');
  return { gameLineMarkets, playerPropsRequested, allMarketsRequested: false,
    gameLinesOnly: gameLineMarkets.length > 0 && !playerPropsRequested };
}

export function scopeNBAResearchMarkets(session: ResearchSession, filter: NBAResearchFilter): ResearchSession {
  const hasTeamMarket = NBA_RESEARCH_MARKETS.some(entry => entry.category === 'Team' && entry.candidateKey != null
    && (filter.marketIds == null || filter.marketIds.includes(entry.id)));
  return { ...session,
    candidates: session.candidates.filter(record => matchesNBAResearchFilter(filter, record.marketKey, record.direction)),
    gameCandidates: session.gameCandidates?.filter(record => matchesNBAResearchFilter(filter, record.marketKey, record.selection)),
    modeledGames: hasTeamMarket ? session.modeledGames?.map(game => ({ ...game,
      quotes: game.quotes?.filter(quote => matchesNBAResearchFilter(filter, quote.market, quote.selection)),
    })).filter(game => (game.quotes?.length ?? 0) > 0 || matchesNBAResearchFilter(filter, 'TOTAL', 'OVER')) : [],
    nbaPresentationResearch: session.nbaPresentationResearch?.filter(record => matchesNBAResearchFilter(filter,
      record.subject.market.key, record.subject.kind === 'PLAYER_PROP' ? record.subject.market.side : record.subject.market.selection)),
  };
}