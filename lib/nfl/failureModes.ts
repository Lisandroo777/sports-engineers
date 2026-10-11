import type { NFLRoleContext } from './roleContext';
import type { NFLOutlierDependency } from './outlierAnalysis';
import type { NFLHistorySample } from './rollingHistory';
import type { NFLInjuryContext } from './injuries';
import type { NFLOpponentContext } from './opponentContext';
import type { NFLWeatherContext } from './weather';

/**
 * Deterministic NFL failure-mode bullets. Every bullet traces to a real computed value already on
 * the candidate — never LLM-invented flavor text. Returns 1-4 bullets.
 */
export function buildNFLFailureModes(params: {
  rawEdge: number | null;
  sampleSize: number | null;
  roleContext: NFLRoleContext;
  projectionUncertainty: number | null;
  projection: number | null;
  outlierDependency?: NFLOutlierDependency | null;
  historySample?: NFLHistorySample;
  injuryContext?: NFLInjuryContext | null;
  opponentContext?: NFLOpponentContext | null;
  weatherContext?: NFLWeatherContext | null;
}): string[] {
  const { rawEdge, sampleSize, roleContext, projectionUncertainty, projection, outlierDependency } = params;
  const modes: string[] = [];
  if (params.historySample?.supplemented) modes.push(`Only ${params.historySample.currentObservations} current-season observations; ${params.historySample.previousObservations} older comparable games supplement the sample.`);
  if (projectionUncertainty != null && projectionUncertainty > 0) modes.push(`Projection uncertainty is about ${projectionUncertainty.toFixed(1)} stat units; the projected edge is not a guarantee.`);
  if (params.injuryContext?.player.availabilityDesignation === 'EXPECTED_AVAILABLE') modes.push('Participation is expected from current roster and depth-chart evidence, not officially confirmed game-day activation.');
  if (params.opponentContext?.status === 'PARTIAL') modes.push('Opponent evidence is partial; coverage and pressure detail are missing.');
  else if (params.opponentContext?.status === 'UNAVAILABLE') modes.push('Opponent matchup evidence is unavailable.');
  if (params.historySample?.reasons.some((reason) => /registered position|proxy/i.test(reason))) modes.push('Older-role comparability uses recorded workload rather than verified historical starter or depth-chart status.');
  if (params.weatherContext?.environment === 'OUTDOOR' && (params.weatherContext.wind?.speed ?? 0) >= 15) modes.push(`Outdoor wind of ${params.weatherContext!.wind!.speed} mph may affect passing and receiving efficiency.`);
  if (params.weatherContext?.severeConditions?.length) modes.push(`Severe game weather: ${params.weatherContext.severeConditions.join(', ')}.`);

  if (outlierDependency?.available && outlierDependency.explosiveDependencePercent != null && outlierDependency.explosiveDependencePercent >= 35) {
    modes.push(`Recent production is driven by one standout game (${outlierDependency.explosiveDependencePercent}% of the recent total). Without it, the average drops to ${outlierDependency.withoutTopGame.mean ?? 'unavailable'}.`);
  }
  if (roleContext.workloadTrend === 'WORKLOAD_DECREASE') {
    modes.push(`Recent opportunity is declining: ${roleContext.reasons.find((r) => r.includes('Falling')) ?? 'workload trend is down over the last 3 games.'}`);
  }
  if (roleContext.workloadTrend === 'HIGH_WORKLOAD_VOLATILITY') {
    modes.push('Game-to-game opportunity (attempts/touches) swings widely, so this projection is not a reliable single number.');
  }
  if (roleContext.stability?.status === 'CHANGED') modes.push('Recorded team or position changed recently; prior usage may no longer describe this role.');
  if (roleContext.stability?.status === 'INCREASING' || roleContext.stability?.status === 'DECLINING') {
    modes.push(`Current-season opportunity is ${roleContext.stability.status.toLowerCase()}; a partial-sample role shift may not persist.`);
  }
  if (roleContext.stability?.status === 'UNCERTAIN') modes.push('Current-season role stability is uncertain; do not treat a short or inconsistent workload swing as a confirmed new role.');
  const absentTeammates = params.injuryContext?.teammateAbsences?.filter((entry) => ['OUT', 'INACTIVE', 'DOUBTFUL'].includes(entry.availabilityDesignation)) ?? [];
  if (absentTeammates.length) modes.push(`Teammate absence may redistribute work, but no matched historical absorption evidence is available; no vacated volume is assigned to this player (${absentTeammates.map((entry) => entry.player).join(', ')}).`);
  if (roleContext.status === 'UNAVAILABLE' || roleContext.status === 'UNCERTAIN') {
    modes.push('Role/opportunity context is uncertain: DeepSide has no snap share, target share, or depth-chart confirmation for this player.');
  }
  if (sampleSize != null && sampleSize < 6) {
    modes.push(`Small sample size (${sampleSize} games) — the recent trend may not be repeatable.`);
  }
  if (rawEdge != null && projectionUncertainty != null && projectionUncertainty > 0 && Math.abs(rawEdge) < projectionUncertainty * 0.5) {
    modes.push(`Projection (${projection ?? 'n/a'}) barely clears the line relative to its own uncertainty (±${projectionUncertainty.toFixed(1)}).`);
  }

  if (modes.length === 0) {
    modes.push('No specific statistical failure mode was identified from available data; standard game-to-game variance still applies.');
  }
  return [...new Set(modes)];
}
