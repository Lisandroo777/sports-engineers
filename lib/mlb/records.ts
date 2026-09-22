import { MLBDataUnavailableError, mlbFetch } from './client';
import type { MLBTeamRecord } from './types';

function toRecord(value: Record<string, unknown>): MLBTeamRecord {
  const splitRecords = ((value.records as Record<string, unknown> | undefined)?.splitRecords ?? []) as Array<Record<string, unknown>>;
  const getSplit = (type: string) => {
    const split = splitRecords.find((entry) => (entry.type as Record<string, unknown> | undefined)?.id === type);
    return split ? `${Number(split.wins ?? 0)}-${Number(split.losses ?? 0)}` : null;
  };

  return {
    wins: Number(value.wins ?? 0),
    losses: Number(value.losses ?? 0),
    pct: typeof value.winningPercentage === 'string' ? value.winningPercentage : null,
    home: getSplit('home'),
    away: getSplit('away'),
  };
}

export async function getMLBTeamRecord(teamId: number | string, season = new Date().getUTCFullYear()): Promise<MLBTeamRecord> {
  const id = Number(teamId);
  if (!id) throw new MLBDataUnavailableError('A valid MLB team ID is required.');

  const payload = await mlbFetch<{ records?: Array<{ teamRecords?: Array<Record<string, unknown>> }> }>(
    `/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team,records`,
    { revalidate: 900 },
  );
  const record = payload.records?.flatMap((division) => division.teamRecords ?? []).find((entry) => Number((entry.team as Record<string, unknown> | undefined)?.id) === id);
  if (!record) throw new MLBDataUnavailableError('Team record is unavailable.');
  return toRecord(record);
}
