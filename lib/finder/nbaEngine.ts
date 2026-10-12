import { getNBASchedule } from '../nba/schedule';
import { searchNBAPlayers, getNBAPlayer } from '../nba/players';
import { getNBAPlayerGameLogs } from '../nba/stats';
import { getNBAMarketMetadata, NBA_ALTERNATE_MARKET_SUFFIX } from '../nba/oddsTypes';
import { NBA_MARKET_LABELS, type NBAAnalyzableMarket } from '../nba/market';
import { findNBAOddsEvent } from '../nba/odds';
import { getNBAInjuryStatuses, classifyNBAInjuryTier, type NBAInjuryTier } from '../nba/injuries';
import {
  getOddsEventsForSport, getDiscoveredEventPlayerProps, getLastOddsCreditInfo,
  OddsBudgetGuardError, OddsRefreshNotAuthorizedError,
  beginOddsSpendTrackingAsync, getActiveOddsSpendTracker,
  inspectEventPlayerPropsCacheState, isPaidRefreshAllowed,
} from '../odds/client';
import { classifyPriceFreshness, analyzePickCandidate, type PriceFreshness, type EliteResearchAnalysis } from '../ai/eliteResearchFilter';
import { buildNBAEliteCandidate, type NBAResearchCandidate } from '../nba/research';
import { estimateExpectedMinutes } from '../nba/projection';
import { buildNBAHistory, type NBAMarketHistory } from '../nba/history';
import { computeNBAOutlierDependency, type NBAOutlierDependency } from '../nba/outlierAnalysis';
import { buildNBAOpponentContextCache, getNBAOpponentContext, type NBAOpponentContext } from '../nba/opponentContext';
import { computeAlternateLineOptimizer, type AlternateLineOptimizerResult } from './alternateLineOptimizer';
import { computeCrossBookThreshold, type CrossBookThresholdResult } from './crossBookThreshold';
import { computeMarketMovement, type MarketMovementSignal } from './marketMovement';
import { buildNBAFailureModes } from '../nba/failureModes';
import { createNBAContextProvider } from '../nba/context/provider';
import { buildNBAResearchContext } from '../nba/context/engine';
import { buildNBAIntelligence } from '../nba/intelligence/engine';
import type { NBAContextSnapshot } from '../nba/context/types';
import type { NBAIntelligenceSnapshot } from '../nba/intelligence/types';
import { nbaObservedGamesFromAgent2Snapshot, nbaObservedGamesFromLogs, seasonNumberFromAgent2, seasonPhaseForAgent2 } from '../nba/prediction/contextAdapter';
import { predictNBAMarket } from '../nba/prediction/engine';
import type { NBAInjuryEvidence, NBAProjectionResult, NBAObservedGame } from '../nba/prediction/types';
import { selectNBAAsOfHistory } from '../nba/prediction/history';
import { researchNBAGameLines } from '../nba/prediction/gameLines/pipeline';
import { loadCachedNBAPlayerProps } from '../nba/prediction/cachedProps';
import { loadNBAGameIntelligence } from '../nba/prediction/gameLines/intelligenceArchive';
import { todaySlateDate } from '../dateModel';
import type { SportProjection } from '../projection/types';
import type { FinderRunSummary, FinderValidationOptions, ValidationPreflight } from './engine';
import { VALIDATION_COST_PER_EVENT, canAffordNextValidationGame } from './engine';

export const NBA_ODDS_SPORT_KEY = 'basketball_nba';

/** Canonical NBA prop markets used when paid market-discovery is unavailable. */
const NBA_FALLBACK_MARKETS = [
  'player_points', 'player_rebounds', 'player_assists', 'player_threes',
  'player_blocks', 'player_steals', 'player_turnovers',
  'player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists', 'player_rebounds_assists',
];

export type NBAPlayerMatchState = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';

export interface NBACandidate {
  sport: 'nba';
  id: string;
  eventId: string;
  gameId: string;
  playerId: number | null;
  playerName: string;
  playerMatch: NBAPlayerMatchState;
  team: string | null;
  opponent: string | null;
  market: NBAAnalyzableMarket;
  marketLabel: string;
  historicalSupport: 'full' | 'partial' | 'unsupported';
  line: number;
  side: 'over' | 'under';
  book: string;
  oddsAmerican: number;
  isAlternate: boolean;
  priceTimestamp: string | null;
  priceFreshness: PriceFreshness;
  history: NBAMarketHistory | null;
  projection: SportProjection | null;
  injuryTier: NBAInjuryTier | null;
  injuryEvidence: NBAInjuryEvidence;
  nbaPrediction: NBAProjectionResult | null;
  researchContext: import('../nba/context/types').NBAResearchContext | null;
  intelligenceSnapshot: NBAIntelligenceSnapshot | null;
  outlierDependency: NBAOutlierDependency | null;
  alternateLines: AlternateLineOptimizerResult | null;
  crossBookThreshold: CrossBookThresholdResult | null;
  /** Always UNAVAILABLE today: the NBA engine never records timestamped price snapshots (only
   *  MLB's engine.ts does). Reported honestly rather than inferred from a single price observation. */
  marketMovement: MarketMovementSignal;
  howItLoses: string[];
  /** Real ESPN position (e.g. G/F/C), when the player was confidently matched. Never guessed. */
  position: string | null;
  /** Real ESPN team defensive/pace context for the opponent, from a slate-level cache (one request
   *  per unique team, never per candidate). Null when the player's own team could not be resolved. */
  opponentContext: NBAOpponentContext | null;
  /** Fail-closed Elite analysis; null only when the player isn't confidently matched (no official research). */
  eliteAnalysis: EliteResearchAnalysis | null;
}

export interface NBAFinderSummary extends FinderRunSummary {
  gameCandidates?: import('../nba/prediction/gameLines/recommendations').GameRecommendation[];
  modeledGames?: import('../nba/prediction/gameLines/recommendations').ModeledGameResearch[];
  nbaCandidates: NBACandidate[];
  playerMatching: { matched: number; ambiguous: number; unmatched: number };
  marketSupport: { full: number; partial: number; unsupported: number };
}

function modelInjuryEvidence(tier: NBAInjuryTier | null, feedAvailable: boolean): NBAInjuryEvidence {
  if (!feedAvailable) return 'FEED_UNAVAILABLE';
  if (tier == null) return 'REPORT_MISSING';
  if (tier === 'OUT' || tier === 'DOUBTFUL' || tier === 'QUESTIONABLE' || tier === 'UNKNOWN') return tier;
  return 'REPORTED_AVAILABLE';
}

function mergeModelObservations(logs: Awaited<ReturnType<typeof getNBAPlayerGameLogs>>, snapshot: NBAContextSnapshot | null, playerId: number, teamId: number): NBAObservedGame[] {
  const byGame = new Map<string, NBAObservedGame>(nbaObservedGamesFromLogs(logs).map((row) => [row.log.gameId, row]));
  if (snapshot) {
    for (const row of nbaObservedGamesFromAgent2Snapshot(snapshot, playerId, teamId)) {
      if (row.phase === 'UNKNOWN') continue;
      byGame.set(row.log.gameId, row);
    }
  }
  return [...byGame.values()].sort((first, second) => Date.parse(first.log.date) - Date.parse(second.log.date) || first.log.gameId.localeCompare(second.log.gameId));
}

function toSportProjection(result: NBAProjectionResult | null): SportProjection | null {
  if (!result) return null;
  return {
    status: result.expectedStat == null ? 'UNAVAILABLE' : 'OK',
    projection: result.expectedStat,
    uncertainty: result.statUncertainty,
    sampleSize: result.sampleSize,
    reliability: result.reliability,
    reliabilityReasons: result.reasons as SportProjection['reliabilityReasons'],
    method: 'nba_model_v1_rate_minutes_distribution',
    inputs: { modelVersion: result.modelVersion, validationStatus: result.validationStatus, expectedMinutes: result.expectedMinutes,
      minutesUncertainty: result.minutesUncertainty, quoteStatus: result.quoteStatus },
  };
}

/**
 * Resolves a sportsbook player name to one ESPN athlete.
 * Exactly one match = MATCHED. Several plausible matches = AMBIGUOUS (never guessed). None =
 * UNMATCHED. Only MATCHED players carry history/projection into official research.
 */
export async function matchNBAPlayer(
  name: string,
  search: (q: string) => Promise<Array<{ id: number; name: string; position?: string | null }>> = searchNBAPlayers,
): Promise<{ state: NBAPlayerMatchState; playerId: number | null; position: string | null }> {
  const cleaned = name.trim();
  if (cleaned.length < 2) return { state: 'UNMATCHED', playerId: null, position: null };
  let matches: Array<{ id: number; name: string; position?: string | null }>;
  try {
    matches = await search(cleaned);
  } catch {
    return { state: 'UNMATCHED', playerId: null, position: null };
  }
  if (matches.length === 0) return { state: 'UNMATCHED', playerId: null, position: null };
  const exact = matches.filter((m) => m.name.toLowerCase() === cleaned.toLowerCase());
  if (exact.length === 1) return { state: 'MATCHED', playerId: exact[0].id, position: exact[0].position ?? null };
  if (exact.length > 1) return { state: 'AMBIGUOUS', playerId: null, position: null };
  if (matches.length === 1) return { state: 'MATCHED', playerId: matches[0].id, position: matches[0].position ?? null };
  return { state: 'AMBIGUOUS', playerId: null, position: null };
}

/**
 * Real NBA Finder run: schedule -> odds event match -> cached props -> normalization -> player
 * matching -> ESPN game-log history/injury status -> rate x minutes projection -> probability ->
 * Elite analysis.
 *
 * Cost behaviour is identical to MLB/NFL: every sportsbook read goes through the shared odds
 * client, so the persistent cache, freshness states, reserve guard and paid-refresh authorization
 * all apply. With ODDS_ALLOW_PAID_REFRESH=false this can only serve cached data and spends 0 credits.
 */
export async function runNBAFinderDeepSearch(
  slateDate: string = todaySlateDate(),
  options: FinderValidationOptions & { gameLines?: boolean; gameLinesOnly?: boolean } = {},
): Promise<NBAFinderSummary> {
  await beginOddsSpendTrackingAsync();
  const contextProvider = createNBAContextProvider({ maxRequests: 100, maxGamesPerTeam: 8 });
  const contextSnapshotCache = new Map<string, Promise<NBAContextSnapshot>>();
  const contextBundleCache = new Map<string, Promise<{ context: import('../nba/context/types').NBAResearchContext; intelligence: NBAIntelligenceSnapshot } | null>>();
  const scheduled = await getNBASchedule(slateDate).catch(() => []);
  const bettable = scheduled.filter((game) => !game.completed
    && (options.validationGameIds == null || options.validationGameIds.includes(game.id)));
  const slateComplete = scheduled.length > 0 && bettable.length === 0;

  let oddsEvents: Awaited<ReturnType<typeof getOddsEventsForSport>> = [];
  let budgetLimited = false;
  let blockReason: 'RESERVE' | 'NOT_AUTHORIZED' | 'VALIDATION_CREDIT_CAP' | null = null;
  try {
    oddsEvents = await getOddsEventsForSport(NBA_ODDS_SPORT_KEY);
  } catch (error) {
    if (error instanceof OddsBudgetGuardError) { budgetLimited = true; blockReason = 'RESERVE'; }
    else if (error instanceof OddsRefreshNotAuthorizedError) { budgetLimited = true; blockReason = 'NOT_AUTHORIZED'; }
    else if (!options.gameLines && !options.gameLinesOnly) throw error;
  }

  const selectable = bettable
    .map((game) => ({ game, event: findNBAOddsEvent(game.homeTeam.displayName, game.awayTeam.displayName, oddsEvents, slateDate) }))
    .filter((entry): entry is { game: (typeof bettable)[number]; event: NonNullable<ReturnType<typeof findNBAOddsEvent>> } => entry.event != null);
  const games = options.validationMaxGames != null && options.validationMaxGames > 0
    ? selectable.slice(0, options.validationMaxGames)
    : selectable;

  if (options.preflight) {
    const needsPaid = (await Promise.all(games.map(async (entry) => ({ entry, state: await inspectEventPlayerPropsCacheState(entry.event.id, NBA_ODDS_SPORT_KEY) }))))
      .filter(({ state }) => state.props !== 'CACHE_FRESH')
      .map(({ entry }) => entry);
    const preflight: ValidationPreflight = {
      eligibleGames: bettable.length,
      matchedEvents: selectable.length,
      selectedValidationGames: games.length,
      cacheHits: games.length - needsPaid.length,
      cacheMisses: needsPaid.length,
      estimatedPaidSubRequests: needsPaid.length * 2,
      estimatedCreditCostLow: needsPaid.length * VALIDATION_COST_PER_EVENT.low,
      estimatedCreditCostExpected: needsPaid.length * VALIDATION_COST_PER_EVENT.expected,
      estimatedCreditCostHigh: needsPaid.length * VALIDATION_COST_PER_EVENT.high,
      paidRefreshAuthorized: isPaidRefreshAllowed(),
      games: await Promise.all(games.map(async (entry) => ({
        gameId: entry.game.id,
        matchup: `${entry.game.awayTeam.displayName} @ ${entry.game.homeTeam.displayName}`,
        gameTime: entry.game.gameTime ?? null,
        status: entry.game.completed ? 'Final' : 'Scheduled',
        eventId: entry.event.id,
        marketsCacheState: (await inspectEventPlayerPropsCacheState(entry.event.id, NBA_ODDS_SPORT_KEY)).props,
        selected: true,
      }))),
    };
    return {
      results: [], nbaCandidates: [], playerMatching: { matched: 0, ambiguous: 0, unmatched: 0 }, marketSupport: { full: 0, partial: 0, unsupported: 0 },
      gamesAnalyzed: 0, gamesEligible: bettable.length, gamesScheduled: scheduled.length, slateComplete,
      propsAnalyzed: 0, eventsMatched: 0, rawPropsTotal: 0, booksAnalyzed: 0,
      analyzedAt: new Date().toISOString(), slateDate, credits: getLastOddsCreditInfo(),
      fromCache: true, cacheAgeMs: null, budgetLimited: false, blockReason: null, oddsSpend: getActiveOddsSpendTracker(),
      validationPreflight: preflight,
    };
  }

  const gameResearch = options.gameLines || options.gameLinesOnly ? await researchNBAGameLines(bettable, oddsEvents) : null;
  if (options.gameLinesOnly) return {
    results: [], nbaCandidates: [], gameCandidates: gameResearch?.recommendations ?? [], modeledGames: gameResearch?.modeledGames ?? [],
    playerMatching: { matched: 0, ambiguous: 0, unmatched: 0 }, marketSupport: { full: 0, partial: 0, unsupported: 0 },
    gamesAnalyzed: bettable.length, gamesEligible: bettable.length, gamesScheduled: scheduled.length, slateComplete,
    propsAnalyzed: 0, eventsMatched: selectable.length, rawPropsTotal: 0, booksAnalyzed: 0,
    analyzedAt: new Date().toISOString(), slateDate, credits: getLastOddsCreditInfo(), fromCache: true, cacheAgeMs: null,
    budgetLimited, blockReason, oddsSpend: getActiveOddsSpendTracker(),
  };

  // One injury-feed fetch per run, reused across every candidate — never per-player network calls.
  const injuryByPlayerId = new Map<number, NBAInjuryTier>();
  let injuryFeedAvailable = false;
  try {
    const injuries = await getNBAInjuryStatuses();
    injuryFeedAvailable = true;
    for (const injury of injuries) {
      if (injury.playerId != null) injuryByPlayerId.set(injury.playerId, classifyNBAInjuryTier(injury.status));
    }
  } catch {
    // Injury feed unavailable this run: every player falls back to UNKNOWN below, which is a
    // real, honest reliability cap — never silently treated as ACTIVE.
  }

  const candidates: NBACandidate[] = [];
  const booksSeen = new Set<string>();
  const matchCache = new Map<string, { state: NBAPlayerMatchState; playerId: number | null; position: string | null }>();
  const logCache = new Map<number, Awaited<ReturnType<typeof getNBAPlayerGameLogs>>>();
  // Player-team resolution, cached once per player, never once per candidate — needed only to
  // determine which of the game's two teams is the real opponent.
  const playerTeamCache = new Map<number, number | null>();
  // Slate-level opponent-context cache: ONE real ESPN request per unique team across the whole
  // run, reused for every candidate facing that team (never one request per candidate).
  const opponentContextCache = await buildNBAOpponentContextCache(
    games.flatMap(({ game }) => [game.homeTeam.id, game.awayTeam.id]),
  );
  let rawPropsTotal = 0;
  let propsAnalyzed = 0;
  let eventsMatched = 0;
  let sawNetworkCall = false;
  let gamesSkippedByCreditCap = 0;
  let estimatedNextGameCostReported: number | undefined;
  let creditsRemainingInValidationBudgetReported: number | undefined;

  for (const { game, event } of games) {
    // TRUE hard ceiling, computed BEFORE any paid work starts for this game.
    if (options.validationMaxCredits != null) {
      const spent = getActiveOddsSpendTracker()?.creditsSpent ?? 0;
      const estimatedNextGameCost = VALIDATION_COST_PER_EVENT.high;
      if (!canAffordNextValidationGame(spent, options.validationMaxCredits, estimatedNextGameCost)) {
        budgetLimited = true;
        blockReason = 'VALIDATION_CREDIT_CAP';
        estimatedNextGameCostReported = estimatedNextGameCost;
        creditsRemainingInValidationBudgetReported = options.validationMaxCredits - spent;
        gamesSkippedByCreditCap += 1;
        continue;
      }
    }
    let props;
    try {
      props = options.gameLines ? await loadCachedNBAPlayerProps(event.id)
        : await getDiscoveredEventPlayerProps(event.id, undefined, NBA_ODDS_SPORT_KEY, NBA_FALLBACK_MARKETS);
      if (getLastOddsCreditInfo()?.source === 'network') sawNetworkCall = true;
    } catch (error) {
      if (error instanceof OddsBudgetGuardError) { budgetLimited = true; blockReason = 'RESERVE'; }
      else if (error instanceof OddsRefreshNotAuthorizedError) { budgetLimited = true; blockReason ??= 'NOT_AUTHORIZED'; }
      else throw error;
      continue;
    }
    eventsMatched += 1;
    rawPropsTotal += props.length;

    const seen = new Set<string>();
    for (const prop of props) {
      const meta = getNBAMarketMetadata(prop.marketKey);
      // Unsupported markets fail closed — never turned into fake zero-history candidates.
      if (!meta || meta.historicalSupport === 'unsupported') continue;

      for (const [side, odds] of [['over', prop.overOdds] as const, ['under', prop.underOdds] as const]) {
        if (odds == null) continue;
        const key = `${prop.player}|${meta.canonicalMarketKey}|${prop.line}|${side}`;
        if (seen.has(key)) continue;
        seen.add(key);
        propsAnalyzed += 1;
        booksSeen.add(prop.sportsbookKey);

        if (!matchCache.has(prop.player)) matchCache.set(prop.player, await matchNBAPlayer(prop.player));
        const match = matchCache.get(prop.player)!;

        const market = meta.canonicalMarketKey;
        let history: NBAMarketHistory | null = null;
        let projection: SportProjection | null = null;
        let injuryTier: NBAInjuryTier | null = null;
        let eliteAnalysis: EliteResearchAnalysis | null = null;
        let nbaPrediction: NBAProjectionResult | null = null;
        let researchContext: import('../nba/context/types').NBAResearchContext | null = null;
        let intelligenceSnapshot: NBAIntelligenceSnapshot | null = null;
        let candidateTeamId: number | null = null;
        let outlierDependency: NBAOutlierDependency | null = null;
        let howItLoses: string[] = [];
        let opponentContext: NBAOpponentContext | null = null;
        // Reuses the MLB-proven, already sport-agnostic optimizer/cross-book functions — they operate
        // on NormalizedProp[] only, never on MLB-specific types.
        const alternateLines = computeAlternateLineOptimizer(props, prop.player, market, side);
        const crossBookThreshold = computeCrossBookThreshold(props, prop.player, market);

        if (match.state === 'MATCHED' && match.playerId != null) {
          if (!logCache.has(match.playerId)) {
            logCache.set(match.playerId, await getNBAPlayerGameLogs(match.playerId).catch(() => []));
          }
          const logs = logCache.get(match.playerId)!;
          if (!playerTeamCache.has(match.playerId)) {
            const playerTeamId = await getNBAPlayer(match.playerId).then((p) => p.team?.id ?? null).catch(() => null);
            playerTeamCache.set(match.playerId, playerTeamId);
          }
          const playerTeamId = playerTeamCache.get(match.playerId) ?? null;
          candidateTeamId = playerTeamId;
          const contextKey = `${game.id}:${playerTeamId ?? 'unknown'}:${match.playerId}`;
          if (playerTeamId != null && !contextBundleCache.has(contextKey)) {
            contextBundleCache.set(contextKey, (async () => {
              try {
                const snapshotKey = `${game.id}:${playerTeamId}`;
                if (!contextSnapshotCache.has(snapshotKey)) contextSnapshotCache.set(snapshotKey,
                  contextProvider.loadSnapshot({ gameId: game.id, teamId: playerTeamId }).catch((error) => { contextSnapshotCache.delete(snapshotKey); throw error; }));
                const contextSnapshot = await contextSnapshotCache.get(snapshotKey)!;
                const builtContext = buildNBAResearchContext({ playerId: match.playerId!, teamId: playerTeamId, gameId: game.id, asOf: contextSnapshot.asOf }, contextSnapshot);
                const intelligenceTarget = { gameId: contextSnapshot.target.gameId, homeTeamId: contextSnapshot.target.homeTeamId,
                  awayTeamId: contextSnapshot.target.awayTeamId, startsAt: contextSnapshot.target.startsAt,
                  basketballDate: slateDate, matchupAliases: [`${contextSnapshot.target.awayTeamId}@${contextSnapshot.target.homeTeamId}`] };
                const archivedIntelligence = await loadNBAGameIntelligence(contextSnapshot).catch(() => null);
                const builtIntelligence = archivedIntelligence ?? buildNBAIntelligence({ target: intelligenceTarget, asOf: builtContext.asOf, documents: [], claims: [], identities: [],
                  sources: [], researchContexts: [builtContext], missing: ['No authorized reviewed NBA intelligence archive or dated identity directory is configured; no news/coaching claims were inferred.'] });
                return { context: builtContext, intelligence: builtIntelligence };
              } catch {
                contextBundleCache.delete(contextKey);
                return null;
              }
            })());
          }
          const contextBundle = playerTeamId == null ? null : await contextBundleCache.get(contextKey) ?? null;
          researchContext = contextBundle?.context ?? null;
          intelligenceSnapshot = contextBundle?.intelligence ?? null;
          const legacyTier = injuryByPlayerId.get(match.playerId) ?? (injuryFeedAvailable ? 'UNKNOWN' : 'UNKNOWN');
          injuryTier = researchContext?.sections.availability.status === 'OUT' ? 'OUT'
            : researchContext?.sections.availability.status === 'DOUBTFUL' ? 'DOUBTFUL'
              : researchContext?.sections.availability.status === 'QUESTIONABLE' ? 'QUESTIONABLE'
                : researchContext?.sections.availability.status === 'PROBABLE' ? 'QUESTIONABLE'
                  : researchContext?.sections.availability.status === 'AVAILABLE' ? 'ACTIVE' : legacyTier;
          const mergedObservations = mergeModelObservations(logs, contextBundle ? await contextSnapshotCache.get(`${game.id}:${playerTeamId}`)! : null, match.playerId, playerTeamId ?? -1);
          const targetSeason = game.season ?? seasonNumberFromAgent2(researchContext?.seasonId ?? null);
          const targetPhase = game.phase && game.phase !== 'UNKNOWN'
            ? game.phase : researchContext ? seasonPhaseForAgent2(researchContext.sections.season.phase, researchContext.sections.season.round) : 'UNKNOWN';
          const modelPhase = targetPhase === 'PRESEASON' || targetPhase === 'ALL_STAR' ? 'UNKNOWN' : targetPhase;
          const safeHistory = targetSeason == null ? [] : selectNBAAsOfHistory({ observations: mergedObservations, targetTipoff: game.gameTime,
            targetGameId: game.id, targetSeason, targetPhase: modelPhase });
          const phaseLogs = safeHistory.map((row) => row.log);
          const marketHistory = buildNBAHistory(phaseLogs, market, prop.line, side);
          history = marketHistory;
          try {
            nbaPrediction = targetSeason == null ? null : predictNBAMarket({ playerId: match.playerId, teamId: playerTeamId ?? -1,
              playerName: prop.player, market, targetPhase: modelPhase, targetSeason, targetGameId: game.id, targetTipoff: game.gameTime,
              observations: mergedObservations, injury: modelInjuryEvidence(injuryTier, injuryFeedAvailable), researchContext,
              intelligenceSnapshot, line: prop.line, direction: side, americanOdds: odds, sportsbook: prop.sportsbookName,
              quoteTimestamp: prop.lastUpdate, oppositeQuote: (side === 'over' ? prop.underOdds : prop.overOdds) == null ? null : {
                market, line: prop.line, direction: side === 'over' ? 'under' : 'over', americanOdds: (side === 'over' ? prop.underOdds : prop.overOdds)!,
                sportsbook: prop.sportsbookName, quoteTimestamp: prop.lastUpdate ?? '',
              } });
          } catch { nbaPrediction = null; }
          projection = toSportProjection(nbaPrediction);
          outlierDependency = computeNBAOutlierDependency(phaseLogs, market);
          const minutesEstimate = estimateExpectedMinutes(phaseLogs, injuryTier);
          const opponentTeamId = playerTeamId != null
            ? (playerTeamId === game.homeTeam.id ? game.awayTeam.id : playerTeamId === game.awayTeam.id ? game.homeTeam.id : null)
            : null;
          opponentContext = getNBAOpponentContext(opponentContextCache, opponentTeamId);

          const researchCandidate: NBAResearchCandidate = {
            candidateId: `${event.id}|${prop.player}|${meta.canonicalMarketKey}|${prop.line}|${side}|${prop.sportsbookKey}`,
            playerId: match.playerId,
            player: prop.player,
            market,
            line: prop.line,
            direction: side,
            projection: projection?.status === 'OK' ? projection.projection : null,
            projectionUncertainty: projection?.status === 'OK' ? projection.uncertainty : null,
            logs: phaseLogs,
            matchupAvailable: opponentContext != null && opponentContext.status !== 'UNAVAILABLE',
            injuryTier,
            oddsAmerican: odds,
            lastUpdatedAt: prop.lastUpdate ?? null,
            isAlternate: prop.isAlternate ?? prop.marketKey?.endsWith?.(NBA_ALTERNATE_MARKET_SUFFIX) ?? false,
            marketSupport: meta.historicalSupport,
            opponentContextAvailable: opponentContext != null && opponentContext.status !== 'UNAVAILABLE',
          };
          const eliteInput = buildNBAEliteCandidate(researchCandidate);
          const modelRates = nbaPrediction?.historyRates;
          eliteAnalysis = analyzePickCandidate({ ...eliteInput,
            projection: nbaPrediction?.expectedStat ?? null,
            projectionUncertainty: nbaPrediction?.statUncertainty ?? null,
            sampleSize: nbaPrediction?.sampleSize ?? 0,
            historicalRates: modelRates ? [modelRates.l5, modelRates.l10, modelRates.l20, modelRates.season].map((rate) => rate == null ? null : rate * 100) : [],
            matchupAvailable: researchCandidate.matchupAvailable,
            usageAvailable: (nbaPrediction?.opportunitiesUsed.length ?? 0) > 0,
            roleKnown: researchContext?.sections.rotation.recentRole !== 'UNKNOWN' && researchContext != null,
            gameContextAvailable: researchContext != null,
            statusKnown: researchContext?.sections.availability.state === 'AVAILABLE' && researchContext.sections.availability.status !== 'UNKNOWN',
            marketFairProbability: nbaPrediction?.noVigMarketProbability ?? null,
            nbaProbabilityOverride: nbaPrediction?.probabilities == null ? undefined : {
              over: nbaPrediction.probabilities.over, under: nbaPrediction.probabilities.under, push: nbaPrediction.probabilities.push,
              expectedValuePercent: nbaPrediction.expectedValuePercent, fairAmericanOdds: nbaPrediction.fairAmericanOdds,
              noVigMarketProbability: nbaPrediction.noVigMarketProbability, eligibleForReview: nbaPrediction.eligibleForReview, modelVersion: nbaPrediction.modelVersion,
              validationStatus: nbaPrediction.validationStatus,
            },
          });
          howItLoses = buildNBAFailureModes({
            rawEdge: eliteAnalysis.rawEdge,
            sampleSize: history?.windows.season.total ?? null,
            projection: researchCandidate.projection,
            projectionUncertainty: researchCandidate.projectionUncertainty,
            outlierDependency,
            minutesTrend: minutesEstimate.minutesTrend,
            injuryTier,
          });
        }

        candidates.push({
          sport: 'nba',
          id: `${event.id}|${prop.player}|${meta.canonicalMarketKey}|${prop.line}|${side}|${prop.sportsbookKey}`,
          eventId: event.id,
          gameId: game.id,
          playerId: match.playerId,
          playerName: prop.player,
          playerMatch: match.state,
          team: candidateTeamId === game.homeTeam.id ? game.homeTeam.displayName : candidateTeamId === game.awayTeam.id ? game.awayTeam.displayName : null,
          opponent: candidateTeamId === game.homeTeam.id ? game.awayTeam.displayName
            : candidateTeamId === game.awayTeam.id ? game.homeTeam.displayName : `${game.awayTeam.displayName} @ ${game.homeTeam.displayName}`,
          market,
          marketLabel: NBA_MARKET_LABELS[market] ?? market,
          historicalSupport: meta.historicalSupport,
          line: prop.line,
          side,
          book: prop.sportsbookName,
          oddsAmerican: odds,
          isAlternate: prop.isAlternate,
          priceTimestamp: prop.lastUpdate ?? null,
          priceFreshness: classifyPriceFreshness(prop.lastUpdate ?? null),
          history,
          projection,
          injuryTier,
          outlierDependency,
          alternateLines,
          crossBookThreshold,
          position: match.position,
          opponentContext,
          injuryEvidence: modelInjuryEvidence(injuryTier, injuryFeedAvailable),
          nbaPrediction,
          researchContext,
          intelligenceSnapshot,
          marketMovement: computeMarketMovement([]),
          howItLoses,
          eliteAnalysis,
        });
      }
    }
  }

  return {
    // Elite-ranked FinderResults (the rich MLB-parity scorecard) stay empty until NBA has its own
    // signal modules (marketMovement/outlierDependency/etc.); researched NBA candidates carry a
    // real EliteResearchAnalysis each so nothing is presented as an official pick without going
    // through the shared qualification gates.
    results: [],
    nbaCandidates: candidates,
    ...(gameResearch ? { gameCandidates: gameResearch.recommendations, modeledGames: gameResearch.modeledGames } : {}),
    playerMatching: {
      matched: candidates.filter((c) => c.playerMatch === 'MATCHED').length,
      ambiguous: candidates.filter((c) => c.playerMatch === 'AMBIGUOUS').length,
      unmatched: candidates.filter((c) => c.playerMatch === 'UNMATCHED').length,
    },
    marketSupport: {
      full: candidates.filter((c) => c.historicalSupport === 'full').length,
      partial: candidates.filter((c) => c.historicalSupport === 'partial').length,
      unsupported: 0,
    },
    gamesAnalyzed: games.length,
    gamesEligible: bettable.length,
    gamesScheduled: scheduled.length,
    slateComplete,
    propsAnalyzed,
    eventsMatched,
    rawPropsTotal,
    booksAnalyzed: booksSeen.size,
    analyzedAt: new Date().toISOString(),
    slateDate,
    credits: getLastOddsCreditInfo(),
    fromCache: !sawNetworkCall,
    cacheAgeMs: null,
    budgetLimited,
    blockReason,
    oddsSpend: getActiveOddsSpendTracker(),
    ...(gamesSkippedByCreditCap > 0 ? {
      gamesSkippedByCreditCap,
      estimatedNextGameCost: estimatedNextGameCostReported,
      creditsRemainingInValidationBudget: creditsRemainingInValidationBudgetReported,
    } : {}),
  };
}
