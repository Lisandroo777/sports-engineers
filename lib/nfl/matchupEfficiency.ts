import type { NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLDefenseGame, NFLDefenseMetricKey, NFLOpponentContext } from './opponentContext';
import type { NFLInjuryContext } from './injuries';
import { classifyNFLInjuryFreshness } from './injuries';
import type { NFLProjectionExplanation } from './opportunityProjection';

export const NFL_MATCHUP_MODEL_VERSION = 'nfl_matchup_efficiency_v1';
export const NFL_MATCHUP_EFFICIENCY_CAP = 0.03;
export type NFLMatchupConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';
export type NFLMatchupFamily = 'WR_YARDS' | 'WR_RECEPTIONS' | 'TE_RECEIVING' | 'RB_RECEIVING' | 'RB_RUSHING' | 'QB_PASSING' | 'QB_COMPLETIONS' | 'QB_RUSHING' | 'OTHER';

export interface NFLMatchupReference {
  metric: 'yardsPerPassAttemptAllowed' | 'completionRateAllowed' | 'yardsPerRushAttemptAllowed';
  value: number;
  observations: number;
  source: string;
  season: number;
  scheduleAdjusted: boolean;
  methodology: 'FACED_OFFENSE_EXPECTATION';
}

export interface NFLMatchupEfficiency {
  modelVersion: string;
  projectionModelVersion: string;
  opportunityModelVersion: string | null;
  probabilityModelVersion: string | null;
  calibrationStatus: 'UNVALIDATED';
  evaluatedAt: string;
  snapshotOnly: boolean;
  market: string;
  family: NFLMatchupFamily;
  researchMode: 'STANDARD' | 'DEEP';
  status: 'PARTIAL' | 'UNAVAILABLE';
  confidence: NFLMatchupConfidence;
  overall: 'FAVORABLE' | 'UNFAVORABLE' | 'NEUTRAL' | 'UNASSESSED';
  defensiveState: 'STABLE' | 'IMPROVING' | 'DECLINING' | 'CHANGED' | 'UNCERTAIN';
  priorities: string[];
  playerFit: string;
  evidenceFor: string[];
  counterCase: string[];
  injuryEvidence: string[];
  trenchEvidence: string[];
  missingInputs: string[];
  inputs: {
    source: string;
    opponentTeamId: number | null;
    season: number | null;
    games: NFLDefenseGame[];
    seasonalGames: number;
    efficiencyMetric: string | null;
    seasonEfficiency: number | null;
    recentEfficiency: number | null;
    priorSeasonEfficiency: number | null;
    sackRate: number | null;
    reference: NFLMatchupReference | null;
  };
  historicalBaseline: number | null;
  phase2Projection: number | null;
  phase2Uncertainty: number | null;
  opportunityProjection: number | null;
  expectedOpportunity: number | null;
  expectedEfficiency: number | null;
  adjustedEfficiency: number | null;
  matchupOpportunityProjection: number | null;
  efficiencyAdjustment: number;
  projectionAdjustment: number;
  finalProjection: number | null;
  adjustmentCap: number;
  formula: string;
  adjustmentReason: string;
  antiDoubleCounting: string[];
}

function familyFor(market: string, position: string | null): NFLMatchupFamily {
  if (market.startsWith('player_rush_')) return position === 'QB' ? 'QB_RUSHING' : 'RB_RUSHING';
  if (market === 'player_pass_completions') return 'QB_COMPLETIONS';
  if (market.startsWith('player_pass_')) return 'QB_PASSING';
  if (market.startsWith('player_reception')) return position === 'TE' ? 'TE_RECEIVING' : position === 'RB' ? 'RB_RECEIVING'
    : market === 'player_receptions' ? 'WR_RECEPTIONS' : 'WR_YARDS';
  return 'OTHER';
}

const PRIORITIES: Record<NFLMatchupFamily, string[]> = {
  WR_YARDS: ['expected targets', 'yards per target', 'pass efficiency', 'coverage fit', 'YAC environment', 'QB protection', 'secondary injuries', 'game script', 'weather'],
  WR_RECEPTIONS: ['expected targets', 'catch rate', 'completion environment', 'coverage style', 'short/intermediate tendencies', 'pressure effects'],
  TE_RECEIVING: ['recorded targets and role', 'routes', 'TE coverage', 'LB/S matchup', 'middle-field tendencies', 'red-zone role'],
  RB_RECEIVING: ['receiving opportunity', 'LB coverage', 'pressure/checkdown environment', 'game script'],
  RB_RUSHING: ['expected carries', 'yards per carry', 'OL versus front', 'run-defense efficiency', 'game script', 'front-seven injuries'],
  QB_PASSING: ['expected attempts', 'yards per attempt', 'pass defense', 'pressure/protection', 'coverage', 'receiver availability', 'game script', 'weather'],
  QB_COMPLETIONS: ['expected attempts', 'completion efficiency', 'pressure', 'coverage', 'depth of target', 'game environment'],
  QB_RUSHING: ['designed rushes', 'scrambles', 'pressure', 'man coverage', 'edge containment', 'red-zone usage'],
  OTHER: ['market-specific supported efficiency'],
};

function pooled(games: NFLDefenseGame[], numerator: NFLDefenseMetricKey, denominator: NFLDefenseMetricKey): number | null {
  const paired = games.filter((game) => Number.isFinite(game.metrics[numerator]) && Number.isFinite(game.metrics[denominator])
    && game.metrics[denominator]! > 0);
  const opportunities = paired.reduce((total, game) => total + game.metrics[denominator]!, 0);
  return opportunities > 0 ? paired.reduce((total, game) => total + game.metrics[numerator]!, 0) / opportunities : null;
}

export function buildNFLMatchupEfficiency(params: {
  market: NFLAnalyzableMarketKey;
  position?: string | null;
  season?: number;
  before?: string;
  researchMode?: 'STANDARD' | 'DEEP';
  opponentContext?: NFLOpponentContext | null;
  injuryContext?: NFLInjuryContext | null;
  projectionModel?: NFLProjectionExplanation | null;
  phase2Projection?: number | null;
  phase2Uncertainty?: number | null;
  reference?: NFLMatchupReference | null;
  now?: Date;
  snapshotOnly?: boolean;
}): NFLMatchupEfficiency {
  const now = params.now ?? new Date();
  const position = params.position?.toUpperCase() ?? null;
  const family = familyFor(params.market, position);
  const model = params.projectionModel;
  const opponent = params.opponentContext;
  const games = [...new Map((opponent?.efficiencyGames ?? []).filter((game) => Number.isFinite(Date.parse(game.date))
    && Date.parse(game.date) <= now.getTime() && (!params.before || Date.parse(game.date) < Date.parse(params.before)))
    .map((game) => [game.eventId, game])).values()].sort((first, second) => Date.parse(first.date) - Date.parse(second.date));
  const season = params.season ?? games.at(-1)?.season ?? null;
  const current = games.filter((game) => game.season === season);
  const prior = games.filter((game) => game.season !== season);
  const isRun = family === 'RB_RUSHING';
  const isCompletion = family === 'WR_RECEPTIONS' || family === 'RB_RECEIVING' || family === 'QB_COMPLETIONS' || (family === 'TE_RECEIVING' && params.market === 'player_receptions');
  const efficiencyMetric = family === 'QB_RUSHING' || family === 'OTHER' ? null : isRun ? 'yardsPerRushAttemptAllowed'
    : isCompletion ? 'completionRateAllowed' : 'yardsPerPassAttemptAllowed';
  const numerator = isRun ? 'rushingYardsAllowed' : isCompletion ? 'completionsAllowed' : 'passingYardsAllowed';
  const denominator = isRun ? 'rushingAttemptsAllowed' : 'passAttemptsAllowed';
  const valid = current.filter((game) => Number.isFinite(game.metrics[numerator]) && game.metrics[numerator]! >= 0
    && Number.isFinite(game.metrics[denominator]) && game.metrics[denominator]! > 0
    && (!isCompletion || game.metrics[numerator]! <= game.metrics[denominator]!));
  const efficiency = efficiencyMetric ? pooled(valid, numerator, denominator) : null;
  const recent = efficiencyMetric && valid.length >= 3 ? pooled(valid.slice(-3), numerator, denominator) : null;
  const priorEfficiency = efficiencyMetric ? pooled(prior, numerator, denominator) : null;
  const sackGames = current.filter((game) => Number.isFinite(game.metrics.sacksGenerated) && game.metrics.sacksGenerated! >= 0
    && Number.isFinite(game.metrics.passAttemptsAllowed) && game.metrics.passAttemptsAllowed! >= 0);
  const sacks = sackGames.reduce((total, game) => total + game.metrics.sacksGenerated!, 0);
  const dropbacks = sackGames.reduce((total, game) => total + game.metrics.passAttemptsAllowed! + game.metrics.sacksGenerated!, 0);
  const sackRate = dropbacks > 0 ? sacks / dropbacks : null;
  const injuries = [...(params.injuryContext?.teammateAbsences ?? []), ...(params.injuryContext?.opponentAbsences ?? [])]
    .filter((entry) => entry.sourceStatus === 'CURRENT' && classifyNFLInjuryFreshness(entry.updatedAt ?? params.injuryContext?.lastUpdated, now) === 'CURRENT'
      && ['OUT', 'INACTIVE', 'DOUBTFUL', 'QUESTIONABLE'].includes(entry.availabilityDesignation));
  const ownNames = new Set(params.injuryContext?.teammateAbsences.map((entry) => entry.player) ?? []);
  const injuryEvidence = injuries.map((entry) => `${ownNames.has(entry.player) ? 'Own team' : 'Opponent'} ${entry.position ?? 'position unknown'} ${entry.player}: ${entry.availabilityDesignation}. Alignment, starter replacement and measured efficiency impact are unverified; no numeric injury boost.`);
  const trenchEvidence = [
    ...(sackRate == null ? [] : [`Opponent sack rate ${(100 * sackRate).toFixed(2)}% from ${sacks} sacks / ${dropbacks} recorded attempts plus sacks (${sackGames.length} current-season games). This is not pressure or blitz rate.`]),
    ...(isRun && efficiency != null ? [`Opponent rushing efficiency: ${efficiency.toFixed(3)} yards/carry; team-wide, not an OL/DL blocking grade.`] : []),
    ...injuryEvidence.filter((statement) => /\b(?:OL|OT|OG|OC|LT|RT|LG|RG|T|G|C|DE|DT|DL|NT|LB|EDGE)\b/.test(statement)),
  ];
  const availableBasic = efficiency != null || (opponent?.metrics?.length ?? 0) > 0;
  const confidence: NFLMatchupConfidence = efficiency != null && valid.length >= 6 ? 'MEDIUM' : availableBasic ? 'LOW' : 'UNAVAILABLE';
  const missingInputs = [
    'opponent-quality-adjusted efficiency reference', 'coverage man/zone rates', 'coverage shells', 'pressure rate', 'blitz rate',
    'offensive-line pressure allowed', 'pass/run block performance', 'verified starting OL and replacements', 'EPA', 'success rate',
    ...(isRun ? ['run-stop information', 'yards before contact', 'yards after contact', 'stuff rate', 'short-yardage defense', 'explosive runs allowed']
      : ['alignment and CB assignments', 'double-team tendencies', 'YAC allowed', 'explosive passes allowed', 'player efficiency by coverage', 'depth-of-target tendencies']),
    ...(['WR_YARDS', 'WR_RECEPTIONS', 'TE_RECEIVING', 'RB_RECEIVING'].includes(family) ? ['position-specific defense', 'routes', 'player route/air-yard profile'] : []),
    ...(family === 'QB_RUSHING' ? ['designed rush versus scramble splits', 'QB-specific rushing defense', 'edge containment'] : []),
    ...(games.length ? [] : ['paired per-game opponent efficiency observations']),
  ];
  const counterCase = [
    'Raw defensive efficiency is not adjusted for the quality of offenses faced; apparent weakness may be schedule-driven.',
    `Current-season paired sample is ${valid.length} games; recent form is descriptive, not an L3 projection multiplier.`,
    'Personnel, returning starters, trades and coaching changes are not verified well enough to attribute defensive trends.',
    ...(family === 'QB_RUSHING' ? ['General run defense cannot establish QB scramble or designed-run efficiency.']
      : isRun ? ['Front-seven injuries do not establish a blocking advantage; the opponent may still win at the line of scrimmage.']
        : ['Unmeasured pressure or coverage assignments may suppress the player even if team-wide passing efficiency appears permissive.']),
    ...injuryEvidence,
  ];
  const reference = params.reference ?? null;
  const numericalMarket = (params.market === 'player_pass_yds' && position === 'QB') || (params.market === 'player_pass_completions' && position === 'QB')
    || (params.market === 'player_rush_yds' && position === 'RB');
  const comparable = numericalMarket && reference?.metric === efficiencyMetric && reference.scheduleAdjusted
    && reference.methodology === 'FACED_OFFENSE_EXPECTATION' && reference.season === season
    && reference.source.trim().length > 0 && Number.isFinite(reference.value) && reference.value > 0 && Number.isFinite(reference.observations) && reference.observations >= 100
    && valid.length >= 6 && efficiency != null && efficiency >= 0 && model?.expectedEfficiency != null && model.expectedEfficiency > 0;
  const cappedAdjustment = comparable ? Math.max(-NFL_MATCHUP_EFFICIENCY_CAP, Math.min(NFL_MATCHUP_EFFICIENCY_CAP,
    (efficiency! / reference!.value - 1) * valid.length / (valid.length + 8))) : 0;
  const expectedEfficiency = model?.expectedEfficiency ?? null;
  const adjustment = params.market === 'player_pass_completions' && expectedEfficiency != null && expectedEfficiency > 0
    ? Math.min(cappedAdjustment, Math.max(0, 1 / expectedEfficiency - 1)) : cappedAdjustment;
  if (adjustment < 0) counterCase.push('Supported matched efficiency evidence is unfavorable relative to the documented faced-offense expectation.');
  const adjustedEfficiency = expectedEfficiency == null ? null : expectedEfficiency * (1 + adjustment);
  const opportunity = model?.expectedOpportunity ?? null;
  const matchupOpportunityProjection = opportunity != null && adjustedEfficiency != null ? opportunity * adjustedEfficiency : null;
  const phase2 = params.phase2Projection ?? model?.finalProjection ?? null;
  const projectionAdjustment = opportunity != null && expectedEfficiency != null ? (model?.opportunityBlendWeight ?? 0) * opportunity * expectedEfficiency * adjustment : 0;
  const finalProjection = phase2 == null ? null : Number((phase2 + projectionAdjustment).toFixed(2));
  const playerFit = opportunity != null && expectedEfficiency != null
    ? `${position ?? 'Player'} ${family}: ${opportunity.toFixed(2)} ${model?.opportunityLabel ?? 'expected opportunities'} at ${expectedEfficiency.toFixed(4)} ${model?.efficiencyLabel ?? 'observed efficiency'}. ${numericalMarket ? 'Matched efficiency units are required for numerical comparison.' : 'Team defense does not identify this player\'s coverage or positional efficiency; fit remains qualitative.'}`
    : `${family}: supported player opportunity/efficiency decomposition is unavailable; no specific skill-versus-weakness claim is made.`;
  return {
    modelVersion: NFL_MATCHUP_MODEL_VERSION, projectionModelVersion: 'nfl_opportunity_matchup_v1', opportunityModelVersion: model?.modelVersion ?? null,
    probabilityModelVersion: model?.probabilityModelVersion ?? null, calibrationStatus: 'UNVALIDATED', evaluatedAt: now.toISOString(), snapshotOnly: params.snapshotOnly ?? false, market: params.market, family,
    researchMode: params.researchMode ?? 'STANDARD', status: availableBasic ? 'PARTIAL' : 'UNAVAILABLE', confidence,
    overall: comparable ? adjustment > 0 ? 'FAVORABLE' : adjustment < 0 ? 'UNFAVORABLE' : 'NEUTRAL' : 'UNASSESSED',
    defensiveState: comparable && valid.length >= 8 && !injuries.length && recent != null
      && pooled(valid.slice(0, -3), numerator, denominator) != null
      ? Math.abs(recent / pooled(valid.slice(0, -3), numerator, denominator)! - 1) < 0.1 ? 'STABLE' : 'UNCERTAIN'
      : 'UNCERTAIN', priorities: PRIORITIES[family], playerFit,
    evidenceFor: [
      ...(efficiency == null ? (opponent?.evidence ?? []).map((statement) => `Aggregate context only: ${statement}`) : [`Observed ${efficiencyMetric}: season ${efficiency.toFixed(4)}, L3 ${recent?.toFixed(4) ?? 'unavailable'}, prior sampled season ${priorEfficiency?.toFixed(4) ?? 'unavailable'}. Ratio of paired totals; no positional split inferred.`]),
      ...(adjustment > 0 ? ['Supported comparable efficiency reference indicates favorable efficiency within the capped adjustment.'] : []),
    ], counterCase, injuryEvidence, trenchEvidence, missingInputs,
    inputs: { source: 'ESPN paired team boxscore counts', opponentTeamId: opponent?.opponentTeamId ?? null, season, games,
      seasonalGames: valid.length, efficiencyMetric, seasonEfficiency: efficiency, recentEfficiency: recent, priorSeasonEfficiency: priorEfficiency,
      sackRate, reference }, historicalBaseline: model?.historicalBaseline ?? null, phase2Projection: phase2, phase2Uncertainty: params.phase2Uncertainty ?? model?.uncertainty ?? null,
    opportunityProjection: model?.opportunityProjection ?? null, expectedOpportunity: opportunity, expectedEfficiency, adjustedEfficiency,
    matchupOpportunityProjection, efficiencyAdjustment: adjustment, projectionAdjustment, finalProjection, adjustmentCap: NFL_MATCHUP_EFFICIENCY_CAP,
    formula: 'a = clamp((paired opponent efficiency / supported schedule-adjusted reference - 1) * n/(n+8), -0.03, +0.03); adjusted efficiency = Phase2 efficiency * (1+a); final = Phase2 final + Phase2 blend * expected opportunity * Phase2 efficiency * a',
    adjustmentReason: comparable ? 'Supported comparable reference and at least six current-season paired games; provisional, unvalidated capped efficiency adjustment.'
      : 'Zero adjustment: a reliable schedule-adjusted, same-unit comparison and/or player-specific efficiency evidence is unavailable. Phase2 projection is unchanged.',
    antiDoubleCounting: ['Expected opportunity and the historical blend remain Phase2-owned and unchanged.',
      'Efficiency adjustment enters only the opportunity branch once; no generic defense bonus.',
      'Injuries, weather, pressure, game script and news do not add numerical boosts here.',
      'Sack outcome rate is not pressure/blitz rate; no separate receiving penalty for the same QB protection signal.',
      'Missing advanced inputs are disclosures, never new Standard publication gates.'],
  };
}