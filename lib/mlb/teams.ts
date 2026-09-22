import { mlbFetch } from './client';
import type { MLBTeam } from './types';

const fallbackTeams: MLBTeam[] = [
  { id: 147, name: 'New York Yankees', abbreviation: 'NYY', league: 'AL', division: 'East' },
  { id: 111, name: 'Boston Red Sox', abbreviation: 'BOS', league: 'AL', division: 'East' },
  { id: 119, name: 'Los Angeles Dodgers', abbreviation: 'LAD', league: 'NL', division: 'West' },
  { id: 137, name: 'San Francisco Giants', abbreviation: 'SFG', league: 'NL', division: 'West' },
];

export async function getMLBTeams(): Promise<MLBTeam[]> {
  try {
    const payload = await mlbFetch<{ teams?: Array<Record<string, unknown>> }>('/teams?sportId=1', {
      revalidate: 3600,
    });

    const teams = payload.teams ?? [];
    return teams.map((team) => {
      const teamRecord = team as Record<string, unknown>;
      const league = teamRecord.league as Record<string, unknown> | undefined;
      const division = teamRecord.division as Record<string, unknown> | undefined;

      return {
        id: Number(teamRecord.id ?? 0),
        name: String(teamRecord.name ?? 'Unknown Team'),
        abbreviation: String(teamRecord.abbreviation ?? 'UNK'),
        league: String(league?.name ?? 'MLB'),
        division: String(division?.name ?? 'Unknown'),
        teamLogoUrl: null,
      } satisfies MLBTeam;
    });
  } catch (error) {
    console.error('[mlb] Falling back to mock teams data.', error);
    return fallbackTeams;
  }
}
