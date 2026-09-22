import type { NormalizedProp } from './types';

export type PropSide = 'over' | 'under';

export function getOpportunityId(prop: NormalizedProp, side: PropSide) {
  return [prop.eventId, prop.player, prop.sourceMarketKey, prop.line, side, prop.sportsbookKey]
    .join('|')
    .toLowerCase()
    .replace(/\s+/g, '-');
}
