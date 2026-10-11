import type { NFLGameLogEntry } from './types';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import { buildNFLRoleContext, type NFLRoleContext } from './roleContext';
import { getMarketFamily } from '../ai/probabilityModel';
import type { NFLHistorySample } from './rollingHistory';
import { nflAvailabilityRisk, type NFLInjuryContext } from './injuries';
import { buildNFLProjectionExplanation, isNFLProjectionObservationValid, type NFLProjectionExplanation } from './opportunityProjection';
import { buildNFLMatchupEfficiency } from './matchupEfficiency';
import { buildNFLGameEnvironment } from './gameEnvironment';
import {
  standardDeviation, unavailableProjection,
  type ProjectionReliability, type ProjectionReliabilityReason, type SportProjection,
} from '../projection/types';

export interface NFLMarketProjection extends SportProjection {
  projectionModel?: NFLProjectionExplanation;
}

export function applyNFLGameEnvironmentToProjection(projection: NFLMarketProjection, params: Omit<Parameters<typeof buildNFLGameEnvironment>[0], 'projectionModel' | 'phase3Projection' | 'phase3Uncertainty'>): NFLMarketProjection {
  if (projection.status !== 'OK' || !projection.projectionModel) return projection;
  const previous = projection.projectionModel.gameEnvironmentModel;
  const environment = buildNFLGameEnvironment({ ...params, projectionModel: projection.projectionModel,
    phase3Projection: previous?.phase3Projection ?? projection.projection,
    phase3Uncertainty: previous?.phase3Uncertainty ?? projection.uncertainty });
  return { ...projection, projection: environment.finalProjection, uncertainty: environment.phase3Uncertainty,
    projectionModel: { ...projection.projectionModel, gameEnvironmentModel: environment, finalProjection: environment.finalProjection },
    inputs: { ...projection.inputs, projectionModelVersion: 'nfl_opportunity_matchup_environment_v1',
      historicalModelVersion: environment.historicalModelVersion, gameEnvironmentModelVersion: environment.modelVersion,
      gameScriptConfidence: environment.confidence, volumeAdjustment: environment.volumeAdjustment,
      finalProjection: environment.finalProjection, missingGameScriptInputs: environment.missingInputs.join(', ') },
  };
}

export function applyNFLMatchupToProjection(projection: NFLMarketProjection, params: Omit<Parameters<typeof buildNFLMatchupEfficiency>[0], 'projectionModel' | 'phase2Projection' | 'phase2Uncertainty'>): NFLMarketProjection {
  if (projection.status !== 'OK' || !projection.projectionModel) return projection;
  const phase2Uncertainty = projection.projectionModel.matchupModel?.phase2Uncertainty ?? projection.uncertainty;
  const matchup = buildNFLMatchupEfficiency({ ...params, projectionModel: projection.projectionModel,
    phase2Projection: projection.projectionModel.matchupModel?.phase2Projection ?? projection.projection, phase2Uncertainty });
  const uncertainty = matchup.projectionAdjustment === 0 ? phase2Uncertainty
    : phase2Uncertainty == null ? null : Number(Math.hypot(phase2Uncertainty, matchup.projectionAdjustment).toFixed(2));
  return { ...projection, projection: matchup.finalProjection, uncertainty,
    projectionModel: { ...projection.projectionModel, matchupModel: matchup, finalProjection: matchup.finalProjection, uncertainty },
    inputs: { ...projection.inputs, projectionModelVersion: matchup.projectionModelVersion,
      opportunityModelVersion: matchup.opportunityModelVersion, matchupModelVersion: matchup.modelVersion,
      matchupConfidence: matchup.confidence, matchupAdjustment: matchup.projectionAdjustment,
      missingMatchupInputs: matchup.missingInputs.join(', '), finalProjection: matchup.finalProjection },
  };
}

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
  historySample?: NFLHistorySample;
  injuryContext?: NFLInjuryContext | null;
  position?: string | null;
  seasonPhase?: string;
}): NFLMarketProjection {
  const { logs, market } = params;
  const roleContext = params.roleContext ?? buildNFLRoleContext(logs, market);
  const values = logs
    .filter((log) => log.result != null)
    .filter((log) => isNFLProjectionObservationValid(market, log.stats))
    .map((log) => getNFLMarketHistoricalValue(market, log.stats))
    .filter((value): value is number => value != null);

  if (values.length < NFL_MIN_SAMPLE) {
    return unavailableProjection('nfl_weighted_history', [
      values.length === 0 ? 'MISSING_STAT' : 'INSUFFICIENT_SAMPLE',
      'ROLE_CONTEXT_UNAVAILABLE',
    ], { market, gamesUsed: values.length });
  }

  const completed = logs.filter((log) => log.result != null).sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime());
  const weightedMean = (entries: NFLGameLogEntry[]) => {
    const usable = entries.filter((log) => isNFLProjectionObservationValid(market, log.stats));
    const weight = usable.reduce((total, log) => total + (log.historyWeight ?? 1), 0);
    return weight ? usable.reduce((total, log) => total + getNFLMarketHistoricalValue(market, log.stats)! * (log.historyWeight ?? 1), 0) / weight : null;
  };
  const windows: Array<[NFLGameLogEntry[], number]> = getMarketFamily(market) === 'RARE_COUNT'
    ? [[completed, 1]]
    : [
      [completed.slice(-3), 0.45],
      [completed.slice(-5), 0.35],
      [completed, 0.20],
    ];
  const present = windows.filter(([entries]) => weightedMean(entries) != null);
  const weightTotal = present.reduce((s, [, w]) => s + w, 0);
  const historicalBaseline = present.reduce((total, [entries, weight]) => total + weightedMean(entries)! * weight, 0) / weightTotal;
  const explanation: NFLProjectionExplanation = buildNFLProjectionExplanation({
    market, position: params.position, logs: completed, historicalBaseline, finalProjection: historicalBaseline,
    seasonPhase: params.seasonPhase,
  });
  const projection = explanation.finalProjection ?? historicalBaseline;
  const rawUncertainty = standardDeviation(values);
  const availability = params.injuryContext ? nflAvailabilityRisk(params.injuryContext) : { uncertaintyMultiplier: 1, points: 0 };
  const opportunityDisagreement = explanation.uncertaintyFromBaselineDisagreement ?? 0;
  const opportunitySpread = explanation.expectedEfficiency != null
    ? (roleContext.opportunity.volatility ?? 0) * Math.abs(explanation.expectedEfficiency) : 0;
  const roleSeparation = explanation.expectedEfficiency != null && roleContext.stability?.recentMean != null
    && roleContext.stability.earlierSeasonMean != null && roleContext.stability.status !== 'STABLE'
    ? Math.abs(roleContext.stability.recentMean - roleContext.stability.earlierSeasonMean) * Math.abs(explanation.expectedEfficiency) : 0;
  const modelUncertainty = rawUncertainty == null ? null : Math.sqrt(Math.max(rawUncertainty, opportunitySpread, roleSeparation) ** 2 + opportunityDisagreement ** 2);
  const uncertainty = modelUncertainty == null ? null : modelUncertainty
    * (params.historySample?.uncertaintyMultiplier ?? 1) * availability.uncertaintyMultiplier;
  explanation.uncertainty = uncertainty != null ? Number(uncertainty.toFixed(2)) : null;

  const reasons: ProjectionReliabilityReason[] = [];
  if (values.length < NFL_PREFERRED_SAMPLE) reasons.push('SHORT_SEASON_SAMPLE');
  if (availability.points > 0) reasons.push('INJURY_LISTED');
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
    method: params.historySample?.supplemented ? 'nfl_rolling_history' : 'nfl_weighted_history',
    projectionModel: explanation,
    inputs: {
      market,
      gamesUsed: values.length,
      seasonMean: weightedMean(completed.filter((log) => log.historySource !== 'PREVIOUS_SEASON')),
      rollingMean: weightedMean(completed),
      previousSeasonGames: params.historySample?.previousObservations ?? 0,
      currentSeasonGames: params.historySample?.currentObservations ?? values.length,
      historyConfidence: params.historySample?.confidence ?? 'CURRENT_ONLY',
      uncertaintyMultiplier: params.historySample?.uncertaintyMultiplier ?? 1,
      availabilityUncertaintyMultiplier: availability.uncertaintyMultiplier,
      l3Mean: weightedMean(completed.slice(-3)),
      roleRequirement: roleContext.requirement,
      roleStatus: roleContext.status,
      projectionModelVersion: explanation.modelVersion,
      probabilityModelVersion: explanation.probabilityModelVersion,
      projectionModelType: explanation.modelType,
      historicalBaseline: explanation.historicalBaseline,
      opportunityProjection: explanation.opportunityProjection,
      opportunityBlendWeight: explanation.opportunityBlendWeight,
      expectedOpportunity: explanation.expectedOpportunity,
      expectedEfficiency: explanation.expectedEfficiency,
      opportunityGames: explanation.opportunityGames,
      currentSeasonOpportunityGames: explanation.currentSeasonOpportunityGames,
      priorSeasonOpportunityGames: explanation.priorSeasonOpportunityGames,
      opportunityUncertainty: opportunityDisagreement,
      opportunitySpread,
      roleSeparation,
      missingOpportunityInputs: explanation.missingInputs.join(', '),
      calibrationStatus: explanation.calibrationStatus,
    },
  };
}
