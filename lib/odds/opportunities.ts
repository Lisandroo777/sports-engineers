import { consensusProbability, expectedValuePercent, fairAmericanOdds, removeTwoWayVig } from './math';
import { getOpportunityId } from './identity';
import type { NormalizedProp } from './types';

export interface MarketConsensusOpportunity {
  id: string;
  player: string;
  playerId?: number | null;
  marketLabel: string;
  marketKey: string;
  line: number;
  side: 'over' | 'under';
  sportsbookKey: string;
  sportsbookName: string;
  odds: number;
  fairProbability: number;
  fairOdds: number | null;
  evPercent: number;
  availableBooks: number;
  lastUpdate: string;
  eventId: string;
}

export function buildMarketConsensusOpportunities(props: NormalizedProp[]): MarketConsensusOpportunity[] {
  const groups = new Map<string, NormalizedProp[]>();
  for (const prop of props.filter((entry) => !entry.isAlternate)) {
    const key = `${prop.player}|${prop.marketKey}|${prop.line}`;
    groups.set(key, [...(groups.get(key) ?? []), prop]);
  }

  const opportunities: MarketConsensusOpportunity[] = [];
  for (const group of groups.values()) {
    const paired = group.filter((prop) => prop.overOdds != null && prop.underOdds != null);
    const overConsensus = consensusProbability(paired.map((prop) => removeTwoWayVig(prop.overOdds!, prop.underOdds!)?.over ?? NaN));
    const underConsensus = consensusProbability(paired.map((prop) => removeTwoWayVig(prop.overOdds!, prop.underOdds!)?.under ?? NaN));
    if (overConsensus == null || underConsensus == null || paired.length < 2) continue;

    for (const prop of group) {
      for (const [side, odds, probability] of [
        ['over', prop.overOdds, overConsensus] as const,
        ['under', prop.underOdds, underConsensus] as const,
      ]) {
        if (odds == null) continue;
        const evPercent = expectedValuePercent(probability, odds);
        if (evPercent == null || evPercent <= 0) continue;
        opportunities.push({
          id: getOpportunityId(prop, side),
          player: prop.player,
          playerId: prop.playerId,
          marketLabel: prop.marketLabel,
          marketKey: prop.marketKey,
          line: prop.line,
          side,
          sportsbookKey: prop.sportsbookKey,
          sportsbookName: prop.sportsbookName,
          odds,
          fairProbability: probability,
          fairOdds: fairAmericanOdds(probability),
          evPercent,
          availableBooks: paired.length,
          lastUpdate: prop.lastUpdate,
          eventId: prop.eventId,
        });
      }
    }
  }
  return opportunities.sort((a, b) => b.evPercent - a.evPercent);
}
