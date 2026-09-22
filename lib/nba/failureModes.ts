import type { NBAOutlierDependency } from './outlierAnalysis';
import type { NBAMinutesTrend } from './projection';
import type { NBAInjuryTier } from './injuries';

/**
 * Deterministic NBA failure-mode bullets. Every bullet traces to a real computed value already on
 * the candidate — never LLM-invented flavor text. Returns 1-4 bullets.
 */
export function buildNBAFailureModes(params: {
  rawEdge: number | null;
  sampleSize: number | null;
  projection: number | null;
  projectionUncertainty: number | null;
  outlierDependency: NBAOutlierDependency | null;
  minutesTrend: NBAMinutesTrend | null;
  injuryTier: NBAInjuryTier | null;
}): string[] {
  const { rawEdge, sampleSize, projection, projectionUncertainty, outlierDependency, minutesTrend, injuryTier } = params;
  const modes: string[] = [];

  if (minutesTrend === 'ROLE_DECREASE' || minutesTrend === 'LOW_RECENT_MINUTES') {
    modes.push('Recent minutes are trending below the season baseline — the projection assumes a role that may not hold.');
  }
  if (minutesTrend === 'HIGH_MINUTES_VOLATILITY') {
    modes.push('Minutes swing widely game-to-game, so expected playing time is not a reliable single number.');
  }
  if (outlierDependency?.available && outlierDependency.explosiveDependencePercent != null && outlierDependency.explosiveDependencePercent >= 35) {
    modes.push(`Recent production is driven by one standout game (${outlierDependency.explosiveDependencePercent}% of the recent total). Without it, the average drops to ${outlierDependency.withoutTopGame.mean ?? 'unavailable'}.`);
  }
  if (injuryTier === 'DOUBTFUL' || injuryTier === 'QUESTIONABLE') {
    modes.push(`Player is listed ${injuryTier.toLowerCase()} — role/minutes could change on short notice.`);
  }
  if (sampleSize != null && sampleSize < 10) {
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
