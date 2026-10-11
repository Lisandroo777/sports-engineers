import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLGameLogEntry } from './types';
import { assessNFLRoleStability, type NFLRoleStability } from './roleContext';
import type { NFLMatchupEfficiency } from './matchupEfficiency';

export const NFL_OPPORTUNITY_MODEL_VERSION = 'nfl_opportunity_v1';
export const NFL_PROBABILITY_MODEL_VERSION = 'shared_probability_model_v1';
export const NFL_OPPORTUNITY_BLEND_WEIGHT = 0.35;

export type NFLProjectionModelType = 'ADVANCED_OPPORTUNITY_MODEL' | 'PARTIAL_OPPORTUNITY_MODEL' | 'HISTORICAL_BASELINE_ONLY';

export interface NFLProjectionExplanation {
  gameEnvironmentModel?: import('./gameEnvironment').NFLGameEnvironmentModel;
  matchupModel?: NFLMatchupEfficiency;
  modelVersion: string;
  probabilityModelVersion: string;
  calibrationStatus: 'UNVALIDATED';
  seasonPhase: string;
  confidence: 'LOW' | 'MEDIUM';
  modelType: NFLProjectionModelType;
  historicalBaseline: number | null;
  opportunityProjection: number | null;
  finalProjection: number | null;
  opportunityBlendWeight: number;
  expectedOpportunity: number | null;
  opportunityLabel: string | null;
  expectedEfficiency: number | null;
  efficiencyLabel: string | null;
  roleStability: NFLRoleStability;
  uncertainty: number | null;
  opportunityInputs: Array<{ gameId: string; date: string; source: string; weight: number; opportunity: number; production: number }>;
  contributingGameIds: string[];
  opportunityGames: number;
  currentSeasonOpportunityGames: number;
  priorSeasonOpportunityGames: number;
  uncertaintyFromBaselineDisagreement: number | null;
  missingInputs: string[];
  antiDoubleCounting: string;
  notes: string[];
}

interface OpportunityDefinition {
  opportunityKey: string;
  opportunityLabel: string;
  productionKey: string;
  efficiencyLabel: string;
  fixedEfficiency?: number;
  missingInputs: string[];
  notes: string[];
}

/** Reuse the canonical game-log source-pair validity rule for projection and efficiency samples. */
export function isNFLProjectionObservationValid(market: NFLAnalyzableMarketKey, stats: Record<string, number>): boolean {
  const production = getNFLMarketHistoricalValue(market, stats);
  return production != null && Number.isFinite(production);
}

function opportunityDefinition(market: NFLAnalyzableMarketKey, position: string | null): OpportunityDefinition | null {
  if (market === 'player_reception_yds') return {
    opportunityKey: 'receivingTargets', opportunityLabel: 'Expected targets', productionKey: 'receivingYards',
    efficiencyLabel: 'Yards per target', missingInputs: ['routes', 'route participation', 'target share', 'air yards', 'air-yard share', 'aDOT'], notes: [],
  };
  if (market === 'player_receptions') return {
    opportunityKey: 'receivingTargets', opportunityLabel: 'Expected targets', productionKey: 'receptions',
    efficiencyLabel: 'Catch rate', missingInputs: ['routes', 'route participation', 'target share'], notes: [],
  };
  if (market === 'player_rush_attempts') return {
    opportunityKey: 'rushingAttempts', opportunityLabel: position === 'QB' ? 'Expected QB rushing attempts' : 'Expected carries',
    productionKey: 'rushingAttempts', efficiencyLabel: 'Attempts per attempt', fixedEfficiency: 1,
    missingInputs: position === 'QB' ? ['designed rushes', 'scrambles'] : ['team rushing volume', 'carry share'],
    notes: position === 'QB' ? ['ESPN does not distinguish designed QB runs from scrambles.'] : [],
  };
  if (market === 'player_rush_yds') return {
    opportunityKey: 'rushingAttempts', opportunityLabel: position === 'QB' ? 'Expected QB rushing attempts' : 'Expected carries',
    productionKey: 'rushingYards', efficiencyLabel: 'Yards per carry',
    missingInputs: position === 'QB' ? ['designed rushes', 'scrambles'] : ['team rushing volume', 'carry share'],
    notes: position === 'QB' ? ['QB rushing is modeled from total recorded attempts; designed runs and scrambles are not separated.'] : [],
  };
  if (market === 'player_pass_attempts') return {
    opportunityKey: 'passingAttempts', opportunityLabel: 'Expected player pass attempts', productionKey: 'passingAttempts',
    efficiencyLabel: 'Attempts per attempt', fixedEfficiency: 1, missingInputs: ['team passing volume', 'dropbacks'],
    notes: ['No current-game team pass-volume projection is connected; this is a player-history opportunity estimate.'],
  };
  if (market === 'player_pass_completions') return {
    opportunityKey: 'passingAttempts', opportunityLabel: 'Expected player pass attempts', productionKey: 'completions',
    efficiencyLabel: 'Completion rate', missingInputs: ['team passing volume', 'dropbacks'], notes: [],
  };
  if (market === 'player_pass_yds') return {
    opportunityKey: 'passingAttempts', opportunityLabel: 'Expected player pass attempts', productionKey: 'passingYards',
    efficiencyLabel: 'Yards per attempt', missingInputs: ['team passing volume', 'dropbacks'], notes: [],
  };
  return null;
}

function weightedMean(entries: NFLGameLogEntry[], key: string): number | null {
  const usable = entries.filter((entry) => Number.isFinite(entry.stats[key]));
  const totalWeight = usable.reduce((sum, entry) => sum + (entry.historyWeight ?? 1), 0);
  return totalWeight > 0
    ? usable.reduce((sum, entry) => sum + entry.stats[key] * (entry.historyWeight ?? 1), 0) / totalWeight
    : null;
}

function expectedOpportunity(entries: NFLGameLogEntry[], key: string): number | null {
  const windows: Array<[NFLGameLogEntry[], number]> = [
    [entries.slice(-3), 0.45], [entries.slice(-5), 0.35], [entries, 0.20],
  ];
  const available = windows.map(([window, weight]) => ({ value: weightedMean(window, key), weight }))
    .filter((entry): entry is { value: number; weight: number } => entry.value != null);
  const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
  return totalWeight > 0 ? available.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight : null;
}

function observedEfficiency(entries: NFLGameLogEntry[], opportunityKey: string, productionKey: string): number | null {
  let opportunityTotal = 0;
  let productionTotal = 0;
  for (const entry of entries) {
    const opportunity = entry.stats[opportunityKey];
    const production = entry.stats[productionKey];
    if (!Number.isFinite(opportunity) || !Number.isFinite(production) || opportunity <= 0) continue;
    const weight = entry.historyWeight ?? 1;
    opportunityTotal += opportunity * weight;
    productionTotal += production * weight;
  }
  return opportunityTotal > 0 ? productionTotal / opportunityTotal : null;
}

export function buildNFLProjectionExplanation(params: {
  market: NFLAnalyzableMarketKey;
  position?: string | null;
  logs: NFLGameLogEntry[];
  seasonPhase?: string;
  historicalBaseline: number | null;
  finalProjection: number | null;
  blendWeight?: number;
}): NFLProjectionExplanation {
  const blendWeight = params.blendWeight ?? NFL_OPPORTUNITY_BLEND_WEIGHT;
  const definition = opportunityDefinition(params.market, params.position?.toUpperCase() ?? null);
  const empty: NFLProjectionExplanation = {
    modelVersion: NFL_OPPORTUNITY_MODEL_VERSION,
    probabilityModelVersion: NFL_PROBABILITY_MODEL_VERSION,
    calibrationStatus: 'UNVALIDATED',
    seasonPhase: params.seasonPhase ?? 'UNAVAILABLE',
    confidence: 'LOW',
    modelType: 'HISTORICAL_BASELINE_ONLY',
    historicalBaseline: params.historicalBaseline,
    opportunityProjection: null,
    finalProjection: params.finalProjection,
    opportunityBlendWeight: 0,
    expectedOpportunity: null,
    opportunityLabel: null,
    expectedEfficiency: null,
    efficiencyLabel: null,
    roleStability: assessNFLRoleStability(params.logs, params.market),
    uncertainty: null,
    opportunityInputs: [],
    contributingGameIds: [],
    opportunityGames: 0,
    currentSeasonOpportunityGames: 0,
    priorSeasonOpportunityGames: 0,
    uncertaintyFromBaselineDisagreement: null,
    missingInputs: ['market-specific opportunity / efficiency pairing'],
    antiDoubleCounting: 'Each observed opportunity-efficiency pair contributes once to the opportunity projection; injury and research signals do not add a second numeric bonus.',
    notes: ['Historical production baseline only; no supported opportunity decomposition is available for this market.'],
  };
  if (!definition) return empty;

  const completed = params.logs.filter((entry) => entry.result != null)
    .sort((first, second) => Date.parse(first.date) - Date.parse(second.date));
  const paired = completed.filter((entry) => Number.isFinite(entry.stats[definition.opportunityKey])
    && entry.stats[definition.opportunityKey] >= 0 && Number.isFinite(entry.stats[definition.productionKey])
    && isNFLProjectionObservationValid(params.market, entry.stats)
    && Number.isFinite(entry.historyWeight ?? 1) && (entry.historyWeight ?? 1) > 0
    && !(entry.stats[definition.opportunityKey] === 0 && entry.stats[definition.productionKey] !== 0)
    && !(['player_receptions', 'player_pass_completions'].includes(params.market)
      && (entry.stats[definition.productionKey] < 0 || entry.stats[definition.productionKey] > entry.stats[definition.opportunityKey])))
    .map((entry) => ({ ...entry, historyWeight: entry.historyWeight ?? (entry.historySource === 'PREVIOUS_SEASON' ? 0.6 : 1) }));
  const current = paired.filter((entry) => entry.historySource !== 'PREVIOUS_SEASON');
  const opportunityEntries = current.length >= 6 ? current : paired;
  const stability = empty.roleStability;
  const sustainedShift = (stability.status === 'INCREASING' || stability.status === 'DECLINING')
    && stability.earlierSeasonMean != null && current.slice(-3).every((entry) => stability.status === 'INCREASING'
      ? entry.stats[definition.opportunityKey] >= stability.earlierSeasonMean! * 1.1
      : entry.stats[definition.opportunityKey] <= stability.earlierSeasonMean! * 0.9);
  const opportunity = expectedOpportunity(sustainedShift ? current.slice(-3) : opportunityEntries, definition.opportunityKey);
  const efficiency = definition.fixedEfficiency ?? observedEfficiency(opportunityEntries, definition.opportunityKey, definition.productionKey);
  if (paired.length < 3 || current.length < 3 || opportunity == null || efficiency == null || params.historicalBaseline == null) {
    return {
      ...empty,
      missingInputs: [...definition.missingInputs, ...(opportunity == null ? [definition.opportunityKey] : []),
        ...(paired.length < 3 ? ['at least three paired opportunity/production game logs'] : []),
        ...(current.length < 3 ? ['at least three current-season paired opportunity/production game logs'] : []),
        ...(opportunity == null ? [definition.opportunityLabel] : []), ...(efficiency == null ? [definition.efficiencyLabel] : [])],
      notes: [...definition.notes, 'Opportunity inputs are insufficient; final projection falls back to the historical baseline.'],
    };
  }

  const opportunityProjection = opportunity * efficiency;
  const finalProjection = (1 - blendWeight) * params.historicalBaseline + blendWeight * opportunityProjection;
  const currentSeasonOpportunityGames = paired.filter((entry) => entry.historySource !== 'PREVIOUS_SEASON').length;
  const priorSeasonOpportunityGames = paired.length - currentSeasonOpportunityGames;
  const missingInputs = [...definition.missingInputs];
  if (params.market === 'player_pass_attempts') missingInputs.push('upcoming game-specific team pass-volume estimate');
  return {
    ...empty,
    modelType: 'PARTIAL_OPPORTUNITY_MODEL',
    confidence: current.length >= 6 && stability.status === 'STABLE' ? 'MEDIUM' : 'LOW',
    opportunityBlendWeight: blendWeight,
    opportunityProjection: Number(opportunityProjection.toFixed(2)),
    finalProjection: Number(finalProjection.toFixed(2)),
    expectedOpportunity: Number(opportunity.toFixed(2)),
    opportunityLabel: definition.opportunityLabel,
    expectedEfficiency: Number(efficiency.toFixed(4)),
    efficiencyLabel: definition.efficiencyLabel,
    opportunityInputs: paired.map((entry) => ({ gameId: entry.gameId, date: entry.date,
      source: entry.historySource ?? 'CURRENT_SEASON', weight: entry.historyWeight ?? 1,
      opportunity: entry.stats[definition.opportunityKey], production: entry.stats[definition.productionKey] })),
    contributingGameIds: opportunityEntries.map((entry) => entry.gameId),
    opportunityGames: paired.length,
    currentSeasonOpportunityGames,
    priorSeasonOpportunityGames,
    uncertaintyFromBaselineDisagreement: Number((Math.sqrt(blendWeight * (1 - blendWeight))
      * Math.abs(opportunityProjection - params.historicalBaseline)).toFixed(2)),
    missingInputs,
    notes: [...definition.notes, 'Opportunity estimate is derived from player game logs, not current-game team volume or advanced participation data.',
      ...(sustainedShift ? ['A consistent three-game current-season opportunity shift supplies expected volume; observed efficiency is not separately boosted.'] : []),
      ...(current.length >= 6 ? ['At least six current-season paired observations are available; prior-season efficiency and opportunity no longer enter this opportunity estimate.'] : ['Comparable prior-season observations retain reduced weight; the small current-season sample limits confidence.']),
      `Final projection uses a provisional ${(blendWeight * 100).toFixed(0)}% opportunity / ${((1 - blendWeight) * 100).toFixed(0)}% historical blend, weighted toward the established baseline pending backtesting.`,
      `Season phase is ${params.seasonPhase ?? 'unavailable'}; phase does not apply a numeric adjustment. Current/prior opportunity sample counts and role stability carry the reliability context.`],
  };
}