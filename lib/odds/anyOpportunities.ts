import { consensusProbability, expectedValuePercent, fairAmericanOdds, removeTwoWayVig } from './math';
import { getOpportunityId } from './identity';
import type { NormalizedProp } from './types';

export interface AnyMarketOpportunity {
  id: string;
  player: string;
  playerId?: number | null;
  marketLabel: string;
  marketKey: string;
  isAlternate: boolean;
  line: number;
  side: 'over' | 'under';
  sportsbookKey: string;
  sportsbookName: string;
  odds: number;
  fairProbability: number | null;
  fairOdds: number | null;
  evPercent: number | null;
  availableBooks: number;
  marketAgreement: number | null;
  lastUpdate: string;
  eventId: string;
  historicalAnalysisAvailable: boolean;
}

/** Same consensus/EV math as opportunities.ts, but returns every priced side (positive and negative EV) for broader analysis. */
export function buildAllMarketOpportunities(props: NormalizedProp[]): AnyMarketOpportunity[] {
  const groups = new Map<string, NormalizedProp[]>();
  for (const prop of props.filter((entry) => !entry.isAlternate)) {
    const key = `${prop.player}|${prop.marketKey}|${prop.line}`;
    groups.set(key, [...(groups.get(key) ?? []), prop]);
  }

  const opportunities: AnyMarketOpportunity[] = [];
  for (const group of groups.values()) {
    const paired = group.filter((prop) => prop.overOdds != null && prop.underOdds != null);
    const overProbs = paired.map((prop) => removeTwoWayVig(prop.overOdds!, prop.underOdds!)?.over).filter((value): value is number => value != null);
    const underProbs = paired.map((prop) => removeTwoWayVig(prop.overOdds!, prop.underOdds!)?.under).filter((value): value is number => value != null);
    const overConsensus = consensusProbability(overProbs);
    const underConsensus = consensusProbability(underProbs);
    const agreement = overProbs.length > 1 ? 100 - Math.min(100, (Math.max(...overProbs) - Math.min(...overProbs)) * 400) : null;

    for (const prop of group) {
      for (const [side, odds, probability] of [
        ['over', prop.overOdds, overConsensus] as const,
        ['under', prop.underOdds, underConsensus] as const,
      ]) {
        if (odds == null) continue;
        const evPercent = probability != null ? expectedValuePercent(probability, odds) : null;
        opportunities.push({
          id: getOpportunityId(prop, side),
          player: prop.player,
          playerId: prop.playerId,
          marketLabel: prop.marketLabel,
          marketKey: prop.marketKey,
          isAlternate: prop.isAlternate,
          line: prop.line,
          side,
          sportsbookKey: prop.sportsbookKey,
          sportsbookName: prop.sportsbookName,
          odds,
          fairProbability: probability,
          fairOdds: probability != null ? fairAmericanOdds(probability) : null,
          evPercent,
          availableBooks: paired.length,
          marketAgreement: agreement,
          lastUpdate: prop.lastUpdate,
          eventId: prop.eventId,
          historicalAnalysisAvailable: prop.historicalAnalysisAvailable,
        });
      }
    }
  }
  return opportunities;
}
