import { createNBAContextProvider } from '../../context/provider';
import type { NBAContextSnapshot } from '../../context/types';
import type { NBAGame } from '../../types';
import type { OddsEvent } from '../../../odds/types';
import { findNBAOddsEvent } from '../../odds';
import { projectNBAGame } from './model';
import { loadCachedNBAGameQuotes } from './quotes';
import { buildGameRecommendation, withoutScenarios, type GameRecommendation, type ModeledGameResearch } from './recommendations';
import { assessNBAGameAvailability } from './availability';
import { loadNBAGameIntelligence } from './intelligenceArchive';
import type { NBAIntelligenceSnapshot } from '../../intelligence/types';
import { nbaActivationCacheKey } from '../activationCache';

export function existingGameQuoteKeys(eventId: string): string[] {
  const base = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${encodeURIComponent(eventId)}/odds`;
  const keys = ['h2h', 'spreads', 'totals', 'team_totals', 'h2h,spreads,totals', 'h2h,spreads,totals,team_totals'].map(markets =>
    `${base}?regions=us&markets=${markets}&oddsFormat=american`);
  return /^[a-f0-9]{32}$/.test(eventId) ? [...keys, nbaActivationCacheKey(eventId)] : keys;
}

export async function researchNBAGameLines(games: NBAGame[], events: OddsEvent[], dependencies?: {
  loadSnapshot: (gameId: string, teamId: number) => Promise<NBAContextSnapshot>;
  loadQuotes: typeof loadCachedNBAGameQuotes;
  loadIntelligence?: (snapshot: NBAContextSnapshot) => Promise<NBAIntelligenceSnapshot | null>;
}) {
  const provider = dependencies ? null : createNBAContextProvider({ maxRequests: 100, maxGamesPerTeam: 20 });
  const loadSnapshot = dependencies?.loadSnapshot ?? ((gameId, teamId) => provider!.loadSnapshot({ gameId, teamId }));
  const loadQuotes = dependencies?.loadQuotes ?? loadCachedNBAGameQuotes;
  const loadIntelligence = dependencies?.loadIntelligence ?? loadNBAGameIntelligence;
  const recommendations: GameRecommendation[] = [];
  const modeledGames: ModeledGameResearch[] = [];
  for (const game of games.filter(entry => !entry.completed && Date.parse(entry.gameTime) > Date.now())) {
    const home = { id: game.homeTeam.id, name: game.homeTeam.displayName, logoUrl: game.homeTeam.logoUrl };
    const away = { id: game.awayTeam.id, name: game.awayTeam.displayName, logoUrl: game.awayTeam.logoUrl };
    try {
      const snapshot = await loadSnapshot(game.id, home.id);
      const predictionAt = snapshot.asOf;
      let intelligence: NBAIntelligenceSnapshot | null = null;
      let archiveIssue: string | null = null;
      try { intelligence = await loadIntelligence(snapshot); }
      catch { archiveIssue = 'Agent #2 intelligence archive unavailable or invalid; no evidence inferred.'; }
      const availability = assessNBAGameAvailability(snapshot, intelligence, predictionAt);
      if (archiveIssue) availability.blockers.push(archiveIssue);
      const model = projectNBAGame({ snapshot, predictionAt, intelligence });
      const event = findNBAOddsEvent(home.name, away.name,
        events.filter(entry => Date.parse(entry.commenceTime) === Date.parse(game.gameTime)), game.gameTime.slice(0, 10));
      const quotes = new Map<string, import('./types').GameQuote>();
      const researchQuotes = new Map<string, import('./types').GameQuote>();
      if (event) {
        const binding = { sourceGameId: game.id, eventId: event.id, homeTeam: home.name, awayTeam: away.name };
        for (const cacheKey of existingGameQuoteKeys(event.id)) {
          const result = await loadQuotes({ cacheKey, binding, predictionAt });
          for (const quote of result.quotes) {
            const updated = Date.parse(quote.updatedAt);
            const observed = Date.parse(quote.observedAt);
            if (quote.eventId !== event.id || quote.homeTeam !== home.name || quote.awayTeam !== away.name
              || Date.parse(quote.commenceTime) !== Date.parse(game.gameTime) || !Number.isFinite(updated) || !Number.isFinite(observed)
              || updated > observed || observed > Date.parse(predictionAt) || Date.now() - updated > 3600000) continue;
            quotes.set(JSON.stringify(quote), quote);
            researchQuotes.set(JSON.stringify(quote), quote);
          }
        }
        for (const [key, quote] of quotes) {
          const recommendation = buildGameRecommendation(model, quote, binding,
            { ...availability, assessment: availability });
          if (recommendation.assessment.status === 'PRICED') recommendations.push({ ...recommendation, home, away });
          else quotes.delete(key);
        }
      }
      modeledGames.push({ recommendationType: 'GAME', gameId: game.id, home, away, projection: withoutScenarios(model),
        availability,
        quotes: [...researchQuotes.values()],
        status: researchQuotes.size ? 'QUOTE_AVAILABLE' : model.status === 'AVAILABLE' ? 'MODELED_NOT_BETTABLE' : 'RESEARCH_UNAVAILABLE',
        reason: researchQuotes.size ? model.status !== 'AVAILABLE'
          ? `Verified cached quotes found, but game projection is ${model.status}. Research only; no probability or EV invented. ${availability.blockers.join(' ')}`
          : availability.impactReviewResolved
          ? 'Verified availability and cached quotes found. Publication still requires every price, value and quality gate.'
          : `Cached quotes found; not a qualified pick. ${availability.blockers.join(' ')}`
          : 'No matching timestamped sportsbook game quotes in the existing cache. No line, odds or EV invented.' });
    } catch {
      modeledGames.push({ recommendationType: 'GAME', gameId: game.id, home, away, projection: null,
        status: 'RESEARCH_UNAVAILABLE', reason: 'Cutoff-safe team research unavailable. No model or price was invented.' });
    }
  }
  return { recommendations, modeledGames };
}