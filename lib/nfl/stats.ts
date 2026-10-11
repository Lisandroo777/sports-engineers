import { espnWebFetch } from './client';
import type { NFLGameLogEntry, NFLGameStatMap } from './types';
import { normalizedNFLInput } from './researchSnapshot';

interface RawGameLogEvent {
  id: string;
  week?: number;
  atVs?: string;
  gameDate: string;
  gameResult?: string;
  opponent?: { displayName?: string; abbreviation?: string };
  team?: { id?: string };
  position?: { abbreviation?: string };
  starter?: boolean;
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
  const requestedSeason = season ?? nflSeasonYear();
  return normalizedNFLInput(`logs:${playerId}:${requestedSeason}`, 15 * 60000, () => loadPlayerGameLogs(playerId, requestedSeason));
}

async function loadPlayerGameLogs(playerId: number | string, requestedSeason: number): Promise<NFLGameLogEntry[]> {
  const data = await espnWebFetch<RawGameLogResponse>(
    `common/v3/sports/football/nfl/athletes/${playerId}/gamelog`,
    { season: String(requestedSeason) },
    0,
  );
  if (!Array.isArray(data.names) || !data.events || !Array.isArray(data.seasonTypes)) throw new Error('NFL historical input is incomplete.');
  const names = data.names ?? [];
  const eventsMeta = data.events ?? {};
  const statsByEvent = new Map<string, NFLGameStatMap>();

  for (const seasonType of data.seasonTypes ?? []) {
    if (/preseason/i.test(seasonType.displayName)) continue;
    const recordedSeason = seasonType.displayName.match(/\b(\d{4})\b/)?.[1];
    if (recordedSeason && Number(recordedSeason) !== requestedSeason) continue;
    for (const category of seasonType.categories ?? []) {
      if (category.type !== 'event') continue;
      for (const event of category.events ?? []) {
        const statMap = statsByEvent.get(event.eventId) ?? {};
        event.stats.forEach((value, index) => {
          const key = names[index];
          if (!key) return;
          if (!value.trim() || /^-+$/.test(value.trim())) return;
          const parsed = Number(value.replaceAll(',', ''));
          if (Number.isFinite(parsed)) statMap[key] = parsed;
        });
        statsByEvent.set(event.eventId, statMap);
      }
    }
  }

  const entries: NFLGameLogEntry[] = [];
  for (const [eventId, stats] of statsByEvent) {
    const meta = eventsMeta[eventId];
    if (!meta || !Number.isFinite(Date.parse(meta.gameDate))) throw new Error('NFL game-log event metadata is incomplete.');
    entries.push({
      gameId: eventId,
      season: requestedSeason,
      teamId: meta.team?.id && Number.isFinite(Number(meta.team.id)) ? Number(meta.team.id) : null,
      position: meta.position?.abbreviation ?? null,
      started: typeof meta.starter === 'boolean' ? meta.starter : null,
      roleEvidence: [
        ...(stats.passingAttempts > 0 ? ['PASSING' as const] : []),
        ...(stats.rushingAttempts > 0 ? ['RUSHING' as const] : []),
        ...(stats.receivingTargets > 0 ? ['RECEIVING' as const] : []),
      ],
      week: meta.week ?? null,
      date: meta.gameDate,
      opponent: meta.opponent?.displayName ?? 'Data unavailable',
      opponentAbbreviation: meta.opponent?.abbreviation ?? '',
      homeAway: meta.atVs === '@' ? 'away' : 'home',
      result: meta.gameResult ?? null,
      stats,
    });
  }

  return entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.gameId.localeCompare(b.gameId));
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
  const current = (await getPlayerGameLogs(playerId, season)).map((log) => ({ ...log, historySource: 'CURRENT_SEASON' as const }));
  if (current.filter((entry) => entry.result != null).length >= NFL_ROLE_LOOKBACK_GAMES) return mergeNFLGameLogs(current);
  const previous = (await getPlayerGameLogs(playerId, season - 1).catch(() => [])).map((log) => ({ ...log, historySource: 'PREVIOUS_SEASON' as const }));
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
