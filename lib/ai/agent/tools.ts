import { runFinderDeepSearch, type FinderResult, type FinderRunSummary } from '../../finder/engine';
import { isAutomaticOddsRefreshEnabled } from '../../odds/autoRefreshLedger';
import { withResearchStage } from '../../reliability/researchFailure';
import { runNFLFinderDeepSearch, type NFLFinderSummary, type NFLFinderOptions } from '../../finder/nflEngine';
import { runNBAFinderDeepSearch, type NBAFinderSummary, type NBACandidate } from '../../finder/nbaEngine';
import { getMLBSchedule } from '../../mlb/schedule';
import { getNFLSchedule, getNFLUpcomingGameDate } from '../../nfl/schedule';
import { getNFLTeams } from '../../nfl/teams';
import { getNBASchedule } from '../../nba/schedule';
import { getMLBPlayer, searchMLBPlayers } from '../../mlb/players';
import { getPlayerGameLogs } from '../../mlb/stats';
import { searchNFLPlayers } from '../../nfl/players';
import { getPlayerGameLogs as getNFLPlayerGameLogs, getPlayerRoleWorkloadLogs } from '../../nfl/stats';
import { buildNFLPlayerWorkloadProfile } from '../../nfl/roleContext';
import { buildNFLOpponentContext, getNFLOpponentDefenseGames } from '../../nfl/opponentContext';
import { buildNFLInjuryContext, getNFLInjurySnapshot, isNFLPlayerAvailabilityKnown } from '../../nfl/injuries';
import { getNFLParticipationSnapshot, evaluateNFLParticipation } from '../../nfl/participation';
import { assignNFLDisplayRanks, groupNFLUnderlyingPlays } from '../../nfl/underlyingPlays';
import { getNFLWeatherContext } from '../../nfl/weather';
import { searchNBAPlayers } from '../../nba/players';
import { getNBAPlayerGameLogs } from '../../nba/stats';
import { classifyNBAMarketIntent, unsupportedNBAGameLineNotice } from '../../nba/prediction/marketIntent';
import { rankNBARecommendations } from '../../nba/prediction/ranking';
import { NFL_QB_MARKETS, NFL_RB_MARKETS, NFL_WR_TE_MARKETS, NFL_KICKER_MARKETS, NFL_DEFENSE_MARKETS, NFL_ELITE_MARKETS, type NFLAnalyzableMarketKey } from '../../nfl/oddsTypes';
import { SPORT_RESEARCH_ADAPTERS, detectSport, normalizeSport, type SupportedSport } from '../sportResearchAdapters';
import { getSportFilterRegistration, isSportResearchImplemented } from '../sportFilterRegistry';
import { applyNFLHardGatesToAnalysis } from '../../nfl/researchModel';
import { OddsBudgetGuardError, OddsRefreshNotAuthorizedError, withAutomaticOddsRefresh } from '../../odds/client';
import { addDaysToSlateDate, todaySlateDate, type SlateDate } from '../../dateModel';
import { resolveDateFromText, type ResolvedDate } from '../dateResolver';
import { fail, ok, type ToolResult } from './status';
import { buildResearchSession, buildResearchSessionFromCandidates, getClosestMisses, type ResearchCandidateRecord, type ResearchSession, type GenericResearchCandidate } from './session';
import { saveResearchSession } from './sessionStore';
import { getCachedMLBPrimaryMarkets } from '../../finder/engine';
import { nflNameMatches, parseNFLRequestScope, type NFLMarketFamily, type NFLRequestScope } from './nflRequestScope';
import { classifyPickTier, queryRequestsPasses, qualityFloorFromQuery, tierMeetsFloor, type PickTier } from './pickTiers';
import { matchesNFLLowThreshold, type NFLResearchMode } from '../../nfl/researchIntent';
import { evaluateNFLSavedResearchMode } from '../../nfl/researchMode';
import { isNFLInjuryContextFresh } from '../../nfl/injuries';
import { requestedMLBTeams, isMLBGameMarketRequest } from '../../../communication/intent';
import { isNFLGameResearchPublishable } from '../../nfl/partialCoverage';

export const MAX_RESULTS_CEILING = 15;

export function nbaFinderCandidateToGeneric(candidate: NBACandidate): GenericResearchCandidate {
  return {
    candidateId: candidate.id, playerId: candidate.playerId, teamId: candidate.teamId ?? null, player: candidate.playerName, team: candidate.team, opponent: candidate.opponent,
    gameId: candidate.gameId,
    marketLabel: candidate.marketLabel, marketKey: candidate.market, line: candidate.line, direction: candidate.side,
    book: candidate.book, odds: candidate.oddsAmerican, projection: candidate.nbaPrediction?.expectedStat ?? null,
    projectionUncertainty: candidate.nbaPrediction?.statUncertainty ?? null,
    l5Rate: candidate.history?.windows.l5.rate ?? null, l10Rate: candidate.history?.windows.l10.rate ?? null,
    l20Rate: candidate.history?.windows.l20.rate ?? null, seasonRate: candidate.history?.windows.season.rate ?? null,
    sampleSize: candidate.nbaPrediction?.sampleSize ?? 0,
    average: candidate.history?.windows.season.mean ?? null, median: candidate.history?.windows.season.median ?? null,
    homeHitRate: candidate.history?.splits?.home.rate ?? null, awayHitRate: candidate.history?.splits?.away.rate ?? null,
    nbaHistory: candidate.history, nbaResearchEvidence: candidate.researchEvidence ?? null,
    analysis: candidate.eliteAnalysis!, nbaPrediction: candidate.nbaPrediction, sport: 'nba',
    matchupAvailable: candidate.opponentContext != null && candidate.opponentContext.status !== 'UNAVAILABLE',
    roleKnown: candidate.researchContext?.sections.rotation.recentRole !== 'UNKNOWN' && candidate.researchContext != null,
    injuryKnown: candidate.researchContext?.sections.availability.state === 'AVAILABLE',
    nbaInjuryEvidence: candidate.injuryEvidence,
    injuryContext: candidate.researchContext?.sections.availability.status === 'AVAILABLE'
      ? { source: 'NBAResearchContext v1', status: candidate.researchContext.sections.availability.status,
        evidenceIds: candidate.researchContext.sections.availability.evidenceIds }
      : null,
    outlierDependencePercent: candidate.outlierDependency?.available ? candidate.outlierDependency.explosiveDependencePercent : null,
    crossBookDiscrepancy: candidate.crossBookThreshold?.available ? candidate.crossBookThreshold.discrepancy : null,
    marketMovementAvailable: candidate.marketMovement.available,
    howItLoses: candidate.howItLoses,
    position: candidate.position,
    projectionReliability: candidate.nbaPrediction?.reliability ?? 'UNRELIABLE',
    crossBookThreshold: candidate.crossBookThreshold,
    marketMovement: candidate.marketMovement,
    outlierAnalysis: candidate.outlierDependency ? {
      applicability: 'APPLICABLE', available: candidate.outlierDependency.available,
      sampleGames: candidate.outlierDependency.sampleGames, explosiveDependencePercent: candidate.outlierDependency.explosiveDependencePercent,
    } : null,
    roleContext: candidate.researchContext ? {
      requirement: 'Observed role evidence only; no future minutes assignment is asserted.',
      status: candidate.researchContext.sections.rotation.recentRole,
      confidence: candidate.nbaPrediction?.reliability ?? 'UNAVAILABLE',
      workloadTrend: candidate.nbaPrediction?.reasons.find((reason) => reason.includes('ROLE')) ?? 'UNAVAILABLE',
      reasons: candidate.nbaPrediction?.reasons ?? [],
      evidence: candidate.researchContext.sections.rotation.evidenceIds.map((id) => candidate.researchContext!.evidence.find((entry) => entry.id === id)?.detail).filter((value): value is string => !!value),
      unavailableEvidence: candidate.researchContext.coverage.missing,
    } : null,
    opponentContext: candidate.opponentContext ? {
      status: candidate.opponentContext.status, availableMetrics: candidate.opponentContext.availableMetrics,
      unavailableMetrics: candidate.opponentContext.unavailableMetrics, evidence: candidate.opponentContext.evidence,
    } : null,
    bestAlternateLine: candidate.alternateLines?.recommended ? {
      line: candidate.alternateLines.recommended.line, side: candidate.alternateLines.recommended.side,
      bestBook: candidate.alternateLines.recommended.bestBook, bestOdds: candidate.alternateLines.recommended.bestOdds,
      trueProbability: candidate.alternateLines.recommended.trueProbability, breakEvenProbability: candidate.alternateLines.recommended.breakEvenProbability,
      edgePercent: candidate.alternateLines.recommended.edgePercent, band: candidate.alternateLines.recommended.band,
    } : null,
    retrievedAt: candidate.priceTimestamp,
  };
}

/** Which sports can actually produce Elite candidates today, and which only have partial data. */
const SPORT_STATUS: Record<SupportedSport, { props: boolean; schedule: boolean; note: string }> = {
  mlb: { props: true, schedule: true, note: 'Fully operational: schedule, sportsbook props, research and Elite Filter.' },
  nfl: { props: true, schedule: true, note: 'Schedule, sportsbook props (where cached), player matching, ESPN attempt/target workload, baseline projection and Elite Filter are connected. Snap share and depth-chart status remain unavailable.' },
  nba: { props: true, schedule: true, note: 'NBA_MODEL_V1 researches supported player props with phase-aware ESPN history, bounded NBAResearchContext and versioned intelligence evidence. Game-line moneylines/spreads/totals are unsupported without timestamped quotes and validated game-line probabilities.' },
  soccer: { props: false, schedule: false, note: 'Research adapter defined only. No data source connected.' },
  tennis: { props: false, schedule: false, note: 'Research adapter defined only. No data source connected.' },
};

/** Carried across one chat turn so repeated tool calls reuse a single expensive slate run. */
export interface AgentContext {
  runs: Map<string, FinderRunSummary>;
  /** The AI's persistent structured research memory, seeded from the server-side session store and updated on new searches. */
  researchSession: ResearchSession | null;
  /** The ID the client holds for researchSession — never the full object. Set/replaced when a new search runs. */
  researchSessionId: string | null;
  /** The triggering user message for this turn, recorded on the session when new research runs. */
  pendingQueryIntent: string;
  /** One explicit UI approval; never persisted and never read from the environment. */
  refreshApproval: { sport: SupportedSport; date: string; maxCredits: number; maxGames?: number; selectedGameIds?: string[] } | null;
  /** Resolved once from the user's message; overrides any date/sport the model passes. */
  canonicalDate: ResolvedDate | null;
  canonicalSport: SupportedSport | null;
  nflScope: NFLRequestScope | null;
  nflResearchIncomplete: boolean;
}

export function createAgentContext(seed?: ResearchSession | null, seedId?: string | null, refreshApproval?: AgentContext['refreshApproval']): AgentContext {
  return { runs: new Map(), researchSession: seed ?? null, researchSessionId: seedId ?? null, pendingQueryIntent: '', refreshApproval: refreshApproval ?? null, canonicalDate: null, canonicalSport: null, nflScope: null, nflResearchIncomplete: false };
}

/** Pins the request's date and sport from the user's own words before any tool runs. */
export function applyRequestScope(context: AgentContext, query: string, today: SlateDate = todaySlateDate()) {
  context.pendingQueryIntent = query;
  context.canonicalDate = resolveDateFromText(query, today);
  context.canonicalSport = detectSport(query);
  const scope = parseNFLRequestScope(query);
  if (!context.canonicalSport && (scope.teams.length > 0 || scope.marketFamily != null || context.researchSession?.sport === 'nfl')) context.canonicalSport = 'nfl';
  context.nflScope = context.canonicalSport === 'nfl' || (!context.canonicalSport && scope.playerQuery) ? scope : null;
}

export async function prepareNFLRequestScope(context: AgentContext, search = searchNFLPlayers): Promise<string | null> {
  const scope = context.nflScope;
  if (!scope || scope.clarification) return scope?.clarification ?? null;
  if (scope.playerQuery && !scope.playerName) {
    const cached = context.researchSession?.sport === 'nfl'
      ? context.researchSession.candidates.filter((candidate) => nflNameMatches(scope.playerQuery!, candidate.player)) : [];
    const names = [...new Set(cached.map((candidate) => candidate.player))];
    const identities = new Set(cached.map((candidate) => `${candidate.playerId}|${candidate.team}|${candidate.player}`));
    if (names.length === 1 && identities.size === 1 && cached[0].team) {
      scope.playerId = cached[0].playerId;
      scope.playerName = names[0];
      scope.playerTeam = cached[0].team;
      scope.playerTeamId = cached[0].teamId ?? null;
    } else {
      const matches = await search(scope.playerQuery).catch(() => []);
      const confident = matches.filter((player) => nflNameMatches(scope.playerQuery!, player.name));
      if (confident.length !== 1 || !confident[0].team) {
        scope.clarification = `Which NFL player do you mean by "${scope.playerQuery}" (full name and team)?`;
        return scope.clarification;
      }
      scope.playerId = confident[0].id;
      scope.playerName = confident[0].name;
      scope.playerTeam = confident[0].team.displayName;
      scope.playerTeamId = confident[0].team.id;
    }
    context.canonicalSport = 'nfl';
  }
  if (!context.canonicalDate && (scope.playerTeam || scope.teams.length > 0)) {
    try {
      const names = [...new Set([...scope.teams, ...(scope.playerTeam ? [scope.playerTeam] : [])])];
      const teams = scope.playerTeamId != null && names.length === 1
        ? [{ id: scope.playerTeamId, displayName: scope.playerTeam! }] : await getNFLTeams();
      const ids = names.map((name) => teams.find((team) => team.displayName.toLowerCase() === name.toLowerCase())?.id);
      const date = ids.every((id): id is number => id != null) ? await getNFLUpcomingGameDate(ids) : null;
      if (date) context.canonicalDate = resolveDateFromText(date);
      else scope.clarification = 'No upcoming game was found for that player or matchup. Which NFL game or date do you mean?';
    } catch {
      scope.clarification = 'DeepSide could not confirm the upcoming game. Which NFL game or date do you mean?';
    }
  }
  return scope.clarification;
}

export { detectSport };

function resolveDate(input?: string | null, context?: AgentContext): { date: SlateDate } | { error: string } {
  if (context?.canonicalDate) return { date: context.canonicalDate.resolvedDate };
  const today = todaySlateDate();
  const resolved = resolveDateFromText((input ?? 'today').trim(), today)?.resolvedDate;
  if (!resolved) return { error: 'Which day should DeepSide research?' };
  // Model-chosen dates are untrusted (they can come from stale training knowledge).
  const plausible = resolved === context?.researchSession?.date
    || (resolved >= addDaysToSlateDate(today, -1) && resolved <= addDaysToSlateDate(today, 14));
  return { date: plausible ? resolved : today };
}

function resolveSport(input: string | undefined, context?: AgentContext): SupportedSport | null {
  return context?.canonicalSport ?? normalizeSport(input ?? 'mlb');
}

async function loadRun(context: AgentContext, sport: SupportedSport, date: string, options: NFLFinderOptions = {}): Promise<FinderRunSummary> {
  const key = `${sport}:${date}:${JSON.stringify(options)}`;
  const existing = context.runs.get(key);
  if (existing) return existing;
  const registration = getSportFilterRegistration(sport);
  if (!registration || !isSportResearchImplemented(sport)) throw new Error(`The ${sport} research filter is not implemented.`);
  const summary = registration.implementation === 'NFL_RESEARCH_MODEL' ? await runNFLFinderDeepSearch(date, options)
    : registration.implementation === 'EXISTING_NBA_ENGINE' ? await runNBAFinderDeepSearch(date, options)
      : registration.implementation === 'EXISTING_MLB_ENGINE' ? await runFinderDeepSearch(date, options)
        : (() => { throw new Error(`The ${sport} research filter is not implemented.`); })();
  context.runs.set(key, summary);
  return summary;
}

const COMPLETED_MLB_STATUS = /final|game over|completed|postponed|cancell?ed|suspended/i;
const PREGAME_MLB_STATUS = /^(?:scheduled|pre-game|warmup|delayed start)/i;

/** Pregame props come down at first pitch, so a started game cannot be researched as a pregame play. */
export function hasMLBGameStarted(game: { status: string; gameTime?: string | null }, now = Date.now()): boolean {
  if (/in progress|manager challenge|review/i.test(game.status)) return true;
  const start = Date.parse(game.gameTime ?? '');
  return Number.isFinite(start) && start <= now && !PREGAME_MLB_STATUS.test(game.status);
}

async function runPreflight(sport: SupportedSport, date: string, forceProviderRefresh = false, marketKeys?: NFLAnalyzableMarketKey[] | null): Promise<FinderRunSummary> {
  const options: NFLFinderOptions = { preflight: true, forceProviderRefresh, ...(sport === 'nfl' && marketKeys ? { marketKeys } : {}) };
  const registration = getSportFilterRegistration(sport);
  if (!registration || !isSportResearchImplemented(sport)) throw new Error(`The ${sport} research filter is not implemented.`);
  if (registration.implementation === 'NFL_RESEARCH_MODEL') return runNFLFinderDeepSearch(date, options);
  if (registration.implementation === 'EXISTING_NBA_ENGINE') return runNBAFinderDeepSearch(date, options);
  if (registration.implementation === 'EXISTING_MLB_ENGINE') return runFinderDeepSearch(date, options);
  throw new Error(`The ${sport} research filter is not implemented.`);
}

// ── tool implementations ──────────────────────────────────────────────────────

async function getSportCapabilities(): Promise<ToolResult<unknown>> {
  return ok(
    Object.entries(SPORT_STATUS).map(([sport, status]) => ({
      sport,
      label: SPORT_RESEARCH_ADAPTERS[sport as SupportedSport].label,
      canProduceCandidates: status.props,
      hasSchedule: status.schedule,
      note: status.note,
        sportFilter: getSportFilterRegistration(sport)?.sportFilter ?? sport.toUpperCase(),
        sportFilterId: getSportFilterRegistration(sport)?.filterId ?? null,
        sportFilterVersion: getSportFilterRegistration(sport)?.version ?? null,
        implementation: getSportFilterRegistration(sport)?.implementation ?? 'NOT_IMPLEMENTED',
      supportedMarkets: SPORT_RESEARCH_ADAPTERS[sport as SupportedSport].marketSupport,
    })),
  );
}

async function getSlate(context: AgentContext, args: { sport?: string; date?: string }): Promise<ToolResult<unknown>> {
  const sport = resolveSport(args.sport, context);
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);
  const resolved = resolveDate(args.date, context);
  if ('error' in resolved) return fail('INVALID_DATE', resolved.error, { sport });

  const nbaMarkets = sport === 'nba' ? classifyNBAMarketIntent(context.pendingQueryIntent) : null;
  if (nbaMarkets?.gameLineMarkets.length) {
    const summary = await runNBAFinderDeepSearch(resolved.date, { gameLines: true, gameLinesOnly: nbaMarkets.gameLinesOnly });
    context.researchSession = buildResearchSessionFromCandidates({ sport: 'nba', date: resolved.date, queryIntent: context.pendingQueryIntent,
      candidates: summary.nbaCandidates.filter(candidate => candidate.playerMatch === 'MATCHED' && candidate.eliteAnalysis != null).map(nbaFinderCandidateToGeneric),
      toolMeta: { gamesFound: summary.gamesAnalyzed, gamesScheduled: summary.gamesScheduled, propsFound: summary.propsAnalyzed,
        booksFound: summary.booksAnalyzed, candidatesFound: summary.nbaCandidates.length, cached: summary.fromCache,
        dataFreshnessSeconds: summary.cacheAgeMs == null ? null : summary.cacheAgeMs / 1000, budgetLimited: summary.budgetLimited } });
    context.researchSession.gameCandidates = summary.gameCandidates ?? [];
    context.researchSession.modeledGames = summary.modeledGames ?? [];
    context.researchSessionId = await saveResearchSession(context.researchSession);
    return ok({ loaded: true, candidatesFound: context.researchSession.candidates.length + context.researchSession.gameCandidates.length,
      modeledGames: context.researchSession.modeledGames, nextStep: 'Call rank_candidates; unpriced team research is not a recommendation.' },
      { sport: 'nba', date: resolved.date, researchComplete: true });
  }

  const status = SPORT_STATUS[sport];
  if (!status.schedule) return fail('SPORT_UNAVAILABLE', status.note, { sport, date: resolved.date });

  try {
    const games = sport === 'nfl'
      ? (await getNFLSchedule({ date: resolved.date })).map((g) => ({ id: String(g.id), status: g.completed ? 'Final' : 'Scheduled', home: g.homeTeam?.name, away: g.awayTeam?.name, gameTime: g.gameTime }))
      : sport === 'nba'
        ? (await getNBASchedule(resolved.date)).map((g) => ({ id: String(g.id), status: g.completed ? 'Final' : 'Scheduled', home: g.homeTeam.name, away: g.awayTeam.name, gameTime: g.gameTime }))
        : (await getMLBSchedule(resolved.date)).map((g) => ({ id: g.id, status: g.status, home: g.homeTeam.name, away: g.awayTeam.name, gameTime: g.gameTime }));
    const live = games.filter((g) => !/final|game over|completed|postponed|cancell?ed|suspended/i.test(g.status ?? ''));
    if (games.length > 0 && live.length === 0) {
      return fail('SLATE_COMPLETE', `Every game on ${resolved.date} has already finished, so sportsbooks no longer offer props.`, {
        sport, date: resolved.date, gamesScheduled: games.length, gamesFound: 0,
      });
    }
    return ok({ games, bettableGames: live.length }, { sport, date: resolved.date, gamesFound: live.length, gamesScheduled: games.length });
  } catch (error) {
    return fail('PROVIDER_ERROR', error instanceof Error ? error.message : 'Schedule provider failed.', { sport, date: resolved.date });
  }
}

export function hasNFLRequestedMarketCoverage(session: ResearchSession, requestedMarkets: readonly string[] = NFL_ELITE_MARKETS): boolean {
  const ledger = session.toolMeta.nflLedger;
  if (!ledger) return !requestedMarkets.some((market) => market === 'player_field_goals' || market === 'player_kicking_points');
  return ledger.researchComplete
    && requestedMarkets.every((market) => ledger.requestedMarkets.some((requested) => requested === market))
    && ledger.games.filter((game) => game.eligibility === 'PREGAME').every((game) => requestedMarkets.every((market) =>
      !game.failedMarkets.some((failed) => failed === market)
      && (game.returnedMarkets.some((returned) => returned === market) || game.zeroMarkets.some((zero) => zero === market))));
}

async function getSportsbookCandidates(context: AgentContext, args: { sport?: string; date?: string }): Promise<ToolResult<unknown>> {
  const clarification = await prepareNFLRequestScope(context);
  if (clarification) return fail('NOT_FOUND', clarification, { sport: 'nfl' });
  const sport = resolveSport(args.sport, context);
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);
  const resolved = resolveDate(args.date, context);
  if ('error' in resolved) return fail('INVALID_DATE', resolved.error, { sport });

  const status = SPORT_STATUS[sport];
  if (!status.props) return fail('SPORT_UNAVAILABLE', status.note, { sport, date: resolved.date });

  const approvedForRequest = null;
  const deliberateRefresh = /\b(refresh|research again|search again|check again|newly available|new (?:search|research|plays|props)|new data|fresh data|latest (?:props|lines|markets))\b/i.test(context.pendingQueryIntent);

  // Reuse first: a stored session for this exact sport+date already holds the full researched pool,
  // so a reworded question never re-runs the slate or risks a paid refresh.
  const existing = context.researchSession;
  let mlbSchedule: Awaited<ReturnType<typeof getMLBSchedule>> | null = null;
  let mlbPregameIds: string[] | null = null;
  if (sport === 'mlb') {
    try {
      mlbSchedule = (await getMLBSchedule(resolved.date)).filter(game => game.date === resolved.date);
    } catch {
      return fail('PROVIDER_ERROR', 'The MLB schedule could not be retrieved.', { sport, date: resolved.date, researchComplete: false });
    }
    if (!mlbSchedule.length) return fail('NO_GAMES', `No MLB games are scheduled on ${resolved.date}.`, { sport, date: resolved.date, gamesScheduled: 0, gamesFound: 0 });
    const teams = requestedMLBTeams(context.pendingQueryIntent);
    const explicitMatchup = /\b(?:vs\.?|versus)\b|@/i.test(context.pendingQueryIntent);
    const matchupSides = context.pendingQueryIntent.split(/\bvs\.?(?=\s|$)|\bversus\b|@/i);
    const selected = mlbSchedule.filter(game => teams.every(team => [game.homeTeam.name, game.awayTeam.name].includes(team)));
    if ((explicitMatchup && (teams.length !== 2 || matchupSides.length !== 2 || matchupSides.some(side => requestedMLBTeams(side).length !== 1))) || !selected.length) {
      return fail('NOT_FOUND', 'That MLB team or matchup has no game on the requested slate.', { sport, date: resolved.date, gamesScheduled: 0, gamesFound: 0, researchComplete: false });
    }
    mlbPregameIds = selected.filter(game => !COMPLETED_MLB_STATUS.test(game.status) && !hasMLBGameStarted(game)).map(game => game.id);
    if (!mlbPregameIds.length) return fail('SLATE_COMPLETE', 'The requested MLB games have finished or already started; pregame props are closed.', { sport, date: resolved.date, gamesScheduled: 0, gamesFound: 0 });
    if (isMLBGameMarketRequest(context.pendingQueryIntent)) return fail('SPORTSBOOK_DATA_REQUIRED', 'MLB game markets require the game-market quote workflow, not player-prop research.', { sport, date: resolved.date, gamesScheduled: mlbPregameIds.length, researchComplete: false });
  }
  const mlbSessionCurrent = sport !== 'mlb' || !existing || existing.candidates.every(candidate => {
    const game = mlbSchedule?.find(entry => entry.id === candidate.gameId);
    return game != null && !COMPLETED_MLB_STATUS.test(game.status) && !hasMLBGameStarted(game)
      && candidate.priceCurrent && ['LIVE', 'FRESH'].includes(classifyStoredPrice(candidate));
  });
  const mlbSessionCovered = sport !== 'mlb' || existing != null && existing.toolMeta.partialCoverage !== true && existing.toolMeta.researchComplete !== false
    && mlbPregameIds!.every(id => existing.toolMeta.mlbGameCoverage
      ? existing.toolMeta.mlbGameCoverage.some(game => game.gameId === id && game.status === 'RESEARCHED')
      : existing.scopeGameIds?.includes(id) || !existing.scopeGameIds?.length
        && existing.toolMeta.gamesScheduled === mlbSchedule!.filter(game => !COMPLETED_MLB_STATUS.test(game.status) && !hasMLBGameStarted(game)).length);
  const sessionMatches = !deliberateRefresh && !approvedForRequest && existing != null && existing.sport === sport && existing.date === resolved.date && existing.candidates.length > 0
    && mlbSessionCurrent
    && mlbSessionCovered
    && (sport !== 'nfl' || existing.toolMeta.researchComplete !== false
      && hasNFLRequestedMarketCoverage(existing, context.nflScope?.marketKeys ?? NFL_ELITE_MARKETS)
      && existing.candidates.every((candidate) => candidate.priceCurrent && ['LIVE', 'FRESH'].includes(classifyStoredPrice(candidate))
        && isNFLPlayerAvailabilityKnown(candidate.injuryContext as Parameters<typeof isNFLPlayerAvailabilityKnown>[0])
        && (context.nflScope?.researchMode !== 'DEEP' || candidate.nflResearchProfile?.researchMode !== 'STANDARD')));
  const reuseSession = () => {
    if (sport === 'mlb') {
      const candidates = existing!.candidates.filter(candidate => mlbPregameIds!.includes(candidate.gameId ?? ''));
      const coverage = existing!.toolMeta.mlbGameCoverage?.filter(game => mlbPregameIds!.includes(game.gameId));
      context.researchSession = { ...existing!, candidates, scopeGameIds: mlbPregameIds!, toolMeta: {
        ...existing!.toolMeta, gamesScheduled: mlbPregameIds!.length, candidatesFound: candidates.length,
        ...(coverage ? { mlbGameCoverage: coverage } : {}),
      } };
    }
    return ok(
    { loaded: true, reusedExistingSession: true, candidatesFound: context.researchSession!.candidates.length, nextStep: 'Call rank_candidates to filter and rank the already-researched pool.' },
    { ...context.researchSession!.toolMeta, sport, date: resolved.date, reusedExistingSession: true },
    );
  };
  if (sessionMatches && (sport === 'mlb' || !existing.scopeGameIds?.length)) return reuseSession();

  let preflight: FinderRunSummary;
  try {
    preflight = await runPreflight(sport, resolved.date, deliberateRefresh, context.nflScope?.marketKeys);
  } catch (error) {
    if (sport === 'nfl') { context.nflResearchIncomplete = true; context.researchSession = null; context.researchSessionId = null; }
    console.error('[deepside:odds] preflight failed', { sport, date: resolved.date, error: error instanceof Error ? error.message : error });
    if (sport !== 'nfl' && error instanceof OddsBudgetGuardError) {
      return fail('RESERVE_BLOCKED', 'Sportsbook data is temporarily unavailable.', { sport, date: resolved.date, budgetLimited: true });
    }
    return fail(sport === 'nfl' ? 'RESEARCH_INCOMPLETE' : 'PROVIDER_ERROR', sport === 'nfl' ? 'The requested NFL slate could not be fully researched.' : `The ${sport.toUpperCase()} schedule or sportsbook event list could not be retrieved.`, { sport, date: resolved.date, researchComplete: false });
  }

  if (sport === 'mlb' && !preflight.validationPreflight && preflight.gameCoverage?.some(game => mlbPregameIds!.includes(game.gameId) && game.status === 'PROVIDER_ERROR')) {
    return fail('PROVIDER_ERROR', 'The MLB sportsbook event list could not be retrieved.', { sport, date: resolved.date, gamesScheduled: mlbPregameIds!.length, researchComplete: false, partialCoverage: true,
      mlbGameCoverage: preflight.gameCoverage.filter(game => mlbPregameIds!.includes(game.gameId)) });
  }
  if (sport !== 'nfl' && preflight.gamesScheduled === 0) {
    return fail('NO_GAMES', `No ${sport.toUpperCase()} games are scheduled on ${resolved.date}.`, { sport, date: resolved.date, gamesScheduled: 0, gamesFound: 0 });
  }
  if (sport !== 'nfl' && preflight.slateComplete) {
    return fail('SLATE_COMPLETE', `Every ${sport.toUpperCase()} game on ${resolved.date} has already finished, so no props are offered.`, { sport, date: resolved.date, gamesScheduled: preflight.gamesScheduled, gamesFound: 0 });
  }

  const preflightData = preflight.validationPreflight;
  if (sport === 'mlb' && preflightData) {
    preflightData.games = preflightData.games.filter(game => mlbPregameIds!.includes(game.gameId));
    if (!preflightData.games.length) preflightData.preflightState = 'EVENT_LIST_REQUIRED';
  }
  const mlbPreflightCoverage = sport === 'mlb' ? mlbSchedule!.filter(game => mlbPregameIds!.includes(game.id)).map(game =>
    preflight.gameCoverage?.find(coverage => coverage.gameId === game.id)
    ?? { gameId: game.id, slateDate: resolved.date, homeTeam: game.homeTeam.name, awayTeam: game.awayTeam.name,
      gameTime: game.gameTime, eventId: null, eventTime: null,
      status: preflightData?.games.some(plan => plan.gameId === game.id && plan.eventId) ? 'NOT_FETCHED' as const : 'NOT_LISTED' as const }) : null;
  if (sport === 'mlb' && preflightData && !deliberateRefresh) {
    for (const game of preflightData.games) {
      if (game.eventId && await getCachedMLBPrimaryMarkets(game.eventId)) game.marketsCacheState = 'CACHE_FRESH';
    }
    preflightData.cacheHits = preflightData.games.filter(game => game.marketsCacheState === 'CACHE_FRESH').length;
    preflightData.cacheMisses = preflightData.games.length - preflightData.cacheHits;
  }
  const scopedTeams = [...new Set([...(context.nflScope?.teams ?? []), ...(context.nflScope?.playerTeam ? [context.nflScope.playerTeam] : [])])];
  const requestedGameIds = sport === 'mlb' ? mlbPregameIds! : sport === 'nfl' && scopedTeams.length > 0
    ? (preflightData?.games ?? []).filter((game) => scopedTeams.every((team) => detectRequestedGames(team, [game]).length > 0)).map((game) => game.gameId)
    : detectRequestedGames(context.pendingQueryIntent, preflightData?.games ?? []);
  if (sport === 'nfl' && scopedTeams.length > 0 && requestedGameIds.length === 0) {
    return fail('NOT_FOUND', 'That player or matchup has no game on the requested slate. Which date should DeepSide research?', { sport, date: resolved.date });
  }
  if (sessionMatches && requestedGameIds.length > 0 && requestedGameIds.every((id) => existing.scopeGameIds!.includes(id))) return reuseSession();

  const autoRefresh = sport === 'nfl' || approvedForRequest != null || isAutomaticOddsRefreshEnabled();
  const scopeGames = (preflightData?.games ?? []).filter((game) => requestedGameIds.length === 0 || requestedGameIds.includes(game.gameId));
  const cachedGameIds = scopeGames
    .filter((game) => game.eventId != null && game.marketsCacheState === 'CACHE_FRESH')
    .map((game) => game.gameId);
  if (sport !== 'nfl' && preflightData?.preflightState === 'EVENT_LIST_REQUIRED') {
    return fail('EVENT_LIST_REQUIRED', `Sportsbooks have not listed the ${mlbPregameIds?.length ?? preflight.gamesEligible} remaining pregame ${sport.toUpperCase()} game${(mlbPregameIds?.length ?? preflight.gamesEligible) === 1 ? '' : 's'} on ${resolved.date} yet, so no markets are posted.`, { sport, date: resolved.date, gamesScheduled: mlbPregameIds?.length ?? preflight.gamesScheduled, gamesFound: 0, researchComplete: false,
      ...(mlbPreflightCoverage ? { mlbGameCoverage: mlbPreflightCoverage, partialCoverage: true } : {}) });
  }
  // Without paid-refresh permission (local development default) only already-cached games can be researched.
  if (!autoRefresh && cachedGameIds.length === 0 && ((preflightData?.cacheMisses ?? 0) > 0 || requestedGameIds.length > 0)) {
    console.info('[deepside:odds] refresh needed but paid refresh disabled', { sport, date: resolved.date, cacheMisses: preflightData?.cacheMisses, estimatedCreditCostHigh: preflightData?.estimatedCreditCostHigh });
    return fail('SPORTSBOOK_DATA_REQUIRED', 'Sportsbook data is temporarily unavailable.', { sport, date: resolved.date,
      ...(mlbPreflightCoverage ? { gamesScheduled: mlbPregameIds!.length, mlbGameCoverage: mlbPreflightCoverage, partialCoverage: true, researchComplete: false } : {}) });
  }

  let summary: FinderRunSummary;
  try {
    const scopedIds = requestedGameIds.length > 0
      ? (autoRefresh ? requestedGameIds : requestedGameIds.filter((id) => cachedGameIds.includes(id)))
      : (!autoRefresh && (preflightData?.cacheMisses ?? 0) > 0 ? cachedGameIds : mlbPregameIds ?? undefined);
    const load = () => loadRun(context, sport, resolved.date, sport === 'nfl' ? {
      ...(context.nflScope?.researchMode === 'DEEP' ? { researchMode: 'DEEP' as const } : {}),
      ...(context.nflScope?.lowThreshold ? { lowThreshold: true } : {}),
      ...(scopedIds ? { validationGameIds: scopedIds } : {}),
      ...(context.nflScope?.marketKeys ? { marketKeys: context.nflScope.marketKeys } : {}),
      ...(context.nflScope?.playerId != null ? { playerId: context.nflScope.playerId } : {}),
    } : scopedIds ? { validationGameIds: scopedIds } : {});
    // The odds client is cache-first per event: only missing/stale games are fetched, identical
    // concurrent requests share one fetch, and the credit reserve guard still hard-stops spending.
    summary = await withAutomaticOddsRefresh(load);
  } catch (error) {
    if (sport === 'nfl') {
      context.nflResearchIncomplete = true; context.researchSession = null; context.researchSessionId = null;
      return fail('RESEARCH_INCOMPLETE', 'The requested NFL slate could not be fully researched.', { sport, date: resolved.date, researchComplete: false });
    }
    console.error('[deepside:odds] research load failed', { sport, date: resolved.date, error: error instanceof Error ? error.message : error });
    if (error instanceof OddsBudgetGuardError) {
      return fail('RESERVE_BLOCKED', 'Sportsbook data is temporarily unavailable.', { sport, date: resolved.date, budgetLimited: true });
    }
    if (error instanceof OddsRefreshNotAuthorizedError) {
      return fail('PAID_REFRESH_NOT_AUTHORIZED', 'Sportsbook data is temporarily unavailable.', { sport, date: resolved.date, budgetLimited: true });
    }
    return fail('PROVIDER_ERROR', 'Sportsbook provider failed.', { sport, date: resolved.date });
  }
  console.info('[deepside:odds] research load', {
    sport, date: resolved.date, scope: requestedGameIds.length ? requestedGameIds : 'full-slate',
    gamesAnalyzed: summary.gamesAnalyzed, propsAnalyzed: summary.propsAnalyzed, oddsSpend: summary.oddsSpend, credits: summary.credits,
  });

  // NFL/NBA don't yet have the MLB-only FinderResult signal modules, so their researched pool
  // lives on sport-specific candidate arrays (each carrying its own EliteResearchAnalysis) rather
  // than summary.results, which those two engines intentionally always leave empty.
  const genericCandidates: GenericResearchCandidate[] | null = await withResearchStage('candidate-conversion', () =>
    sport === 'nfl'
      ? (summary as NFLFinderSummary).nflCandidates
        .filter((c) => c.playerMatch === 'MATCHED' && c.eliteAnalysis != null)
        .filter((c) => (summary as NFLFinderSummary).nflLedger?.researchComplete === true
          || isNFLGameResearchPublishable((summary as NFLFinderSummary).nflLedger, {
            gameId: c.gameId, eventId: c.eventId, marketKey: c.market, retrievedAt: c.retrievedAt, sourceGameId: c.sourceGameId,
          }))
        .map((c) => ({
          candidateId: c.id, playerId: c.playerId, teamId: c.teamId, player: c.playerName, team: c.team, opponent: c.opponent,
          marketLabel: c.marketLabel, marketKey: c.market, line: c.line, direction: c.side,
          book: c.book, odds: c.oddsAmerican, projection: c.projection?.projection ?? null,
          projectionUncertainty: c.projection?.uncertainty ?? null,
          l5Rate: c.history?.windows.l5.hitRate ?? null, l10Rate: c.history?.windows.l10.hitRate ?? null,
          l20Rate: null, seasonRate: c.history?.windows.season.hitRate ?? null,
          sampleSize: c.history?.gamesUsed ?? null, average: c.history?.mean ?? null,
          median: c.history?.median ?? null, standardDeviation: c.history?.stdDev ?? null,
          homeHitRate: c.history?.splits.home.hitRate ?? null, awayHitRate: c.history?.splits.away.hitRate ?? null,
          analysis: c.nflResearchProfile ? applyNFLHardGatesToAnalysis(c.eliteAnalysis!, c.nflResearchProfile) : c.eliteAnalysis!,
          nflResearchProfile: c.nflResearchProfile ?? undefined,
          sport: 'nfl',
          matchupAvailable: c.opponentContext?.status !== 'UNAVAILABLE',
          roleKnown: c.roleContext.status === 'STABLE' || c.roleContext.status === 'CHANGING',
          injuryKnown: isNFLPlayerAvailabilityKnown(c.injuryContext),
          outlierDependencePercent: null,
          crossBookDiscrepancy: c.crossBookThreshold?.available ? c.crossBookThreshold.discrepancy : null,
          marketMovementAvailable: c.marketMovement.available,
          howItLoses: c.howItLoses,
          position: c.position?.toLowerCase() ?? (NFL_QB_MARKETS.includes(c.market) ? 'qb' : NFL_RB_MARKETS.includes(c.market) ? 'rb' : NFL_WR_TE_MARKETS.includes(c.market) ? 'wr_te' : NFL_KICKER_MARKETS.includes(c.market) ? 'k' : NFL_DEFENSE_MARKETS.includes(c.market) ? 'def' : null),
          projectionReliability: c.projection?.reliability ?? null,
          crossBookThreshold: c.crossBookThreshold,
          marketMovement: c.marketMovement,
          outlierAnalysis: c.outlierDependency ? {
            applicability: c.outlierDependency.applicability, available: c.outlierDependency.available,
            sampleGames: c.outlierDependency.sampleGames, explosiveDependencePercent: c.outlierDependency.explosiveDependencePercent,
          } : null,
          roleContext: {
            requirement: c.roleContext.requirement, status: c.roleContext.status,
            confidence: c.roleContext.confidence, workloadTrend: c.roleContext.workloadTrend, reasons: c.roleContext.reasons,
            opportunity: c.roleContext.opportunity, evidence: c.roleContext.evidence, unavailableEvidence: c.roleContext.unavailableEvidence,
          },
          opponentContext: c.opponentContext ? {
            opponentTeamId: c.opponentContext.opponentTeamId, efficiencyGames: c.opponentContext.efficiencyGames,
            status: c.opponentContext.status, sampleSize: c.opponentContext.sampleSize, trend: c.opponentContext.trend,
            sourceStatus: c.opponentContext.sourceStatus, metrics: c.opponentContext.metrics,
            availableMetrics: c.opponentContext.availableMetrics, unavailableMetrics: c.opponentContext.missingFields,
            evidence: c.opponentContext.evidence,
          } : { status: 'UNAVAILABLE', availableMetrics: [], unavailableMetrics: ['opponent defensive boxscores'], evidence: [] },
          injuryContext: c.injuryContext,
          weatherContext: c.weatherContext,
          nflHistory: c.history,
          nflKickingResearch: c.nflKickingResearch ?? undefined,
          gameId: c.gameId, eventId: c.eventId, retrievedAt: c.retrievedAt, sourceGameId: c.sourceGameId,
          bestAlternateLine: c.alternateLines?.recommended ? {
            line: c.alternateLines.recommended.line, side: c.alternateLines.recommended.side,
            bestBook: c.alternateLines.recommended.bestBook, bestOdds: c.alternateLines.recommended.bestOdds,
            trueProbability: c.alternateLines.recommended.trueProbability, breakEvenProbability: c.alternateLines.recommended.breakEvenProbability,
            edgePercent: c.alternateLines.recommended.edgePercent, band: c.alternateLines.recommended.band,
          } : null,
        }))
      : sport === 'nba'
        ? (summary as NBAFinderSummary).nbaCandidates
          .filter((c) => c.playerMatch === 'MATCHED' && c.eliteAnalysis != null)
          .map(nbaFinderCandidateToGeneric)
        : null);

  if (sport === 'mlb') summary = { ...summary, results: summary.results.filter(result => mlbPregameIds!.includes(result.gameId ?? '')) };
  const mlbGameCoverage = sport === 'mlb' ? mlbSchedule!.filter(game => mlbPregameIds!.includes(game.id)).map(game =>
    summary.gameCoverage?.find(coverage => coverage.gameId === game.id)
    ?? preflight.gameCoverage?.find(coverage => coverage.gameId === game.id)
    ?? { gameId: game.id, slateDate: resolved.date, homeTeam: game.homeTeam.name, awayTeam: game.awayTeam.name,
      gameTime: game.gameTime, eventId: null, eventTime: null,
      status: summary.results.some(result => result.gameId === game.id) ? 'RESEARCHED' as const
        : summary.budgetLimited ? 'BUDGET_BLOCKED' as const
          : scopeGames.some(plan => plan.gameId === game.id && plan.eventId) ? 'NO_MARKETS' as const : 'NOT_LISTED' as const }) : null;
  const mlbPartialCoverage = mlbGameCoverage?.some(game => game.status !== 'RESEARCHED') ?? false;
  const candidatesFound = genericCandidates != null ? genericCandidates.length : summary.results.length;
  const meta = {
    sport,
    date: resolved.date,
    gamesFound: summary.gamesAnalyzed,
    gamesScheduled: requestedGameIds.length > 0 ? requestedGameIds.length : summary.gamesEligible,
    propsFound: summary.propsAnalyzed,
    booksFound: summary.booksAnalyzed,
    candidatesFound,
    cached: summary.fromCache,
    dataFreshnessSeconds: summary.cacheAgeMs != null ? Math.round(summary.cacheAgeMs / 1000) : null,
    budgetLimited: summary.budgetLimited,
    blockReason: summary.blockReason,
    oddsSpend: summary.oddsSpend,
    ...(mlbGameCoverage ? {
      mlbGameCoverage,
      partialCoverage: mlbPartialCoverage,
      researchComplete: !mlbPartialCoverage,
    } : {}),
    ...(sport === 'nfl' ? { nflLedger: (summary as NFLFinderSummary).nflLedger,
      researchComplete: (summary as NFLFinderSummary).nflLedger?.researchComplete ?? false,
      partialCoverage: (summary as NFLFinderSummary).nflLedger?.researchComplete !== true,
      gamesScheduled: (summary as NFLFinderSummary).nflLedger?.eligiblePregame ?? summary.gamesEligible } : {}),
    ...(sport === 'nba' ? {
      nbaGameCoverage: (summary as NBAFinderSummary).nbaGameCoverage,
      partialCoverage: (summary as NBAFinderSummary).partialCoverage === true,
      researchComplete: (summary as NBAFinderSummary).partialCoverage !== true
        && ((summary as NBAFinderSummary).researchComplete ?? !summary.budgetLimited),
    } : {}),
  };

  if (sport === 'nfl' && !meta.researchComplete && candidatesFound === 0) {
    context.nflResearchIncomplete = true; context.researchSession = null; context.researchSessionId = null;
    return fail('RESEARCH_INCOMPLETE', 'The requested NFL slate could not be fully researched.', meta);
  }
  if (sport === 'nfl') context.nflResearchIncomplete = false;
  if (summary.slateComplete) {
    return fail('SLATE_COMPLETE', `Every game on ${resolved.date} has already finished, so no props are offered.`, meta);
  }
  if (sport !== 'nfl' && summary.propsAnalyzed === 0) {
    // Report the ACTUAL blocker. Only say "reserve" when the reserve guard really fired.
    if (summary.blockReason === 'RESERVE') {
      return fail('RESERVE_BLOCKED', 'No sportsbook player props are cached for this slate and the Odds API credit reserve blocked a refresh.', meta);
    }
    if (summary.blockReason === 'NOT_AUTHORIZED') {
      return fail('SPORTSBOOK_DATA_REQUIRED', 'Sportsbook data is temporarily unavailable.', meta);
    }
    if ((summary.oddsSpend?.providerErrors ?? 0) > 0 || (mlbGameCoverage ?? summary.gameCoverage)?.some(game => game.status === 'PROVIDER_ERROR')) {
      return fail('PROVIDER_ERROR', 'The sportsbook odds provider returned an error for this slate.', meta);
    }
    const gameCount = summary.gameCoverage?.filter(game => game.status === 'NO_MARKETS').length ?? summary.gamesEligible;
    return fail('NO_CACHED_SPORTSBOOK_DATA', `Sportsbooks have not posted ${sport.toUpperCase()} player props for the ${gameCount} pregame game${gameCount === 1 ? '' : 's'} on ${resolved.date} yet.`, meta);
  }
  if (sport !== 'nfl' && candidatesFound === 0) return fail('NO_CANDIDATES', 'Props were loaded but no researchable candidates were produced.', meta);

  // Successful research replaces the stored session so follow-ups always answer from the latest slate.
  context.researchSession = await withResearchStage('session-build', () => genericCandidates != null
    ? buildResearchSessionFromCandidates({
      sport,
      date: resolved.date,
      queryIntent: context.pendingQueryIntent,
      candidates: genericCandidates,
      toolMeta: meta,
    })
    : buildResearchSession({
      sport,
      date: resolved.date,
      queryIntent: context.pendingQueryIntent,
      results: summary.results,
      toolMeta: meta,
    }));
  if (requestedGameIds.length > 0) context.researchSession.scopeGameIds = requestedGameIds;
  // Persisted server-side only; the client gets back an opaque ID, never the (possibly hundreds-of-
  // candidates) session object. Replaces any previous session for this conversation.
  context.researchSessionId = await withResearchStage('session-save', () => saveResearchSession(context.researchSession!));

  // Candidates are NOT returned here — with the per-run cap removed there can be hundreds, which
  // would blow the model's context/rate limit. They are held server-side in the research session;
  // call rank_candidates next to retrieve the top publication-gated, tiered, ranked results.
  return ok({ loaded: true, candidatesFound: meta.candidatesFound, nextStep: 'Call rank_candidates to retrieve the top researched picks.' }, meta);
}

async function runEliteFilter(context: AgentContext, args: { sport?: string; date?: string; candidateIds?: string[] }): Promise<ToolResult<unknown>> {
  const sport = resolveSport(args.sport, context);
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);
  const resolved = resolveDate(args.date, context);
  if ('error' in resolved) return fail('INVALID_DATE', resolved.error, { sport });

  const session = context.researchSession;
  if (!session || session.sport !== sport || session.date !== resolved.date) {
    return fail('NO_CANDIDATES', 'No candidates are loaded yet. Call get_sportsbook_candidates first.', { sport, date: resolved.date });
  }

  const wanted = args.candidateIds?.length ? new Set(args.candidateIds) : null;
  const pool = wanted ? session.candidates.filter((c) => wanted.has(c.candidateId)) : session.candidates;
  if (pool.length === 0) return fail('NO_CANDIDATES', 'No matching candidates to analyse.', { sport, date: resolved.date });

  const qualified = pool.map((candidate) => sport === 'nfl' ? evaluateNFLSavedResearchMode(candidate, context.nflScope?.researchMode ?? 'STANDARD') : candidate).filter((candidate) => sport === 'nfl'
    ? isNFLInjuryContextFresh(candidate.injuryContext as Parameters<typeof isNFLInjuryContextFresh>[0]) && classifyPickTier(candidate, sport).pickTier !== 'PASS' : candidate.eliteQualified);

  const reasonCounts: Record<string, number> = {};
  for (const candidate of pool) for (const reason of candidate.rejectionReasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;

  const meta = { sport, date: resolved.date, candidatesFound: pool.length,
    eliteFound: qualified.filter((candidate) => candidate.eliteQualified && (!candidate.nflResearchProfile || candidate.nflResearchProfile.productionEliteQualified)).length,
    recommendationsFound: qualified.length };

  if (qualified.length === 0) {
    return {
      status: 'NO_ELITE_RESULTS',
      error: sport === 'nfl' ? `Researched ${pool.length} candidates and none passed the publication and research requirements.`
        : `Researched ${pool.length} candidates and none passed the Elite threshold.`,
      ...meta,
      data: {
        analysed: pool.length,
        topRejectionReasons: Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
        closestMisses: pool.slice(0, 5),
      },
    };
  }

  return ok({ qualified: qualified.slice(0, MAX_RESULTS_CEILING), qualifiedTotal: qualified.length, analysed: pool.length }, meta);
}

export interface CandidateSearchConstraints {
  researchMode: NFLResearchMode;
  lowThreshold: boolean;
  sport: SupportedSport | null;
  date: string | null;
  side: 'over' | 'under' | null;
  targetOdds: number | null;
  minOdds: number | null;
  maxOdds: number | null;
  sort: 'balanced' | 'value' | 'payout' | 'safety';
  qualityFloor: PickTier;
  showPasses: boolean;
  maxResults: number;
  player: string | null;
  team: string | null;
  market: string | null;
  sportsbook: string | null;
  selectedCandidateIds: string[] | null;
  marketFamily: NFLMarketFamily | null;
  playerUnresolved: boolean;
  requestedTeams: string[];
}

type CandidateRankArgs = {
  sport?: string; date?: string; maxResults?: number; eliteOnly?: boolean;
  playerType?: 'hitter' | 'pitcher' | 'any'; side?: 'over' | 'under' | 'any'; team?: string; player?: string; marketContains?: string;
  positionGroup?: string;
  nflScope?: NFLRequestScope | null;
  resolvedDate?: string;
  requireFreshNFLInjury?: boolean;
};

const MIN_OFFICIAL_ODDS = -900;
const TARGET_ODDS_TOLERANCE = 50;

function classifyStoredPrice(candidate: ResearchCandidateRecord) {
  const timestamp = candidate.nflResearchProfile?.market?.provenance?.[0]?.publishedAt ?? candidate.retrievedAt;
  if (!timestamp) return 'UNKNOWN';
  const age = Date.now() - Date.parse(timestamp);
  return Number.isFinite(age) && age >= 0 && age <= 3600000 ? 'FRESH' : 'EXPIRED';
}

function teamAliases(team: string): string[] {
  const words = team.trim().split(/\s+/);
  const last = words[words.length - 1] ?? '';
  const nickname = last.length >= 4 ? last : words.slice(-2).join(' ');
  return [...new Set([team, nickname])].filter(Boolean);
}

/** Games named in the request ("Colts vs Commanders", "Yankees props"); empty means the whole slate. */
export function detectRequestedGames(query: string, games: Array<{ gameId: string; matchup: string }>): string[] {
  const mentions = (team: string) => teamAliases(team).some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(query));
  const scored = games.map((game) => {
    const [away = '', home = ''] = game.matchup.split(/\s+@\s+/);
    return { gameId: game.gameId, hits: Number(mentions(away)) + Number(mentions(home)) };
  });
  const both = scored.filter((game) => game.hits === 2);
  return (both.length ? both : scored.filter((game) => game.hits === 1)).map((game) => game.gameId);
}

export function parseCandidateSearchConstraints(query: string, candidates: ResearchCandidateRecord[], sport?: string): CandidateSearchConstraints {
  const normalized = query.toLowerCase();
  const nfl = sport === 'nfl' || detectSport(query) === 'nfl' || (detectSport(query) == null && candidates.some((candidate) => NFL_ELITE_MARKETS.includes(candidate.marketKey as NFLAnalyzableMarketKey)));
  const nflScope = nfl ? parseNFLRequestScope(query) : null;
  const range = normalized.match(/(?:between|from)\s*([+-]\d{2,4})\s*(?:and|to)\s*([+-]\d{2,4})/i);
  const signedPrice = normalized.match(/\b(?:under|below)\s*([+-]\d{2,4})\b/i);
  const overPrice = normalized.match(/\b(?:over|above)\s*([+-]\d{2,4})\b/i);
  const target = range || signedPrice || overPrice ? null : normalized.match(/(?<![\w])([+-]\d{2,4})\b/i);
  const requestedCount = normalized.match(/\b([23])[-\s]man\b/i)
    ?? normalized.match(/\b(\d{1,2})\b(?=[^.!?\n]{0,30}\b(?:plays?|picks?|props?)\b)/i);
  const matchingRecords = candidates.filter((candidate) => normalized.includes(candidate.player.toLowerCase())
    || (nflScope?.playerQuery && nflNameMatches(nflScope.playerQuery, candidate.player)));
  const matchingPlayers = [...new Set(matchingRecords.map((candidate) => candidate.player))];
  const playerIdentities = new Set(matchingRecords.map((candidate) => `${candidate.playerId}|${candidate.team}|${candidate.player}`));
  const player = matchingPlayers.length === 1 ? matchingPlayers[0] : null;
  const books = [...new Set(candidates.map((candidate) => candidate.book).filter((book): book is string => Boolean(book)))];
  const sportsbook = books.find((book) => normalized.includes(book.toLowerCase())) ?? null;
  const markets = [...new Set(candidates.flatMap((candidate) => [candidate.market, candidate.marketKey.replaceAll('_', ' ')]))]
    .sort((a, b) => b.length - a.length);
  const market = markets.find((value) => {
    const label = value.toLowerCase();
    const singular = label.replace(/s\b/g, '');
    return normalized.includes(label) || normalized.includes(singular);
  }) ?? null;
  const teamNames = [...new Set(candidates.flatMap((candidate) => [candidate.team, candidate.opponent]).filter((team): team is string => Boolean(team)))];
  const mentionedTeams = nflScope?.teams.length ? nflScope.teams : teamNames.filter((team) => {
    const name = team.toLowerCase();
    const words = name.split(/\s+/).filter((word) => word.length >= 4);
    return normalized.includes(name) || words.some((word) => normalized.includes(word));
  });
  const selectedGames = mentionedTeams.length >= 2
    ? candidates.filter((candidate) => mentionedTeams.some((team) => candidate.team?.toLowerCase() === team.toLowerCase())
      && mentionedTeams.some((team) => candidate.opponent?.toLowerCase().includes(team.toLowerCase()))).map((candidate) => candidate.candidateId)
    : null;

  return {
    researchMode: nflScope?.researchMode ?? 'STANDARD',
    lowThreshold: nflScope?.lowThreshold ?? false,
    sport: detectSport(query) ?? (nfl ? 'nfl' : null),
    date: resolveDateFromText(query)?.resolvedDate ?? null,
    side: /\bunders?\b(?!\s*[+-]\d)/i.test(query) ? 'under' : /\bovers?\b(?!\s*[+-]\d)/i.test(query) ? 'over' : null,
    targetOdds: target ? Number(target[1]) : null,
    minOdds: range ? Math.min(Number(range[1]), Number(range[2])) : nfl && signedPrice && Number(signedPrice[1]) < 0 ? Number(signedPrice[1]) : overPrice ? Number(overPrice[1]) : null,
    maxOdds: range ? Math.max(Number(range[1]), Number(range[2])) : signedPrice && !(nfl && Number(signedPrice[1]) < 0) ? Number(signedPrice[1]) : null,
    sort: /\b(?:best\s+value|higher\s+value|most\s+valuable)\b/i.test(query) ? 'value'
      : /\b(?:better payout|more upside|higher payout)\b/i.test(query) ? 'payout'
      : nflScope?.rankingIntent === 'MOST_LIKELY' || /\b(?:safer|safest|most likely|highest probability|highest chance|lower risk)\b/i.test(query) ? 'safety' : 'balanced',
    qualityFloor: qualityFloorFromQuery(query),
    showPasses: queryRequestsPasses(query),
    maxResults: Math.min(MAX_RESULTS_CEILING, Math.max(1, requestedCount ? Number(requestedCount[1]) : MAX_RESULTS_CEILING)),
    player,
    team: mentionedTeams.length === 1 ? mentionedTeams[0] : null,
    market,
    sportsbook,
    selectedCandidateIds: selectedGames?.length ? [...new Set(selectedGames)] : null,
    marketFamily: nflScope?.marketFamily ?? null,
    playerUnresolved: Boolean(nflScope?.playerQuery && (matchingPlayers.length !== 1 || playerIdentities.size !== 1)),
    requestedTeams: nflScope?.teams ?? [],
  };
}

export function selectRankedCandidates(candidates: ResearchCandidateRecord[], query: string, args: CandidateRankArgs = {}): { constraints: CandidateSearchConstraints; pool: ResearchCandidateRecord[]; selected: ResearchCandidateRecord[] } {
  const constraints = parseCandidateSearchConstraints(query, candidates, args.sport);
  if (args.resolvedDate && constraints.date) constraints.date = args.resolvedDate;
  const nfl = args.sport === 'nfl' || constraints.sport === 'nfl';
  let pool = candidates.filter((candidate) => candidate.odds != null && candidate.odds >= MIN_OFFICIAL_ODDS);
  if (nfl && args.requireFreshNFLInjury) pool = pool.filter((candidate) => isNFLInjuryContextFresh(candidate.injuryContext as Parameters<typeof isNFLInjuryContextFresh>[0]));
    const playerType = args.playerType ?? null;
  const side = constraints.side ?? (args.side !== 'any' ? args.side : null);
  const team = constraints.team ?? args.team ?? null;
  const player = args.nflScope?.playerName ?? constraints.player ?? args.player ?? null;
  const market = constraints.market ?? args.marketContains ?? null;

  if (nfl && (args.nflScope?.clarification || (constraints.playerUnresolved && !args.nflScope?.playerName))) pool = [];
  if (nfl && constraints.requestedTeams.length > 0) pool = pool.filter((candidate) => constraints.requestedTeams.every((requested) =>
    [candidate.team, candidate.opponent].some((teamName) => teamName?.toLowerCase() === requested.toLowerCase())));
  const marketKeys = args.nflScope?.marketKeys ?? (constraints.marketFamily ? parseNFLRequestScope(query).marketKeys : null);
  if (nfl && marketKeys) pool = pool.filter((candidate) => marketKeys.includes(candidate.marketKey as NFLAnalyzableMarketKey));
  if (playerType === 'pitcher') pool = pool.filter((candidate) => candidate.marketKey.startsWith('pitcher_'));
  if (playerType === 'hitter') pool = pool.filter((candidate) => candidate.marketKey.startsWith('batter_'));
  if (side) pool = pool.filter((candidate) => candidate.direction === side);
  if (team) pool = pool.filter((candidate) => (candidate.team ?? '').toLowerCase().includes(team.toLowerCase()) || (candidate.opponent ?? '').toLowerCase().includes(team.toLowerCase()));
  if (player) pool = pool.filter((candidate) => nfl ? nflNameMatches(player, candidate.player) : candidate.player.toLowerCase().includes(player.toLowerCase()));
  if (market) pool = pool.filter((candidate) => candidate.market.toLowerCase().includes(market.toLowerCase()) || candidate.marketKey.replaceAll('_', ' ').toLowerCase().includes(market.toLowerCase()));
  if (constraints.sportsbook) pool = pool.filter((candidate) => candidate.book?.toLowerCase() === constraints.sportsbook?.toLowerCase());
  if (constraints.selectedCandidateIds) {
    const selectedIds = new Set(constraints.selectedCandidateIds);
    pool = pool.filter((candidate) => selectedIds.has(candidate.candidateId));
  }
  if (constraints.targetOdds != null) pool = pool.filter((candidate) => Math.abs(candidate.odds! - constraints.targetOdds!) <= TARGET_ODDS_TOLERANCE);
  if (constraints.minOdds != null) pool = pool.filter((candidate) => candidate.odds! >= constraints.minOdds!);
  if (constraints.maxOdds != null) pool = pool.filter((candidate) => candidate.odds! <= constraints.maxOdds!);
  if (args.positionGroup) pool = pool.filter((candidate) => (candidate.position ?? '').toLowerCase().includes(args.positionGroup!.toLowerCase()));
  if (nfl && constraints.lowThreshold) pool = pool.filter(matchesNFLLowThreshold);
  if (nfl && constraints.researchMode === 'DEEP') pool = pool.filter((candidate) => candidate.nflResearchProfile?.researchMode !== 'STANDARD');

  const eligible = pool.map((candidate) => nfl ? evaluateNFLSavedResearchMode(candidate, constraints.researchMode) : candidate).flatMap((candidate) => {
    const decision = classifyPickTier(candidate, nfl ? 'nfl' : args.sport ?? constraints.sport ?? undefined);
    const tier = decision.pickTier;
    if (constraints.showPasses) return tier === 'PASS' ? [{ ...candidate, ...decision }] : [];
    const floor = constraints.qualityFloor;
    return tier !== 'PASS' && tierMeetsFloor(tier, floor)
      && (!nfl || (!candidate.isAlternate && NFL_ELITE_MARKETS.includes(candidate.marketKey as NFLAnalyzableMarketKey)))
      ? [{ ...candidate, ...decision }] : [];
  });
  const uniqueEligible = nfl ? groupNFLUnderlyingPlays(eligible, pool) : [...eligible];
  const nba = args.sport === 'nba' || constraints.sport === 'nba';
  const nbaIntent = constraints.sort === 'value' ? 'BEST_VALUE' as const
    : constraints.sort === 'safety' ? 'MOST_LIKELY' as const
      : constraints.sort === 'payout' ? 'PAYOUT' as const : 'BEST' as const;
  const ordered = nba ? rankNBARecommendations(uniqueEligible, nbaIntent)
    : constraints.sort === 'balanced'
      ? rankBalancedFrontier(uniqueEligible)
      : uniqueEligible.sort((a, b) => constraints.sort === 'payout'
      ? b.odds! - a.odds! || b.researchScore - a.researchScore
      : constraints.sort === 'value'
        ? (b.evPercent ?? -Infinity) - (a.evPercent ?? -Infinity)
          || (b.priceEdgePercent ?? -Infinity) - (a.priceEdgePercent ?? -Infinity)
          || (b.playerEdgePercent ?? -Infinity) - (a.playerEdgePercent ?? -Infinity)
          || (b.trueProbability ?? -Infinity) - (a.trueProbability ?? -Infinity)
          || a.trapRisk - b.trapRisk || b.researchScore - a.researchScore
        : (b.trueProbability ?? -Infinity) - (a.trueProbability ?? -Infinity)
          || (b.evPercent ?? -Infinity) - (a.evPercent ?? -Infinity)
          || (b.priceEdgePercent ?? -Infinity) - (a.priceEdgePercent ?? -Infinity)
          || a.trapRisk - b.trapRisk || b.researchScore - a.researchScore);
  const requestedCount = query.match(/\b(?:top|best|show(?:\s+me)?|find|give(?:\s+me)?)\s+(\d+)\b/i)?.[1];
  const limit = args.sport === 'nfl' || args.sport === 'nba'
    ? requestedCount ? Math.max(1, Number(requestedCount)) : args.maxResults ?? ordered.length
    : Math.min(constraints.maxResults, args.maxResults ?? MAX_RESULTS_CEILING);
  const selected = ordered.slice(0, limit);
  return { constraints, pool, selected: nfl ? assignNFLDisplayRanks(selected) : selected };
}

const BALANCED_RANK_METRICS: Array<(candidate: ResearchCandidateRecord) => number | null> = [
  (candidate) => candidate.trueProbability,
  (candidate) => candidate.evPercent,
  (candidate) => candidate.priceEdgePercent,
  (candidate) => candidate.playerEdgePercent,
  (candidate) => candidate.researchScore,
  (candidate) => candidate.dataQuality,
  (candidate) => -candidate.trapRisk,
];

function rankBalancedFrontier(candidates: ResearchCandidateRecord[]): ResearchCandidateRecord[] {
  const values = candidates.map((candidate) => BALANCED_RANK_METRICS.map((metric) => metric(candidate)));
  const scales = BALANCED_RANK_METRICS.map((_, dimension) => {
    const present = values.map((row) => row[dimension]).filter((value): value is number => value != null && Number.isFinite(value));
    return { minimum: Math.min(...present), maximum: Math.max(...present) };
  });
  const normalized = values.map((row) => row.map((value, dimension) => {
    const scale = scales[dimension];
    if (value == null || !Number.isFinite(value)) return 0;
    return scale.maximum === scale.minimum ? 1 : (value - scale.minimum) / (scale.maximum - scale.minimum);
  }));
  const remaining = new Set(candidates.map((_, index) => index));
  const ranked: ResearchCandidateRecord[] = [];

  while (remaining.size) {
    const frontier = [...remaining].filter((candidateIndex) => ![...remaining].some((otherIndex) => {
      if (candidateIndex === otherIndex) return false;
      let strictlyBetter = false;
      for (let dimension = 0; dimension < values[candidateIndex].length; dimension++) {
        const candidateValue = values[candidateIndex][dimension];
        const otherValue = values[otherIndex][dimension];
        if (otherValue == null || !Number.isFinite(otherValue)) continue;
        if (candidateValue == null || !Number.isFinite(candidateValue) || otherValue < candidateValue) return false;
        if (otherValue > candidateValue) strictlyBetter = true;
      }
      return strictlyBetter;
    }));
    frontier.sort((left, right) => {
      const balanced = (index: number) => {
        const scores = normalized[index];
        const reciprocalTotal = scores.reduce((total, score) => total + 1 / Math.max(score, 0.01), 0);
        return scores.length / reciprocalTotal;
      };
      return balanced(right) - balanced(left)
        || (candidates[right].trueProbability ?? -Infinity) - (candidates[left].trueProbability ?? -Infinity)
        || (candidates[right].evPercent ?? -Infinity) - (candidates[left].evPercent ?? -Infinity)
        || candidates[left].candidateId.localeCompare(candidates[right].candidateId);
    });
    for (const index of frontier) {
      ranked.push(candidates[index]);
      remaining.delete(index);
    }
  }
  return ranked;
}

async function rankCandidates(context: AgentContext, args: CandidateRankArgs): Promise<ToolResult<unknown>> {
  const clarification = await prepareNFLRequestScope(context);
  if (clarification) return fail('NOT_FOUND', clarification, { sport: 'nfl' });
  const sport = resolveSport(args.sport, context);
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);
  const nbaIntent = sport === 'nba' ? classifyNBAMarketIntent(context.pendingQueryIntent) : null;
  const resolved = resolveDate(args.date, context);
  if ('error' in resolved) return fail('INVALID_DATE', resolved.error, { sport });

  const session = context.researchSession;
  if (!session || session.sport !== sport || session.date !== resolved.date) {
    return fail('NO_CANDIDATES', 'No candidates are loaded yet. Call get_sportsbook_candidates first.', { sport, date: resolved.date });
  }
  if (nbaIntent?.gameLineMarkets.length && session.modeledGames != null) {
    const { selectNBAMixedRecommendations } = await import('../../nba/prediction/gameLines/selection');
    const results = selectNBAMixedRecommendations(session, context.pendingQueryIntent);
    return ok({ results, closestMisses: [], modeledGames: session.modeledGames },
      { sport, date: resolved.date, candidatesFound: results.length, researchComplete: true });
  }

  const { constraints, pool, selected } = selectRankedCandidates(session.candidates, context.pendingQueryIntent, { ...args, sport, resolvedDate: resolved.date,
    nflScope: context.nflScope, requireFreshNFLInjury: sport === 'nfl' });
  if (sport === 'nfl' && context.nflResearchIncomplete) return fail('RESEARCH_INCOMPLETE', 'The requested NFL slate could not be fully researched.', { sport, date: resolved.date, researchComplete: false });
  if ((constraints.sport && constraints.sport !== session.sport) || (constraints.date && constraints.date !== session.date)) {
    return fail('NO_CANDIDATES', 'The cached research session does not match the requested sport or date.', { sport, date: resolved.date });
  }
  const tieredPool = pool.map((candidate) => sport === 'nfl' ? evaluateNFLSavedResearchMode(candidate, constraints.researchMode) : candidate)
    .map((candidate) => ({ ...candidate, ...classifyPickTier(candidate, sport) }));
  const uniqueTieredPool = sport === 'nfl' ? groupNFLUnderlyingPlays(tieredPool, pool) : tieredPool;
  const recommendationTiers = uniqueTieredPool.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.pickTier!] = (counts[candidate.pickTier!] ?? 0) + 1;
    return counts;
  }, {});
  const meta = { sport, date: resolved.date, researchMode: constraints.researchMode, lowThreshold: constraints.lowThreshold, candidatesFound: pool.length, eliteFound: sport === 'nfl'
    ? groupNFLUnderlyingPlays(pool.filter((candidate) => candidate.eliteQualified)).length : pool.filter((c) => c.eliteQualified).length,
    recommendedFound: Object.entries(recommendationTiers).reduce((sum, [tier, count]) => sum + (tier === 'PASS' ? 0 : count), 0),
    recommendationTiers, qualityFloor: constraints.showPasses ? 'PASS' : constraints.qualityFloor, includePasses: constraints.showPasses,
    ...(nbaIntent?.gameLineMarkets.length ? { unsupportedMarkets: nbaIntent.gameLineMarkets,
      unsupportedMarketNotice: unsupportedNBAGameLineNotice(nbaIntent.gameLineMarkets) } : {}) };

  if (selected.length === 0) {
    return { status: 'NO_ELITE_RESULTS', error: constraints.showPasses
      ? 'No rejected candidates matched those constraints.'
      : pool.length === 0 ? 'No recommendable candidates matched the requested quality floor.' : `Researched ${pool.length} candidates and none passed the requested publication and quality requirements.`, ...meta,
      data: { constraints, closestMisses: sport !== 'nfl' || /\bclosest\s+(?:misses|plays|picks)\b/i.test(context.pendingQueryIntent) ? getClosestMisses({ ...session, candidates: pool }, 5) : [] } };
  }

  return ok({ results: selected, returned: selected.length, constraints }, meta);
}

async function researchPlayer(args: { name?: string; season?: number; sport?: string }): Promise<ToolResult<unknown>> {
  if (!args.name?.trim()) return fail('NOT_FOUND', 'A player name is required.');
  const sport = normalizeSport(args.sport ?? 'mlb');
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);

  if (sport === 'nfl') {
    try {
      const matches = await searchNFLPlayers(args.name);
      if (matches.length === 0) return fail('NOT_FOUND', `No NFL player matched "${args.name}".`, { sport: 'nfl' });
      const player = matches[0];
      const season = args.season ?? undefined;
      const logs = await getNFLPlayerGameLogs(player.id, season);
      const workloadLogs = await getPlayerRoleWorkloadLogs(player.id, season);
      const slate = await getNFLSchedule({ date: todaySlateDate() }).catch(() => []);
      const game = player.team ? slate.find((entry) => !entry.completed && (entry.homeTeam.id === player.team!.id || entry.awayTeam.id === player.team!.id)) : null;
      const opponent = game && player.team ? (game.homeTeam.id === player.team.id ? game.awayTeam : game.homeTeam) : null;
      const defenseGames = opponent ? await getNFLOpponentDefenseGames(opponent.id, season).catch(() => []) : [];
      const weatherContext = game ? await getNFLWeatherContext(game) : null;
      let injurySourceAvailable = true;
      const injurySnapshot = await getNFLInjurySnapshot().catch(() => {
        injurySourceAvailable = false;
        return null;
      });
      const injuryReports = injurySnapshot?.reports ?? [];
      injurySourceAvailable = injurySourceAvailable && injurySnapshot?.complete === true;
      const participationSnapshot = game ? await getNFLParticipationSnapshot(game) : null;
      const matchupMarkets: Array<[string, Parameters<typeof buildNFLOpponentContext>[0]['market']]> = player.position === 'QB'
        ? [['passing', 'player_pass_yds'], ['rushing', 'player_rush_yds']]
        : player.position === 'RB'
          ? [['rushing', 'player_rush_yds'], ['receiving', 'player_reception_yds']]
          : player.position === 'WR' || player.position === 'TE'
            ? [['receiving', 'player_reception_yds']]
            : [];
      return ok({
        player: { id: player.id, name: player.name, team: player.team?.displayName ?? null, position: player.position },
        gamesLogged: logs.length,
        recentGames: logs.slice(-10),
        roleWorkload: buildNFLPlayerWorkloadProfile(workloadLogs, player.position),
        opponentContext: opponent ? {
          opponent: { id: opponent.id, name: opponent.displayName },
          byPropFamily: Object.fromEntries(matchupMarkets.map(([key, market]) => [key, buildNFLOpponentContext({ opponentTeamId: opponent.id, games: defenseGames, market, position: player.position, season })])),
        } : null,
        injuryContext: {
          byPropFamily: Object.fromEntries(matchupMarkets.map(([key, market]) => [key, buildNFLInjuryContext({
            playerId: player.id, player: player.name, teamId: player.team?.id ?? null, team: player.team?.displayName ?? null,
            opponentTeamId: opponent?.id ?? null, market, position: player.position, reports: injuryReports, sourceAvailable: injurySourceAvailable, snapshot: injurySnapshot,
            participation: participationSnapshot ? evaluateNFLParticipation({ playerId: player.id, teamId: player.team?.id ?? null, position: player.position, snapshot: participationSnapshot, injuries: injurySnapshot }) : null,
          })])),
        },
        weatherContext,
      }, { sport: 'nfl' });
    } catch (error) {
      return fail('PROVIDER_ERROR', error instanceof Error ? error.message : 'NFL provider failed.', { sport: 'nfl' });
    }
  }

  if (sport === 'nba') {
    try {
      const matches = await searchNBAPlayers(args.name);
      if (matches.length === 0) return fail('NOT_FOUND', `No NBA player matched "${args.name}".`, { sport: 'nba' });
      const player = matches[0];
      const logs = await getNBAPlayerGameLogs(player.id);
      return ok({
        player: { id: player.id, name: player.name, team: player.team?.displayName ?? null, position: player.position },
        gamesLogged: logs.length,
        recentGames: logs.slice(-10),
      }, { sport: 'nba' });
    } catch (error) {
      return fail('PROVIDER_ERROR', error instanceof Error ? error.message : 'NBA provider failed.', { sport: 'nba' });
    }
  }

  try {
    const matches = await searchMLBPlayers(args.name);
    if (matches.length === 0) return fail('NOT_FOUND', `No MLB player matched "${args.name}".`, { sport: 'mlb' });
    const player = await getMLBPlayer(matches[0].id);
    const logs = await getPlayerGameLogs(player.id, args.season ?? new Date().getUTCFullYear());
    return ok({
      player: { id: player.id, name: player.name, team: player.currentTeam?.name ?? null, position: player.position, batSide: player.batSide },
      gamesLogged: logs.length,
      recentGames: logs.slice(-10),
    }, { sport: 'mlb' });
  } catch (error) {
    return fail('PROVIDER_ERROR', error instanceof Error ? error.message : 'MLB provider failed.', { sport: 'mlb' });
  }
}

async function getLastResearchSession(context: AgentContext, args: { limit?: number }): Promise<ToolResult<unknown>> {
  const session = context.researchSession;
  if (!session) return fail('NO_CANDIDATES', 'No research session is stored yet. Call get_sportsbook_candidates for a sport and date first.');

  const candidates = session.sport === 'nfl' ? session.candidates.filter((candidate) => candidate.priceCurrent
    && ['LIVE', 'FRESH'].includes(candidate.priceFreshness)
    && classifyStoredPrice(candidate) === 'FRESH'
    && isNFLInjuryContextFresh(candidate.injuryContext as Parameters<typeof isNFLInjuryContextFresh>[0])) : session.candidates;
  if (session.sport === 'nfl' && candidates.length === 0) return fail('NO_CANDIDATES', 'The saved NFL research is no longer current; new pregame research is required.', {
    sport: session.sport, date: session.date, ...session.toolMeta, cached: true,
  });

  // The full structured pool stays server-side for rank_candidates. Sending hundreds of rich
  // records back through the model can exceed its context window before it can issue that rank.
  const limit = args.limit != null ? Math.max(1, Math.min(50, args.limit)) : MAX_RESULTS_CEILING;
  return ok(
    {
      sport: session.sport,
      date: session.date,
      queryIntent: session.queryIntent,
      generatedAt: session.generatedAt,
      candidates: candidates.slice(0, limit),
    },
    {
      sport: session.sport,
      date: session.date,
      ...session.toolMeta,
      cached: true,
    },
  );
}

async function getClosestMissesTool(context: AgentContext, args: { count?: number }): Promise<ToolResult<unknown>> {
  const session = context.researchSession;
  if (!session) return fail('NO_CANDIDATES', 'No research session is stored yet. Call get_sportsbook_candidates for a sport and date first.');

  const count = args.count != null ? Math.max(1, Math.min(20, args.count)) : 5;
  const { constraints, pool } = selectRankedCandidates(session.candidates, context.pendingQueryIntent, { sport: session.sport, nflScope: context.nflScope,
    requireFreshNFLInjury: session.sport === 'nfl' });
  if ((constraints.sport && constraints.sport !== session.sport) || (constraints.date && constraints.date !== session.date)) return fail('NO_CANDIDATES', 'The requested slate does not match the stored research.');
  const misses = getClosestMisses(session.sport === 'nfl' ? { ...session, candidates: pool } : session, count);
  if (misses.length === 0) {
    return fail('NO_CANDIDATES', 'Every stored candidate already qualified as Elite; there are no misses to show.', {
      sport: session.sport, date: session.date, ...session.toolMeta, cached: true,
    });
  }
  return ok(
    { closestMisses: misses },
    { sport: session.sport, date: session.date, ...session.toolMeta, cached: true },
  );
}

// ── registry ──────────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    name: 'get_sport_capabilities',
    description: 'List every sport DeepSide supports and whether it can currently produce researched candidates. Call this before claiming a sport is unavailable.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: 'function' as const,
    name: 'get_slate',
    description: 'Get the game slate for a sport and date. Resolves natural dates like today/tonight/tomorrow.',
    parameters: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'mlb, nfl, nba, soccer or tennis' },
        date: { type: 'string', description: 'today, tonight, tomorrow, yesterday, or YYYY-MM-DD' },
      },
      required: ['sport', 'date'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function' as const,
    name: 'get_sportsbook_candidates',
    description: 'Load researched prop candidates for a slate from the DeepSide sportsbook cache. Returns typed status such as NO_SPORTSBOOK_DATA, SLATE_COMPLETE or BUDGET_LIMITED when props are unavailable.',
    parameters: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'mlb, nfl, nba, soccer or tennis' },
        date: { type: 'string', description: 'today, tonight, tomorrow, yesterday, or YYYY-MM-DD' },
      },
      required: ['sport', 'date'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function' as const,
    name: 'run_elite_filter',
    description: 'Apply deterministic research checks over loaded candidates. NFL uses the requested STANDARD or DEEP publication checks and can return any non-PASS tier, even with zero Elite. Elite qualification is separate and must never be inferred or promoted. Other sports retain their existing Elite filter.',
    parameters: {
      type: 'object',
      properties: {
        sport: { type: 'string' },
        date: { type: 'string' },
        candidateIds: { type: ['array', 'null'], items: { type: 'string' }, description: 'Optional subset. Null analyses every loaded candidate.' },
      },
      required: ['sport', 'date', 'candidateIds'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function' as const,
    name: 'rank_candidates',
    description: 'Filter, rank and limit ALREADY-LOADED candidates from the stored research session. This is the tool for every best/favorite/strongest/top or narrowing request. It reuses the existing pool, assigns deterministic pick tiers after publication hard gates, and ranks eligible NUKE/ELITE/SHARP/EDGE/LEAN candidates. Honors explicit quality floors from the user; PASS candidates appear only when explicitly requested. maxResults is a ceiling, never a quota.',
    parameters: {
      type: 'object',
      properties: {
        sport: { type: 'string' },
        date: { type: 'string' },
        maxResults: { type: ['integer', 'null'], description: `Ceiling, max ${MAX_RESULTS_CEILING}. Defaults to ${MAX_RESULTS_CEILING}.` },
        eliteOnly: { type: ['boolean', 'null'], description: 'Legacy compatibility only. Quality floors are determined exclusively from the user request; default is all publishable tiers from LEAN upward.' },
        playerType: { type: ['string', 'null'], enum: ['hitter', 'pitcher', 'any', null] },
        side: { type: ['string', 'null'], enum: ['over', 'under', 'any', null] },
        team: { type: ['string', 'null'], description: 'Matches either side of the matchup.' },
        player: { type: ['string', 'null'], description: 'Substring match on player name.' },
        marketContains: { type: ['string', 'null'], description: 'Substring match on market label or key, e.g. "strikeout".' },
        positionGroup: { type: ['string', 'null'], description: 'NFL: qb/rb/wr_te/k/def (derived from market role group). NBA: substring of the real ESPN position, e.g. "G" for guards, "F" for forwards, "C" for centers.' },
      },
      required: ['sport', 'date', 'maxResults', 'eliteOnly', 'playerType', 'side', 'team', 'player', 'marketContains', 'positionGroup'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function' as const,
    name: 'research_player',
    description: 'Look up a player (MLB, NFL or NBA) and their recent real game logs.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        season: { type: ['integer', 'null'] },
        sport: { type: ['string', 'null'], description: 'mlb (default), nfl or nba' },
      },
      required: ['name', 'season', 'sport'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function' as const,
    name: 'get_last_research_session',
    description: 'Retrieve the previously loaded research session (sport, date, and every researched candidate with its current pick tier and Elite analysis) without making any new sportsbook or provider calls. Always try this FIRST for follow-up questions about candidates, players, tiers, or results already discussed in this conversation — only call get_sportsbook_candidates when the user asks about a different sport, date, or slate, or when this returns NO_CANDIDATES.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: ['integer', 'null'], description: 'Optional cap on candidates returned (max 50). Null returns all.' },
      },
      required: ['limit'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function' as const,
    name: 'get_closest_misses',
    description: 'From the stored research session, return the non-Elite candidates ordered by how close they came to qualifying (highest researchScore first), each with its exact projection, edge, and rejection reasons. Use this for “why did the closest one fail” or “show me the closest misses” — never re-run get_sportsbook_candidates for this.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: ['integer', 'null'], description: 'How many closest misses to return (max 20). Defaults to 5.' },
      },
      required: ['count'],
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function executeTool(name: string, args: Record<string, unknown>, context: AgentContext): Promise<ToolResult<unknown>> {
  switch (name) {
    case 'get_sport_capabilities': return getSportCapabilities();
    case 'get_slate': return getSlate(context, args as { sport?: string; date?: string });
    case 'get_sportsbook_candidates': return getSportsbookCandidates(context, args as { sport?: string; date?: string });
    case 'run_elite_filter': return runEliteFilter(context, args as { sport?: string; date?: string; candidateIds?: string[] });
    case 'rank_candidates': return rankCandidates(context, args as Parameters<typeof rankCandidates>[1]);
    case 'research_player': return researchPlayer(args as { name?: string; season?: number; sport?: string });
    case 'get_last_research_session': return getLastResearchSession(context, args as { limit?: number });
    case 'get_closest_misses': return getClosestMissesTool(context, args as { count?: number });
    default: return fail('PROVIDER_ERROR', `Unknown tool "${name}".`);
  }
}
