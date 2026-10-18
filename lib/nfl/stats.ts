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

const KICKING_ALIASES = {
  fieldGoalsMade: ['fieldGoalsMade', 'fieldGoalsMade-fieldGoalAttempts'],
  fieldGoalAttempts: ['fieldGoalAttempts', 'fieldGoalsAttempted'],
  extraPointsMade: ['extraPointsMade', 'extraPointsMade-extraPointAttempts'],
  extraPointAttempts: ['extraPointAttempts', 'extraPointsAttempted'],
  kickingPoints: ['kickingPoints', 'totalKickingPoints'],
  longestFieldGoal: ['longestFieldGoal', 'longFieldGoal', 'longFieldGoalMade'],
  fieldGoalsMade0_19: ['fieldGoalsMade0_19', 'fieldGoalsMade1_19', 'fieldGoalsMade1_19-fieldGoalAttempts1_19'],
  fieldGoalAttempts0_19: ['fieldGoalAttempts0_19', 'fieldGoalAttempts1_19'],
  fieldGoalsMade20_29: ['fieldGoalsMade20_29', 'fieldGoalsMade20_29-fieldGoalAttempts20_29'],
  fieldGoalAttempts20_29: ['fieldGoalAttempts20_29'],
  fieldGoalsMade30_39: ['fieldGoalsMade30_39', 'fieldGoalsMade30_39-fieldGoalAttempts30_39'],
  fieldGoalAttempts30_39: ['fieldGoalAttempts30_39'],
  fieldGoalsMade40_49: ['fieldGoalsMade40_49', 'fieldGoalsMade40_49-fieldGoalAttempts40_49'],
  fieldGoalAttempts40_49: ['fieldGoalAttempts40_49'],
  fieldGoalsMade50Plus: ['fieldGoalsMade50Plus', 'fieldGoalsMade50', 'fieldGoalsMade50-fieldGoalAttempts50'],
  fieldGoalAttempts50Plus: ['fieldGoalAttempts50Plus', 'fieldGoalAttempts50'],
} as const;

export function normalizeNFLKickingStats(names: readonly string[], values: readonly string[]): NFLGameStatMap {
  const raw = new Map<string, string[]>();
  names.forEach((name, index) => {
    if (values[index] !== undefined) raw.set(name, [...(raw.get(name) ?? []), values[index].trim()]);
  });
  const count = (value: string): number | null => {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  const read = (aliases: readonly string[]): number | null => {
    const supplied = aliases.flatMap((alias) => raw.get(alias) ?? []);
    if (!supplied.length) return null;
    const parsed = supplied.map(count);
    return parsed.every((value) => value !== null && value === parsed[0]) ? parsed[0] : null;
  };
  const pair = (madeAliases: readonly string[], attemptAliases: readonly string[]): [number | null, number | null] => {
    const madeValues = madeAliases.flatMap((alias) => raw.get(alias) ?? []);
    const madeCounts: string[] = [];
    const attemptCounts = attemptAliases.flatMap((alias) => raw.get(alias) ?? []);
    for (const value of madeValues) {
      const matched = /^(\d+)\s*[/-]\s*(\d+)$/.exec(value);
      madeCounts.push(matched ? matched[1] : value);
      if (matched) attemptCounts.push(matched[2]);
    }
    const consistent = (supplied: string[]): number | null => {
      const parsed = supplied.map(count);
      return parsed.length && parsed.every((value) => value !== null && value === parsed[0]) ? parsed[0] : null;
    };
    const made = consistent(madeCounts);
    const attempts = consistent(attemptCounts);
    if ((madeCounts.length && made === null) || (attemptCounts.length && attempts === null)
      || (made !== null && attempts !== null && made > attempts)) return [null, null];
    return [made, attempts];
  };
  const [made, attempts] = pair(KICKING_ALIASES.fieldGoalsMade, KICKING_ALIASES.fieldGoalAttempts);
  const [extraMade, extraAttempts] = pair(KICKING_ALIASES.extraPointsMade, KICKING_ALIASES.extraPointAttempts);
  const result: NFLGameStatMap = {};
  const put = (key: string, value: number | null) => { if (value !== null && Number.isSafeInteger(value)) result[key] = value; };
  put('fieldGoalsMade', made);
  put('fieldGoalAttempts', attempts);
  put('extraPointsMade', extraMade);
  put('extraPointAttempts', extraAttempts);
  const derivedPoints = made !== null && extraMade !== null ? 3 * made + extraMade : null;
  const points = read(KICKING_ALIASES.kickingPoints);
  const hasPoints = KICKING_ALIASES.kickingPoints.some((alias) => raw.has(alias));
  const minimumPoints = 3 * (made ?? 0) + (extraMade ?? 0);
  const consistentPoints = points !== null && points >= minimumPoints && (derivedPoints === null || points === derivedPoints);
  put('kickingPoints', hasPoints ? (consistentPoints ? points : null) : derivedPoints);
  const longest = read(KICKING_ALIASES.longestFieldGoal);
  put('longestFieldGoal', longest !== null && longest > 0 && made !== 0 && attempts !== 0 ? longest : null);
  const bucketAliases = [
    [KICKING_ALIASES.fieldGoalsMade0_19, KICKING_ALIASES.fieldGoalAttempts0_19],
    [KICKING_ALIASES.fieldGoalsMade20_29, KICKING_ALIASES.fieldGoalAttempts20_29],
    [KICKING_ALIASES.fieldGoalsMade30_39, KICKING_ALIASES.fieldGoalAttempts30_39],
    [KICKING_ALIASES.fieldGoalsMade40_49, KICKING_ALIASES.fieldGoalAttempts40_49],
    [KICKING_ALIASES.fieldGoalsMade50Plus, KICKING_ALIASES.fieldGoalAttempts50Plus],
  ] as const;
  const buckets = bucketAliases.map(([madeAliases, attemptAliases]) => pair(madeAliases, attemptAliases));
  const sumComplete = (counts: (number | null)[]): number | null => counts.every((value) => value !== null)
    ? counts.reduce<number>((sum, value) => sum + value!, 0) : null;
  const consistentTotal = (counts: (number | null)[], total: number | null): boolean => {
    const sum = counts.reduce<number>((subtotal, value) => subtotal + (value ?? 0), 0);
    return total === null || (sum <= total && (counts.some((value) => value === null) || sum === total));
  };
  const bucketsValid = buckets.every(([bucketMade, bucketAttempts], index) =>
    bucketMade !== null || bucketAttempts !== null || !bucketAliases[index].flat().some((alias) => raw.has(alias)));
  const bucketsConsistent = bucketsValid && consistentTotal(buckets.map(([value]) => value), made)
    && consistentTotal(buckets.map(([, value]) => value), attempts);
  if (bucketsConsistent) {
    put('fieldGoalsMadeUnder40', sumComplete(buckets.slice(0, 3).map(([value]) => value)));
    put('fieldGoalAttemptsUnder40', sumComplete(buckets.slice(0, 3).map(([, value]) => value)));
    put('fieldGoalsMade40_49', buckets[3][0]);
    put('fieldGoalAttempts40_49', buckets[3][1]);
    put('fieldGoalsMade50Plus', buckets[4][0]);
    put('fieldGoalAttempts50Plus', buckets[4][1]);
  }
  return result;
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
  const rawStatsByEvent = new Map<string, { names: string[]; values: string[] }>();

  for (const seasonType of data.seasonTypes ?? []) {
    if (/preseason/i.test(seasonType.displayName)) continue;
    const recordedSeason = seasonType.displayName.match(/\b(\d{4})\b/)?.[1];
    if (recordedSeason && Number(recordedSeason) !== requestedSeason) continue;
    for (const category of seasonType.categories ?? []) {
      if (category.type !== 'event') continue;
      for (const event of category.events ?? []) {
        const statMap = statsByEvent.get(event.eventId) ?? {};
        const rawStats = rawStatsByEvent.get(event.eventId) ?? { names: [], values: [] };
        event.stats.forEach((value, index) => {
          const key = names[index];
          if (!key) return;
          rawStats.names.push(key);
          rawStats.values.push(value);
          if (!value.trim() || /^-+$/.test(value.trim())) return;
          const parsed = Number(value.replaceAll(',', ''));
          if (Number.isFinite(parsed)) statMap[key] = parsed;
        });
        rawStatsByEvent.set(event.eventId, rawStats);
        statsByEvent.set(event.eventId, statMap);
      }
    }
  }

  const entries: NFLGameLogEntry[] = [];
  for (const [eventId, stats] of statsByEvent) {
    const rawStats = rawStatsByEvent.get(eventId)!;
    for (const aliases of Object.values(KICKING_ALIASES)) {
      for (const alias of aliases) delete stats[alias];
    }
    delete stats.fieldGoalsMadeUnder40;
    delete stats.fieldGoalAttemptsUnder40;
    Object.assign(stats, normalizeNFLKickingStats(rawStats.names, rawStats.values));
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

/** Provider stat keys and canonical normalized kicking keys, grouped by position relevance. */
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
  fieldGoalsMade: 'fieldGoalsMade',
  fieldGoalAttempts: 'fieldGoalAttempts',
  extraPointsMade: 'extraPointsMade',
  extraPointAttempts: 'extraPointAttempts',
  kickingPoints: 'kickingPoints',
  longestFieldGoal: 'longestFieldGoal',
  fieldGoalsMadeUnder40: 'fieldGoalsMadeUnder40',
  fieldGoalAttemptsUnder40: 'fieldGoalAttemptsUnder40',
  fieldGoalsMade40_49: 'fieldGoalsMade40_49',
  fieldGoalAttempts40_49: 'fieldGoalAttempts40_49',
  fieldGoalsMade50Plus: 'fieldGoalsMade50Plus',
  fieldGoalAttempts50Plus: 'fieldGoalAttempts50Plus',
} as const;
