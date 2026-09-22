import { espnSiteFetch } from './client';
import type { NFLGame, NFLTeam } from './types';

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

interface RawEvent {
  id: string;
  date: string;
  week?: { number: number };
  competitions: Array<{
    competitors: RawCompetitor[];
    status?: { type?: { completed?: boolean } };
    venue?: { id?: string; fullName?: string; indoor?: boolean; address?: { city?: string; state?: string; country?: string } };
  }>;
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
      week: event.week?.number ?? null,
      gameTime: event.date,
      homeTeam: normalizeScoreboardTeam(home.team),
      awayTeam: normalizeScoreboardTeam(away.team),
      homeScore: home.score != null ? Number(home.score) : null,
      awayScore: away.score != null ? Number(away.score) : null,
      completed: Boolean(competition?.status?.type?.completed),
      venue: competition.venue?.fullName ? {
        id: competition.venue.id ?? null,
        name: competition.venue.fullName,
        indoor: typeof competition.venue.indoor === 'boolean' ? competition.venue.indoor : null,
        city: competition.venue.address?.city ?? null,
        state: competition.venue.address?.state ?? null,
        country: competition.venue.address?.country ?? null,
      } : null,
    };
  });
}
