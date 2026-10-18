import { getDiscoveredEventPlayerProps, getOddsEvents, getPropsCacheTtlMs } from './client';
import { matchOddsEvent } from './match';
import type { NormalizedProp, OddsEvent } from './types';
import { findMLBPlayerIdByName } from '../mlb/players';

export interface EventPropsResult {
  event: OddsEvent | null;
  props: NormalizedProp[];
}

/** Fetches every currently posted player prop market for one selected game on the given slate date (defaults to today). */
export async function getEventProps(homeTeam: string, awayTeam: string, slateDate?: string, verifiedEvent?: OddsEvent | null, gameTime?: string): Promise<EventPropsResult> {
  const events = verifiedEvent === undefined ? await getOddsEvents() : verifiedEvent ? [verifiedEvent] : [];
  const event = matchOddsEvent({
    homeTeam: { id: 0, name: homeTeam, abbreviation: '' },
    awayTeam: { id: 0, name: awayTeam, abbreviation: '' },
  }, events, slateDate, gameTime);
  if (!event) return { event: null, props: [] };

  const props = await getDiscoveredEventPlayerProps(event.id, getPropsCacheTtlMs(event.commenceTime));
  const playerIds = new Map<string, number | null>();
  await Promise.all([...new Set(props.map((prop) => prop.player))].map(async (player) => {
    playerIds.set(player, await findMLBPlayerIdByName(player).catch(() => null));
  }));
  return { event, props: props.map((prop) => ({ ...prop, playerId: playerIds.get(prop.player) ?? null })) };
}
