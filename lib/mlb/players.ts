import { allowMLBMockFallback, MLBDataUnavailableError, mlbFetch } from './client';
import type { MLBPlayer } from './types';

const fallbackPlayers: MLBPlayer[] = [
  { id: 660271, name: 'Shohei Ohtani', currentTeam: { id: 119, name: 'Dodgers', abbreviation: 'LAD' }, position: 'DH', batSide: 'Left', throwSide: 'Right' },
  { id: 592450, name: 'Aaron Judge', currentTeam: { id: 147, name: 'Yankees', abbreviation: 'NYY' }, position: 'RF', batSide: 'Right', throwSide: 'Right' },
  { id: 605141, name: 'Mookie Betts', currentTeam: { id: 119, name: 'Dodgers', abbreviation: 'LAD' }, position: 'RF', batSide: 'Right', throwSide: 'Right' },
];

function mapPlayer(value: Record<string, unknown>): MLBPlayer {
  const player = value as Record<string, unknown>;
  const team = player.currentTeam as Record<string, unknown> | undefined;
  const primaryPosition = player.primaryPosition as Record<string, unknown> | undefined;
  const batSide = player.batSide as Record<string, unknown> | undefined;
  const pitchHand = player.pitchHand as Record<string, unknown> | undefined;
  return {
    id: Number(player.id ?? 0),
    name: String(player.fullName ?? player.name ?? 'Unknown Player'),
    currentTeam: team ? { id: Number(team.id ?? 0), name: String(team.name ?? 'Unknown'), abbreviation: String(team.abbreviation ?? 'UNK') } : null,
    position: typeof primaryPosition?.name === 'string' ? primaryPosition.name : null,
    batSide: typeof batSide?.code === 'string' ? batSide.code : null,
    throwSide: typeof pitchHand?.code === 'string' ? pitchHand.code : null,
    jerseyNumber: typeof player.primaryNumber === 'number' ? player.primaryNumber : null,
    height: typeof player.height === 'string' ? player.height : null,
    weight: typeof player.weight === 'number' ? player.weight : null,
    playerImageUrl: getPlayerImageUrl(Number(player.id ?? 0)),
  };
}

export async function searchMLBPlayers(query: string) {
  if (!query.trim()) {
    return [];
  }

  try {
    const payload = await mlbFetch<{ people?: Array<Record<string, unknown>> }>(`/people/search?names=${encodeURIComponent(query)}&sportIds=1&active=true`, {
      revalidate: 300,
    });

    const people = payload.people ?? [];
    return people.map((item) => mapPlayer(item));
  } catch (error) {
    console.error('[mlb] Unable to search players.', error);
    if (allowMLBMockFallback()) {
      return fallbackPlayers.filter((player) => player.name.toLowerCase().includes(query.trim().toLowerCase()));
    }
    throw error instanceof MLBDataUnavailableError ? error : new MLBDataUnavailableError();
  }
}

export async function findMLBPlayerIdByName(name: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const players = await searchMLBPlayers(name);
  return players.find((player) => player.name.trim().toLowerCase() === normalized)?.id ?? null;
}

export async function getMLBPlayer(playerId: string | number) {
  const id = typeof playerId === 'string' ? Number(playerId) : playerId;

  if (!id) {
    throw new MLBDataUnavailableError('A valid MLB player ID is required.');
  }

  try {
    const payload = await mlbFetch<{ people?: Array<Record<string, unknown>> }>(`/people/${id}?hydrate=currentTeam`, {
      revalidate: 3600,
    });
    const person = payload.people?.[0];
    if (!person) {
      throw new MLBDataUnavailableError('Player data is unavailable.');
    }
    return mapPlayer(person);
  } catch (error) {
    console.error('[mlb] Unable to load player data.', error);
    if (allowMLBMockFallback()) {
      const fallback = fallbackPlayers.find((player) => player.id === id);
      if (fallback) return fallback;
    }
    throw error instanceof MLBDataUnavailableError ? error : new MLBDataUnavailableError();
  }
}

export function getPlayerImageUrl(playerId: number | string) {
  const configuredBaseUrl = process.env.MLB_PLAYER_IMAGE_BASE_URL?.trim();
  if (configuredBaseUrl) return `${configuredBaseUrl.replace(/\/$/, '')}/${playerId}`;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_180,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}
