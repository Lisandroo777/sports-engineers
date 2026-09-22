import { espnNBASiteFetch } from './client';

export interface NBATeamStat {
  name: string;
  displayName: string;
  value: number | null;
  rank: number | null;
  /** ESPN's own category label (e.g. "defensive", "offensive"), when the response provides one. */
  category: string | null;
}

interface RawStat { name?: string; displayName?: string; value?: number | string; rank?: number | string; }
interface RawCategory { name?: string; displayName?: string; stats?: RawStat[]; }

/** Free ESPN team-stat surface for opponent context. It exposes available categories only. */
export async function getNBATeamStats(teamId: string | number): Promise<NBATeamStat[]> {
  const data = await espnNBASiteFetch<{ results?: { stats?: { categories?: RawCategory[] } }; stats?: RawStat[] }>(`teams/${teamId}/statistics`, {}, 900);
  const categories = data.results?.stats?.categories ?? [];
  const nested = categories.flatMap((category) => (category.stats ?? []).map((stat) => ({ stat, category: category.name ?? category.displayName ?? null })));
  const uncategorized = (data.stats ?? []).map((stat) => ({ stat, category: null as string | null }));
  return [...nested, ...uncategorized].map(({ stat, category }) => ({
    name: stat.name ?? 'Data unavailable',
    displayName: stat.displayName ?? stat.name ?? 'Data unavailable',
    value: stat.value == null ? null : Number(stat.value),
    rank: stat.rank == null ? null : Number(stat.rank),
    category,
  }));
}
