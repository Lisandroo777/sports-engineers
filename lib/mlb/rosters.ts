import { MLBDataUnavailableError, mlbFetch } from './client';
import type { MLBPlayer } from './types';

function mapRosterPlayer(value: Record<string, unknown>): MLBPlayer {
  const person = (value.person as Record<string, unknown> | undefined) ?? value;
  const position = value.position as Record<string, unknown> | undefined;
  return {
    id: Number(person.id ?? 0),
    name: String(person.fullName ?? person.name ?? 'Unknown Player'),
    currentTeam: null,
    position: typeof position?.abbreviation === 'string' ? position.abbreviation : null,
  };
}

export async function getMLBActiveRoster(teamId: number | string): Promise<MLBPlayer[]> {
  const id = Number(teamId);
  if (!id) throw new MLBDataUnavailableError('A valid MLB team ID is required.');
  const payload = await mlbFetch<{ roster?: Array<Record<string, unknown>> }>(`/teams/${id}/roster?rosterType=active`, { revalidate: 300 });
  return (payload.roster ?? []).map(mapRosterPlayer).filter((player) => player.id > 0);
}
