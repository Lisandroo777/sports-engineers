import { espnWebFetch } from './client';
import type { NFLGameLogEntry, NFLGameStatMap } from './types';

interface RawGameLogEvent {
  id: string;
  week?: number;
  atVs?: string;
  gameDate: string;
  gameResult?: string;
  opponent?: { displayName?: string; abbreviation?: string };
}

interface RawCategoryEvent {
  eventId: string;
  stats: string[];
}

interface RawCategory {
  displayName: string;
  type: string;
  events?: RawCategoryEvent[];
}

interface RawSeasonType {
  displayName: string;
  categories?: RawCategory[];
}

interface RawGameLogResponse {
  names?: string[];
  events?: Record<string, RawGameLogEvent>;
  seasonTypes?: RawSeasonType[];
}

export async function getPlayerGameLogs(playerId: number | string, season?: number): Promise<NFLGameLogEntry[]> {
  const data = await espnWebFetch<RawGameLogResponse>(
    `common/v3/sports/football/nfl/athletes/${playerId}/gamelog`,
    season == null ? {} : { season: String(season) },
    900,
  );
  const names = data.names ?? [];
  const eventsMeta = data.events ?? {};
  const statsByEvent = new Map<string, NFLGameStatMap>();

  for (const seasonType of data.seasonTypes ?? []) {
    if (/preseason/i.test(seasonType.displayName)) continue;
    for (const category of seasonType.categories ?? []) {
      if (category.type !== 'event') continue;
      for (const event of category.events ?? []) {
        const statMap = statsByEvent.get(event.eventId) ?? {};
        event.stats.forEach((value, index) => {
          const key = names[index];
          if (!key) return;
          const parsed = Number(value);
          if (Number.isFinite(parsed)) statMap[key] = parsed;
        });
        statsByEvent.set(event.eventId, statMap);
      }
    }
  }

  const entries: NFLGameLogEntry[] = [];
  for (const [eventId, stats] of statsByEvent) {
    const meta = eventsMeta[eventId];
    if (!meta) continue;
    entries.push({
      gameId: eventId,
      week: meta.week ?? null,
      date: meta.gameDate,
      opponent: meta.opponent?.displayName ?? 'Data unavailable',
      opponentAbbreviation: meta.opponent?.abbreviation ?? '',
      homeAway: meta.atVs === '@' ? 'away' : 'home',
      result: meta.gameResult ?? null,
      stats,
    });
  }

  return entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export const NFL_ROLE_LOOKBACK_GAMES = 17;

export function nflSeasonYear(date = new Date()): number {
  return date.getUTCMonth() < 2 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
}

export function mergeNFLGameLogs(...sets: NFLGameLogEntry[][]): NFLGameLogEntry[] {
  const byGame = new Map<string, NFLGameLogEntry>();
  for (const entry of sets.flat()) byGame.set(entry.gameId, entry);
  return [...byGame.values()]
    .filter((entry) => entry.result != null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-NFL_ROLE_LOOKBACK_GAMES);
}

/** Rolling workload history for role analysis only; never changes current-season prop history. */
export async function getPlayerRoleWorkloadLogs(playerId: number | string, season = nflSeasonYear()): Promise<NFLGameLogEntry[]> {
  const current = await getPlayerGameLogs(playerId, season);
  if (current.filter((entry) => entry.result != null).length >= NFL_ROLE_LOOKBACK_GAMES) return mergeNFLGameLogs(current);
  const previous = await getPlayerGameLogs(playerId, season - 1).catch(() => []);
  return mergeNFLGameLogs(previous, current);
}

export function getStatValue(entry: NFLGameLogEntry, statKey: string): number | null {
  return entry.stats[statKey] ?? null;
}

/** Canonical stat keys actually observed in ESPN's NFL gamelog `names` array, grouped by position relevance. */
export const NFL_STAT_KEYS = {
  passingYards: 'passingYards',
  passingAttempts: 'passingAttempts',
  completions: 'completions',
  completionPct: 'completionPct',
  passingTouchdowns: 'passingTouchdowns',
  longestCompletion: 'longPassing',
  interceptions: 'interceptions',
  rushingYards: 'rushingYards',
  rushingAttempts: 'rushingAttempts',
  yardsPerRushAttempt: 'yardsPerRushAttempt',
  rushingTouchdowns: 'rushingTouchdowns',
  receivingYards: 'receivingYards',
  receptions: 'receptions',
  receivingTouchdowns: 'receivingTouchdowns',
  yardsPerReception: 'yardsPerReception',
  targets: 'receivingTargets',
  longestRush: 'longRushing',
  longestReception: 'longReception',
  totalTackles: 'totalTackles',
  soloTackles: 'soloTackles',
  assistTackles: 'assistTackles',
  sacks: 'sacks',
  passesDefended: 'passesDefended',
  fumblesForced: 'fumblesForced',
  fumblesRecovered: 'fumblesRecovered',
} as const;
