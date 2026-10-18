import { getNFLSchedule } from '../nfl/schedule';
import { searchNFLPlayers } from '../nfl/players';
import { getPlayerGameLogs as getNFLPlayerGameLogs, nflSeasonYear } from '../nfl/stats';
import { getNFLMarketMetadata, NFL_ELITE_MARKETS, NFL_MARKET_LABELS, type NFLAnalyzableMarketKey } from '../nfl/oddsTypes';
import { buildNFLRollingHistory } from '../nfl/rollingHistory';
import { withNFLResearchSnapshot, memoNFLResearchInput, nflResearchNow } from '../nfl/researchSnapshot';
import { withNFLSpendTelemetry, getNFLSpendTelemetry } from '../nfl/spendTelemetry';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getNFLParticipationSnapshot, evaluateNFLParticipation, type NFLParticipationSnapshot } from '../nfl/participation';
import { getNFLSportsbookEvents, retrieveNFLSportsbookGame, inspectNFLSportsbookCoverage, classifyNFLProviderFailure, type NFLProviderFailure } from '../nfl/sportsbook';
import { createNFLSlateLedger, finishNFLSlateLedger, type NFLSlateLedger } from '../nfl/slateLedger';
import { findNFLOddsEvent } from '../nfl/odds';
import {
  getLastOddsCreditInfo,
  withAutomaticOddsRefresh,
  OddsBudgetGuardError, OddsRefreshNotAuthorizedError,
} from '../odds/client';
import { classifyPriceFreshness, ELITE_THRESHOLDS, type PriceFreshness, type EliteResearchAnalysis } from '../ai/eliteResearchFilter';
import { applyNFLGameEnvironmentToProjection, applyNFLMatchupToProjection, projectNFLMarket, type NFLMarketProjection } from '../nfl/projection';
import { analyzeNFLCandidate, type NFLResearchCandidate } from '../nfl/research';
import { buildNFLRoleContext, type NFLRoleContext } from '../nfl/roleContext';
import { buildNFLOpponentContext, getNFLOpponentDefenseGames, type NFLDefenseGame, type NFLOpponentContext } from '../nfl/opponentContext';
import { buildNFLInjuryContext, evaluateNFLPlayerAvailability, getNFLInjurySnapshot, type NFLInjuryContext, type NFLInjuryReport, type NFLInjurySnapshot } from '../nfl/injuries';
import { getNFLWeatherContext, type NFLWeatherContext } from '../nfl/weather';
import { getNFLKickingResearch, type NFLKickingResearch } from '../nfl/kickingResearch';
import { getNFLKickingOpportunity, type NFLKickingOpportunityResult } from '../nfl/kickingOpportunity';
import { buildNFLResearchProfile, reviewNFLSourceConflicts, type NFLResearchProfile, type NFLSourceProvenance } from '../nfl/researchModel';
import { buildNFLPlayerIntelligence, getNFLNewsSnapshot, type NFLNewsSnapshot } from '../nfl/intelligence';
import { buildNFLGameScriptResearch } from '../nfl/gameScript';
import { recordNFLPropPriceSnapshot, summarizeNFLPropPriceMovement } from '../nfl/marketSnapshots';
import { evaluateNFLReliabilityPolicy } from '../nfl/reliabilityPolicy';
import { buildNFLFailureModes } from '../nfl/failureModes';
import { classifyNFLSeasonPhase } from '../nfl/seasonContext';
import { matchesNFLLowThreshold, type NFLResearchMode } from '../nfl/researchIntent';
import { computeNFLOutlierDependency, type NFLOutlierDependency } from '../nfl/outlierAnalysis';
import { buildNFLHistory, type NFLMarketHistory } from '../nfl/history';
import { computeAlternateLineOptimizer, type AlternateLineOptimizerResult } from './alternateLineOptimizer';
import { computeCrossBookThreshold, type CrossBookThresholdResult } from './crossBookThreshold';
import { computeMarketMovement, type MarketMovementSignal } from './marketMovement';
import { todaySlateDate } from '../dateModel';
import type { NFLGame } from '../nfl/types';
import type { FinderRunSummary, FinderValidationOptions, ResearchPriorityGame, ValidationPreflight } from './engine';
import { VALIDATION_COST_PER_EVENT, canAffordNextValidationGame, classifyValidationPreflight } from './engine';

export const NFL_ODDS_SPORT_KEY = 'americanfootball_nfl';
export const NFL_VALIDATION_COST_PER_EVENT = { low: 0, expected: NFL_ELITE_MARKETS.length, high: NFL_ELITE_MARKETS.length } as const;

/** Canonical NFL prop markets used when paid market-discovery is unavailable. */
export const NFL_FALLBACK_MARKETS = [
  'player_pass_yds', 'player_pass_tds', 'player_pass_attempts', 'player_pass_completions', 'player_pass_interceptions', 'player_pass_longest_completion',
  'player_rush_yds', 'player_rush_attempts', 'player_rush_longest', 'player_rush_tds',
  'player_reception_yds', 'player_receptions', 'player_reception_longest', 'player_reception_tds',
  'player_rush_reception_yds', 'player_anytime_td',
];

export type NFLPlayerMatchState = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';

export interface NFLCandidate {
  sport: 'nfl';
  id: string;
  eventId: string;
  gameId: string;
  playerId: number | null;
  position: string | null;
  teamId: number | null;
  opponentTeamId: number | null;
  playerName: string;
  playerMatch: NFLPlayerMatchState;
  team: string | null;
  opponent: string | null;
  market: NFLAnalyzableMarketKey;
  marketLabel: string;
  historicalSupport: 'full' | 'partial' | 'unsupported';
  line: number;
  side: 'over' | 'under';
  book: string;
  oddsAmerican: number;
  isAlternate: boolean;
  priceTimestamp: string | null;
  retrievedAt?: string | null;
  sourceGameId?: string | null;
  priceFreshness: PriceFreshness;
  history: NFLMarketHistory | null;
  projection: NFLMarketProjection | null;
  roleContext: NFLRoleContext;
  opponentContext: NFLOpponentContext | null;
  injuryContext: NFLInjuryContext | null;
  weatherContext: NFLWeatherContext | null;
  alternateLines: AlternateLineOptimizerResult | null;
  crossBookThreshold: CrossBookThresholdResult | null;
  outlierDependency: NFLOutlierDependency | null;
  /** Always UNAVAILABLE today: the NFL engine never records timestamped price snapshots (only
   *  MLB's engine.ts does). Reported honestly rather than inferred from a single price observation. */
  marketMovement: MarketMovementSignal;
  howItLoses: string[];
  /** Fail-closed Elite analysis; null only when the player isn't confidently matched (no official research). */
  eliteAnalysis: EliteResearchAnalysis | null;
  nflResearchProfile?: NFLResearchProfile | null;
  nflKickingResearch?: NFLKickingResearch | null;
}

export interface NFLFinderSummary extends FinderRunSummary {
  nflLedger?: NFLSlateLedger;
  nflCandidates: NFLCandidate[];
  playerMatching: { matched: number; ambiguous: number; unmatched: number };
  marketSupport: { full: number; partial: number; unsupported: number };
}

export interface NFLFinderOptions extends FinderValidationOptions {
  researchMode?: NFLResearchMode;
  lowThreshold?: boolean;
  marketKeys?: NFLAnalyzableMarketKey[];
  playerId?: number | null;
}

const researchObserver = new AsyncLocalStorage<(summary: NFLFinderSummary) => void>();

export function observeNFLResearch<T>(observer: (summary: NFLFinderSummary) => void, operation: () => Promise<T>): Promise<T> {
  return researchObserver.run(observer, operation);
}

const COMPLETED_UNUSED = /final|completed|postponed|cancell?ed|suspended/i;
void COMPLETED_UNUSED;

/**
 * Resolves a sportsbook player name to one ESPN athlete.
 * Exactly one match = MATCHED. Several plausible matches = AMBIGUOUS (never guessed). None =
 * UNMATCHED. Only MATCHED players carry history/projection into official research.
 */
export async function matchNFLPlayer(
  name: string,
  search: (q: string) => Promise<Array<{ id: number; name: string; position?: string; team?: { id: number; displayName: string } | null }>> = searchNFLPlayers,
): Promise<{ state: NFLPlayerMatchState; playerId: number | null; teamId: number | null; teamName: string | null; position: string | null }> {
  const unmatched = { state: 'UNMATCHED' as const, playerId: null, teamId: null, teamName: null, position: null };
  const cleaned = name.trim();
  if (cleaned.length < 2) return unmatched;
  let matches: Array<{ id: number; name: string; position?: string; team?: { id: number; displayName: string } | null }>;
  try {
    matches = await search(cleaned);
  } catch {
    return unmatched;
  }
  if (matches.length === 0) return unmatched;
  const exact = matches.filter((m) => m.name.toLowerCase() === cleaned.toLowerCase());
  const resolved = exact.length === 1 ? exact[0] : exact.length === 0 && matches.length === 1 ? matches[0] : null;
  if (!resolved) return { state: 'AMBIGUOUS', playerId: null, teamId: null, teamName: null, position: null };
  return { state: 'MATCHED', playerId: resolved.id, teamId: resolved.team?.id ?? null, teamName: resolved.team?.displayName ?? null, position: resolved.position ?? null };
}

/**
 * Ranks NFL slate games for research using only free signals (ESPN schedule + odds-cache state), so
 * DeepSide can choose which games are worth a paid refresh *before* spending a single credit.
 *
 * Games whose props are already cached rank highest because researching them costs 0 credits, which
 * is what lets a small authorized budget still produce research instead of blocking on the full slate.
 */
export function rankNFLResearchPriority(
  entries: Array<{ game: NFLGame; eventId: string | null; propsCached: boolean }>,
  selectedGameIds?: string[],
): ResearchPriorityGame[] {
  const selectedSet = selectedGameIds?.length ? new Set(selectedGameIds) : null;
  return entries
    .map(({ game, eventId, propsCached }) => {
      let priority = 0;
      const reasons: string[] = [];
      const unavailableEvidence: string[] = [];
      if (eventId) { priority += 40; reasons.push('Sportsbook event is matched, so this game can be researched.'); }
      else unavailableEvidence.push('Matched sportsbook event');
      if (propsCached) { priority += 30; reasons.push('Player props are already cached — researching this game costs 0 credits.'); }
      else unavailableEvidence.push('Player props (a paid refresh is required)');
      if (game.venue?.name) { priority += 10; reasons.push(`Venue context is available (${game.venue.indoor ? 'indoor' : 'outdoor'}).`); }
      else unavailableEvidence.push('Venue and roof context');
      if (game.homeTeam.id && game.awayTeam.id) { priority += 10; reasons.push('Both team IDs resolve for opponent-defense and injury context.'); }
      else unavailableEvidence.push('Opponent and injury context');
      if (game.gameTime) { priority += 10; reasons.push('Kickoff time is known for weather and price-freshness timing.'); }
      else unavailableEvidence.push('Kickoff time');
      unavailableEvidence.push('Live sportsbook lines', 'Snap-share confirmation');
      const coverage: ResearchPriorityGame['coverage'] = priority >= 80 ? 'HIGH' : priority >= 50 ? 'MEDIUM' : 'LOW';
      return {
        gameId: game.id,
        matchup: `${game.awayTeam.displayName} @ ${game.homeTeam.displayName}`,
        gameTime: game.gameTime ?? null,
        priority,
        coverage,
        selected: false,
        reasons,
        unavailableEvidence,
      };
    })
    .sort((a, b) => b.priority - a.priority || (a.gameTime ?? '').localeCompare(b.gameTime ?? ''))
    .map((game) => ({ ...game, selected: selectedSet ? selectedSet.has(game.gameId) : false }));
}

/**
 * Real NFL Finder run: schedule -> odds event match -> cached props -> normalization -> player
 * matching -> ESPN game-log history -> baseline projection.
 *
 * NFL sportsbook reads use the scoped shared-cache pipeline and request-local header telemetry.
 * Research qualification remains independent of whether markets came from cache or a refresh.
 */
export async function runNFLFinderDeepSearch(
  slateDate: string = todaySlateDate(),
  options: NFLFinderOptions = {},
): Promise<NFLFinderSummary> {
  return withAutomaticOddsRefresh(() => withNFLSpendTelemetry(() => withNFLResearchSnapshot(async () => {
    const summary = await runNFLFinderResearch(slateDate, options);
    if (!options.preflight) researchObserver.getStore()?.(summary);
    return summary;
  })));
}

async function runNFLFinderResearch(slateDate: string, options: NFLFinderOptions): Promise<NFLFinderSummary> {
  const scheduled = await getNFLSchedule({ date: slateDate });
  const selectedScheduled = options.validationGameIds != null ? scheduled.filter((game) => options.validationGameIds!.includes(game.id)) : scheduled;
  const markets = (options.marketKeys ?? NFL_ELITE_MARKETS).filter((market) => NFL_ELITE_MARKETS.includes(market));
  let nflLedger = createNFLSlateLedger(selectedScheduled, slateDate, markets);
  const eligibleIds = new Set(nflLedger.games.filter((game) => game.eligibility === 'PREGAME').map((game) => game.gameId));
  const bettable = selectedScheduled.filter((game) => eligibleIds.has(game.id));
  const slateComplete = scheduled.length > 0 && bettable.length === 0;

  let oddsEvents: Awaited<ReturnType<typeof getNFLSportsbookEvents>> = [];
  let eventFailure: NFLProviderFailure | null = null;
  let budgetLimited = false;
  let blockReason: 'RESERVE' | 'NOT_AUTHORIZED' | 'VALIDATION_CREDIT_CAP' | null = null;
  try {
    if (bettable.length > 0) oddsEvents = await getNFLSportsbookEvents();
  } catch (error) {
    if (error instanceof OddsBudgetGuardError) { budgetLimited = true; blockReason = 'RESERVE'; }
    else if (error instanceof OddsRefreshNotAuthorizedError) { budgetLimited = true; blockReason = 'NOT_AUTHORIZED'; }
    else eventFailure = classifyNFLProviderFailure(error);
  }

  const selectable = bettable
    // NFL kickoffs can cross midnight UTC (for example, a Sunday evening local game at 00:15Z
    // Monday). Teams uniquely identify an NFL event on a slate, while forcing the local slate date
    // against the provider's UTC date incorrectly drops that event.
    .map((game) => ({ game, event: findNFLOddsEvent(game.homeTeam.displayName, game.awayTeam.displayName, oddsEvents) }))
    .filter((entry): entry is { game: (typeof bettable)[number]; event: NonNullable<ReturnType<typeof findNFLOddsEvent>> } => entry.event != null
      && Math.abs(Date.parse(entry.event.commenceTime) - Date.parse(entry.game.gameTime)) <= 15 * 60000);
  for (const row of nflLedger.games.filter((row) => row.eligibility === 'PREGAME')) {
    row.eventId = selectable.find((entry) => entry.game.id === row.gameId)?.event.id ?? null;
    if (!row.eventId) { row.state = 'FAILED'; row.failure = eventFailure ?? 'EVENT_UNAVAILABLE'; }
  }
  const explicitlySelected = options.validationGameIds?.length
    ? selectable.filter((entry) => options.validationGameIds!.includes(entry.game.id))
    : selectable;
  const games = options.validationMaxGames != null && options.validationMaxGames > 0
    ? explicitlySelected.slice(0, options.validationMaxGames)
    : explicitlySelected;

  if (options.preflight) {
    // Inspected once per matched game and reused everywhere below: the cache state drives the cost
    // estimate, the per-game rows and the research-priority ranking, and it must not disagree.
    const cacheCoverage = new Map(await Promise.all(selectable.map(async (entry) => [entry.game.id, await inspectNFLSportsbookCoverage({ date: slateDate, gameId: entry.game.id, eventId: entry.event.id, kickoff: entry.game.gameTime, markets })] as const)));
    const propsCacheStateByGameId = new Map([...cacheCoverage].map(([id, coverage]) => [id, coverage.state]));
    const needsPaid = games.filter((entry) => propsCacheStateByGameId.get(entry.game.id) !== 'CACHE_FRESH');
    const missingMarkets = needsPaid.reduce((total, entry) => total + (cacheCoverage.get(entry.game.id)?.missingMarkets ?? markets.length), 0);
    const eventListUnavailable = bettable.length > 0 && selectable.length === 0;
    const preflight: ValidationPreflight = {
      eligibleGames: bettable.length,
      matchedEvents: selectable.length,
      selectedValidationGames: games.length,
      cacheHits: games.length - needsPaid.length,
      cacheMisses: needsPaid.length,
      estimatedPaidSubRequests: needsPaid.length,
      estimatedCreditCostLow: eventListUnavailable ? null : needsPaid.length * NFL_VALIDATION_COST_PER_EVENT.low,
      estimatedCreditCostExpected: eventListUnavailable ? null : missingMarkets,
      estimatedCreditCostHigh: eventListUnavailable ? null : missingMarkets,
      estimatedCostStatus: eventListUnavailable ? 'UNKNOWN_UNTIL_EVENT_LIST' : 'KNOWN',
      preflightState: classifyValidationPreflight({ scheduledGames: bettable.length, matchedEvents: selectable.length, cacheMisses: needsPaid.length }),
      paidRefreshAuthorized: true,
      // Lets the caller pick the minimum set of high-priority games to refresh instead of being
      // forced to authorize the entire slate before any research can start.
      researchPriorityGames: rankNFLResearchPriority(
        bettable.map((game) => ({
          game,
          eventId: selectable.find((entry) => entry.game.id === game.id)?.event.id ?? null,
          propsCached: propsCacheStateByGameId.get(game.id) === 'CACHE_FRESH',
        })),
        games.map((entry) => entry.game.id),
      ),
      games: selectedScheduled.map((game) => {
        const matched = selectable.find((entry) => entry.game.id === game.id);
        return {
          gameId: game.id,
          matchup: `${game.awayTeam.displayName} @ ${game.homeTeam.displayName}`,
          gameTime: game.gameTime ?? null,
          status: game.completed ? 'Final' : 'Scheduled',
          eventId: matched?.event.id ?? null,
          marketsCacheState: matched ? propsCacheStateByGameId.get(game.id)! : 'EVENT_UNAVAILABLE',
          selected: matched != null,
        };
      }),
    };
    return {
      nflLedger: finishNFLSlateLedger(nflLedger),
      results: [], nflCandidates: [], playerMatching: { matched: 0, ambiguous: 0, unmatched: 0 }, marketSupport: { full: 0, partial: 0, unsupported: 0 },
      gamesAnalyzed: 0, gamesEligible: bettable.length, gamesScheduled: scheduled.length, slateComplete,
      propsAnalyzed: 0, eventsMatched: 0, rawPropsTotal: 0, booksAnalyzed: 0,
      analyzedAt: new Date().toISOString(), slateDate, credits: getLastOddsCreditInfo(),
      fromCache: true, cacheAgeMs: null, budgetLimited: false, blockReason: null, oddsSpend: getNFLSpendTelemetry(),
      validationPreflight: preflight,
    };
  }

  const candidates: NFLCandidate[] = [];
  const booksSeen = new Set<string>();
  const matchCache = new Map<string, Awaited<ReturnType<typeof matchNFLPlayer>>>();
  const logCache = new Map<number, Awaited<ReturnType<typeof getNFLPlayerGameLogs>>>();
  const previousLogCache = new Map<number, Awaited<ReturnType<typeof getNFLPlayerGameLogs>>>();
  const opponentDefenseCache = new Map<number, Promise<NFLDefenseGame[]>>();
  const weatherContextCache = new Map<string, Promise<NFLWeatherContext>>();
  const participationCache = new Map<string, Promise<NFLParticipationSnapshot>>();
  let injuryReports: NFLInjuryReport[] = [];
  let injurySnapshot: NFLInjurySnapshot | null = null;
  let newsSnapshot: NFLNewsSnapshot | null = null;
  let newsSnapshotAttempted = false;
  let injurySourceAvailable = true;
  try {
    injurySnapshot = await getNFLInjurySnapshot();
    injuryReports = injurySnapshot.reports;
    injurySourceAvailable = injurySnapshot.complete;
  } catch {
    injurySourceAvailable = false;
  }
  let rawPropsTotal = 0;
  let propsAnalyzed = 0;
  let eventsMatched = 0;
  let sawNetworkCall = false;
  let gamesSkippedByCreditCap = 0;
  let estimatedNextGameCostReported: number | undefined;
  let creditsRemainingInValidationBudgetReported: number | undefined;
  let unsupportedProps = 0;

  for (const { game, event } of games) {
    const ledgerRow = nflLedger.games.find((row) => row.gameId === game.id)!;
    // TRUE hard ceiling, computed BEFORE any paid work starts for this game (see
    // canAffordNextValidationGame's doc comment for why an after-the-fact check let 2 games
    // together exceed a 40-credit cap even though neither game alone did).
    if (options.validationMaxCredits != null) {
      const spent = getNFLSpendTelemetry()?.creditsSpent ?? 0;
      const estimatedNextGameCost = NFL_VALIDATION_COST_PER_EVENT.high;
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
      const retrieval = await retrieveNFLSportsbookGame({ date: slateDate, gameId: game.id, eventId: event.id, kickoff: game.gameTime, markets });
      Object.assign(ledgerRow, { returnedMarkets: retrieval.returnedMarkets, zeroMarkets: retrieval.zeroMarkets, failedMarkets: retrieval.failedMarkets,
        retrievedAt: retrieval.retrievedAt, expiresAt: retrieval.expiresAt, failure: retrieval.failure, fromCache: retrieval.fromCache });
      if (!retrieval.fromCache) sawNetworkCall = true;
      if (!retrieval.complete) { ledgerRow.state = 'FAILED'; continue; }
      props = retrieval.props;
      ledgerRow.state = props.length ? 'SPORTSBOOK_AVAILABLE' : 'ZERO_MARKETS';
    } catch (error) {
      if (error instanceof OddsBudgetGuardError) { budgetLimited = true; blockReason = 'RESERVE'; }
      else if (error instanceof OddsRefreshNotAuthorizedError) { budgetLimited = true; blockReason ??= 'NOT_AUTHORIZED'; }
      else { ledgerRow.failure = classifyNFLProviderFailure(error); ledgerRow.state = 'FAILED'; }
      continue;
    }
    eventsMatched += 1;
    rawPropsTotal += props.length;

    const seen = new Set<string>();
    for (const prop of props) {
      const meta = getNFLMarketMetadata(prop.marketKey);
      // Unsupported markets fail closed — never turned into fake zero-history candidates.
      if (!meta || meta.historicalSupport !== 'full' || prop.isAlternate || !markets.includes(meta.canonicalMarketKey as NFLAnalyzableMarketKey)) { unsupportedProps += 1; continue; }

      for (const [side, odds] of [['over', prop.overOdds] as const, ['under', prop.underOdds] as const]) {
        if (odds == null) continue;
        const key = `${prop.player}|${meta.canonicalMarketKey}|${prop.line}|${side}|${prop.sportsbookKey}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (!matchCache.has(prop.player)) matchCache.set(prop.player, await matchNFLPlayer(prop.player));
        const match = matchCache.get(prop.player)!;
        if (options.playerId != null && match.playerId !== options.playerId) continue;
        if (match.state === 'MATCHED' && match.teamId !== game.homeTeam.id && match.teamId !== game.awayTeam.id) continue;
        propsAnalyzed += 1;
        booksSeen.add(prop.sportsbookKey);
        ledgerRow.propsEvaluated += 1;

        const market = meta.canonicalMarketKey as NFLAnalyzableMarketKey;
        const isKickingMarket = market === 'player_field_goals' || market === 'player_kicking_points';
        let history: NFLMarketHistory | null = null;
        let projection: NFLMarketProjection | null = null;
        let eliteAnalysis: EliteResearchAnalysis | null = null;
        let howItLoses: string[] = [];
        let roleContext: NFLRoleContext | null = null;
        let opponentContext: NFLOpponentContext | null = null;
        let injuryContext: NFLInjuryContext | null = null;
        let weatherContext: NFLWeatherContext | null = null;
        let nflResearchProfile: NFLResearchProfile | null = null;
        let nflKickingResearch: NFLKickingResearch | null = null;
        let kickingOpponentContext: NFLOpponentContext | null = null;
        const kickingSupportingReasons: string[] = [];
        const kickingCounterReasons: string[] = [];
        const kickingProvenance = new Map<string, NFLSourceProvenance>();
        let outlierDependency: NFLOutlierDependency | null = null;
        let playerPriceHistory: Awaited<ReturnType<typeof recordNFLPropPriceSnapshot>> = [];
        // Reuses the MLB-proven, already sport-agnostic optimizer/cross-book functions — they operate
        // on NormalizedProp[] only, never on MLB-specific types.
        const alternateLines = computeAlternateLineOptimizer(props, prop.player, market, side);
        const crossBookThreshold = computeCrossBookThreshold(props, prop.player, market);
        // Only a confidently matched player may carry official research.
        if (match.state === 'MATCHED' && match.playerId != null) {
          const playerId = match.playerId;
          const season = nflSeasonYear(new Date(game.gameTime));
          if (!logCache.has(match.playerId)) {
            logCache.set(match.playerId, await getNFLPlayerGameLogs(match.playerId, season).catch(() => { ledgerRow.failure = 'RESEARCH_FAILED'; return []; }));
          }
          const current = logCache.get(match.playerId)!.filter((log) => new Date(log.date).getTime() < new Date(game.gameTime).getTime());
          const currentSample = buildNFLRollingHistory({ current, previous: [], season, teamId: match.teamId, position: match.position, market });
          if (currentSample.observations < ELITE_THRESHOLDS.minSampleSize && !previousLogCache.has(match.playerId)) {
            previousLogCache.set(match.playerId, await getNFLPlayerGameLogs(match.playerId, season - 1).catch(() => []));
          }
          const historySample = await memoNFLResearchInput(`history:${game.id}:${playerId}:${market}`, async () => buildNFLRollingHistory({ current, previous: previousLogCache.get(playerId) ?? [], season, teamId: match.teamId, position: match.position, market }));
          const logs = historySample.logs;
          roleContext = await memoNFLResearchInput(`role:${game.id}:${match.playerId}:${market}`, async () => buildNFLRoleContext(logs, market));
          const opponentTeamId = match.teamId === game.homeTeam.id ? game.awayTeam.id : match.teamId === game.awayTeam.id ? game.homeTeam.id : null;
          injuryContext = buildNFLInjuryContext({
            playerId: match.playerId,
            player: prop.player,
            teamId: match.teamId,
            team: match.teamName,
            opponentTeamId,
            market,
            position: match.position,
            reports: injuryReports,
            sourceAvailable: injurySourceAvailable,
            snapshot: injurySnapshot,
            now: new Date(nflResearchNow()),
            participation: await (async () => {
              if (!participationCache.has(game.id)) participationCache.set(game.id, getNFLParticipationSnapshot(game));
              const snapshot = await participationCache.get(game.id)!;
              return snapshot ? memoNFLResearchInput(`availability:${game.id}:${match.playerId}`, async () => evaluateNFLParticipation({ playerId: match.playerId!, teamId: match.teamId, position: match.position, snapshot, injuries: injurySnapshot, now: new Date(nflResearchNow()) })) : null;
            })(),
          });
          history = buildNFLHistory(logs, market, prop.line, side, historySample);
          const seasonPhase = classifyNFLSeasonPhase({ season: game.season ?? season, week: game.week, seasonType: game.seasonType ?? null, playoffRound: game.playoffRound ?? null });
          projection = projectNFLMarket({ logs, market, roleContext, historySample, injuryContext, position: match.position, seasonPhase });
          outlierDependency = computeNFLOutlierDependency(logs, market);
          if (isKickingMarket) {
            if (!weatherContextCache.has(game.id)) weatherContextCache.set(game.id, getNFLWeatherContext(game));
            weatherContext = await weatherContextCache.get(game.id)!;
          }

          const researchCandidate: NFLResearchCandidate = {
            candidateId: `${event.id}|${prop.player}|${meta.canonicalMarketKey}|${prop.line}|${side}|${prop.sportsbookKey}`,
            playerId: match.playerId,
            player: prop.player,
            market,
            line: prop.line,
            direction: side,
            projection: projection.status === 'OK' ? projection.projection : null,
            projectionUncertainty: projection.status === 'OK' ? projection.uncertainty : null,
            logs,
            historySample,
            matchupAvailable: false,
            oddsAmerican: odds,
            lastUpdatedAt: prop.lastUpdate ?? null,
            isAlternate: prop.isAlternate,
            marketSupport: meta.historicalSupport,
            roleContext,
            injuryContext,
            weatherContext,
          };
          eliteAnalysis = analyzeNFLCandidate(researchCandidate);
          const linePreferred = !options.lowThreshold || matchesNFLLowThreshold({ marketKey: market, direction: side, line: prop.line, projection: projection.projection });
          const preliminaryEligible = evaluateNFLPlayerAvailability(injuryContext).eligible && linePreferred
            && odds >= -900 && eliteAnalysis.priceCurrent && eliteAnalysis.valueQualified
            && eliteAnalysis.rawEdge != null && eliteAnalysis.rawEdge > 0
            && (roleContext.status === 'STABLE' || roleContext.status === 'CHANGING')
            && history.gamesUsed >= 5 && eliteAnalysis.trapRisk <= ELITE_THRESHOLDS.trapRisk;
          if (preliminaryEligible) {
            if (opponentTeamId != null) {
              if (!opponentDefenseCache.has(opponentTeamId)) opponentDefenseCache.set(opponentTeamId, getNFLOpponentDefenseGames(opponentTeamId).catch(() => []));
              opponentContext = buildNFLOpponentContext({ opponentTeamId, games: await opponentDefenseCache.get(opponentTeamId)!, market, position: match.position });
            }
            if (!weatherContextCache.has(game.id)) weatherContextCache.set(game.id, getNFLWeatherContext(game));
            weatherContext = await weatherContextCache.get(game.id)!;
            if (options.researchMode === 'DEEP') {
              if (!newsSnapshotAttempted) {
                newsSnapshotAttempted = true;
                try { newsSnapshot = await getNFLNewsSnapshot(new Date(nflResearchNow())); } catch { newsSnapshot = null; }
              }
              playerPriceHistory = await recordNFLPropPriceSnapshot({ eventId: event.id, player: prop.player, marketKey: market,
                sportsbookKey: prop.sportsbookKey, side, line: prop.line, odds, retrievedAt: prop.retrievedAt ?? ledgerRow.retrievedAt ?? null,
                quoteUpdatedAt: prop.lastUpdate ?? null });
            }
          }
          projection = applyNFLMatchupToProjection(projection, { market, position: match.position, season, before: game.gameTime,
            researchMode: options.researchMode ?? 'STANDARD', opponentContext, injuryContext, now: new Date(nflResearchNow()) });
          const gameScript = buildNFLGameScriptResearch(game, match.teamId, new Date(nflResearchNow()).toISOString(), market, side, {
            position: match.position, season, researchMode: options.researchMode ?? 'STANDARD',
            projectionModel: projection.projectionModel, phase3Projection: projection.projection, phase3Uncertainty: projection.uncertainty,
            injuryContext, weatherContext, now: new Date(nflResearchNow()),
          });
          if (isKickingMarket) {
            const opportunity = await memoNFLResearchInput<NFLKickingOpportunityResult>(`kicking-opportunity:${match.teamId}:${opponentTeamId}:${season}:${game.gameTime}`, async () => {
              try {
                if (match.teamId == null || opponentTeamId == null) throw new Error('Resolved matchup team IDs unavailable.');
                return await getNFLKickingOpportunity({ teamId: match.teamId, opponentTeamId, season, before: game.gameTime, currentLogs: current });
              } catch {
                return { facts: {}, evidence: [{ field: 'loader', status: 'UNAVAILABLE', sourceURL: null,
                  retrievedAt: new Date(nflResearchNow()).toISOString(), sampleId: `${game.id}:${match.teamId}`, gameIds: [],
                  reason: 'Kicking opportunity acquisition unavailable; no opportunity counts inferred.' }],
                  missingFields: ['loader'], gameIds: [], sourceURLs: [] };
              }
            });
            const teamTotal = gameScript.value?.homeAway === 'HOME' ? gameScript.value.homeTeamTotal
              : gameScript.value?.homeAway === 'AWAY' ? gameScript.value.awayTeamTotal : null;
            const teamTotalSource = gameScript.provenance.find((source) => source.sourceType === 'SPORTSBOOK');
            const priorLogs = previousLogCache.get(playerId);
            const opportunityFacts = { ...opportunity.facts };
            if (!['fourthDownAttempts', 'fourthDownOpportunities'].every((field) => opportunity.evidence.some((entry) => entry.field === field && entry.status === 'AVAILABLE'))) {
              delete opportunityFacts.fourthDownOpportunities;
            }
            nflKickingResearch = getNFLKickingResearch({
              logs, season, before: game.gameTime, weatherContext, injuryContext,
              ...(priorLogs ? { careerLogs: [...historySample.currentSeason, ...priorLogs.filter((log) => log.result != null && Date.parse(log.date) < Date.parse(game.gameTime))] } : {}),
              opportunity: { ...opportunityFacts, ...(teamTotal != null && teamTotalSource?.retrievedAt ? {
                teamTotal: { value: teamTotal, source: `${teamTotalSource.source} (derived market-implied team total, not observed scoring)`,
                  retrievedAt: teamTotalSource.retrievedAt, sampleId: `${game.id}:${match.teamId}` },
              } : {}) },
            });
            const coverage: NFLKickingResearch['evidence'] = opportunity.evidence.filter((entry) => entry.field !== 'teamTotal' || !nflKickingResearch!.opportunity.facts.teamTotal)
              .map((entry) => ({ id: `opportunity.coverage.${entry.field}`, status: entry.status === 'AVAILABLE' ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
                source: entry.sourceURL, retrievedAt: entry.retrievedAt,
                reason: entry.status === 'AVAILABLE' ? null : `${entry.status}: ${entry.reason ?? 'Complete opportunity coverage unavailable.'}` }));
            for (const field of opportunity.missingFields) {
              if ((field === 'teamTotal' && nflKickingResearch.opportunity.facts.teamTotal) || coverage.some((entry) => entry.id === `opportunity.coverage.${field}`)) continue;
              coverage.push({ id: `opportunity.coverage.${field}`, status: 'UNAVAILABLE', source: null,
                retrievedAt: null, reason: 'Opportunity loader reports missing coverage; no value inferred.' });
            }
            nflKickingResearch.evidence.push(...coverage);
            nflKickingResearch.unavailableEvidence.push(...coverage.filter((entry) => entry.status === 'UNAVAILABLE'));
            const opponentRate = nflKickingResearch.opportunity.opponentRedZoneTouchdownRate;
            const opponentCoverage = opportunity.evidence.filter((entry) => ['opponentRedZoneTrips', 'opponentRedZoneTouchdowns'].includes(entry.field));
            if (opponentTeamId != null && opponentRate?.rate != null
              && ['opponentRedZoneTrips', 'opponentRedZoneTouchdowns'].every((field) => opponentCoverage.some((entry) => entry.field === field && entry.status === 'AVAILABLE'))) {
              kickingOpponentContext = { opponentTeamId, status: 'PARTIAL',
                sampleSize: new Set(opponentCoverage.flatMap((entry) => entry.gameIds)).size, trend: 'INSUFFICIENT_SAMPLE',
                sourceStatus: { provider: 'ESPN', schedule: 'UNAVAILABLE', boxscores: 'AVAILABLE' }, metrics: [], availableMetrics: [],
                missingFields: ['Kicking opportunity context only; opponent efficiency and positional matchup metrics unavailable.'],
                evidence: [`Observed opponent red-zone touchdowns/trips ${opponentRate.numerator}/${opponentRate.denominator}; neutral historical context, not a favorable matchup rating. Source: ${opponentRate.source}; retrieved ${opponentRate.retrievedAt}; sample ${opponentRate.sampleId}.`] };
            }
            const logSource: NFLSourceProvenance = { source: 'ESPN NFL game logs (supplied historical sample only)', sourceType: 'ESPN',
              publishedAt: null, retrievedAt: null, affectedPlayer: prop.player, affectedTeam: match.teamName };
            for (const sample of [nflKickingResearch.recentL3, nflKickingResearch.recentL5, nflKickingResearch.currentSeason, nflKickingResearch.career]) {
              if (!sample) continue;
              const counts = `${sample.label}: ${sample.made.total ?? 'unavailable'} field goals made (${sample.made.observedGames} observed games), ${sample.attempted.total ?? 'unavailable'} exact field-goal attempts (${sample.attempted.observedGames} observed games); source: supplied ESPN game logs.`;
              kickingSupportingReasons.push(counts);
              kickingProvenance.set(counts, logSource);
              if (sample.accuracy?.rate != null) {
                const accuracy = `${sample.label}: paired field-goal accuracy ${sample.accuracy.numerator}/${sample.accuracy.denominator}; not a forecast.`;
                kickingSupportingReasons.push(accuracy);
                kickingProvenance.set(accuracy, logSource);
              }
            }
            const totalFact = nflKickingResearch.opportunity.facts.teamTotal;
            for (const key of ['teamRedZoneTouchdownRate', 'opponentRedZoneTouchdownRate', 'teamRedZoneTripsPerDrive', 'fourthDownAttemptRate'] as const) {
              const rate = nflKickingResearch.opportunity[key];
              if (rate?.rate == null) continue;
              const reason = `Observed kicking opportunity ${key}: ${rate.numerator}/${rate.denominator}; sample ${rate.sampleId}. Neutral historical context, not a directional signal or projection modifier.`;
              kickingSupportingReasons.push(reason);
              kickingProvenance.set(reason, { ...logSource, source: rate.source, retrievedAt: rate.retrievedAt });
            }
            if (totalFact) {
              const totalReason = `Market-implied team total ${totalFact.value}; source: ${totalFact.source}; retrieved ${totalFact.retrievedAt}; sample ${totalFact.sampleId}. A team total does not establish field-goal opportunities.`;
              kickingSupportingReasons.push(totalReason);
              kickingProvenance.set(totalReason, { ...logSource, source: totalFact.source, sourceType: 'SPORTSBOOK', retrievedAt: totalFact.retrievedAt });
            }
            if (weatherContext) {
              const weatherReason = `Kicking weather: ${weatherContext.environment}; wind ${weatherContext.wind?.speed ?? 'unavailable'} mph, gusts ${weatherContext.gusts?.speed ?? 'unavailable'} mph, temperature ${weatherContext.temperature?.value ?? 'unavailable'} F, precipitation ${weatherContext.precipitation?.amount ?? 'unavailable'} in; source: ${weatherContext.sources.forecast ?? weatherContext.sources.venue}; forecast ${weatherContext.forecastTimestamp ?? 'unavailable'}.`;
              kickingSupportingReasons.push(weatherReason);
              kickingProvenance.set(weatherReason, { ...logSource, source: weatherContext.sources.forecast ?? weatherContext.sources.venue,
                sourceType: weatherContext.sources.forecast ? 'WEATHER' : 'ESPN', publishedAt: weatherContext.forecastTimestamp });
            }
            kickingCounterReasons.push(market === 'player_field_goals'
              ? side === 'over' ? 'Field-goal over countercase: touchdowns instead of stalled drives, fourth-down attempts, or missed kicks can leave made field goals below the line.'
                : 'Field-goal under countercase: repeated stalled drives can create additional attempts; historical accuracy does not cap made field goals.'
              : side === 'over' ? 'Kicking-points over countercase: touchdowns may yield only extra points, while fourth-down attempts or missed field goals can remove three-point opportunities.'
                : 'Kicking-points under countercase: additional field-goal attempts or touchdown-driven extra points can exceed the line.');
            const recentAccuracy = nflKickingResearch.recentL5.accuracy;
            if (recentAccuracy?.rate != null) {
              const observedCounter = `Field-goal sample countercase: last 5 supplied games recorded ${recentAccuracy.numerator} made from ${recentAccuracy.denominator} paired attempts (${recentAccuracy.denominator - recentAccuracy.numerator} misses); attempts and conversion are separate uncertainties, not guaranteed future scoring.`;
              kickingCounterReasons.push(observedCounter);
              kickingProvenance.set(observedCounter, logSource);
            }
            kickingCounterReasons.push(...nflKickingResearch.unavailableEvidence.map((evidence) => {
              const reason = `Kicking evidence unavailable: ${evidence.id}; ${evidence.reason} Source: ${evidence.source ?? 'unavailable'}; timestamp: ${evidence.retrievedAt ?? 'unavailable'}.`;
              if (evidence.source) kickingProvenance.set(reason, { ...logSource, source: evidence.source,
                sourceType: evidence.id.startsWith('opportunity.coverage.') ? 'ESPN' : 'UNKNOWN', retrievedAt: evidence.retrievedAt });
              return reason;
            }));
          }
          projection = applyNFLGameEnvironmentToProjection(projection, { market, position: match.position, teamId: match.teamId,
            direction: side, season, researchMode: options.researchMode ?? 'STANDARD', gameScript, injuryContext, weatherContext, now: new Date(nflResearchNow()) });
          if (gameScript.value) gameScript.value.environmentModel = projection.projectionModel?.gameEnvironmentModel;
          researchCandidate.projection = projection.status === 'OK' ? projection.projection : null;
          researchCandidate.projectionUncertainty = projection.status === 'OK' ? projection.uncertainty : null;
          eliteAnalysis = analyzeNFLCandidate({ ...researchCandidate, matchupAvailable: opponentContext?.status !== 'UNAVAILABLE' && opponentContext != null, weatherContext });
          // Deterministic NFL reliability policy (Phase 5): a market-aware, role-derived override
          // on top of the shared Elite Filter — never changes researchScore/thresholds themselves.
          if (eliteAnalysis.eliteQualified) {
            const verdict = evaluateNFLReliabilityPolicy({
              reliability: projection.status === 'OK' ? projection.reliability : null,
              roleRequirement: roleContext.requirement,
              roleStatus: roleContext.status,
            });
            if (!verdict.acceptable) {
              eliteAnalysis = {
                ...eliteAnalysis,
                eliteQualified: false,
                researchQualified: false,
                qualification: 'REJECT',
                rejectedReasons: [...eliteAnalysis.rejectedReasons, verdict.reason!],
              };
            }
          }
          howItLoses = buildNFLFailureModes({
            rawEdge: eliteAnalysis.rawEdge,
            sampleSize: history?.gamesUsed ?? null,
            roleContext,
            projectionUncertainty: researchCandidate.projectionUncertainty,
            projection: researchCandidate.projection,
            outlierDependency,
            historySample, injuryContext, opponentContext, weatherContext,
          });
          howItLoses = [...new Set([...howItLoses, ...(projection.projectionModel?.matchupModel?.counterCase ?? [])])];
          howItLoses = [...new Set([...howItLoses, ...(projection.projectionModel?.gameEnvironmentModel?.counterCase ?? [])])];
          if (isKickingMarket) howItLoses = [...new Set([...howItLoses, ...kickingCounterReasons])];
          const intelligenceItems = newsSnapshot ? buildNFLPlayerIntelligence({ snapshot: newsSnapshot, playerId,
            player: prop.player, teamId: match.teamId, team: match.teamName, opponentTeamId, market,
            retrievedAt: newsSnapshot.fetchedAt }) : [];
          const sourceConflictReview = reviewNFLSourceConflicts({ intelligence: intelligenceItems, injuryContext,
            practiceEvidence: [], candidatePlayer: prop.player, candidateTeam: match.teamName, now: new Date(nflResearchNow()) });
          const marketIntelligence = summarizeNFLPropPriceMovement({ history: playerPriceHistory, currentLine: prop.line, currentPrice: odds,
            retrievedAt: prop.retrievedAt ?? ledgerRow.retrievedAt ?? null, valueQualified: eliteAnalysis.valueQualified, priceCurrent: eliteAnalysis.priceCurrent });
          const sampleConfidence = (count: number | null | undefined): 'HIGH' | 'MEDIUM' | 'LOW' | null => count == null ? null : count >= 10 ? 'HIGH' : count >= 5 ? 'MEDIUM' : 'LOW';
          const scoreRatings = {
            roleOpportunity: { rating: null, evidenceCoverage: roleContext.evidence.length ? 30 : 0, confidence: roleContext.confidence === 'NONE' ? null : roleContext.confidence },
            matchupScheme: { rating: null, evidenceCoverage: opponentContext?.metrics?.length ? Math.min(60, opponentContext.metrics.length * 15) : 0, confidence: opponentContext?.sampleSize ? sampleConfidence(opponentContext.sampleSize) : null },
            expectedGameScript: { rating: null, evidenceCoverage: gameScript.value?.spread != null && gameScript.value.total != null ? 50 : gameScript.value?.spread != null || gameScript.value?.total != null ? 25 : 0, confidence: gameScript.value?.confidence === 'LOW' ? 'LOW' as const : null },
            projectionVsLine: { rating: eliteAnalysis.modelProbability, evidenceCoverage: projection.status === 'OK' && eliteAnalysis.modelProbability != null ? 100 : 0, confidence: projection.status === 'OK' ? projection.reliability === 'HIGH' ? 'HIGH' as const : projection.reliability === 'MEDIUM' ? 'MEDIUM' as const : 'LOW' as const : null },
            injuryLineupImpact: { rating: null, evidenceCoverage: injuryContext?.sourceStatus.status === 'CURRENT' ? 70 : 0, confidence: injuryContext?.sourceStatus.status === 'CURRENT' ? 'MEDIUM' as const : null },
            recentUnderlyingPerformance: { rating: eliteAnalysis.historicalHitRatePercent, evidenceCoverage: Math.min(100, (history?.windows.l10.decisions ?? 0) * 10), confidence: sampleConfidence(history?.windows.l10.decisions) },
            intelligence: { rating: null, evidenceCoverage: newsSnapshot?.status === 'AVAILABLE' ? 100 : 0, confidence: newsSnapshot?.status === 'AVAILABLE' ? 'LOW' as const : null },
            marketMovementPrice: { rating: null, evidenceCoverage: playerPriceHistory.length >= 2 ? 50 : playerPriceHistory.length ? 20 : 0, confidence: playerPriceHistory.length >= 2 ? 'LOW' as const : null },
            weather: { rating: null, evidenceCoverage: weatherContext?.sourceStatus === 'AVAILABLE' || weatherContext?.sourceStatus === 'NOT_APPLICABLE' ? 100 : 0, confidence: weatherContext?.sourceStatus === 'AVAILABLE' ? 'MEDIUM' as const : null },
            historicalContext: { rating: history?.windows.season.hitRate ?? null, evidenceCoverage: Math.min(100, (history?.windows.season.decisions ?? 0) * 10), confidence: sampleConfidence(history?.windows.season.decisions) },
          };
          nflResearchProfile = buildNFLResearchProfile({
            researchMode: options.researchMode ?? 'STANDARD',
            candidateId: `${event.id}|${prop.player}|${meta.canonicalMarketKey}|${prop.line}|${side}|${prop.sportsbookKey}`,
            player: prop.player, team: match.teamName, market, direction: side, line: prop.line, sportsbook: prop.sportsbookName,
            gameSeason: game.season ?? nflSeasonYear(new Date(game.gameTime)), gameWeek: game.week, gameSeasonType: game.seasonType ?? null, playoffRound: game.playoffRound ?? null,
            oddsAmerican: odds, priceTimestamp: prop.lastUpdate ?? null, retrievedAt: prop.retrievedAt ?? null,
            priceCurrent: eliteAnalysis.priceCurrent, priceFreshness: eliteAnalysis.priceFreshness,
            trueProbability: eliteAnalysis.trueProbability, priceEdge: eliteAnalysis.priceEdgePercent,
            valueQualified: eliteAnalysis.valueQualified, existingEliteQualified: eliteAnalysis.eliteQualified,
            dataQuality: eliteAnalysis.dataQuality, rawEdge: eliteAnalysis.rawEdge,
            position: match.position, roleContext, roleLogs: logs, projectionModel: projection.projectionModel ?? null,
            opponentContext: kickingOpponentContext ?? opponentContext, injuryContext, weatherContext, marketSupport: meta.historicalSupport,
            historyGames: history?.gamesUsed ?? null, projectionAvailable: projection.status === 'OK',
            availabilityEligible: evaluateNFLPlayerAvailability(injuryContext).eligible,
            alternatePrices: alternateLines.options.map((option) => ({ sportsbook: option.bestBook, price: option.bestOdds, line: option.line })),
            supportingReasons: [...eliteAnalysis.whyQualified, ...(eliteAnalysis.rawEdge == null ? [] : [`Current-line projection edge: ${eliteAnalysis.rawEdge.toFixed(2)}.`]), ...kickingSupportingReasons],
            counterReasons: [...howItLoses, ...roleContext.unavailableEvidence.map((field) => `Role evidence unavailable: ${field}.`),
              ...(opponentContext?.missingFields ?? []).map((field) => `Scheme evidence unavailable: ${field}.`)],
            intelligenceItems, intelligenceStatus: newsSnapshot?.status ?? 'UNAVAILABLE',
            intelligenceMissingFields: newsSnapshot?.missingFields ?? ['ESPN NFL news feed unavailable'],
            sourceConflictReview, marketIntelligence,
            scoreRatings,
            layerOverrides: { gameScript },
          });
          if (isKickingMarket) {
            for (const evidence of [...nflResearchProfile.evidence.for, ...nflResearchProfile.evidence.against]) {
              const source = kickingProvenance.get(evidence.statement);
              if (source) evidence.source = source;
            }
          }
        }
        roleContext ??= buildNFLRoleContext([], market);

        candidates.push({
          sport: 'nfl',
          id: `${event.id}|${prop.player}|${meta.canonicalMarketKey}|${prop.line}|${side}|${prop.sportsbookKey}`,
          eventId: event.id,
          gameId: game.id,
          playerId: match.playerId,
          position: match.position,
          teamId: match.teamId,
          opponentTeamId: match.teamId === game.homeTeam.id ? game.awayTeam.id : match.teamId === game.awayTeam.id ? game.homeTeam.id : null,
          playerName: prop.player,
          playerMatch: match.state,
          team: match.teamName,
          opponent: match.teamId === game.homeTeam.id ? game.awayTeam.displayName : match.teamId === game.awayTeam.id ? game.homeTeam.displayName : `${game.awayTeam.displayName} @ ${game.homeTeam.displayName}`,
          market,
          marketLabel: NFL_MARKET_LABELS[market] ?? market,
          historicalSupport: meta.historicalSupport,
          line: prop.line,
          side,
          book: prop.sportsbookName,
          oddsAmerican: odds,
          isAlternate: prop.isAlternate,
          priceTimestamp: prop.lastUpdate ?? null,
          retrievedAt: prop.retrievedAt,
          sourceGameId: prop.sourceGameId,
          priceFreshness: classifyPriceFreshness(prop.lastUpdate ?? null),
          history,
          projection,
          roleContext,
          opponentContext,
          injuryContext,
          weatherContext,
          alternateLines,
          crossBookThreshold,
          outlierDependency,
          marketMovement: computeMarketMovement([]),
          howItLoses,
          eliteAnalysis,
          nflResearchProfile,
          ...(isKickingMarket ? { nflKickingResearch } : {}),
        });
      }
    }
    if (ledgerRow.state !== 'ZERO_MARKETS') ledgerRow.state = ledgerRow.failure ? 'FAILED' : 'RESEARCHED';
  }

  for (const row of nflLedger.games) {
    if (row.eligibility === 'PREGAME' && Date.parse(row.kickoff) <= Date.now()) row.eligibility = 'STARTED';
    else if (row.state === 'RESEARCHED' && row.expiresAt != null && row.expiresAt <= Date.now()) { row.state = 'FAILED'; row.failure = 'STALE_PRICE'; }
  }
  nflLedger = finishNFLSlateLedger(nflLedger);
  for (const candidate of candidates) {
    const row = nflLedger.games.find((game) => game.gameId === candidate.gameId);
    if (candidate.eliteAnalysis && (row?.state !== 'RESEARCHED' || row.eligibility !== 'PREGAME' || row.failure != null)) candidate.eliteAnalysis = {
      ...candidate.eliteAnalysis, eliteQualified: false, researchQualified: false, qualification: 'REJECT', whyQualified: [],
      rejectedReasons: [...candidate.eliteAnalysis.rejectedReasons, 'This NFL game research is incomplete or the game is no longer pregame.'],
    };
  }
  return {
    nflLedger,
    // Elite-ranked FinderResults (the rich MLB-parity scorecard) stay empty until NFL has its own
    // signal modules; researched NFL candidates carry a real EliteResearchAnalysis each so nothing
    // is presented as an official pick without going through the shared qualification gates.
    results: [],
    nflCandidates: candidates,
    playerMatching: {
      matched: candidates.filter((c) => c.playerMatch === 'MATCHED').length,
      ambiguous: candidates.filter((c) => c.playerMatch === 'AMBIGUOUS').length,
      unmatched: candidates.filter((c) => c.playerMatch === 'UNMATCHED').length,
    },
    marketSupport: {
      full: candidates.filter((c) => c.historicalSupport === 'full').length,
      partial: candidates.filter((c) => c.historicalSupport === 'partial').length,
      unsupported: unsupportedProps,
    },
    gamesAnalyzed: nflLedger.researchedGames,
    gamesEligible: bettable.length,
    gamesScheduled: selectedScheduled.length,
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
    oddsSpend: getNFLSpendTelemetry(),
    ...(gamesSkippedByCreditCap > 0 ? {
      gamesSkippedByCreditCap,
      estimatedNextGameCost: estimatedNextGameCostReported,
      creditsRemainingInValidationBudget: creditsRemainingInValidationBudgetReported,
    } : {}),
  };
}
