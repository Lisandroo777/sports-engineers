import { getNBATeamStats } from './teamStats';

export type NBAOpponentContextStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';

export interface NBAOpponentContext {
  opponentTeamId: number;
  status: NBAOpponentContextStatus;
  availableMetrics: string[];
  unavailableMetrics: string[];
  evidence: string[];
}

/**
 * Real ESPN team-stat names we look for, when actually present, to describe an opponent's
 * defensive/pace profile. Never invented: if none of these appear in the real response, status is
 * UNAVAILABLE. Not yet verified against a live response (no live NBA request has been made — see
 * dev-server-lifecycle rule about protecting the Odds credit reserve; this endpoint is ESPN, not
 * Odds, but the audit-before-use discipline still applies). Verify this exact name list once a real
 * response is inspected.
 */
const NBA_DEFENSIVE_METRIC_NAMES = ['avgPoints', 'avgRebounds', 'avgAssists', 'avgSteals', 'avgBlocks', 'avgTurnovers', 'pace'];

const UNAVAILABLE_METRICS = [...NBA_DEFENSIVE_METRIC_NAMES];

function buildContext(teamId: number, stats: Awaited<ReturnType<typeof getNBATeamStats>>): NBAOpponentContext {
  const defensiveCategory = stats.filter((s) => s.category != null && /defen/i.test(s.category));
  const source = defensiveCategory.length > 0 ? defensiveCategory : stats;
  const matched = source.filter((s) => NBA_DEFENSIVE_METRIC_NAMES.includes(s.name) && s.value != null);

  const availableMetrics = matched.map((s) => s.displayName);
  const unavailableMetrics = UNAVAILABLE_METRICS.filter((name) => !matched.some((m) => m.name === name));
  const evidence = matched.map((s) => `${s.displayName}: ${s.value}${s.rank != null ? ` (rank ${s.rank})` : ''}`);

  const status: NBAOpponentContextStatus =
    matched.length === 0 ? 'UNAVAILABLE' : matched.length < NBA_DEFENSIVE_METRIC_NAMES.length ? 'PARTIAL' : 'AVAILABLE';

  return { opponentTeamId: teamId, status, availableMetrics, unavailableMetrics, evidence };
}

/**
 * Builds a slate-level opponent-context cache: ONE real ESPN request per unique team, reused for
 * every candidate facing that team. Never makes one request per candidate.
 */
export async function buildNBAOpponentContextCache(
  teamIds: number[],
  fetchStats: (teamId: number) => Promise<Awaited<ReturnType<typeof getNBATeamStats>>> = getNBATeamStats,
): Promise<Map<number, NBAOpponentContext>> {
  const unique = [...new Set(teamIds)];
  const cache = new Map<number, NBAOpponentContext>();
  for (const teamId of unique) {
    try {
      const stats = await fetchStats(teamId);
      cache.set(teamId, buildContext(teamId, stats));
    } catch {
      cache.set(teamId, { opponentTeamId: teamId, status: 'UNAVAILABLE', availableMetrics: [], unavailableMetrics: [...UNAVAILABLE_METRICS], evidence: [] });
    }
  }
  return cache;
}

export function getNBAOpponentContext(cache: Map<number, NBAOpponentContext>, opponentTeamId: number | null): NBAOpponentContext | null {
  if (opponentTeamId == null) return null;
  return cache.get(opponentTeamId) ?? null;
}
