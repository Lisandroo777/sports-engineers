import { getDiscoveredEventPlayerProps, getOddsEvents, getPropsCacheTtlMs } from './client';
import { findOddsEventForTeam } from './match';
import type { NormalizedProp, OddsEvent } from './types';
import { findMLBPlayerIdByName } from '../mlb/players';

export interface EventPropsResult {
  event: OddsEvent | null;
  props: NormalizedProp[];
}

/** Fetches every currently posted player prop market for one selected game on the given slate date (defaults to today). */
export async function getEventProps(homeTeam: string, awayTeam: string, slateDate?: string): Promise<EventPropsResult> {
  const events = await getOddsEvents();
  const event = findOddsEventForTeam(homeTeam, events, slateDate) ?? findOddsEventForTeam(awayTeam, events, slateDate);
  if (!event) return { event: null, props: [] };

  const props = await getDiscoveredEventPlayerProps(event.id, getPropsCacheTtlMs(event.commenceTime));
  const playerIds = new Map<string, number | null>();
  await Promise.all([...new Set(props.map((prop) => prop.player))].map(async (player) => {
    playerIds.set(player, await findMLBPlayerIdByName(player));
  }));
  return { event, props: props.map((prop) => ({ ...prop, playerId: playerIds.get(prop.player) ?? null })) };
}
