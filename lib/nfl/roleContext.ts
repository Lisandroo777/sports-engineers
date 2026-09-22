import type { NFLGameLogEntry } from './types';
import type { NFLAnalyzableMarketKey } from './oddsTypes';
import { mean, standardDeviation } from '../projection/types';

/**
 * NFL role-requirement classification (Phase 3).
 *
 * DeepSide has NO snap share, route participation, target share, depth chart, or confirmed
 * starter feed for NFL. Rather than treat every market identically, each market is classified by
 * how much a genuine role signal (opportunity/workload) matters to that stat specifically:
 *
 * CRITICAL  – the stat is mostly a function of raw opportunity (carries, targets/receptions,
 *             snaps). Without real recent-workload evidence, a projection here is not trustworthy
 *             no matter how good the per-touch rate estimate is.
 * IMPORTANT – opportunity matters, but starters at this position have a comparatively stable,
 *             predictable workload game-to-game (a starting QB's attempts don't swing on committee
 *             logic the way a RB's carries do), so real recent-attempt evidence is still required,
 *             just with a softer penalty when it's uncertain.
 * OPTIONAL  – the outcome is driven more by matchup/game-flow variance or a fixed role (kicker
 *             plays every game) than by a workload signal we could realistically track.
 */
export type NFLRoleRequirement = 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL';

export const NFL_ROLE_REQUIREMENTS: Record<NFLAnalyzableMarketKey, NFLRoleRequirement> = {
  // QB dropback volume: starters throw a fairly stable number of times per game plan.
  player_pass_attempts: 'IMPORTANT',
  player_pass_completions: 'IMPORTANT',
  player_pass_yds: 'IMPORTANT',
  player_pass_tds: 'IMPORTANT',
  player_pass_interceptions: 'IMPORTANT',
  player_pass_longest_completion: 'OPTIONAL',
  // RB/WR/TE markets use real per-game carries and targets. Share-of-team metrics remain
  // unavailable, so these markets still require conservative role handling.
  player_rush_yds: 'CRITICAL',
  player_rush_attempts: 'CRITICAL',
  player_rush_tds: 'CRITICAL',
  player_reception_yds: 'CRITICAL',
  player_receptions: 'CRITICAL',
  player_reception_tds: 'CRITICAL',
  player_rush_rec_yds: 'CRITICAL',
  player_anytime_td: 'CRITICAL',
  player_tackles_assists: 'CRITICAL',
  player_solo_tackles: 'CRITICAL',
  // Explosive-play/longest props and defensive splash plays are driven far more by matchup and
  // per-play variance than by touch volume; a kicker's role is fixed (plays every healthy game).
  player_rush_longest: 'OPTIONAL',
  player_reception_longest: 'OPTIONAL',
  player_sacks: 'OPTIONAL',
  player_defensive_interceptions: 'OPTIONAL',
  player_kicking_points: 'OPTIONAL',
  player_field_goals: 'OPTIONAL',
};

/** The real ESPN game-log stat used as the opportunity/workload proxy for a market's role context. */
const NFL_OPPORTUNITY_STAT: Record<NFLAnalyzableMarketKey, string | null> = {
  player_pass_attempts: 'passingAttempts', player_pass_completions: 'passingAttempts',
  player_pass_yds: 'passingAttempts', player_pass_tds: 'passingAttempts', player_pass_interceptions: 'passingAttempts',
  player_pass_longest_completion: null,
  player_rush_attempts: 'rushingAttempts', player_rush_yds: 'rushingAttempts', player_rush_tds: 'rushingAttempts',
  player_receptions: 'receivingTargets', player_reception_yds: 'receivingTargets', player_reception_tds: 'receivingTargets',
  player_rush_rec_yds: 'touches', player_anytime_td: 'touches',
  player_tackles_assists: 'totalTackles', player_solo_tackles: 'totalTackles',
  player_rush_longest: null, player_reception_longest: null,
  player_sacks: null, player_defensive_interceptions: null,
  player_kicking_points: null, player_field_goals: null,
};

export type NFLWorkloadTrend = 'WORKLOAD_INCREASE' | 'WORKLOAD_DECREASE' | 'WORKLOAD_STABLE' | 'HIGH_WORKLOAD_VOLATILITY' | 'INSUFFICIENT_OPPORTUNITY_DATA';
export type NFLRoleStatus = 'STABLE' | 'CHANGING' | 'UNCERTAIN' | 'UNAVAILABLE';
export type NFLRoleConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/** Minimum games with a recorded opportunity stat before any trend is trusted. */
export const NFL_MIN_OPPORTUNITY_SAMPLE = 3;

export interface NFLWorkloadWindow { games: number; mean: number | null }

export interface NFLOpportunityTrend {
  available: boolean;
  statKey: string | null;
  l3: NFLWorkloadWindow;
  l5: NFLWorkloadWindow;
  l10: NFLWorkloadWindow;
  season: NFLWorkloadWindow;
  trend: NFLWorkloadTrend;
  volatility: number | null;
}

function touchesValue(stats: Record<string, number>): number | null {
  const rush = stats.rushingAttempts;
  const rec = stats.receptions;
  if (rush == null && rec == null) return null;
  return (rush ?? 0) + (rec ?? 0);
}

function window(values: number[], size: number | null): NFLWorkloadWindow {
  const slice = size == null ? values : values.slice(-size);
  return { games: slice.length, mean: mean(slice) };
}

function trendFromValues(values: number[], statKey: string | null): NFLOpportunityTrend {
  const empty: NFLOpportunityTrend = {
    available: false, statKey, l3: { games: 0, mean: null }, l5: { games: 0, mean: null },
    l10: { games: 0, mean: null }, season: { games: 0, mean: null }, trend: 'INSUFFICIENT_OPPORTUNITY_DATA', volatility: null,
  };
  if (values.length < NFL_MIN_OPPORTUNITY_SAMPLE) return { ...empty, l3: window(values, 3), l5: window(values, 5), l10: window(values, 10), season: window(values, null) };

  const l3 = window(values, 3);
  const l5 = window(values, 5);
  const l10 = window(values, 10);
  const season = window(values, null);
  const volatility = standardDeviation(values);
  const cv = volatility != null && season.mean != null && season.mean > 0 ? volatility / season.mean : null;
  let trend: NFLWorkloadTrend = 'WORKLOAD_STABLE';
  if (cv != null && cv > 0.5) trend = 'HIGH_WORKLOAD_VOLATILITY';
  else if (l3.mean != null && season.mean != null && season.mean > 0) {
    const delta = (l3.mean - season.mean) / season.mean;
    if (delta >= 0.2) trend = 'WORKLOAD_INCREASE';
    else if (delta <= -0.2) trend = 'WORKLOAD_DECREASE';
  }
  return { available: true, statKey, l3, l5, l10, season, trend, volatility };
}

function computeRecordedStatTrend(logs: NFLGameLogEntry[], statKey: string): NFLOpportunityTrend {
  const values = logs
    .filter((log) => log.result != null)
    .map((log) => log.stats[statKey] ?? null)
    .filter((value): value is number => value != null);
  return trendFromValues(values, statKey);
}

/** Real recency-weighted workload comparison (L3/L5/L10/season) for one market's opportunity stat. */
export function computeNFLOpportunityTrend(logs: NFLGameLogEntry[], market: NFLAnalyzableMarketKey): NFLOpportunityTrend {
  const statKey = NFL_OPPORTUNITY_STAT[market];
  const empty: NFLOpportunityTrend = {
    available: false, statKey, l3: { games: 0, mean: null }, l5: { games: 0, mean: null },
    l10: { games: 0, mean: null }, season: { games: 0, mean: null }, trend: 'INSUFFICIENT_OPPORTUNITY_DATA', volatility: null,
  };
  if (!statKey) return empty;

  const values = logs
    .filter((log) => log.result != null)
    .map((log) => (statKey === 'touches' ? touchesValue(log.stats) : log.stats[statKey] ?? null))
    .filter((value): value is number => value != null);
  return trendFromValues(values, statKey);
}

export interface NFLRoleContext {
  requirement: NFLRoleRequirement;
  status: NFLRoleStatus;
  confidence: NFLRoleConfidence;
  workloadTrend: NFLWorkloadTrend;
  opportunity: NFLOpportunityTrend;
  /** Real, computed facts that back this status — never invented flavor text. */
  evidence: string[];
  /** Named data sources DeepSide does not have, so callers never assume more than we know. */
  unavailableEvidence: string[];
  reasons: string[];
}

/** Data sources NFL role context can never draw on today — always reported, never silently assumed. */
export const NFL_UNAVAILABLE_ROLE_EVIDENCE = ['snap share', 'route participation', 'target share', 'true dropbacks', 'depth chart position', 'confirmed starter status'];

/** Builds a deterministic role-context verdict for one market from real ESPN game logs only. */
export function buildNFLRoleContext(logs: NFLGameLogEntry[], market: NFLAnalyzableMarketKey): NFLRoleContext {
  const requirement = NFL_ROLE_REQUIREMENTS[market];
  const completedGames = logs.filter((log) => log.result != null).length;
  const trend = computeNFLOpportunityTrend(logs, market);
  const evidence: string[] = [`${completedGames} completed games in the log`];
  const reasons: string[] = [];

  if (trend.available) {
    evidence.push(`L3 ${trend.statKey} avg ${trend.l3.mean?.toFixed(1)}, season avg ${trend.season.mean?.toFixed(1)} (${trend.season.games} games)`);
  }

  let status: NFLRoleStatus;
  let confidence: NFLRoleConfidence;
  if (!trend.statKey) {
    // OPTIONAL markets with no meaningful opportunity proxy (kicker, defensive splash plays):
    // role context is judged only on games played, never invented from an unrelated stat.
    status = completedGames >= NFL_MIN_OPPORTUNITY_SAMPLE ? 'STABLE' : 'UNAVAILABLE';
    confidence = completedGames >= NFL_MIN_OPPORTUNITY_SAMPLE ? 'MEDIUM' : 'NONE';
    reasons.push('No workload proxy is tracked for this market; judged on games played only.');
  } else if (trend.trend === 'INSUFFICIENT_OPPORTUNITY_DATA') {
    status = 'UNAVAILABLE';
    confidence = 'NONE';
    reasons.push(`Fewer than ${NFL_MIN_OPPORTUNITY_SAMPLE} games with a recorded ${trend.statKey} value.`);
  } else if (trend.trend === 'HIGH_WORKLOAD_VOLATILITY') {
    status = 'UNCERTAIN';
    confidence = 'LOW';
    reasons.push(`${trend.statKey} volatility is high game-to-game; recent workload is not a reliable predictor.`);
  } else if (trend.trend === 'WORKLOAD_INCREASE' || trend.trend === 'WORKLOAD_DECREASE') {
    status = 'CHANGING';
    confidence = 'MEDIUM';
    reasons.push(`${trend.trend === 'WORKLOAD_INCREASE' ? 'Rising' : 'Falling'} ${trend.statKey}: L3 avg diverges 20%+ from season avg.`);
  } else {
    status = 'STABLE';
    confidence = requirement === 'CRITICAL' ? (trend.season.games >= 8 ? 'HIGH' : 'MEDIUM') : 'MEDIUM';
  }

  return { requirement, status, confidence, workloadTrend: trend.trend, opportunity: trend, evidence, unavailableEvidence: [...NFL_UNAVAILABLE_ROLE_EVIDENCE], reasons };
}

export interface NFLPlayerWorkloadProfile {
  position: string;
  gamesAnalyzed: number;
  status: NFLRoleStatus;
  confidence: NFLRoleConfidence;
  evidence: string[];
  unavailableEvidence: string[];
  opportunities: Record<string, NFLOpportunityTrend>;
  starterStatus: 'UNAVAILABLE';
  committeeStatus: 'UNAVAILABLE';
}

/** Position-aware workload summary built only from ESPN's recorded per-game opportunities. */
export function buildNFLPlayerWorkloadProfile(logs: NFLGameLogEntry[], position: string): NFLPlayerWorkloadProfile {
  const normalizedPosition = position.toUpperCase();
  const markets: Array<[string, NFLAnalyzableMarketKey]> = normalizedPosition === 'QB'
    ? [['passingAttempts', 'player_pass_attempts'], ['rushingAttempts', 'player_rush_attempts']]
    : normalizedPosition === 'RB'
      ? [['rushingAttempts', 'player_rush_attempts'], ['receivingTargets', 'player_reception_yds'], ['receptions', 'player_receptions']]
      : normalizedPosition === 'WR' || normalizedPosition === 'TE'
        ? [['receivingTargets', 'player_reception_yds'], ['receptions', 'player_receptions']]
        : [];
  const opportunities = Object.fromEntries(markets.map(([label, market]) => [
    label,
    label === 'receptions' ? computeRecordedStatTrend(logs, 'receptions') : computeNFLOpportunityTrend(logs, market),
  ]));
  const distinctTrends = [...new Set(Object.values(opportunities))];
  const available = distinctTrends.filter((trend) => trend.available);
  const evidence = available.map((trend) => `${trend.season.games} games with ${trend.statKey}; L3 avg ${trend.l3.mean?.toFixed(1)}, rolling avg ${trend.season.mean?.toFixed(1)}`);

  let status: NFLRoleStatus = 'UNAVAILABLE';
  let confidence: NFLRoleConfidence = 'NONE';
  if (available.some((trend) => trend.trend === 'HIGH_WORKLOAD_VOLATILITY')) {
    status = 'UNCERTAIN';
    confidence = 'LOW';
  } else if (available.some((trend) => trend.trend === 'WORKLOAD_INCREASE' || trend.trend === 'WORKLOAD_DECREASE')) {
    status = 'CHANGING';
    confidence = 'MEDIUM';
  } else if (available.length > 0) {
    status = 'STABLE';
    confidence = Math.max(...available.map((trend) => trend.season.games)) >= 8 ? 'HIGH' : 'MEDIUM';
  }

  return {
    position: normalizedPosition,
    gamesAnalyzed: logs.filter((log) => log.result != null).length,
    status,
    confidence,
    evidence,
    unavailableEvidence: [...NFL_UNAVAILABLE_ROLE_EVIDENCE],
    opportunities,
    starterStatus: 'UNAVAILABLE',
    committeeStatus: 'UNAVAILABLE',
  };
}
