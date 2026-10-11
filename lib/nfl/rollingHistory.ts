import { ELITE_THRESHOLDS } from '../ai/eliteResearchFilter';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLGameLogEntry } from './types';

export interface NFLHistorySample {
  season: number;
  logs: NFLGameLogEntry[];
  currentSeason: NFLGameLogEntry[];
  previousSeason: NFLGameLogEntry[];
  currentObservations: number;
  previousObservations: number;
  observations: number;
  supplemented: boolean;
  confidence: 'CURRENT_ONLY' | 'COMPARABLE' | 'LIMITED' | 'INSUFFICIENT';
  uncertaintyMultiplier: number;
  excludedPreviousGames: number;
  reasons: string[];
}

export function nflOpportunityValue(log: NFLGameLogEntry, market: NFLAnalyzableMarketKey): number | null {
  const key = market.startsWith('player_pass_') ? 'passingAttempts'
    : market.startsWith('player_rush_') ? 'rushingAttempts'
    : market.startsWith('player_reception') ? 'receivingTargets' : null;
  const value = key ? log.stats[key] : null;
  return value != null && Number.isFinite(value) ? value : null;
}

function ordered(logs: NFLGameLogEntry[], season: number, source: NFLGameLogEntry['historySource']): NFLGameLogEntry[] {
  const byGame = new Map<string, NFLGameLogEntry>();
  for (const log of logs) {
    if (log.result != null && (log.season == null || log.season === season)) byGame.set(log.gameId, { ...log, season, historySource: source, historyWeight: source === 'CURRENT_SEASON' ? 1 : 0.6 });
  }
  return [...byGame.values()].sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime() || first.gameId.localeCompare(second.gameId));
}

export function buildNFLRollingHistory(params: {
  current: NFLGameLogEntry[];
  previous: NFLGameLogEntry[];
  season: number;
  teamId: number | null;
  position: string | null;
  market: NFLAnalyzableMarketKey;
}): NFLHistorySample {
  const { season, teamId, position, market } = params;
  const currentSeason = ordered(params.current, season, 'CURRENT_SEASON');
  const currentIds = new Set(currentSeason.map((log) => log.gameId));
  const previousSeason = ordered(params.previous, season - 1, 'PREVIOUS_SEASON').filter((log) => !currentIds.has(log.gameId));
  const hasValue = (log: NFLGameLogEntry) => {
    const value = getNFLMarketHistoricalValue(market, log.stats);
    return value != null && Number.isFinite(value);
  };
  const current = currentSeason.filter((log) => (log.teamId == null || log.teamId === teamId) && (log.position == null || log.position === position));
  const currentObservations = current.filter(hasValue).length;
  const reasons: string[] = [];
  const needed = Math.max(0, ELITE_THRESHOLDS.minSampleSize - currentObservations);
  const recent = current.slice(-3);
  const opportunities = recent.map((log) => nflOpportunityValue(log, market)).filter((value): value is number => value != null);
  const currentWorkload = opportunities.length ? opportunities.reduce((total, value) => total + value, 0) / opportunities.length : null;
  const roleFamily = market.startsWith('player_pass_') ? 'PASSING' : market.startsWith('player_rush_') ? 'RUSHING' : market.startsWith('player_reception') ? 'RECEIVING' : null;
  const priorContext = previousSeason.filter((log) => log.teamId != null && log.teamId === teamId && position != null
    && (log.position != null ? log.position === position : roleFamily != null && log.roleEvidence?.includes(roleFamily)));
  if (needed > 0 && priorContext.length !== previousSeason.length) reasons.push('Previous games with different or unverified team/position context were excluded.');
  const priorOpportunities = priorContext.slice(-10).map((log) => nflOpportunityValue(log, market)).filter((value): value is number => value != null);
  const previousWorkload = priorOpportunities.length ? priorOpportunities.reduce((total, value) => total + value, 0) / priorOpportunities.length : null;
  const roleComparable = currentWorkload != null && currentWorkload > 0 && previousWorkload != null
    && Math.abs(previousWorkload - currentWorkload) / currentWorkload <= 0.3;
  const currentStarter = recent.every((log) => log.started === true) ? true : recent.length > 0 && recent.every((log) => log.started === false) ? false : null;
  const eligible = roleComparable ? priorContext.filter((log) => {
    const workload = nflOpportunityValue(log, market);
    return hasValue(log) && workload != null && workload >= currentWorkload! * 0.6 && workload <= currentWorkload! * 1.6
      && (currentStarter == null || log.started == null || log.started === currentStarter);
  }) : [];
  if (needed > 0 && !roleComparable) reasons.push('Previous-season workload is materially different or comparable current-role evidence is insufficient.');
  const supplement = needed > 0 ? eligible.slice(-needed) : [];
  const logs = [...supplement, ...current].sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime() || first.gameId.localeCompare(second.gameId));
  const previousObservations = supplement.length;
  const observations = currentObservations + previousObservations;
  const supplemented = previousObservations > 0;
  const proxyRole = supplement.some((log) => log.position == null);
  if (proxyRole) reasons.push('Historical registered position is unavailable; comparability uses recorded market-specific workload, not a confirmed depth-chart role.');
  if (supplemented) reasons.push(`${previousObservations} comparable previous-season games supplement ${currentObservations} current-season observations; older games carry 60% weight.`);
  const confidence = observations < ELITE_THRESHOLDS.minSampleSize ? 'INSUFFICIENT'
    : !supplemented ? 'CURRENT_ONLY' : currentObservations < 3 ? 'LIMITED' : 'COMPARABLE';
  const uncertaintyMultiplier = supplemented ? 1 + (previousObservations / observations) * 0.3 + (currentObservations < 3 ? 0.15 : 0) + (proxyRole ? 0.1 : 0) : 1;
  return {
    season, logs, currentSeason, previousSeason, currentObservations, previousObservations, observations,
    supplemented, confidence, uncertaintyMultiplier, excludedPreviousGames: previousSeason.length - supplement.length, reasons,
  };
}