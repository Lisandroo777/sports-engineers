import type { OutlierDependency } from './outlierAnalysis';
import type { VolumeEfficiency } from './volumeEfficiency';

/**
 * Every recommended pick must show how it loses. Each bullet is generated only from real computed
 * numbers already on the candidate — never invented flavor text. Returns at most 4, at least 1.
 */
export function buildFailureModes(params: {
  side: 'over' | 'under';
  line: number;
  recentAverage: number | null;
  consistency: number | null;
  outlier: OutlierDependency;
  volumeEfficiency: VolumeEfficiency;
  sampleSize: number | null;
}): string[] {
  const { side, line, recentAverage, consistency, outlier, volumeEfficiency, sampleSize } = params;
  const modes: string[] = [];

  if (outlier.available && outlier.explosiveDependencePercent != null && outlier.explosiveDependencePercent >= 35) {
    modes.push(
      `Relies heavily on standout games: the single best recent game accounted for ${outlier.explosiveDependencePercent}% of production. Without it, the average drops to ${outlier.withoutTopGame.mean ?? 'unavailable'}.`,
    );
  }

  if (consistency != null && recentAverage != null && recentAverage > 0 && consistency > recentAverage * 0.5) {
    modes.push(`High game-to-game variance (std dev ${consistency} vs recent average ${recentAverage}) means one outlier game could flip this result.`);
  }

  if (volumeEfficiency.available && volumeEfficiency.meetsRequiredRate === false) {
    const unit = volumeEfficiency.basis === 'innings_pitched' ? 'inning' : 'plate appearance';
    modes.push(
      `Recent rate per ${unit} (${volumeEfficiency.actualRatePerUnit}) is below the rate required to clear ${side} ${line} (${volumeEfficiency.requiredRatePerUnit}) at the estimated volume of ${volumeEfficiency.estimatedVolume} ${unit}s.`,
    );
  }

  if (sampleSize != null && sampleSize < 10) {
    modes.push(`Small sample size (${sampleSize} games) — the recent trend may not be repeatable.`);
  }

  if (modes.length === 0) {
    modes.push('No specific statistical failure mode was identified from available data; standard game-to-game variance still applies.');
  }

  return modes.slice(0, 4);
}
