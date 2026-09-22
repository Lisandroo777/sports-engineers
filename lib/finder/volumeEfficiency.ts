import type { MLBGameLog } from '../mlb/types';
import { getStatForCanonicalMarket } from './signals';

export interface VolumeEfficiency {
  available: boolean;
  /** What the estimated volume is derived from — always an average of recent real games, never a live confirmed lineup/pitch-count projection. */
  basis: 'plate_appearances' | 'innings_pitched' | 'unavailable';
  estimatedVolume: number | null;
  requiredRatePerUnit: number | null;
  actualRatePerUnit: number | null;
  meetsRequiredRate: boolean | null;
}

const UNAVAILABLE: VolumeEfficiency = { available: false, basis: 'unavailable', estimatedVolume: null, requiredRatePerUnit: null, actualRatePerUnit: null, meetsRequiredRate: null };

/**
 * Breaks a counting-stat line into the per-unit rate required to clear it at the player's recent
 * volume, and compares that to their actual recent rate. Volume is estimated from the average of
 * real recent games — not a confirmed lineup spot, pitch count, or times-through-order model,
 * which DeepSide does not have a live data source for.
 */
export function computeVolumeEfficiency(
  games: MLBGameLog[],
  canonicalMarketKey: string,
  line: number,
  side: 'over' | 'under',
  isPitcher: boolean,
  windowSize = 10,
): VolumeEfficiency {
  const recent = games.slice(-windowSize);
  const values = recent.map((game) => getStatForCanonicalMarket(game, canonicalMarketKey)).filter((value): value is number => value != null);
  if (!values.length) return UNAVAILABLE;

  if (isPitcher) {
    const innings = recent.map((game) => Number(game.inningsPitched ?? 0)).filter((value) => value > 0);
    if (innings.length < 3) return UNAVAILABLE;
    const avgInnings = innings.reduce((sum, value) => sum + value, 0) / innings.length;
    const actualRate = values.reduce((sum, value) => sum + value, 0) / values.length / avgInnings;
    const requiredRate = line / avgInnings;
    return {
      available: true,
      basis: 'innings_pitched',
      estimatedVolume: Number(avgInnings.toFixed(1)),
      requiredRatePerUnit: Number(requiredRate.toFixed(3)),
      actualRatePerUnit: Number(actualRate.toFixed(3)),
      meetsRequiredRate: side === 'over' ? actualRate >= requiredRate : actualRate <= requiredRate,
    };
  }

  const plateAppearances = recent.map((game) => Number(game.plateAppearances ?? 0)).filter((value) => value > 0);
  if (plateAppearances.length < 3) return UNAVAILABLE;
  const avgPA = plateAppearances.reduce((sum, value) => sum + value, 0) / plateAppearances.length;
  const actualRate = values.reduce((sum, value) => sum + value, 0) / values.length / avgPA;
  const requiredRate = line / avgPA;
  return {
    available: true,
    basis: 'plate_appearances',
    estimatedVolume: Number(avgPA.toFixed(1)),
    requiredRatePerUnit: Number(requiredRate.toFixed(3)),
    actualRatePerUnit: Number(actualRate.toFixed(3)),
    meetsRequiredRate: side === 'over' ? actualRate >= requiredRate : actualRate <= requiredRate,
  };
}
