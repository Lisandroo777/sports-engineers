import { getEventPlayerProps, getOddsEvents, getPropsCacheTtlMs } from './client';
import { findOddsEventForTeam } from './match';
import { ALTERNATE_HITTER_MARKETS, ALTERNATE_PITCHER_MARKETS, HITTER_MARKETS, PITCHER_MARKETS } from './types';
import type { NormalizedProp, OddsEvent } from './types';

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

export interface PlayerPropsResult {
  event: OddsEvent | null;
  props: NormalizedProp[];
}

export async function getPlayerProps(playerName: string, teamName: string, isPitcher: boolean, useAlternates = false, slateDate?: string): Promise<PlayerPropsResult> {
  const events = await getOddsEvents();
  const event = findOddsEventForTeam(teamName, events, slateDate);
  if (!event) return { event: null, props: [] };

  const markets = useAlternates
    ? (isPitcher ? ALTERNATE_PITCHER_MARKETS : ALTERNATE_HITTER_MARKETS)
    : (isPitcher ? PITCHER_MARKETS : HITTER_MARKETS);
  const allProps = await getEventPlayerProps(event.id, markets, getPropsCacheTtlMs(event.commenceTime));
  const normalizedTarget = normalizeName(playerName);
  const props = allProps.filter((prop) => normalizeName(prop.player) === normalizedTarget);
  return { event, props };
}
