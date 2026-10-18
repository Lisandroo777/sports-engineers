import type { NFLGameLogEntry } from './types';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
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
  player_kicking_points: 'fieldGoalsAttempted', player_field_goals: 'fieldGoalsAttempted',
};

export type NFLWorkloadTrend = 'WORKLOAD_INCREASE' | 'WORKLOAD_DECREASE' | 'WORKLOAD_STABLE' | 'HIGH_WORKLOAD_VOLATILITY' | 'INSUFFICIENT_OPPORTUNITY_DATA';
export type NFLRoleStatus = 'STABLE' | 'CHANGING' | 'UNCERTAIN' | 'UNAVAILABLE';
export type NFLRoleConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type NFLRoleStabilityStatus = 'STABLE' | 'INCREASING' | 'DECLINING' | 'CHANGED' | 'UNCERTAIN';

export interface NFLRoleStability {
  status: NFLRoleStabilityStatus;
  games: number;
  recentMean: number | null;
  earlierSeasonMean: number | null;
  relativeChange: number | null;
  evidence: string[];
}

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
  rolling?: NFLWorkloadWindow;
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

function trendFromValues(values: number[], statKey: string | null, windows = { l3: window(values, 3), l5: window(values, 5), l10: window(values, 10), season: window(values, null) }): NFLOpportunityTrend {
  const empty: NFLOpportunityTrend = {
    available: false, statKey, l3: { games: 0, mean: null }, l5: { games: 0, mean: null },
    l10: { games: 0, mean: null }, season: { games: 0, mean: null }, trend: 'INSUFFICIENT_OPPORTUNITY_DATA', volatility: null,
  };
  if (values.length < NFL_MIN_OPPORTUNITY_SAMPLE) return { ...empty, ...windows, rolling: window(values, null) };

  const { l3, l5, l10, season } = windows;
  const rolling = window(values, null);
  const volatility = standardDeviation(values);
  const cv = volatility != null && rolling.mean != null && rolling.mean > 0 ? volatility / rolling.mean : null;
  let trend: NFLWorkloadTrend = 'WORKLOAD_STABLE';
  if (cv != null && cv > 0.5) trend = 'HIGH_WORKLOAD_VOLATILITY';
  else if (l3.mean != null && rolling.mean != null && rolling.mean > 0) {
    const delta = (l3.mean - rolling.mean) / rolling.mean;
    if (delta >= 0.2) trend = 'WORKLOAD_INCREASE';
    else if (delta <= -0.2) trend = 'WORKLOAD_DECREASE';
  }
  return { available: true, statKey, l3, l5, l10, season, rolling, trend, volatility };
}

function trendFromLogs(logs: NFLGameLogEntry[], statKey: string, valueFor: (log: NFLGameLogEntry) => number | null): NFLOpportunityTrend {
  const completed = logs.filter((log) => log.result != null).sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime());
  const valuesFor = (entries: NFLGameLogEntry[]) => entries.map(valueFor).filter((value): value is number => value != null && Number.isFinite(value));
  return trendFromValues(valuesFor(completed), statKey, {
    l3: window(valuesFor(completed.slice(-3)), null), l5: window(valuesFor(completed.slice(-5)), null), l10: window(valuesFor(completed.slice(-10)), null),
    season: window(valuesFor(completed.filter((log) => log.historySource !== 'PREVIOUS_SEASON')), null),
  });
}

function computeRecordedStatTrend(logs: NFLGameLogEntry[], statKey: string): NFLOpportunityTrend {
  return trendFromLogs(logs, statKey, (log) => log.stats[statKey] ?? null);
}

/** Real recency-weighted workload comparison (L3/L5/L10/season) for one market's opportunity stat. */
export function computeNFLOpportunityTrend(logs: NFLGameLogEntry[], market: NFLAnalyzableMarketKey): NFLOpportunityTrend {
  const statKey = NFL_OPPORTUNITY_STAT[market];
  const empty: NFLOpportunityTrend = {
    available: false, statKey, l3: { games: 0, mean: null }, l5: { games: 0, mean: null },
    l10: { games: 0, mean: null }, season: { games: 0, mean: null }, trend: 'INSUFFICIENT_OPPORTUNITY_DATA', volatility: null,
  };
  if (!statKey) return empty;

  return trendFromLogs(logs, statKey, (log) => {
    const yardageStat = market === 'player_pass_yds' ? 'passingYards' : market === 'player_rush_yds' ? 'rushingYards'
      : market === 'player_reception_yds' ? 'receivingYards' : null;
    const rawProduction = yardageStat ? log.stats[yardageStat] : null;
    if (rawProduction != null && rawProduction < 0 && getNFLMarketHistoricalValue(market, log.stats) == null) return null;
    const opportunity = statKey === 'touches' ? touchesValue(log.stats)
      : statKey === 'fieldGoalsAttempted' ? log.stats.fieldGoalAttempts ?? log.stats.fieldGoalsAttempted ?? null
        : log.stats[statKey] ?? null;
    return opportunity != null && Number.isFinite(opportunity) && opportunity >= 0
      && (statKey !== 'fieldGoalsAttempted' || Number.isInteger(opportunity)) ? opportunity : null;
  });
}

export interface NFLRoleContext {
  requirement: NFLRoleRequirement;
  status: NFLRoleStatus;
  confidence: NFLRoleConfidence;
  workloadTrend: NFLWorkloadTrend;
  opportunity: NFLOpportunityTrend;
  stability: NFLRoleStability;
  /** Real, computed facts that back this status — never invented flavor text. */
  evidence: string[];
  /** Named data sources DeepSide does not have, so callers never assume more than we know. */
  unavailableEvidence: string[];
  reasons: string[];
}

/** Data sources NFL role context can never draw on today — always reported, never silently assumed. */
export const NFL_UNAVAILABLE_ROLE_EVIDENCE = ['snap share', 'route participation', 'target share', 'true dropbacks', 'depth chart position', 'confirmed starter status'];

export function assessNFLRoleStability(logs: NFLGameLogEntry[], market: NFLAnalyzableMarketKey): NFLRoleStability {
  const statKey = NFL_OPPORTUNITY_STAT[market];
  const current = logs.filter((log) => log.result != null && log.historySource !== 'PREVIOUS_SEASON')
    .sort((first, second) => Date.parse(first.date) - Date.parse(second.date));
  const valueFor = (log: NFLGameLogEntry) => statKey === 'touches'
    ? touchesValue(log.stats)
    : statKey === 'fieldGoalsAttempted' ? log.stats.fieldGoalAttempts ?? log.stats.fieldGoalsAttempted ?? null
      : statKey ? log.stats[statKey] ?? null : null;
  const values = current.map(valueFor).filter((value): value is number => value != null && Number.isFinite(value)
    && (statKey !== 'fieldGoalsAttempted' || value >= 0 && Number.isInteger(value)));
  if (!statKey || values.length < 6) return {
    status: 'UNCERTAIN', games: values.length, recentMean: values.length ? mean(values.slice(-3)) : null,
    earlierSeasonMean: null, relativeChange: null,
    evidence: [!statKey ? 'No supported market-specific opportunity stat is recorded.' : `Only ${values.length} current-season opportunity games; at least 6 are required to compare recent usage with an earlier-season baseline.`],
  };

  const recent = values.slice(-3);
  const earlier = values.slice(0, -3);
  const recentMean = mean(recent);
  const earlierSeasonMean = mean(earlier);
  if (recentMean == null || earlierSeasonMean == null || earlierSeasonMean === 0) return {
    status: 'UNCERTAIN', games: values.length, recentMean, earlierSeasonMean, relativeChange: null,
    evidence: ['Recent and earlier-season opportunity cannot be compared from nonzero recorded values.'],
  };

  const relativeChange = (recentMean - earlierSeasonMean) / Math.abs(earlierSeasonMean);
  const direction = relativeChange >= 0.2 ? 1 : relativeChange <= -0.2 ? -1 : 0;
  const consistentGames = direction === 0 ? 0 : recent.filter((value) =>
    direction > 0 ? value >= earlierSeasonMean * 1.1 : value <= earlierSeasonMean * 0.9).length;
  const identityChanged = current.slice(-6).some((log) => log.teamId != null && current[0]?.teamId != null && log.teamId !== current[0].teamId)
    || current.slice(-6).some((log) => log.position != null && current[0]?.position != null && log.position !== current[0].position);
  const status: NFLRoleStabilityStatus = identityChanged ? 'CHANGED'
    : direction !== 0 && consistentGames >= 2 ? direction > 0 ? 'INCREASING' : 'DECLINING'
      : Math.abs(relativeChange) < 0.2 ? 'STABLE' : 'UNCERTAIN';
  const evidence = [`Recent 3-game ${statKey} average ${recentMean.toFixed(2)} versus earlier current-season average ${earlierSeasonMean.toFixed(2)} (${(relativeChange * 100).toFixed(1)}%).`];
  if (identityChanged) evidence.push('Player team or listed position changed within the recent current-season logs.');
  if (status === 'UNCERTAIN') evidence.push('The apparent shift is not consistent across at least two of the latest three games; it is not treated as a confirmed role change.');
  return { status, games: values.length, recentMean, earlierSeasonMean, relativeChange, evidence };
}

/** Builds a deterministic role-context verdict for one market from real ESPN game logs only. */
export function buildNFLRoleContext(logs: NFLGameLogEntry[], market: NFLAnalyzableMarketKey): NFLRoleContext {
  const requirement = NFL_ROLE_REQUIREMENTS[market];
  const completedGames = logs.filter((log) => log.result != null).length;
  const trend = computeNFLOpportunityTrend(logs, market);
  const stability = assessNFLRoleStability(logs, market);
  const evidence: string[] = [`${completedGames} completed games in the log`];
  const reasons: string[] = [];

  if (trend.available) {
    evidence.push(`L3 ${trend.statKey} avg ${trend.l3.mean?.toFixed(1)}, season avg ${trend.season.mean?.toFixed(1)} (${trend.season.games} games)`);
    if (logs.some((log) => log.historySource === 'PREVIOUS_SEASON')) evidence.push(`Rolling workload: ${trend.rolling?.games ?? 0} games across seasons; current season remains ${trend.season.games} games.`);
  }
  evidence.push(...stability.evidence);

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

  return { requirement, status, confidence, workloadTrend: trend.trend, opportunity: trend, stability, evidence, unavailableEvidence: [...NFL_UNAVAILABLE_ROLE_EVIDENCE], reasons };
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
