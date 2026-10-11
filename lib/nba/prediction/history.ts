import { getNBAHistoricalValue, type NBAAnalyzableMarket } from '../market';
import type { NBAObservedGame, NBASeasonPhase, NBAWindowRates } from './types';

const EXCLUDED_PHASES = new Set<NBASeasonPhase>(['PRESEASON', 'ALL_STAR', 'UNKNOWN']);

export function selectNBAAsOfHistory(input: {
  observations: NBAObservedGame[];
  targetTipoff: string;
  targetGameId: string;
  targetSeason: number | null;
  targetPhase: Exclude<NBASeasonPhase, 'PRESEASON' | 'ALL_STAR'>;
}): NBAObservedGame[] {
  const cutoff = Date.parse(input.targetTipoff);
  if (!Number.isFinite(cutoff) || input.targetSeason == null || input.targetPhase === 'UNKNOWN') return [];
  const byGame = new Map<string, NBAObservedGame>();
  for (const observation of input.observations) {
    const date = Date.parse(observation.log.date);
    if (!observation.log.result || !Number.isFinite(date) || date >= cutoff || observation.log.gameId === input.targetGameId
      || observation.season !== input.targetSeason || EXCLUDED_PHASES.has(observation.phase) || observation.phase !== input.targetPhase) continue;
    const previous = byGame.get(observation.log.gameId);
    if (!previous || Date.parse(previous.log.date) < date) byGame.set(observation.log.gameId, observation);
  }
  return [...byGame.values()].sort((a, b) => Date.parse(a.log.date) - Date.parse(b.log.date) || a.log.gameId.localeCompare(b.log.gameId));
}

export function getNBAWindowValues(observations: NBAObservedGame[], market: NBAAnalyzableMarket): Array<{ gameId: string; value: number }> {
  return observations.flatMap(({ log }) => {
    const value = getNBAHistoricalValue(market, log.stats);
    return value != null && Number.isFinite(value) ? [{ gameId: log.gameId, value }] : [];
  });
}

export function nbaHistoricalWindowRates(values: number[], line: number, direction: 'over' | 'under'): NBAWindowRates {
  const summarize = (window: number | null): number | null => {
    const selected = window == null ? values : values.slice(-window);
    if (!selected.length) return null;
    const hits = selected.filter((value) => direction === 'over' ? value > line : value < line).length;
    return hits / selected.length;
  };
  return { l5: summarize(5), l10: summarize(10), l20: summarize(20), season: summarize(null) };
}

export function nbaHistoricalPushRate(values: number[], line: number): number | null {
  return values.length ? values.filter((value) => value === line).length / values.length : null;
}

export function nbaExplosiveOutlierShare(values: number[]): number | null {
  if (values.length < 3) return null;
  const sum = values.reduce((total, value) => total + Math.max(0, value), 0);
  return sum > 0 ? Math.max(...values.map((value) => Math.max(0, value))) / sum : null;
}

export function sampleMean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function sampleVariance(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = sampleMean(values)!;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}
