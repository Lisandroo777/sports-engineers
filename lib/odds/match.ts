import type { MLBGame } from '../mlb/types';
import type { OddsEvent } from './types';
import { SPORTS_TIME_ZONE } from '../dateModel';

const MLB_TEAM_ALIASES: Record<string, string> = {
  athletics: 'athletics',
  oaklandathletics: 'athletics',
  as: 'athletics',
  whitesox: 'chicagowhitesox',
  chicagowhitesox: 'chicagowhitesox',
  dbacks: 'arizonadiamondbacks',
  diamondbacks: 'arizonadiamondbacks',
  arizonadiamondbacks: 'arizonadiamondbacks',
  guardians: 'clevelandguardians',
  clevelandguardians: 'clevelandguardians',
  marlins: 'miamimarlins',
  miamimarlins: 'miamimarlins',
};

export function normalizeMLBTeamName(name: string) {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return MLB_TEAM_ALIASES[compact] ?? compact;
}

/**
 * The event's calendar date in the sports time zone, as YYYY-MM-DD.
 * Slicing the UTC timestamp instead would file any game after ~8pm ET under the following day.
 */
export function oddsEventSlateDate(event: OddsEvent): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SPORTS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(event.commenceTime));
}

export function matchOddsEvent(game: MLBGame, oddsEvents: OddsEvent[]): OddsEvent | null {
  const home = normalizeMLBTeamName(game.homeTeam.name);
  const away = normalizeMLBTeamName(game.awayTeam.name);
  return oddsEvents.find((event) => normalizeMLBTeamName(event.homeTeam) === home && normalizeMLBTeamName(event.awayTeam) === away) ?? null;
}

/**
 * Finds the odds event for a team, optionally constrained to a specific slate date (YYYY-MM-DD).
 * Passing a date is important on days with doubleheaders/multiple same-team events — without it,
 * this would silently match whichever event happens to appear first in the events list.
 */
export function findOddsEventForTeam(teamName: string, oddsEvents: OddsEvent[], slateDate?: string): OddsEvent | null {
  const normalized = normalizeMLBTeamName(teamName);
  const candidates = oddsEvents.filter((event) => normalizeMLBTeamName(event.homeTeam) === normalized || normalizeMLBTeamName(event.awayTeam) === normalized);
  if (candidates.length === 0) return null;
  if (!slateDate) return candidates[0];
  return candidates.find((event) => oddsEventSlateDate(event) === slateDate) ?? null;
}
