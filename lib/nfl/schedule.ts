import { espnSiteFetch } from './client';
import type { NFLGame, NFLGameOdds, NFLTeam } from './types';
import { SPORTS_TIME_ZONE } from '../dateModel';
import { nflSeasonYear } from './stats';

interface RawScoreboardTeam {
  id: string;
  displayName: string;
  name?: string;
  abbreviation: string;
  color?: string;
  logo?: string;
}

interface RawCompetitor {
  id: string;
  homeAway: 'home' | 'away';
  team: RawScoreboardTeam;
  score?: string;
}

interface RawOddsLine { line?: string | number; odds?: string | number }
interface RawSpreadSide { open?: RawOddsLine; close?: RawOddsLine }
interface RawOdds {
  provider?: { name?: string; displayName?: string };
  spread?: number;
  overUnder?: number;
  pointSpread?: { home?: RawSpreadSide; away?: RawSpreadSide };
  total?: { over?: RawSpreadSide; under?: RawSpreadSide };
}

interface RawEvent {
  id: string;
  date: string;
  season?: { year?: number; type?: number; name?: string };
  week?: { number: number; text?: string };
  competitions: Array<{
    competitors: RawCompetitor[];
    status?: { type?: { completed?: boolean; name?: string } };
    venue?: { id?: string; fullName?: string; indoor?: boolean; address?: { city?: string; state?: string; country?: string } };
    odds?: RawOdds[];
  }>;
}

function postseasonRound(weekText: string | undefined): NFLGame['playoffRound'] {
  const text = weekText ?? '';
  if (/super\s*bowl/i.test(text)) return 'SUPER_BOWL';
  if (/conference|championship/i.test(text)) return 'CONFERENCE_CHAMPIONSHIP';
  if (/divisional/i.test(text)) return 'DIVISIONAL';
  if (/wild\s*card/i.test(text)) return 'WILD_CARD';
  return null;
}

function numericOddsLine(value: string | number | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/^[ou]/i, '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeGameOdds(odds: RawOdds[], retrievedAt: string): NFLGameOdds[] {
  return odds.flatMap((entry) => {
    const homeSpread = numericOddsLine(entry.pointSpread?.home?.close?.line) ?? (Number.isFinite(entry.spread) ? entry.spread! : null);
    const openingHomeSpread = numericOddsLine(entry.pointSpread?.home?.open?.line);
    const total = Number.isFinite(entry.overUnder) ? entry.overUnder! : numericOddsLine(entry.total?.over?.close?.line);
    const openingTotal = numericOddsLine(entry.total?.over?.open?.line);
    if (homeSpread == null && total == null) return [];
    return [{ provider: entry.provider?.displayName ?? entry.provider?.name ?? 'ESPN game odds', homeSpread, openingHomeSpread, total, openingTotal, retrievedAt }];
  });
}

function normalizeScoreboardTeam(team: RawScoreboardTeam): NFLTeam {
  return {
    id: Number(team.id),
    name: team.name ?? team.displayName,
    displayName: team.displayName,
    abbreviation: team.abbreviation,
    logoUrl: team.logo ?? null,
    color: team.color ? `#${team.color}` : null,
  };
}

export async function getNFLUpcomingGameDate(teamIds: number[], now = new Date()): Promise<string | null> {
  if (teamIds.length === 0) return null;
  const data = await espnSiteFetch<{ events?: RawEvent[] }>(`teams/${teamIds[0]}/schedule`, { season: String(nflSeasonYear(now)) }, 300);
  const event = (data.events ?? []).filter((entry) => {
    const competition = entry.competitions?.[0];
    return !competition?.status?.type?.completed && new Date(entry.date).getTime() > now.getTime()
      && teamIds.every((id) => competition?.competitors?.some((competitor) => Number(competitor.team.id) === id));
  }).sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime())[0];
  if (!event) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SPORTS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(event.date));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function getNFLSchedule(options?: { week?: number; date?: string }): Promise<NFLGame[]> {
  const params: Record<string, string> = {};
  if (options?.date) params.dates = options.date.replace(/-/g, '');
  else if (options?.week) params.week = String(options.week);
  const data = await espnSiteFetch<{ events?: RawEvent[] }>('scoreboard', params, 300);
  const events = data.events ?? [];

  return events.map((event) => {
    const competition = event.competitions?.[0];
    const home = competition?.competitors?.find((c) => c.homeAway === 'home');
    const away = competition?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) throw new Error('Malformed NFL scoreboard event');

    return {
      id: event.id,
      season: event.season?.year ?? nflSeasonYear(new Date(event.date)),
      week: event.week?.number ?? null,
      seasonType: event.season?.type === 3 || /postseason|playoffs/i.test(event.season?.name ?? '') ? 'POSTSEASON'
        : event.season?.type === 2 || /regular/i.test(event.season?.name ?? '') ? 'REGULAR' : null,
      playoffRound: postseasonRound(event.week?.text),
      gameTime: event.date,
      homeTeam: normalizeScoreboardTeam(home.team),
      awayTeam: normalizeScoreboardTeam(away.team),
      homeScore: home.score != null ? Number(home.score) : null,
      awayScore: away.score != null ? Number(away.score) : null,
      completed: Boolean(competition?.status?.type?.completed),
      status: competition?.status?.type?.name,
      venue: competition.venue?.fullName ? {
        id: competition.venue.id ?? null,
        name: competition.venue.fullName,
        indoor: typeof competition.venue.indoor === 'boolean' ? competition.venue.indoor : null,
        city: competition.venue.address?.city ?? null,
        state: competition.venue.address?.state ?? null,
        country: competition.venue.address?.country ?? null,
      } : null,
      odds: normalizeGameOdds(competition?.odds ?? [], new Date().toISOString()),
    };
  });
}
