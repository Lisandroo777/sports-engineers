import { calculateHits, calculateHitsRunsRBI, calculateHomeRuns, calculateOutsRecorded, calculateRBI, calculateRuns, calculateStrikeouts, calculateTotalBases } from '../mlb/stats';
import type { MLBGameLog } from '../mlb/types';

export function getStatForCanonicalMarket(game: MLBGameLog, canonicalMarketKey: string): number | null {
  switch (canonicalMarketKey) {
    case 'batter_hits': return calculateHits(game);
    case 'batter_total_bases': return calculateTotalBases(game);
    case 'batter_home_runs': return calculateHomeRuns(game);
    case 'batter_runs_scored': return calculateRuns(game);
    case 'batter_rbis': return calculateRBI(game);
    case 'batter_hits_runs_rbis': return calculateHitsRunsRBI(game);
    case 'batter_strikeouts': return calculateStrikeouts(game);
    case 'batter_doubles': return game.doubles ?? null;
    case 'batter_triples': return game.triples ?? null;
    case 'batter_walks': return game.walks ?? null;
    case 'pitcher_strikeouts': return calculateStrikeouts(game);
    case 'pitcher_hits_allowed': return game.hitsAllowed ?? null;
    case 'pitcher_earned_runs': return game.earnedRuns ?? null;
    case 'pitcher_outs': return calculateOutsRecorded(game.inningsPitched);
    default: return null;
  }
}

export interface WindowResult { hits: number; total: number; rate: number | null; }

export interface HistoricalSignal {
  available: boolean;
  windows: { l5: WindowResult; l10: WindowResult; l20: WindowResult; l40: WindowResult; season: WindowResult };
  recentAverage: number | null;
  seasonAverage: number | null;
  median: number | null;
  consistency: number | null;
  homeAway: { home: WindowResult; away: WindowResult } | null;
  trend: 'up' | 'down' | 'flat' | 'unavailable';
}

function evaluateWindow(games: MLBGameLog[], canonicalMarketKey: string, line: number, side: 'over' | 'under'): WindowResult {
  let hits = 0;
  let total = 0;
  for (const game of games) {
    const value = getStatForCanonicalMarket(game, canonicalMarketKey);
    if (value == null) continue;
    if (Number.isInteger(line) && value === line) continue;
    total += 1;
    if (side === 'over' ? value > line : value < line) hits += 1;
  }
  return { hits, total, rate: total > 0 ? Math.round((hits / total) * 100) : null };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function buildHistoricalSignal(games: MLBGameLog[], canonicalMarketKey: string, line: number, side: 'over' | 'under'): HistoricalSignal {
  const values = games.map((game) => getStatForCanonicalMarket(game, canonicalMarketKey)).filter((value): value is number => value != null);
  if (!values.length) {
    return {
      available: false,
      windows: { l5: { hits: 0, total: 0, rate: null }, l10: { hits: 0, total: 0, rate: null }, l20: { hits: 0, total: 0, rate: null }, l40: { hits: 0, total: 0, rate: null }, season: { hits: 0, total: 0, rate: null } },
      recentAverage: null, seasonAverage: null, median: null, consistency: null, homeAway: null, trend: 'unavailable',
    };
  }

  const l5 = evaluateWindow(games.slice(-5), canonicalMarketKey, line, side);
  const l10 = evaluateWindow(games.slice(-10), canonicalMarketKey, line, side);
  const l20 = evaluateWindow(games.slice(-20), canonicalMarketKey, line, side);
  const l40 = evaluateWindow(games.slice(-40), canonicalMarketKey, line, side);
  const season = evaluateWindow(games, canonicalMarketKey, line, side);

  const recentValues = values.slice(-10);
  const recentAverage = recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length;
  const seasonAverage = values.reduce((sum, value) => sum + value, 0) / values.length;

  const homeGames = games.filter((game) => game.homeAway?.toLowerCase() === 'home');
  const awayGames = games.filter((game) => game.homeAway?.toLowerCase() === 'away');
  const homeAway = (homeGames.length || awayGames.length) ? {
    home: evaluateWindow(homeGames, canonicalMarketKey, line, side),
    away: evaluateWindow(awayGames, canonicalMarketKey, line, side),
  } : null;

  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));
  const firstAvg = firstHalf.length ? firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length : 0;
  const secondAvg = secondHalf.length ? secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length : 0;
  const trend: HistoricalSignal['trend'] = secondAvg > firstAvg * 1.1 ? 'up' : secondAvg < firstAvg * 0.9 ? 'down' : 'flat';

  return {
    available: true,
    windows: { l5, l10, l20, l40, season },
    recentAverage: Number(recentAverage.toFixed(2)),
    seasonAverage: Number(seasonAverage.toFixed(2)),
    median: median(values),
    consistency: standardDeviation(values),
    homeAway,
    trend,
  };
}
