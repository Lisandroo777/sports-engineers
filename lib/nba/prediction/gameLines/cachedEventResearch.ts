import type { OddsEvent } from '../../../odds/types';
import { getOddsEventsForSport } from '../../../odds/client';
import type { PickPresentationInput } from '../../presentation';
import { nbaActivationCacheKey } from '../activationCache';
import { loadCachedNBAPlayerProps } from '../cachedProps';
import { loadCachedNBAGameQuotes } from './quotes';
import { searchNBAPlayers } from '../../players';
import { getNBAPlayerGameLogs } from '../../stats';
import { nbaHistoricalResearch } from '../../researchHistory';
import { matchesNBAResearchFilter, type NBAResearchFilter } from '../../researchMarkets';
import { loadNBAResearchEvents, loadNBAResearchReceipt, nbaResearchSlateDate, normalizeNBAResearchReceipt } from '../researchReceipt';
import { nbaResearchQuotePresentation } from '../researchPresentation';
import { exactNBAQuoteHistory, loadNBAHistoricalPeriods } from '../periodResearch';
import { espnNBASiteFetch } from '../../client';

export async function loadCachedNBAEventResearch(date: string, events?: OddsEvent[], filter?: NBAResearchFilter): Promise<PickPresentationInput[]> {
  const listed = events ?? [...new Map([...(await getOddsEventsForSport('basketball_nba').catch(() => [])),
    ...(await loadNBAResearchEvents(date).catch(() => []))].map(event => [event.id, event])).values()];
  const inputs: PickPresentationInput[] = [];
  const players = new Map<string, ReturnType<typeof searchNBAPlayers>>();
  const histories = new Map<number, ReturnType<typeof getNBAPlayerGameLogs>>();
  const teamHistories = new Map<string, ReturnType<typeof loadNBAHistoricalPeriods>>();
  for (const event of listed.filter(entry => Number.isFinite(Date.parse(entry.commenceTime)) && nbaResearchSlateDate(entry.commenceTime) === date && Date.parse(entry.commenceTime) > Date.now())) {
    if (!/^[a-f0-9]{32}$/.test(event.id)) continue;
    const broadReceipt = await loadNBAResearchReceipt(event.id).catch(() => null);
    const broadQuotes = broadReceipt ? normalizeNBAResearchReceipt(broadReceipt, {
      id: event.id, tipoff: event.commenceTime, homeTeam: event.homeTeam, awayTeam: event.awayTeam,
    }, filter) : [];
    if (broadQuotes.length) {
      for (const quote of broadQuotes) {
        let history = 'Historical research unavailable: exact player/team identity or period data not connected. No substitute used.';
        if (quote.player) {
          if (!players.has(quote.player)) players.set(quote.player, searchNBAPlayers(quote.player).catch(() => []));
          const matched = (await players.get(quote.player)!).filter(player => player.name.toLowerCase() === quote.player!.toLowerCase()
            && [event.homeTeam, event.awayTeam].includes(player.team?.displayName ?? ''));
          if (matched.length === 1) {
            const player = matched[0];
            if (!histories.has(player.id)) histories.set(player.id, getNBAPlayerGameLogs(player.id).catch(() => []));
            const logs = await histories.get(player.id)!;
            if (quote.period === 'Q1') {
              const periodKey = `player:${player.id}`;
              if (!teamHistories.has(periodKey)) teamHistories.set(periodKey, loadNBAHistoricalPeriods(logs.filter(log => Date.parse(log.date) + 6 * 3600000 < Date.now()).slice(-20).map(log => log.gameId)));
              history = exactNBAQuoteHistory({ ...quote, team: player.team!.displayName }, await teamHistories.get(periodKey)!, player.id);
            } else history = nbaHistoricalResearch(quote.sourceMarket, logs, quote.line!, quote.selection === 'Yes' || quote.selection === 'Over' ? 'over' : 'under', quote.tipoff);
          }
        } else {
          const teamName = quote.team ?? quote.homeTeam;
          if (!teamHistories.has(teamName)) teamHistories.set(teamName, (async () => {
            const teams = await espnNBASiteFetch<{ sports?: Array<{ leagues?: Array<{ teams?: Array<{ team: { id: string; displayName: string } }> }> }> }>('teams', {}, 86400);
            const team = teams.sports?.flatMap(sport => sport.leagues ?? []).flatMap(league => league.teams ?? []).find(entry => entry.team.displayName === teamName)?.team;
            if (!team) return [];
            const schedule = await espnNBASiteFetch<{ events?: Array<{ id: string; date: string; competitions?: Array<{ status?: { type?: { completed?: boolean } } }> }> }>(`teams/${team.id}/schedule`, {}, 3600);
            return loadNBAHistoricalPeriods((schedule.events ?? []).filter(game => game.competitions?.[0]?.status?.type?.completed
              && Date.parse(game.date) + 6 * 3600000 < Math.min(Date.now(), Date.parse(event.commenceTime))).slice(-20).map(game => game.id));
          })().catch(() => []));
          history = exactNBAQuoteHistory(quote, await teamHistories.get(teamName)!);
        }
        inputs.push(nbaResearchQuotePresentation(quote, history));
      }
      continue;
    }
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
    const props = await loadCachedNBAPlayerProps(event.id, event.commenceTime, true);
    for (const prop of props) for (const [side, odds] of [['over', prop.overOdds], ['under', prop.underOdds]] as const) {
      if (odds == null) continue;
      const extraMarket = prop.historicalAnalysisAvailable === false;
      const fantasy = prop.marketKey === 'player_fantasy_points';
      const binary = ['player_double_double', 'player_triple_double'].includes(prop.marketKey);
      let historicalDetail: string | null = null;
      let matchupDetail: string | null = null;
      if (!fantasy && (extraMarket || filter) && (!filter || matchesNBAResearchFilter(filter, prop.marketKey, side))) {
        if (!players.has(prop.player)) players.set(prop.player, searchNBAPlayers(prop.player).catch(() => []));
        const matches = (await players.get(prop.player)!).filter(player => player.name.toLowerCase() === prop.player.toLowerCase()
          && [event.homeTeam, event.awayTeam].includes(player.team?.displayName ?? ''));
        if (matches.length === 1) {
          const player = matches[0];
          if (!histories.has(player.id)) histories.set(player.id, getNBAPlayerGameLogs(player.id).catch(() => []));
          const logs = await histories.get(player.id)!;
          const opponent = player.team?.displayName === event.homeTeam ? event.awayTeam : event.homeTeam;
          historicalDetail = nbaHistoricalResearch(prop.marketKey, logs, prop.line, side, event.commenceTime);
          matchupDetail = nbaHistoricalResearch(prop.marketKey, logs, prop.line, side, event.commenceTime, opponent);
        } else historicalDetail = 'Historical evaluation unavailable: no unique exact player name and event-team match. No substitute player used.';
      }
      inputs.push({ ...common, candidateId: `provider.${event.id}.${prop.player}.${prop.marketKey}.${prop.line}.${side}.${prop.sportsbookKey}`,
        subject: { kind: 'PLAYER_PROP', gameId: event.id, player: { id: null, name: prop.player, team: null },
          market: { key: prop.marketKey, label: `${prop.marketLabel}${binary ? ' (Yes = Over 0.5; No = Under 0.5)' : ''}`, line: prop.line, side } },
        sportsbook: prop.sportsbookName, americanOdds: odds, quoteStatus: 'CURRENT',
        ...(extraMarket ? { missing: [...common.missing, 'Research-only market: no connected validated prediction model.',
          ...(fantasy ? ['DFS-only quote. Provider-specific fantasy scoring rules are not connected; no fantasy score formula assumed.'] : [])] } : {}),
        researchEvidence: [{ id: `quote.${event.id}.${prop.sportsbookKey}.${prop.player}.${prop.marketKey}.${side}`, category: 'VERIFIED_QUOTE',
          source: 'THE_ODDS_API', detail: `Player quote for ${event.awayTeam} @ ${event.homeTeam}; provider event ${event.id}; tipoff ${event.commenceTime}; quote updated ${prop.lastUpdate}. Team membership not inferred.`,
          observedAt: prop.lastUpdate, stance: 'CONTEXT' }, ...(historicalDetail ? [{
            id: `history.${event.id}.${prop.player}.${prop.marketKey}.${side}`, category: 'DESCRIPTIVE_HISTORY', source: 'ESPN',
            detail: historicalDetail, observedAt: new Date().toISOString(), stance: 'CONTEXT' as const,
          }] : [])] });
      if (matchupDetail) inputs[inputs.length - 1].researchEvidence = [...(inputs[inputs.length - 1].researchEvidence ?? []), {
        id: `matchup.${event.id}.${prop.player}.${prop.marketKey}.${side}`, category: 'OPPONENT_HISTORY', source: 'ESPN',
        detail: matchupDetail, observedAt: new Date().toISOString(), stance: 'CONTEXT',
      }];
    }
  }
  return inputs;
}