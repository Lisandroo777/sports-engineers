import { MLBDataUnavailableError, mlbFetch } from './client';
import type { MLBProbablePitcher } from './types';

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export async function getMLBPitcherSeasonStats(playerId: number | string, season = new Date().getUTCFullYear()): Promise<MLBProbablePitcher> {
  const id = Number(playerId);
  if (!id) throw new MLBDataUnavailableError('A valid MLB player ID is required.');
  const payload = await mlbFetch<{ stats?: Array<{ splits?: Array<{ stat?: Record<string, unknown> }> }> }>(
    `/people/${id}/stats?stats=season&group=pitching&season=${season}`,
    { revalidate: 900 },
  );
  const stat = payload.stats?.[0]?.splits?.[0]?.stat;
  if (!stat) throw new MLBDataUnavailableError('Pitcher season statistics are unavailable.');
  const faced = toNumber(stat.battersFaced);
  const strikeouts = toNumber(stat.strikeOuts);
  const walks = toNumber(stat.baseOnBalls);
  return {
    id,
    name: '',
    throwingHand: null,
    era: Number(stat.era ?? 0) || null,
    whip: Number(stat.whip ?? 0) || null,
    kPct: faced ? Number(((strikeouts / faced) * 100).toFixed(1)) : null,
    bbPct: faced ? Number(((walks / faced) * 100).toFixed(1)) : null,
    hrPer9: Number(stat.homeRunsPer9 ?? 0) || null,
    fip: null,
    baa: typeof stat.avg === 'string' ? Number(stat.avg) : null,
  };
}
