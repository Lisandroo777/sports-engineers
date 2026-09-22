import { espnNBAWebFetch, espnNBASiteFetch } from './client';
import type { NBAPlayer, NBATeam } from './types';

interface RawSearchEntry { displayName: string; link?: { web?: string }; }
interface RawAthlete { id: string; fullName?: string; displayName?: string; position?: { abbreviation?: string }; team?: { id?: string; displayName?: string; abbreviation?: string; logo?: string }; jersey?: string; headshot?: { href?: string }; }

function extractId(link?: string) {
  const match = link?.match(/\/id\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

function teamFromAthlete(team: RawAthlete['team']): NBATeam | null {
  if (!team?.id || !team.displayName || !team.abbreviation) return null;
  return { id: Number(team.id), name: team.displayName, displayName: team.displayName, abbreviation: team.abbreviation, logoUrl: team.logo ?? null };
}

export async function getNBAPlayer(playerId: number | string): Promise<NBAPlayer> {
  const data = await espnNBAWebFetch<{ athlete?: RawAthlete }>(`common/v3/sports/basketball/nba/athletes/${playerId}`, {}, 3600);
  const athlete = data.athlete;
  if (!athlete) throw new Error('NBA player not found.');
  return { id: Number(athlete.id), name: athlete.fullName ?? athlete.displayName ?? 'Unknown player', position: athlete.position?.abbreviation ?? null, team: teamFromAthlete(athlete.team), jersey: athlete.jersey ?? null, headshotUrl: athlete.headshot?.href ?? null };
}

export async function searchNBAPlayers(query: string): Promise<NBAPlayer[]> {
  if (query.trim().length < 2) return [];
  const data = await espnNBAWebFetch<{ results?: Array<{ type: string; contents: RawSearchEntry[] }> }>('search/v2', { query: query.trim(), limit: '10' }, 120);
  const entries = data.results?.find((group) => group.type === 'player')?.contents ?? [];
  const ids = Array.from(new Set(entries.map((entry) => extractId(entry.link?.web)).filter((id): id is number => id != null)));
  const players = await Promise.all(ids.slice(0, 10).map((id) => getNBAPlayer(id).catch(() => null)));
  return players.filter((player): player is NBAPlayer => player != null);
}

/** Free roster helper for future role/availability enrichment. */
export async function getNBATeamRoster(teamId: string): Promise<NBAPlayer[]> {
  const data = await espnNBASiteFetch<{ athletes?: RawAthlete[] }>(`teams/${teamId}/roster`, {}, 3600);
  return (data.athletes ?? []).map((athlete) => ({ id: Number(athlete.id), name: athlete.fullName ?? athlete.displayName ?? 'Unknown player', position: athlete.position?.abbreviation ?? null, team: teamFromAthlete(athlete.team), jersey: athlete.jersey ?? null, headshotUrl: athlete.headshot?.href ?? null }));
}
