import { espnSiteFetch } from './client';
import { getNFLTeam } from './teams';
import type { NFLPlayer } from './types';

interface RawRosterAthlete {
  id: string;
  fullName: string;
  displayName: string;
  position?: { abbreviation?: string; displayName?: string };
  jersey?: string;
  headshot?: { href?: string };
  age?: number;
  displayHeight?: string;
  displayWeight?: string;
}

export async function getNFLRoster(teamId: number | string): Promise<NFLPlayer[]> {
  const [data, team] = await Promise.all([
    espnSiteFetch<{ athletes?: Array<{ items?: RawRosterAthlete[] }> }>(`teams/${teamId}/roster`, {}, 3600),
    getNFLTeam(teamId).catch(() => null),
  ]);

  const groups = data.athletes ?? [];
  return groups.flatMap((group) =>
    (group.items ?? []).map((athlete) => ({
      id: Number(athlete.id),
      name: athlete.fullName ?? athlete.displayName,
      position: athlete.position?.abbreviation ?? 'N/A',
      positionName: athlete.position?.displayName ?? null,
      team,
      jersey: athlete.jersey ?? null,
      headshotUrl: athlete.headshot?.href ?? null,
      age: athlete.age ?? null,
      height: athlete.displayHeight ?? null,
      weight: athlete.displayWeight ?? null,
    })),
  );
}
