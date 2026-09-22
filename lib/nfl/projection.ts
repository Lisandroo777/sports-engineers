import type { NFLGameLogEntry } from './types';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import { buildNFLRoleContext, type NFLRoleContext } from './roleContext';
import { getMarketFamily } from '../ai/probabilityModel';
import {
  mean, standardDeviation, unavailableProjection,
  type ProjectionReliability, type ProjectionReliabilityReason, type SportProjection,
} from '../projection/types';

/**
 * NFL baseline projection — a FOUNDATION, not a production-grade NFL projection.
 *
 * It is a recency-weighted historical mean of real ESPN game-log values. That is deliberately
 * honest about its limits: ESPN supplies real attempts and targets, but not snaps, routes, share
 * metrics, confirmed depth-chart role, or game script. Role evidence therefore remains capped at
 * MEDIUM reliability — never HIGH — so it cannot masquerade as a complete workload model.
 *
 * FORMULA (VOLUME/COUNT markets): (0.45*L3 + 0.35*L5 + 0.20*season) / sum(weights present)
 *
 * RARE_COUNT markets (sacks, INTs, any TD market) use SEASON-ONLY weighting instead (Phase 6 audit
 * fix). A 3-game window carries almost no signal for an event that happens far less than once per
 * game — audited against Vita Vea's real 17-game sack log, the L3-heavy blend produced
 * modelProbability=88.7% (P(0 sacks) at a recency-deflated lambda=0.12) while the full-season empirical
 * UNDER-0.5 rate was 76.5% and season-mean Poisson gave 76.7% — a materially overconfident number
 * driven purely by 3 recent zero-sack games, not real signal. Season-only weighting fixes this
 * specific overreaction without touching VOLUME/COUNT markets, which were not found to have this issue.
 */

/** Minimum contributing games before any NFL projection is attempted. */
export const NFL_MIN_SAMPLE = 3;
/** Below this, the short-season sample is flagged. */
export const NFL_PREFERRED_SAMPLE = 6;

/**
 * Projection Reliability V2 (Phase 3): the blanket ROLE_CONTEXT_UNAVAILABLE cap is replaced by a
 * market-specific rule driven by lib/nfl/roleContext.ts's real workload-trend evidence.
 *
 *   requirement=CRITICAL & role status UNAVAILABLE/UNCERTAIN -> UNRELIABLE (fails closed; Elite false)
 *   requirement=CRITICAL & role status CHANGING              -> capped at LOW
 *   requirement=IMPORTANT & role status not STABLE           -> capped at MEDIUM
 *   requirement=OPTIONAL                                      -> no role-driven cap
 *
 * This does NOT automatically reject every NFL candidate — a CRITICAL market with a genuinely
 * STABLE, well-sampled workload can still reach MEDIUM (never HIGH, since role/opportunity is still
 * a real-data proxy, not the actual snap/target feed DeepSide doesn't have).
 */
function applyRoleReliability(base: ProjectionReliability, roleContext: NFLRoleContext, reasons: ProjectionReliabilityReason[]): ProjectionReliability {
  const RANK: Record<ProjectionReliability, number> = { UNRELIABLE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  let cap: ProjectionReliability | null = null;
  if (roleContext.requirement === 'CRITICAL') {
    if (roleContext.status === 'UNAVAILABLE' || roleContext.status === 'UNCERTAIN') { cap = 'UNRELIABLE'; reasons.push('ROLE_CONTEXT_UNAVAILABLE'); }
    else if (roleContext.status === 'CHANGING') cap = 'LOW';
  } else if (roleContext.requirement === 'IMPORTANT') {
    if (roleContext.status !== 'STABLE') cap = 'MEDIUM';
  }
  return cap != null && RANK[cap] < RANK[base] ? cap : base;
}

export function projectNFLMarket(params: {
  logs: NFLGameLogEntry[];
  market: NFLAnalyzableMarketKey;
  roleContext?: NFLRoleContext;
}): SportProjection {
  const { logs, market } = params;
  const roleContext = params.roleContext ?? buildNFLRoleContext(logs, market);
  const values = logs
    .filter((log) => log.result != null)
    .map((log) => getNFLMarketHistoricalValue(market, log.stats))
    .filter((value): value is number => value != null);

  if (values.length < NFL_MIN_SAMPLE) {
    return unavailableProjection('nfl_weighted_history', [
      values.length === 0 ? 'MISSING_STAT' : 'INSUFFICIENT_SAMPLE',
      'ROLE_CONTEXT_UNAVAILABLE',
    ], { market, gamesUsed: values.length });
  }

  const windows: Array<[number[], number]> = getMarketFamily(market) === 'RARE_COUNT'
    ? [[values, 1]]
    : [
      [values.slice(-3), 0.45],
      [values.slice(-5), 0.35],
      [values, 0.20],
    ];
  const present = windows.filter(([w]) => w.length > 0);
  const weightTotal = present.reduce((s, [, w]) => s + w, 0);
  const projection = present.reduce((s, [w, weight]) => s + mean(w)! * weight, 0) / weightTotal;
  const uncertainty = standardDeviation(values);

  const reasons: ProjectionReliabilityReason[] = [];
  if (values.length < NFL_PREFERRED_SAMPLE) reasons.push('SHORT_SEASON_SAMPLE');
  const cv = uncertainty != null && projection > 0 ? uncertainty / projection : null;
  if (cv != null && cv > 0.6) reasons.push('HIGH_RATE_VOLATILITY');
  if (roleContext.workloadTrend === 'HIGH_WORKLOAD_VOLATILITY') reasons.push('HIGH_RATE_VOLATILITY');
  if (roleContext.workloadTrend === 'WORKLOAD_DECREASE') reasons.push('ROLE_DECREASE');
  if (roleContext.workloadTrend === 'WORKLOAD_INCREASE') reasons.push('ROLE_INCREASE');

  const baseReliability: ProjectionReliability =
    values.length < NFL_MIN_SAMPLE ? 'UNRELIABLE'
      : reasons.includes('HIGH_RATE_VOLATILITY') || values.length < NFL_PREFERRED_SAMPLE ? 'LOW'
        : 'MEDIUM';
  const reliability = applyRoleReliability(baseReliability, roleContext, reasons);

  return {
    status: 'OK',
    projection: Number(projection.toFixed(2)),
    uncertainty: uncertainty != null ? Number(uncertainty.toFixed(2)) : null,
    sampleSize: values.length,
    reliability,
    reliabilityReasons: [...new Set(reasons)],
    method: 'nfl_weighted_history',
    inputs: {
      market,
      gamesUsed: values.length,
      seasonMean: mean(values) != null ? Number(mean(values)!.toFixed(2)) : null,
      l3Mean: mean(values.slice(-3)) != null ? Number(mean(values.slice(-3))!.toFixed(2)) : null,
      roleRequirement: roleContext.requirement,
      roleStatus: roleContext.status,
    },
  };
}
