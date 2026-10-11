import type { ResearchSession } from '../../../ai/agent/session';
import { selectRankedCandidates } from '../../../ai/agent/tools';
import { classifyNBAMarketIntent } from '../marketIntent';
import { classifyGameRecommendation, type NBARecommendation } from './recommendations';
import { qualityFloorFromQuery, tierMeetsFloor } from '../../../ai/agent/pickTiers';

export function selectNBAMixedRecommendations(session: ResearchSession, query: string, now = new Date()): NBARecommendation[] {
  const intent = classifyNBAMarketIntent(query);
  const qualityQuery = /\bnukes?\b/i.test(query) ? `${query} nukes only` : query;
  const selectedMarkets = new Set(intent.gameLineMarkets.map(market => market === 'FULL_GAME_TOTAL' ? 'TOTAL' : market));
  const games = (session.gameCandidates ?? []).flatMap(record => {
    if (intent.playerPropsRequested && !intent.allMarketsRequested && !selectedMarkets.size) return [];
    if (!intent.allMarketsRequested && selectedMarkets.size && !selectedMarkets.has(record.marketKey)) return [];
    const decision = classifyGameRecommendation(record, now);
    return decision.pickTier !== 'PASS' && tierMeetsFloor(decision.pickTier, qualityFloorFromQuery(qualityQuery)) ? [{ ...record, ...decision }] : [];
  });
  const props = intent.gameLinesOnly ? [] : selectRankedCandidates(session.candidates, qualityQuery, { sport: 'nba' }).selected;
  const records: NBARecommendation[] = [...props, ...games];
  const valueFirst = /best\s+value|value\s+picks|highest\s+ev/i.test(query);
  const likelyFirst = /most\s+likely|safest|highest\s+probability/i.test(query);
  return records.sort((first, second) => {
    const probability = (second.trueProbability ?? -Infinity) - (first.trueProbability ?? -Infinity);
    const ev = (second.evPercent ?? -Infinity) - (first.evPercent ?? -Infinity);
    const quality = second.researchScore - first.researchScore;
    return (valueFirst ? ev || quality || probability : likelyFirst ? probability || quality || ev : quality || probability || ev)
      || first.trapRisk - second.trapRisk || first.candidateId.localeCompare(second.candidateId);
  }).slice(0, Math.min(15, Number(query.match(/\b(?:top|best|show(?:\s+me)?|find|give(?:\s+me)?)\s+(\d+)\b/i)?.[1] ?? 15)))
    .map((record, index) => ({ ...record, rank: index + 1 }));
}