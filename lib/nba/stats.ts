import { espnNBAWebFetch } from './client';
import type { NBAGameLogEntry, NBAGameStatMap } from './types';

interface RawEvent { id: string; gameDate?: string; atVs?: string; gameResult?: string; season?: { year?: number; type?: number; name?: string }; week?: { text?: string }; opponent?: { displayName?: string; abbreviation?: string }; }
interface RawCategoryEvent { eventId: string; stats: string[]; }
interface RawCategory { type: string; events?: RawCategoryEvent[]; }
interface RawSeasonType { displayName: string; type?: string; categories?: RawCategory[]; }
interface RawGameLogResponse { names?: string[]; events?: Record<string, RawEvent>; seasonTypes?: RawSeasonType[]; }

function parseStat(value: string, key: string): number | null {
  if (key === 'minutes') {
    const parts = value.split(':').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] / 60 : Number(value);
  }
  if (key.includes('-')) {
    const made = Number(value.split('-')[0]);
    return Number.isFinite(made) ? made : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getNBAPlayerGameLogs(playerId: number | string): Promise<NBAGameLogEntry[]> {
  const data = await espnNBAWebFetch<RawGameLogResponse>(`common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`, {}, 900);
  const names = data.names ?? [];
  const statsByEvent = new Map<string, NBAGameStatMap>();
  const phaseByEvent = new Map<string, { season: number | null; phase: NonNullable<NBAGameLogEntry['phase']>; round: string | null }>();
  for (const seasonType of data.seasonTypes ?? []) {
    const display = `${seasonType.displayName} ${seasonType.type ?? ''}`;
    if (/preseason|all-star/i.test(display)) continue;
    const season = Number(display.match(/\b(\d{4})\b/)?.[1]);
    const phase: NonNullable<NBAGameLogEntry['phase']> = /play.?in/i.test(display) ? 'PLAY_IN'
      : /postseason|playoffs/i.test(display) ? 'POSTSEASON'
        : /regular/i.test(display) ? 'REGULAR' : 'UNKNOWN';
    for (const category of seasonType.categories ?? []) {
      if (category.type !== 'event') continue;
      for (const event of category.events ?? []) {
        phaseByEvent.set(event.eventId, { season: Number.isFinite(season) ? season : null, phase, round: data.events?.[event.eventId]?.week?.text ?? null });
        const stats = statsByEvent.get(event.eventId) ?? {};
        event.stats.forEach((value, index) => {
          const key = names[index];
          if (!key) return;
          const parsed = parseStat(value, key);
          if (parsed != null) stats[key] = parsed;
          if (key.includes('-')) {
            const statNames = key.split('-');
            const statValues = value.split('-');
            if (statNames.length === 2 && statValues.length === 2 && statValues.every(part => /^\d+$/.test(part.trim()))) {
              stats[statNames[0]] = Number(statValues[0]);
              stats[statNames[1]] = Number(statValues[1]);
            }
          }
        });
        statsByEvent.set(event.eventId, stats);
      }
    }
  }
  const logs: NBAGameLogEntry[] = [];
  for (const [gameId, stats] of statsByEvent) {
    const event = data.events?.[gameId];
    if (!event?.gameDate) continue;
    const seasonInfo = phaseByEvent.get(gameId);
    const season = event.season?.year ?? seasonInfo?.season ?? null;
    const display = `${event.season?.name ?? ''} ${event.week?.text ?? ''}`;
    const phase = /play.?in/i.test(display) || seasonInfo?.phase === 'PLAY_IN' ? 'PLAY_IN'
      : event.season?.type === 1 || /preseason/i.test(display) ? 'PRESEASON'
        : event.season?.type === 2 || /regular/i.test(display) ? 'REGULAR'
          : event.season?.type === 3 || /postseason|playoffs/i.test(display) ? 'POSTSEASON'
            : seasonInfo?.phase ?? 'UNKNOWN';
    logs.push({ gameId, date: event.gameDate, season, phase, round: event.week?.text ?? seasonInfo?.round ?? null,
      opponent: event.opponent?.displayName ?? 'Data unavailable', opponentAbbreviation: event.opponent?.abbreviation ?? '',
      homeAway: event.atVs === '@' ? 'away' : 'home', result: event.gameResult ?? null, stats });
  }
  return logs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export const NBA_MARKET_TO_STAT = {
  points: 'points', rebounds: 'totalRebounds', assists: 'assists', threePointersMade: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', steals: 'steals', blocks: 'blocks', turnovers: 'turnovers', minutes: 'minutes',
} as const;

export type NBAStatMarket = keyof typeof NBA_MARKET_TO_STAT;

export function getNBAStatValue(log: NBAGameLogEntry, market: NBAStatMarket): number | null {
  return log.stats[NBA_MARKET_TO_STAT[market]] ?? null;
}
