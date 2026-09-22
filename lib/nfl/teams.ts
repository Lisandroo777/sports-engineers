import { espnSiteFetch } from './client';
import type { NFLTeam } from './types';

interface RawTeam {
  id: string;
  displayName: string;
  name?: string;
  abbreviation: string;
  color?: string;
  logos?: Array<{ href: string; rel: string[] }>;
}

function normalizeTeam(team: RawTeam): NFLTeam {
  const logo = team.logos?.find((l) => l.rel.includes('full') && !l.rel.includes('dark')) ?? team.logos?.[0];
  return {
    id: Number(team.id),
    name: team.name ?? team.displayName,
    displayName: team.displayName,
    abbreviation: team.abbreviation,
    logoUrl: logo?.href ?? null,
    color: team.color ? `#${team.color}` : null,
  };
}

export async function getNFLTeams(): Promise<NFLTeam[]> {
  const data = await espnSiteFetch<{ sports: Array<{ leagues: Array<{ teams: Array<{ team: RawTeam }> }> }> }>(
    'teams',
    {},
    86400,
  );
  const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams.map((entry) => normalizeTeam(entry.team));
}

export async function getNFLTeam(teamId: number | string): Promise<NFLTeam | null> {
  const teams = await getNFLTeams();
  return teams.find((team) => team.id === Number(teamId)) ?? null;
}
