import type { NBAGameLogEntry } from './types';

export interface NBAResearchInputs {
  completedGames: number;
  recentGames: number;
  seasonGames: number;
  recentMinutes: number | null;
  seasonMinutes: number | null;
  recentPoints: number | null;
  seasonPoints: number | null;
  recentRebounds: number | null;
  seasonRebounds: number | null;
  recentAssists: number | null;
  seasonAssists: number | null;
  minuteVolatility: number | null;
  expectedRole: 'available' | 'unavailable';
  projection: 'available' | 'unavailable';
}

function average(logs: NBAGameLogEntry[], key: string): number | null {
  const values = logs.map((log) => log.stats[key]).filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function deviation(logs: NBAGameLogEntry[], key: string): number | null {
  const mean = average(logs, key);
  if (mean == null) return null;
  const values = logs.map((log) => log.stats[key]).filter((value): value is number => value != null);
  return values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) : null;
}

/** Historical inputs only. These are baselines, not current projections or expected minutes. */
export function buildNBAResearchInputs(logs: NBAGameLogEntry[]): NBAResearchInputs {
  const completed = logs.filter((log) => log.result != null);
  const recent = completed.slice(-10);
  return {
    completedGames: completed.length,
    recentGames: recent.length,
    seasonGames: completed.length,
    recentMinutes: average(recent, 'minutes'),
    seasonMinutes: average(completed, 'minutes'),
    recentPoints: average(recent, 'points'),
    seasonPoints: average(completed, 'points'),
    recentRebounds: average(recent, 'totalRebounds'),
    seasonRebounds: average(completed, 'totalRebounds'),
    recentAssists: average(recent, 'assists'),
    seasonAssists: average(completed, 'assists'),
    minuteVolatility: deviation(recent, 'minutes'),
    expectedRole: 'unavailable',
    projection: 'unavailable',
  };
}
