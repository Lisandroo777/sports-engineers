import { espnWebFetch } from './client';
import { getNFLTeam } from './teams';
import type { NFLPlayer } from './types';

interface RawSearchResult {
  displayName: string;
  subtitle?: string;
  link?: { web?: string };
  image?: { default?: string };
}

function extractAthleteId(webLink: string | undefined): number | null {
  const match = webLink?.match(/\/id\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

export async function searchNFLPlayers(query: string): Promise<NFLPlayer[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const data = await espnWebFetch<{ results?: Array<{ type: string; contents: RawSearchResult[] }> }>(
    'search/v2',
    { query: trimmed, limit: '10' },
    120,
  );

  const playerGroup = data.results?.find((group) => group.type === 'player');
  const candidates = (playerGroup?.contents ?? [])
    .map((entry) => ({ id: extractAthleteId(entry.link?.web), name: entry.displayName, team: entry.subtitle, headshot: entry.image?.default }))
    .filter((entry): entry is { id: number; name: string; team: string | undefined; headshot: string | undefined } => entry.id != null);

  // Search results don't include position; resolve full profiles in parallel (bounded, small result set).
  const players = await Promise.all(
    candidates.slice(0, 10).map(async (candidate) => {
      try {
        return await getNFLPlayer(candidate.id);
      } catch {
        return null;
      }
    }),
  );

  return players.filter((player): player is NFLPlayer => player != null);
}

interface RawAthlete {
  id: string;
  fullName: string;
  displayName: string;
  position?: { abbreviation?: string; displayName?: string };
  team?: { id: string };
  jersey?: string;
  headshot?: { href?: string };
  age?: number;
  displayHeight?: string;
  displayWeight?: string;
}

export async function getNFLPlayer(playerId: number | string): Promise<NFLPlayer> {
  const data = await espnWebFetch<{ athlete?: RawAthlete }>(`common/v3/sports/football/nfl/athletes/${playerId}`, {}, 3600);
  const athlete = data.athlete;
  if (!athlete) throw new Error('NFL player not found.');

  const team = athlete.team?.id ? await getNFLTeam(athlete.team.id).catch(() => null) : null;

  return {
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
  };
}
