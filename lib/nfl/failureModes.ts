import type { NFLRoleContext } from './roleContext';
import type { NFLOutlierDependency } from './outlierAnalysis';

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
}): string[] {
  const { rawEdge, sampleSize, roleContext, projectionUncertainty, projection, outlierDependency } = params;
  const modes: string[] = [];

  if (outlierDependency?.available && outlierDependency.explosiveDependencePercent != null && outlierDependency.explosiveDependencePercent >= 35) {
    modes.push(`Recent production is driven by one standout game (${outlierDependency.explosiveDependencePercent}% of the recent total). Without it, the average drops to ${outlierDependency.withoutTopGame.mean ?? 'unavailable'}.`);
  }
  if (roleContext.workloadTrend === 'WORKLOAD_DECREASE') {
    modes.push(`Recent opportunity is declining: ${roleContext.reasons.find((r) => r.includes('Falling')) ?? 'workload trend is down over the last 3 games.'}`);
  }
  if (roleContext.workloadTrend === 'HIGH_WORKLOAD_VOLATILITY') {
    modes.push('Game-to-game opportunity (attempts/touches) swings widely, so this projection is not a reliable single number.');
  }
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
  return modes.slice(0, 4);
}
