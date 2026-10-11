import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLGame, NFLGameLogEntry } from './types';

export type NFLSeasonPhase = 'EARLY_REGULAR_SEASON' | 'MID_REGULAR_SEASON' | 'LATE_REGULAR_SEASON' | 'PLAYOFFS' | 'UNAVAILABLE';
export type NFLSeasonContextImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNCERTAINTY' | 'UNAVAILABLE';

export interface NFLSeasonContext {
  season: number | null;
  week: number | null;
  gameNumber: number | null;
  gameNumberBasis: 'PLAYER_SEASON_APPEARANCE' | null;
  phase: NFLSeasonPhase;
  playoffRound: NFLGame['playoffRound'];
  teamSituation: string | null;
  playerContext: string[];
  phaseHistory: string[];
  impact: NFLSeasonContextImpact;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  projectionAdjustment: null;
  missingData: string[];
  notes: string[];
}

export interface NFLSeasonContextInput {
  game: Pick<NFLGame, 'season' | 'week' | 'seasonType' | 'playoffRound'>;
  player: string;
  playerTeamId: number | null;
  position: string | null;
  market: NFLAnalyzableMarketKey;
  direction: 'over' | 'under';
  line: number;
  logs: NFLGameLogEntry[];
  roleStatus: string;
  roleWorkloadTrend: string;
}

export function classifyNFLSeasonPhase(game: NFLSeasonContextInput['game']): NFLSeasonPhase {
  if (game.seasonType === 'POSTSEASON') return 'PLAYOFFS';
  if (game.week == null || !Number.isFinite(game.week) || game.week < 1 || game.week > 18) return 'UNAVAILABLE';
  if (game.seasonType != null && game.seasonType !== 'REGULAR') return 'UNAVAILABLE';
  if (game.week <= 4) return 'EARLY_REGULAR_SEASON';
  if (game.week <= 13) return 'MID_REGULAR_SEASON';
  return 'LATE_REGULAR_SEASON';
}

const PHASE_LABEL: Record<NFLSeasonPhase, string> = {
  EARLY_REGULAR_SEASON: 'Early Regular Season', MID_REGULAR_SEASON: 'Mid Regular Season',
  LATE_REGULAR_SEASON: 'Late Regular Season', PLAYOFFS: 'Playoffs', UNAVAILABLE: 'Unavailable',
};

function phaseForLog(log: NFLGameLogEntry): NFLSeasonPhase {
  if (log.week == null) return 'UNAVAILABLE';
  if (log.week <= 4) return 'EARLY_REGULAR_SEASON';
  if (log.week <= 13) return 'MID_REGULAR_SEASON';
  return 'LATE_REGULAR_SEASON';
}

export function buildNFLSeasonContext(input: NFLSeasonContextInput): NFLSeasonContext {
  const phase = classifyNFLSeasonPhase(input.game);
  const season = input.game.season ?? input.logs.find((log) => log.historySource !== 'PREVIOUS_SEASON')?.season ?? null;
  const currentSeason = input.logs.filter((log) => log.result != null && log.historySource !== 'PREVIOUS_SEASON'
    && (season == null || log.season == null || log.season === season));
  const matchingRole = currentSeason.filter((log) => (input.playerTeamId == null || log.teamId == null || log.teamId === input.playerTeamId)
    && (input.position == null || log.position == null || log.position.toUpperCase() === input.position.toUpperCase()));
  const playerGameNumber = matchingRole.length + 1;
  const priorTeamRoleGames = matchingRole.filter((log) => log.teamId != null && input.playerTeamId != null && log.teamId === input.playerTeamId
    && log.position != null && input.position != null && log.position.toUpperCase() === input.position.toUpperCase()).length;
  const currentPhaseLogs = phase === 'PLAYOFFS' ? [] : matchingRole.filter((log) => phaseForLog(log) === phase);
  const phaseValues = currentPhaseLogs.map((log) => getNFLMarketHistoricalValue(input.market, log.stats))
    .filter((value): value is number => value != null && Number.isFinite(value));
  const phaseHits = phaseValues.filter((value) => input.direction === 'over' ? value > input.line : value < input.line).length;
  const phaseDecisions = phaseValues.filter((value) => value !== input.line).length;
  const phaseHitRate = phaseDecisions > 0 ? Number((phaseHits / phaseDecisions * 100).toFixed(1)) : null;
  const comparablePriorLogs = input.logs.filter((log) => log.result != null && log.historySource === 'PREVIOUS_SEASON'
    && log.teamId != null && input.playerTeamId != null && log.teamId === input.playerTeamId
    && log.position != null && input.position != null && log.position.toUpperCase() === input.position.toUpperCase());
  const earlyValues = matchingRole.filter((log) => phaseForLog(log) === 'EARLY_REGULAR_SEASON')
    .map((log) => getNFLMarketHistoricalValue(input.market, log.stats)).filter((value): value is number => value != null && Number.isFinite(value));
  const earlyDecisions = earlyValues.filter((value) => value !== input.line).length;
  const earlyHitRate = earlyDecisions ? earlyValues.filter((value) => input.direction === 'over' ? value > input.line : value < input.line).length / earlyDecisions * 100 : null;
  const phaseHistory: string[] = [];
  const playerContext: string[] = [];
  const missingData = [
    'team standings, clinching/elimination status, must-win context, and player rest/snap-limit intent',
    'coaching/coordinator tenure, offseason system changes, and scheme continuity across seasons',
    'snap/route participation, personnel packages, and team pace/pass/rush tendencies by phase',
    'opponent-adjusted, role-controlled market-specific early/mid/late/playoff prop baselines',
    'playoff-versus-regular-season rotation, fourth-down, red-zone, and matchup-familiarity evidence',
    'measurable cumulative workload/fatigue and accumulated-injury effects against player baseline',
    ...(phase === 'PLAYOFFS' && input.game.playoffRound == null ? ['specific postseason round'] : []),
  ];
  const notes: string[] = [];

  if (phase === 'UNAVAILABLE') missingData.push('authoritative season type or regular-season week');
  else playerContext.push(`Role status entering this game: ${input.roleStatus}; workload trend: ${input.roleWorkloadTrend}.`);
  if (currentSeason.length > 0) playerContext.push(`${currentSeason.length} current-season player game logs are available before this game; next appearance is player game ${playerGameNumber}.`);
  if (priorTeamRoleGames > 0) playerContext.push(`${priorTeamRoleGames} current-season logs match the player's current team and position; exact scheme continuity is not available.`);
  if (phase === 'EARLY_REGULAR_SEASON' && currentSeason.length < 5) {
    notes.push(`Early-season uncertainty: only ${currentSeason.length} current-season games are available. Prior-season observations are not presumed comparable without verified role/system continuity.`);
  }
  if (input.roleStatus !== 'STABLE' && input.roleStatus !== 'UNAVAILABLE') {
    notes.push(`Current role is ${input.roleStatus} (${input.roleWorkloadTrend}); season phase does not establish role stability.`);
  }
  if (phase === 'LATE_REGULAR_SEASON' && input.game.week != null) {
    notes.push(`Week ${input.game.week} late-season rest, fatigue, playoff-position, and workload effects are not inferred because standings/rest evidence is unavailable.`);
  }
  if (phase === 'PLAYOFFS') {
    notes.push('Postseason usage changes are not assumed; no calibrated player/market playoff adjustment is available.');
    if (input.game.playoffRound) notes.push(`Schedule identifies ${input.game.playoffRound.toLowerCase().replaceAll('_', ' ')} round.`);
  }
  if (phaseHitRate != null && phaseDecisions >= 3) {
    phaseHistory.push(`${PHASE_LABEL[phase]} exact-line history: ${phaseHits}/${phaseDecisions} decisions (${phaseHitRate}%) across ${phaseDecisions} usable player-game observations.`);
    if (phase === 'MID_REGULAR_SEASON' && earlyHitRate != null && earlyDecisions >= 3) {
      phaseHistory.push(`Early-season comparison: ${earlyHitRate.toFixed(1)}% across ${earlyDecisions} observations versus ${phaseHitRate}% in this phase; current-team/position match only, with coaching/system and opponent adjustments unavailable.`);
      notes.push('Phase hit-rate differences are descriptive only; the sample is not a validated out-of-sample effect and does not change projection or probability.');
    }
  } else {
    phaseHistory.push(`No sufficient ${PHASE_LABEL[phase].toLowerCase()} exact-line sample for this player/market; no phase hit-rate claim is made.`);
  }
  const priorPhaseValues = comparablePriorLogs.filter((log) => phase !== 'PLAYOFFS' && phaseForLog(log) === phase)
    .map((log) => getNFLMarketHistoricalValue(input.market, log.stats)).filter((value): value is number => value != null && Number.isFinite(value));
  const priorPhaseDecisions = priorPhaseValues.filter((value) => value !== input.line).length;
  if (priorPhaseDecisions >= 3) {
    const priorHits = priorPhaseValues.filter((value) => input.direction === 'over' ? value > input.line : value < input.line).length;
    phaseHistory.push(`Prior-season same-team/position ${PHASE_LABEL[phase].toLowerCase()} exact-line history: ${priorHits}/${priorPhaseDecisions} decisions (${(priorHits / priorPhaseDecisions * 100).toFixed(1)}%) at this line; QB/coaching/system continuity and injury context are uncontrolled, so descriptive only.`);
  }
  if (currentSeason.length < 5) notes.push(`Small current-season sample (${currentSeason.length} games) increases uncertainty; previous-season data is downweighted by the existing history model, not treated as a full current-season sample.`);

  return {
    season, week: input.game.week, gameNumber: currentSeason.length ? playerGameNumber : null,
    gameNumberBasis: currentSeason.length ? 'PLAYER_SEASON_APPEARANCE' : null,
    phase, playoffRound: input.game.playoffRound ?? null, teamSituation: null, playerContext, phaseHistory,
    impact: phase === 'UNAVAILABLE' ? 'UNAVAILABLE' : currentSeason.length < 5 ? 'UNCERTAINTY' : 'NEUTRAL',
    confidence: currentSeason.length >= 10 && phaseHistory.some((item) => item.includes('versus')) ? 'MEDIUM' : phase === 'UNAVAILABLE' ? 'UNKNOWN' : 'LOW',
    projectionAdjustment: null, missingData, notes,
  };
}
