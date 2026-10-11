import type { OddsEvent } from '../../../odds/types';
import { getOddsEventsForSport } from '../../../odds/client';
import type { PickPresentationInput } from '../../presentation';
import { nbaActivationCacheKey } from '../activationCache';
import { loadCachedNBAPlayerProps } from '../cachedProps';
import { loadCachedNBAGameQuotes } from './quotes';

export async function loadCachedNBAEventResearch(date: string, events?: OddsEvent[]): Promise<PickPresentationInput[]> {
  const listed = events ?? await getOddsEventsForSport('basketball_nba').catch(() => []);
  const inputs: PickPresentationInput[] = [];
  for (const event of listed.filter(entry => entry.commenceTime.slice(0, 10) === date && Date.parse(entry.commenceTime) > Date.now())) {
    if (!/^[a-f0-9]{32}$/.test(event.id)) continue;
    const result = await loadCachedNBAGameQuotes({ cacheKey: nbaActivationCacheKey(event.id),
      binding: { sourceGameId: event.id, eventId: event.id, homeTeam: event.homeTeam, awayTeam: event.awayTeam }, predictionAt: new Date().toISOString() });
    const common = { tierDecision: null, trueProbability: null, modelProbability: null, evPercent: null, researchScore: null,
      seasonPhase: null, seasonPhaseCertainty: 'MISSING' as const,
      missing: ['Exact ESPN event/season/model binding and verified availability required; provider quotes alone are not recommendations.'] };
    for (const quote of result.quotes.filter(quote => Date.parse(quote.commenceTime) === Date.parse(event.commenceTime))) inputs.push({ ...common,
      candidateId: `provider.${event.id}.${quote.market}.${quote.selection}.${quote.team}.${quote.line}.${quote.sportsbookKey}`,
      subject: { kind: 'GAME_LINE', gameId: event.id, home: { id: null, name: event.homeTeam }, away: { id: null, name: event.awayTeam },
        market: { key: quote.market, label: quote.market, type: quote.market, line: quote.line, selection: quote.selection, team: quote.team } },
      sportsbook: quote.sportsbook, americanOdds: quote.americanOdds, quoteStatus: 'CURRENT',
      researchEvidence: [{ id: `quote.${event.id}.${quote.sportsbookKey}.${quote.market}`, category: 'VERIFIED_QUOTE',
        source: 'THE_ODDS_API', detail: `Provider event ${event.id}; ${event.awayTeam} @ ${event.homeTeam}; tipoff ${event.commenceTime}; quote updated ${quote.updatedAt}.`,
        observedAt: quote.observedAt, stance: 'CONTEXT' }] });
    const props = await loadCachedNBAPlayerProps(event.id, event.commenceTime);
    for (const prop of props) for (const [side, odds] of [['over', prop.overOdds], ['under', prop.underOdds]] as const) {
      if (odds == null) continue;
      inputs.push({ ...common, candidateId: `provider.${event.id}.${prop.player}.${prop.marketKey}.${prop.line}.${side}.${prop.sportsbookKey}`,
        subject: { kind: 'PLAYER_PROP', gameId: event.id, player: { id: null, name: prop.player, team: null },
          market: { key: prop.marketKey, label: prop.marketLabel, line: prop.line, side } },
        sportsbook: prop.sportsbookName, americanOdds: odds, quoteStatus: 'CURRENT',
        researchEvidence: [{ id: `quote.${event.id}.${prop.sportsbookKey}.${prop.player}.${prop.marketKey}.${side}`, category: 'VERIFIED_QUOTE',
          source: 'THE_ODDS_API', detail: `Player quote for ${event.awayTeam} @ ${event.homeTeam}; provider event ${event.id}; tipoff ${event.commenceTime}; quote updated ${prop.lastUpdate}. Team membership not inferred.`,
          observedAt: prop.lastUpdate, stance: 'CONTEXT' }] });
    }
  }
  return inputs;
}