import { allowMLBMockFallback, formatMLBDate, MLBDataUnavailableError, mlbFetch } from './client';
import type { MLBGame, MLBProbablePitcher, MLBTeamSummary, MLBVenue } from './types';

const fallbackSchedule: MLBGame[] = [
  {
    id: 'fallback-1',
    date: formatMLBDate(),
    gameTime: '7:10 PM',
    awayTeam: { id: 1, name: 'Yankees', abbreviation: 'NYY' },
    homeTeam: { id: 2, name: 'Red Sox', abbreviation: 'BOS' },
    status: 'Scheduled',
    venue: { id: 'fenway', stadiumName: 'Fenway Park', city: 'Boston', state: 'MA', timezone: 'America/New_York' },
  },
  {
    id: 'fallback-2',
    date: formatMLBDate(),
    gameTime: '8:10 PM',
    awayTeam: { id: 3, name: 'Dodgers', abbreviation: 'LAD' },
    homeTeam: { id: 4, name: 'Giants', abbreviation: 'SFG' },
    status: 'Scheduled',
    venue: { id: 'oracle', stadiumName: 'Oracle Park', city: 'San Francisco', state: 'CA', timezone: 'America/Los_Angeles' },
  },
];

function toPitcher(value: unknown): MLBProbablePitcher | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const pitcher = value as Record<string, unknown>;
  return {
    id: Number(pitcher.id ?? 0),
    name: String(pitcher.fullName ?? pitcher.fullName ?? pitcher.name ?? 'TBD'),
    throwingHand: typeof (pitcher.pitchHand as Record<string, unknown> | undefined)?.code === 'string'
      ? String((pitcher.pitchHand as Record<string, unknown>).code)
      : null,
  };
}

function toVenue(value: unknown): MLBVenue | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const venue = value as Record<string, unknown>;
  return {
    id: String(venue.id ?? 'unknown'),
    stadiumName: String(venue.name ?? 'Unknown Venue'),
    city: String(venue.city ?? 'Unknown City'),
    state: String(venue.state ?? 'Unknown State'),
    timezone: 'America/New_York',
  };
}

function toTeam(value: unknown): MLBTeamSummary {
  if (!value || typeof value !== 'object') {
    return { id: 0, name: 'Unknown', abbreviation: 'UNK' };
  }

  const team = value as Record<string, unknown>;
  const record = team.leagueRecord as Record<string, unknown> | undefined;
  return {
    id: Number((team.team as Record<string, unknown> | undefined)?.id ?? team.id ?? 0),
    name: String((team.team as Record<string, unknown> | undefined)?.name ?? team.name ?? 'Unknown'),
    abbreviation: String((team.team as Record<string, unknown> | undefined)?.abbreviation ?? team.abbreviation ?? 'UNK'),
    record: record ? {
      wins: Number(record.wins ?? 0),
      losses: Number(record.losses ?? 0),
      pct: typeof record.pct === 'string' ? record.pct : null,
    } : null,
  };
}

export async function getMLBSchedule(date: string = formatMLBDate()): Promise<MLBGame[]> {
  try {
    const scheduleDate = formatMLBDate(date);
    const payload = await mlbFetch<{ dates?: Array<{ games?: Array<Record<string, unknown>> }> }>(`/schedule?sportId=1&date=${encodeURIComponent(scheduleDate)}&hydrate=probablePitcher,linescore`, {
      revalidate: 60,
      init: {
        method: 'GET',
      },
    });

    const games = payload.dates?.flatMap((entry) => entry.games ?? []) ?? [];

    return games
      .filter((game) => typeof game === 'object')
      .map((game) => {
        const response = game as Record<string, unknown>;
        const teams = response.teams as Record<string, unknown> | undefined;
        const status = response.status as Record<string, unknown> | undefined;
        const venue = response.venue as Record<string, unknown> | undefined;
        const away = teams?.away as Record<string, unknown> | undefined;
        const home = teams?.home as Record<string, unknown> | undefined;
        const awayTeam = toTeam(away);
        const homeTeam = toTeam(home);

        return {
          id: String(response.gamePk ?? response.id ?? 'unknown'),
          date: scheduleDate,
          gameTime: String(response.gameDate ?? 'TBD'),
          awayTeam,
          homeTeam,
          status: String(status?.detailedState ?? response.status ?? 'Scheduled'),
          venue: toVenue(venue),
          venueId: venue?.id ? String(venue.id) : null,
          awayProbableStarter: toPitcher(away?.probablePitcher),
          homeProbableStarter: toPitcher(home?.probablePitcher),
        } satisfies MLBGame;
      });
  } catch (error) {
    console.error('[mlb] Unable to load schedule data.', error);
    if (allowMLBMockFallback()) {
      return fallbackSchedule;
    }
    throw error instanceof MLBDataUnavailableError ? error : new MLBDataUnavailableError();
  }
}

export async function getMLBGames(date: string = formatMLBDate()) {
  return getMLBSchedule(date);
}
