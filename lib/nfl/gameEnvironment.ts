import type { NFLGameScriptResearch, NFLResearchLayer } from './researchModel';
import type { NFLProjectionExplanation } from './opportunityProjection';
import type { NFLInjuryContext } from './injuries';
import { classifyNFLInjuryFreshness } from './injuries';
import type { NFLWeatherContext } from './weather';
import type { NFLResearchMode } from './researchIntent';

export const NFL_GAME_ENVIRONMENT_MODEL_VERSION = 'nfl_game_environment_v1';
export type NFLScriptFamily = 'QB_ATTEMPTS' | 'QB_COMPLETIONS' | 'QB_PASSING' | 'QB_RUSHING' | 'RB_CARRIES' | 'RB_RUSHING' | 'RB_RECEIVING' | 'RECEPTIONS' | 'RECEIVING_YARDS' | 'OTHER';
export interface NFLTeamTendencyEvidence {
  teamId: number;
  season: number;
  source: string;
  retrievedAt: string;
  games: number;
  currentSystemVerified: boolean;
  passRate: number | null;
  rushRate: number | null;
  playsPerGame: number | null;
  leadingPassRate: number | null;
  trailingPassRate: number | null;
  closePassRate: number | null;
}
export interface NFLGameEnvironmentModel {
  modelVersion: string;
  historicalModelVersion: string;
  opportunityModelVersion: string | null;
  matchupModelVersion: string | null;
  probabilityModelVersion: string | null;
  calibrationStatus: 'UNVALIDATED';
  evaluatedAt: string;
  snapshotOnly: boolean;
  researchMode: NFLResearchMode;
  market: string;
  direction: 'over' | 'under';
  family: NFLScriptFamily;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';
  status: 'PARTIAL' | 'UNAVAILABLE';
  inputs: {
    teamId: number | null;
    season: number | null;
    seasonPhase: string;
    homeAway: 'HOME' | 'AWAY' | null;
    homeSpread: number | null;
    candidateSpread: number | null;
    total: number | null;
    teamTotal: number | null;
    opponentTeamTotal: number | null;
    expectedLeader: string | null;
    expectedMargin: number | null;
    moneyline: null;
    marketRetrievalStatus: 'RECENT_RETRIEVAL' | 'STALE_RETRIEVAL' | 'UNKNOWN';
    marketProvenance: NFLResearchLayer<NFLGameScriptResearch>['provenance'];
    observedTendencies: NFLTeamTendencyEvidence | null;
    weather: { environment: string; windMph: number | null; sourceStatus: string } | null;
    injuryEvidence: string[];
  };
  expectedScoringEnvironment: 'HIGH_MARKET_TOTAL' | 'LOW_MARKET_TOTAL' | 'MARKET_TOTAL_AVAILABLE' | 'UNAVAILABLE';
  expectedScript: 'MARKET_FAVORITE' | 'MARKET_UNDERDOG' | 'MARKET_PICK_EM' | 'UNAVAILABLE';
  potentialBlowout: boolean;
  expectedTeamVolume: { plays: number | null; passAttempts: number | null; rushAttempts: number | null; possessions: number | null };
  passRushEnvironment: string;
  priorities: string[];
  evidence: string[];
  counterCase: string[];
  scenarios: Array<{ name: 'FAVORABLE' | 'BASE' | 'ADVERSE'; scoreState: string; opportunityImpact: string; evidenceStatus: 'CONDITIONAL_UNVALIDATED'; probability: null; projection: null }>;
  robustness: 'NOT_QUANTIFIED';
  phase2Opportunity: number | null;
  expectedPlayerOpportunity: number | null;
  targetShare: number | null;
  matchupAdjustedEfficiency: number | null;
  phase3Projection: number | null;
  phase3Uncertainty: number | null;
  gameEnvironmentOpportunityProjection: number | null;
  volumeAdjustment: number;
  projectionAdjustment: number;
  adjustmentLimit: number;
  finalProjection: number | null;
  formula: string;
  adjustmentReason: string;
  missingInputs: string[];
  antiDoubleCounting: string[];
}

function familyFor(market: string, position: string | null): NFLScriptFamily {
  if (market === 'player_pass_attempts') return 'QB_ATTEMPTS';
  if (market === 'player_pass_completions') return 'QB_COMPLETIONS';
  if (market === 'player_pass_yds') return 'QB_PASSING';
  if (market.startsWith('player_rush_') && position === 'QB') return 'QB_RUSHING';
  if (market === 'player_rush_attempts') return 'RB_CARRIES';
  if (market === 'player_rush_yds') return 'RB_RUSHING';
  if (market.startsWith('player_reception') && position === 'RB') return 'RB_RECEIVING';
  if (market === 'player_receptions') return 'RECEPTIONS';
  if (market === 'player_reception_yds') return 'RECEIVING_YARDS';
  return 'OTHER';
}
const PRIORITIES: Record<NFLScriptFamily, string[]> = {
  QB_ATTEMPTS: ['team play volume', 'observed pass tendency', 'score-state response', 'pace'],
  QB_COMPLETIONS: ['expected attempts', 'completion environment'],
  QB_PASSING: ['expected attempts', 'Phase3 adjusted yards per attempt'],
  QB_RUSHING: ['designed-run role', 'scramble environment', 'pressure', 'score state', 'red-zone usage'],
  RB_CARRIES: ['team plays', 'observed rush tendency', 'leading/trailing response', 'backfield role'],
  RB_RUSHING: ['expected carries', 'Phase3 adjusted yards per carry'],
  RB_RECEIVING: ['verified receiving role', 'team attempts', 'passing-down role', 'score state'],
  RECEPTIONS: ['expected team pass attempts', 'recorded target opportunity', 'target share if verified', 'pace'],
  RECEIVING_YARDS: ['expected targets', 'Phase3 adjusted yards per target', 'team attempts', 'pace'],
  OTHER: ['supported market-specific volume', 'red-zone role if recorded'],
};
const finite = (value: number | null | undefined) => value != null && Number.isFinite(value) ? value : null;

export function buildNFLGameEnvironment(params: {
  market: string;
  direction?: 'over' | 'under';
  position?: string | null;
  teamId?: number | null;
  season?: number | null;
  researchMode?: NFLResearchMode;
  gameScript?: NFLResearchLayer<NFLGameScriptResearch> | null;
  projectionModel?: NFLProjectionExplanation | null;
  phase3Projection?: number | null;
  phase3Uncertainty?: number | null;
  injuryContext?: NFLInjuryContext | null;
  weatherContext?: NFLWeatherContext | null;
  tendencies?: NFLTeamTendencyEvidence | null;
  now?: Date;
  snapshotOnly?: boolean;
}): NFLGameEnvironmentModel {
  const now = params.now ?? new Date();
  const script = params.gameScript?.value;
  const position = params.position?.toUpperCase() ?? null;
  const family = familyFor(params.market, position);
  const direction = params.direction ?? 'over';
  const homeAway = script?.homeAway ?? null;
  const spread = finite(script?.spread);
  const total = finite(script?.total);
  const candidateSpread = homeAway && spread != null ? homeAway === 'HOME' ? spread : -spread : null;
  const teamTotal = finite(homeAway === 'HOME' ? script?.homeTeamTotal : homeAway === 'AWAY' ? script?.awayTeamTotal : null);
  const opponentTotal = finite(homeAway === 'HOME' ? script?.awayTeamTotal : homeAway === 'AWAY' ? script?.homeTeamTotal : null);
  const retrievedAt = params.gameScript?.provenance?.[0]?.retrievedAt;
  const age = retrievedAt ? now.getTime() - Date.parse(retrievedAt) : null;
  const marketRetrievalStatus = age == null ? 'UNKNOWN' : !Number.isFinite(age) || age < 0 || age > 3600000 ? 'STALE_RETRIEVAL' : 'RECENT_RETRIEVAL';
  const tendency = params.tendencies;
  const rates = tendency ? [tendency.passRate, tendency.rushRate, tendency.leadingPassRate, tendency.trailingPassRate, tendency.closePassRate] : [];
  const tendencyFresh = tendency ? Date.parse(tendency.retrievedAt) <= now.getTime() && now.getTime() - Date.parse(tendency.retrievedAt) <= 86400000 : false;
  const acceptedTendency = tendency && tendency.teamId === params.teamId && tendency.season === params.season && tendency.currentSystemVerified
    && tendency.source.trim() && Number.isFinite(tendency.games) && tendency.games >= 6 && tendencyFresh
    && rates.every((rate) => rate == null || Number.isFinite(rate) && rate >= 0 && rate <= 1)
    && (tendency.passRate == null || tendency.rushRate == null || Math.abs(tendency.passRate + tendency.rushRate - 1) < 0.01)
    && (tendency.playsPerGame == null || Number.isFinite(tendency.playsPerGame) && tendency.playsPerGame > 0) ? tendency : null;
  const injury = params.injuryContext;
  const injuryEvidence = [injury?.player, ...(injury?.teammateAbsences ?? [])].filter((entry) => entry
    && classifyNFLInjuryFreshness(entry.updatedAt ?? injury?.lastUpdated, now) === 'CURRENT'
    && entry.sourceStatus === 'CURRENT' && ['OUT', 'INACTIVE', 'DOUBTFUL', 'QUESTIONABLE'].includes(entry.availabilityDesignation))
    .map((entry) => `${entry!.position ?? 'Position unavailable'} ${entry!.player}: ${entry!.availabilityDesignation}. Role redistribution and play-calling response are not measured; no extra numerical effect.`);
  const isRun = family === 'RB_CARRIES' || family === 'RB_RUSHING';
  const isQBRun = family === 'QB_RUSHING';
  const counterCase = isQBRun ? [
    'Trailing does not guarantee QB rushing: pressure may produce sacks, throwaways or scrambles, and designed-run usage is unverified.',
    'A comfortable lead could reduce starter work; a close game need not create rushing opportunities.',
  ] : isRun ? [
    'An early deficit could reduce carries if the offense switches away from the run; its score-state rush response is not established.',
    'A lead could support rushing or trigger rotation/rest; favorite status alone does not establish this player\'s late carries.',
  ] : family === 'RB_RECEIVING' ? [
    'A comfortable lead could remove passing-down work; a deficit does not help unless this back owns the receiving role.',
    'Trailing could increase passes to WR/TE instead of this back; measured checkdown and target-share evidence is missing.',
  ] : [
    'An early multi-score lead could reduce second-half passing opportunities if the team changes its play calling.',
    'A deficit may require passing, but sacks, stalled drives or opponent possession control could still suppress attempts and targets.',
  ];
  if (total != null) counterCase.push('A high total can come from efficiency rather than extra possessions; a low total does not establish an Under.');
  const potentialBlowout = candidateSpread != null && Math.abs(candidateSpread) >= 10;
  if (potentialBlowout) counterCase.push('A double-digit market spread flags scenario uncertainty, not a generic blowout multiplier; starter rotation/rest evidence is unavailable.');
  if (direction === 'under') counterCase.unshift('Retained or increased player opportunity could defeat this Under. A low-volume script could help, but neither score state nor player allocation is certain.');
  counterCase.push(...injuryEvidence);
  const weather = params.weatherContext;
  const indoor = weather?.environment === 'INDOOR' || weather?.sourceStatus === 'NOT_APPLICABLE';
  if (!indoor && weather?.sourceStatus === 'AVAILABLE' && (weather.wind?.speed ?? 0) >= 20) counterCase.push('Recorded strong wind could affect passing efficiency or play calling; no second numerical wind penalty is applied here.');
  const model = params.projectionModel;
  const expectedOpportunity = model?.expectedOpportunity ?? null;
  const adjustedEfficiency = model?.matchupModel?.adjustedEfficiency ?? model?.expectedEfficiency ?? null;
  const phase3Projection = params.phase3Projection ?? model?.matchupModel?.finalProjection ?? model?.finalProjection ?? null;
  const confidence = acceptedTendency && !injuryEvidence.length ? 'MEDIUM' : marketRetrievalStatus === 'STALE_RETRIEVAL' ? 'UNAVAILABLE'
    : spread != null || total != null || acceptedTendency ? 'LOW' : 'UNAVAILABLE';
  const mode = params.researchMode ?? 'STANDARD';
  const opportunityImpact = isQBRun ? ['Designed-run or scramble opportunity occurs; no magnitude inferred.', 'Recorded QB rushing role; no score-state modifier.', 'Few scrambles or designed runs, or starter workload reduced.']
    : isRun ? ['Carries retained while protecting a lead, if this player keeps the backfield role.', 'Competitive game with recorded historical role.', 'Early deficit or late rotation reduces this player\'s carries.']
      : ['Pass opportunities retained/increased, only if team tendency and player role support it.', 'Competitive game with recorded historical role.', 'Early lead, stalled drives or possession loss reduces passing opportunity.'];
  const evidence = [
    ...(candidateSpread == null ? [] : [`Market candidate spread ${candidateSpread}; expected margin ${-candidateSpread}, not a score-state probability or certainty.`]),
    ...(total == null ? [] : [`Market total ${total}${teamTotal == null ? '' : `; derived team/opponent totals ${teamTotal}/${opponentTotal}`}. These are scoring expectations, not observed pace.`]),
    ...(acceptedTendency ? [`Observed current-system tendencies (${acceptedTendency.source}, ${acceptedTendency.games} games): pass ${acceptedTendency.passRate ?? 'unavailable'}, rush ${acceptedTendency.rushRate ?? 'unavailable'}, leading pass ${acceptedTendency.leadingPassRate ?? 'unavailable'}, trailing pass ${acceptedTendency.trailingPassRate ?? 'unavailable'}, close pass ${acceptedTendency.closePassRate ?? 'unavailable'}. Historical averages are not upcoming volume.`] : []),
    `Season phase ${model?.seasonPhase ?? 'UNAVAILABLE'} supplies uncertainty context only; no must-win, playoff or season bonus.`,
    ...(indoor ? ['Indoor environment; no outdoor-weather adjustment.'] : []),
  ];
  return {
    modelVersion: NFL_GAME_ENVIRONMENT_MODEL_VERSION, historicalModelVersion: model ? 'nfl_weighted_history_v1' : 'UNAVAILABLE',
    opportunityModelVersion: model?.modelVersion ?? null, matchupModelVersion: model?.matchupModel?.modelVersion ?? null,
    probabilityModelVersion: model?.probabilityModelVersion ?? null, calibrationStatus: 'UNVALIDATED', evaluatedAt: now.toISOString(),
    snapshotOnly: params.snapshotOnly ?? false, researchMode: mode, market: params.market, direction, family, confidence,
    status: confidence === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'PARTIAL',
    inputs: { teamId: params.teamId ?? null, season: params.season ?? null, seasonPhase: model?.seasonPhase ?? 'UNAVAILABLE', homeAway,
      homeSpread: spread, candidateSpread, total, teamTotal, opponentTeamTotal: opponentTotal, expectedLeader: script?.expectedLeader ?? null,
      expectedMargin: candidateSpread == null ? null : -candidateSpread, moneyline: null, marketRetrievalStatus,
      marketProvenance: params.gameScript?.provenance ?? [], observedTendencies: acceptedTendency,
      weather: weather ? { environment: weather.environment, windMph: indoor ? null : weather.wind?.speed ?? null, sourceStatus: weather.sourceStatus } : null, injuryEvidence },
    expectedScoringEnvironment: total == null ? 'UNAVAILABLE' : total >= 50 ? 'HIGH_MARKET_TOTAL' : total <= 40 ? 'LOW_MARKET_TOTAL' : 'MARKET_TOTAL_AVAILABLE',
    expectedScript: candidateSpread == null ? 'UNAVAILABLE' : candidateSpread < 0 ? 'MARKET_FAVORITE' : candidateSpread > 0 ? 'MARKET_UNDERDOG' : 'MARKET_PICK_EM',
    potentialBlowout, expectedTeamVolume: { plays: null, passAttempts: null, rushAttempts: null, possessions: null },
    passRushEnvironment: acceptedTendency ? 'Observed tendencies available; current-game play volume and calibrated score-state mixture unavailable.' : 'Leading/trailing behavior is conditional and unmeasured; no pass/rush advantage assigned.',
    priorities: PRIORITIES[family], evidence, counterCase,
    scenarios: mode === 'DEEP' ? (['FAVORABLE', 'BASE', 'ADVERSE'] as const).map((name, index) => {
      const scenarioIndex = direction === 'under' ? 2 - index : index;
      return { name,
        scoreState: scenarioIndex === 1 ? 'Competitive / close' : isQBRun ? 'QB role-dependent, score state insufficient' : isRun ? scenarioIndex === 0 ? 'Leading' : 'Trailing or late rotation' : scenarioIndex === 0 ? 'Competitive or trailing' : 'Early lead or possession deficit',
        opportunityImpact: opportunityImpact[scenarioIndex], evidenceStatus: 'CONDITIONAL_UNVALIDATED', probability: null, projection: null };
    }) : [],
    robustness: 'NOT_QUANTIFIED', phase2Opportunity: expectedOpportunity, expectedPlayerOpportunity: expectedOpportunity, targetShare: null,
    matchupAdjustedEfficiency: adjustedEfficiency, phase3Projection, phase3Uncertainty: params.phase3Uncertainty ?? model?.uncertainty ?? null,
    gameEnvironmentOpportunityProjection: model?.opportunityProjection == null ? null
      : model.matchupModel?.efficiencyAdjustment ? model.matchupModel.matchupOpportunityProjection : model.opportunityProjection,
    volumeAdjustment: 0, projectionAdjustment: 0, adjustmentLimit: 0, finalProjection: phase3Projection,
    formula: 'O4 = O2 + 0; deltaProduction = Phase2Blend * (O4 - O2) * Phase3Efficiency = 0; final = Phase3Final + deltaProduction. TeamVolume and targetShare remain null until measured and validated.',
    adjustmentReason: 'Zero volume adjustment: no validated current-game team-volume / score-state response model or verified player share is connected. Preserve Phase2 role opportunity and Phase3 efficiency/projection.',
    missingInputs: [...(spread == null ? ['spread / expected leader'] : []), ...(total == null ? ['game total / derived team totals'] : []),
      'moneyline', 'verified game-market quote update timestamp', ...(marketRetrievalStatus === 'STALE_RETRIEVAL' ? ['fresh game-market retrieval'] : []),
      ...(homeAway == null ? ['candidate team side'] : []), 'expected offensive plays', 'expected team pass/rush attempts', 'possessions', 'seconds per play', 'neutral-situation pace',
      'neutral pass/rush rates', 'PROE', ...(!acceptedTendency ? ['observed current-system pass/rush rates', 'leading/trailing/close-game tendencies', 'coaching continuity'] : []),
      'red-zone trips and player role', 'red-zone pass/rush tendencies', 'fourth-down aggression', 'explosive-play tendencies', 'scoring rate', 'turnover rate',
      ...(['RB_RECEIVING', 'RECEPTIONS', 'RECEIVING_YARDS'].includes(family) ? ['verified current-game target share'] : []),
      ...(isQBRun ? ['designed-run/scramble splits', 'red-zone QB rushing'] : []),
      ...(potentialBlowout ? ['verified starter rotation/rest response'] : []), 'validated team-volume response / score-state mixture'],
    antiDoubleCounting: ['Game environment may inform team volume, never prop value directly.',
      'Team volume must reach player opportunity through one verified allocation; no independent team/player boost.',
      'Phase2 role opportunity stays the fallback and is not added twice.', 'Phase3 efficiency stays unchanged; no second matchup bonus.',
      'Spread and total are context only, not additional projection multipliers.',
      'Weather and injuries are qualitative here; existing risk/availability owners remain authoritative.',
      'Season phase, must-win and playoffs receive no numerical bonus.', 'Final projection feeds unchanged probability, value and tier logic.'],
  };
}