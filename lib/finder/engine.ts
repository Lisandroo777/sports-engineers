import { getMLBSchedule } from '../mlb/schedule';
import type { MLBGame } from '../mlb/types';
import { getPlayerGameLogs } from '../mlb/stats';
import { getMLBPlayer } from '../mlb/players';
import { getEventProps } from '../odds/eventProps';
import { buildAllMarketOpportunities, type AnyMarketOpportunity } from '../odds/anyOpportunities';
import { getLastOddsCreditInfo, OddsBudgetGuardError, OddsRefreshNotAuthorizedError, getOddsEvents, hasCachedEventMarkets, inspectEventPlayerPropsCacheState, isPaidRefreshAllowed, beginOddsSpendTrackingAsync, getActiveOddsSpendTracker, type OddsSpendTracker } from '../odds/client';
import { findOddsEventForTeam, oddsEventSlateDate } from '../odds/match';
import { buildHistoricalSignal } from './signals';
import { buildMatchupSignal } from './matchup';
import { computeFinderScore } from './score';
import { buildExplanation } from './explain';
import { todaySlateDate } from '../dateModel';
import { recordSnapshot, getSnapshotHistory } from '../odds/snapshotStore';
import { computeMarketMovement, type MarketMovementSignal } from './marketMovement';
import { computeOutlierDependency, type OutlierDependency } from './outlierAnalysis';
import { computeVolumeEfficiency, type VolumeEfficiency } from './volumeEfficiency';
import { computeAlternateLineOptimizer, type AlternateLineOptimizerResult } from './alternateLineOptimizer';
import { computeCrossBookThreshold, type CrossBookThresholdResult } from './crossBookThreshold';
import { buildFailureModes } from './failureModes';

const REAL_DATA_SOURCES = ['MLB Stats API (schedule, players, game logs)', 'The Odds API (sportsbook lines and alternates)'];

export interface FinderResult {
  sport: 'mlb' | 'nfl' | 'nba';
  id: string;
  player: string;
  playerId: number | null;
  teamId: number | null;
  teamName: string | null;
  opponentTeamId: number | null;
  opponentName: string | null;
  homeAway: 'home' | 'away' | null;
  gameTimeIso: string | null;
  marketLabel: string;
  marketKey: string;
  line: number;
  side: 'over' | 'under';
  isAlternate: boolean;
  bestBook: { sportsbookName: string; odds: number } | null;
  availableBooks: number;
  evPercent: number | null;
  projection: number | null;
  projectionUncertainty: number | null;
  finderScore: number;
  grade: string | null;
  historical: { l5: string; l10: string; l20: string; l40: string; season: string; l5Rate: number | null; l10Rate: number | null; l20Rate: number | null; seasonRate: number | null };
  signals: string[];
  concerns: string[];
  gameId: string;
  eventId: string;
  marketUpdatedAt: string | null;
  marketMovement: MarketMovementSignal;
  outlierDependency: OutlierDependency;
  volumeEfficiency: VolumeEfficiency;
  alternateLineOptimizer: AlternateLineOptimizerResult;
  crossBookThreshold: CrossBookThresholdResult;
  /** Grounded, computed-only failure modes — never invented flavor text. */
  howItLoses: string[];
  sources: string[];
}

export interface FinderRunSummary {
  results: FinderResult[];
  /** Bettable games actually processed this run \u2014 with no per-run cap, this always equals gamesEligible. */
  gamesAnalyzed: number;
  /** Scheduled games that are not yet final/postponed, i.e. eligible for research regardless of cache state. */
  gamesEligible: number;
  gamesScheduled: number;
  /** Every scheduled game has already finished, so no props can exist for this slate. */
  slateComplete: boolean;
  propsAnalyzed: number;
  /** Games with a matched sportsbook event (before filtering for zero-prop events). */
  eventsMatched: number;
  /** Raw normalized sportsbook props before per-player-market-line-side dedup and opportunity building. */
  rawPropsTotal: number;
  booksAnalyzed: number;
  analyzedAt: string;
  slateDate: string;
  credits: ReturnType<typeof getLastOddsCreditInfo>;
  fromCache: boolean;
  cacheAgeMs: number | null;
  budgetLimited: boolean;
  /** Why a refresh was blocked, so callers never misreport an authorization block as a reserve block. */
  blockReason: 'RESERVE' | 'NOT_AUTHORIZED' | 'VALIDATION_CREDIT_CAP' | null;
  /** Provider-spend observability for this run — credits before/after, paid requests, and cache hit/miss breakdown. */
  oddsSpend: OddsSpendTracker | null;
  /** Present only on a validation preflight (dry run); never set on a normal request. */
  validationPreflight?: ValidationPreflight;
  /** True when a validation spend cap stopped the run before all selected games were processed. */
  validationBudgetLimited?: boolean;
  /** Conservative (worst-case) cost estimate for the next unattempted game when the credit cap stopped the run. */
  estimatedNextGameCost?: number;
  /** validationMaxCredits - creditsSpent at the moment the cap decision was made (only present when validationMaxCredits was set). */
  creditsRemainingInValidationBudget?: number;
  /** Count of games never attempted because starting them could have exceeded validationMaxCredits. */
  gamesSkippedByCreditCap?: number;
}

function bestBookFor(opportunity: AnyMarketOpportunity, all: AnyMarketOpportunity[]) {  const sameLine = all.filter((entry) => entry.player === opportunity.player && entry.marketKey === opportunity.marketKey && entry.line === opportunity.line && entry.side === opportunity.side);
  const best = sameLine.reduce((champion, entry) => (entry.odds > champion.odds ? entry : champion), sameLine[0]);
  return { best, books: new Set(sameLine.map((entry) => entry.sportsbookKey)) };
}

/** Sportsbooks pull props once a game ends, so completed games can never yield candidates. */
const COMPLETED_GAME_STATUSES = /final|game over|completed|postponed|cancell?ed|suspended/i;

/** Observed per-event cost of the two paid sub-requests (markets ~1 + odds 10-30). */
export const VALIDATION_COST_PER_EVENT = { low: 11, expected: 18, high: 31 } as const;

/**
 * TRUE hard-ceiling precheck (fixes the bug where checking spend only BETWEEN games let a 2-game
 * batch land at 53 credits against a 40-credit cap): before starting any paid work for the next
 * game, require creditsSpent + a CONSERVATIVE (worst-case) per-event cost estimate to still fit
 * under validationMaxCredits. If it wouldn't fit, the game is never started — not even partially.
 */
export function canAffordNextValidationGame(
  creditsSpent: number,
  validationMaxCredits: number | undefined,
  estimatedNextGameCost: number = VALIDATION_COST_PER_EVENT.high,
): boolean {
  if (validationMaxCredits == null) return true;
  return creditsSpent + estimatedNextGameCost <= validationMaxCredits;
}

export function classifyValidationPreflight(params: {
  scheduledGames: number;
  matchedEvents: number;
  cacheMisses: number;
}): ValidationPreflight['preflightState'] {
  if (params.scheduledGames === 0) return 'NO_SCHEDULE';
  if (params.matchedEvents === 0) return 'EVENT_LIST_REQUIRED';
  if (params.cacheMisses > 0) return 'SPORTSBOOK_DATA_REQUIRED';
  return 'READY';
}

/** Shell summary used by the preflight dry run, which stops before any research work. */
function emptySummary(slateDate: string, gamesScheduled: number, gamesEligible: number, slateComplete: boolean): FinderRunSummary {
  return {
    results: [], gamesAnalyzed: 0, gamesEligible, gamesScheduled, slateComplete,
    propsAnalyzed: 0, eventsMatched: 0, rawPropsTotal: 0, booksAnalyzed: 0,
    analyzedAt: new Date().toISOString(), slateDate, credits: getLastOddsCreditInfo(),
    fromCache: true, cacheAgeMs: null, budgetLimited: false, blockReason: null, oddsSpend: getActiveOddsSpendTracker(),
  };
}

/**
 * Validation/dev-only knobs for one controlled live test. ALL fields are optional and undefined by
 * default — normal Finder runs analyse every eligible game. These never alter ranking, the Elite
 * Filter, or candidate limits, and they never authorize paid calls on their own
 * (ODDS_ALLOW_PAID_REFRESH is still required).
 */
export interface FinderValidationOptions {
  /** Cap on games ATTEMPTED for this one request. Undefined = no cap (production default). */
  validationMaxGames?: number;
  /** Optional explicit game IDs selected by free pre-screening/manual choice. */
  validationGameIds?: string[];
  /** Hard ceiling on credits this request may spend; stops before the next game when reached. */
  validationMaxCredits?: number;
  /** Dry run: report cache state and cost estimate, then stop before any research or paid call. */
  preflight?: boolean;
  /** Treat selected paid provider data as refresh-required even while its cache TTL is active. */
  forceProviderRefresh?: boolean;
}

export interface ValidationGamePlan {
  gameId: string;
  matchup: string;
  gameTime: string | null;
  status: string;
  eventId: string | null;
  marketsCacheState: string;
  selected: boolean;
}

export interface ResearchPriorityGame {
  gameId: string;
  matchup: string;
  gameTime: string | null;
  priority: number;
  coverage: 'HIGH' | 'MEDIUM' | 'LOW';
  selected: boolean;
  reasons: string[];
  unavailableEvidence: string[];
}

export interface ValidationPreflight {
  eligibleGames: number;
  matchedEvents: number;
  selectedValidationGames: number;
  cacheHits: number;
  cacheMisses: number;
  estimatedPaidSubRequests: number;
  estimatedCreditCostLow: number | null;
  estimatedCreditCostExpected: number | null;
  estimatedCreditCostHigh: number | null;
  estimatedCostStatus?: 'KNOWN' | 'UNKNOWN_UNTIL_EVENT_LIST';
  preflightState?: 'NO_SCHEDULE' | 'EVENT_LIST_REQUIRED' | 'EVENT_MATCH_FAILED' | 'SPORTSBOOK_DATA_REQUIRED' | 'READY';
  eventListDates?: string[];
  researchPriorityGames?: ResearchPriorityGame[];
  paidRefreshAuthorized: boolean;
  games: ValidationGamePlan[];
}

export function rankMLBResearchPriority(games: MLBGame[], selectedCount = games.length, selectedGameIds?: string[]): ResearchPriorityGame[] {
  const selectedSet = selectedGameIds?.length ? new Set(selectedGameIds) : null;
  const ranked = games.map((game) => {
    let priority = 0;
    const reasons: string[] = [];
    const unavailableEvidence: string[] = [];
    const starters = [game.awayProbableStarter, game.homeProbableStarter].filter(Boolean);
    if (starters.length === 2) { priority += 35; reasons.push('Both probable starting pitchers are listed.'); }
    else if (starters.length === 1) { priority += 18; reasons.push('One probable starting pitcher is listed.'); unavailableEvidence.push('One probable starter'); }
    else unavailableEvidence.push('Probable starters');
    const handedness = starters.filter((starter) => starter?.throwingHand).length;
    if (handedness === 2) { priority += 10; reasons.push('Pitcher handedness coverage is available for both starters.'); }
    else if (handedness === 1) { priority += 5; reasons.push('Pitcher handedness coverage is partially available.'); unavailableEvidence.push('One starter handedness'); }
    else unavailableEvidence.push('Pitcher handedness');
    if (game.venue?.stadiumName) { priority += 15; reasons.push('Ballpark context is available.'); }
    else unavailableEvidence.push('Ballpark context');
    if (game.venue?.timezone) priority += 5;
    if (game.awayTeam.id && game.homeTeam.id) { priority += 10; reasons.push('Both team IDs are available for research links/context.'); }
    if (game.awayTeam.record && game.homeTeam.record) { priority += 10; reasons.push('Both team records are available.'); }
    else unavailableEvidence.push('Team record coverage');
    unavailableEvidence.push('Confirmed lineups', 'Weather feed', 'Bullpen exposure', 'Batter handedness splits');
    const coverage: ResearchPriorityGame['coverage'] = priority >= 65 ? 'HIGH' : priority >= 40 ? 'MEDIUM' : 'LOW';
    return { gameId: game.id, matchup: `${game.awayTeam.name} @ ${game.homeTeam.name}`, gameTime: game.gameTime ?? null, priority, coverage, selected: false, reasons, unavailableEvidence };
  }).sort((a, b) => b.priority - a.priority || (a.gameTime ?? '').localeCompare(b.gameTime ?? ''));
  const autoSelected = new Set(ranked.slice(0, selectedCount).map((game) => game.gameId));
  return ranked.map((game) => ({ ...game, selected: selectedSet ? selectedSet.has(game.gameId) : autoSelected.has(game.gameId) }));
}

export async function runFinderDeepSearch(
  slateDate: string = todaySlateDate(),
  options: FinderValidationOptions = {},
): Promise<FinderRunSummary> {
  await beginOddsSpendTrackingAsync();
  const scheduled = await getMLBSchedule(slateDate);
  const bettable = scheduled.filter((game) => !COMPLETED_GAME_STATUSES.test(game.status));
  const slateComplete = scheduled.length > 0 && bettable.length === 0;

  // Every bettable game is eligible for research — no fixed per-run cap. Cost is controlled per-game
  // by the Odds client's own CACHE_FRESH/CACHE_STALE/CACHE_MISSING + isPaidRefreshAllowed() gate
  // (see lib/odds/client.ts), not by truncating the slate. Cached-first ordering just means a slow
  // run still surfaces already-paid-for games' results first.
  const oddsEvents = await getOddsEvents();
  const planned = (await Promise.all([...bettable]
    .map(async (game) => {
      const event =
        findOddsEventForTeam(game.homeTeam.name, oddsEvents, slateDate) ??
        findOddsEventForTeam(game.awayTeam.name, oddsEvents, slateDate);
      return { game, event, cached: event ? await hasCachedEventMarkets(event.id) : false };
    })))
    .sort((a, b) => Number(b.cached) - Number(a.cached));

  // Validation selection is deterministic and edge-blind: only games with a matched sportsbook event,
  // ordered by game time then event id. It never inspects projections or ranking.
  const validationActive = options.validationMaxGames != null && options.validationMaxGames > 0;
  const explicitSelectedIds = options.validationGameIds?.length ? new Set(options.validationGameIds) : null;
  const selectable = planned
    .filter((entry) => entry.event != null)
    .sort((a, b) => (a.game.gameTime ?? '').localeCompare(b.game.gameTime ?? '') || (a.event!.id).localeCompare(b.event!.id));
  const selectedIds = explicitSelectedIds ?? (validationActive
    ? new Set(selectable.slice(0, options.validationMaxGames).map((entry) => entry.game.id))
    : null);

  if (options.preflight) {
    const priorityGames = rankMLBResearchPriority(bettable, options.validationMaxGames ?? bettable.length, options.validationGameIds);
    const selectedPlan = explicitSelectedIds ? selectable.filter((entry) => explicitSelectedIds.has(entry.game.id)) : validationActive ? selectable.slice(0, options.validationMaxGames) : selectable;
    const needsPaid = options.forceProviderRefresh
      ? selectedPlan
      : (await Promise.all(selectedPlan.map(async (entry) => ({ entry, state: await inspectEventPlayerPropsCacheState(entry.event!.id) }))))
        .filter(({ state }) => state.props !== 'CACHE_FRESH')
        .map(({ entry }) => entry);
    const subRequests = needsPaid.length * 2;
    const eventListDates = [...new Set(oddsEvents.map(oddsEventSlateDate))].sort();
    const preflightState = classifyValidationPreflight({ scheduledGames: scheduled.length, matchedEvents: selectable.length, cacheMisses: needsPaid.length });
    const eventListUnavailable = preflightState === 'EVENT_LIST_REQUIRED';
    return {
      ...emptySummary(slateDate, scheduled.length, bettable.length, slateComplete),
      validationPreflight: {
        eligibleGames: bettable.length,
        matchedEvents: selectable.length,
        selectedValidationGames: selectedPlan.length,
        cacheHits: selectedPlan.length - needsPaid.length,
        cacheMisses: needsPaid.length,
        estimatedPaidSubRequests: eventListUnavailable ? 0 : subRequests,
        estimatedCreditCostLow: eventListUnavailable ? null : needsPaid.length * VALIDATION_COST_PER_EVENT.low,
        estimatedCreditCostExpected: eventListUnavailable ? null : needsPaid.length * VALIDATION_COST_PER_EVENT.expected,
        estimatedCreditCostHigh: eventListUnavailable ? null : needsPaid.length * VALIDATION_COST_PER_EVENT.high,
        estimatedCostStatus: eventListUnavailable ? 'UNKNOWN_UNTIL_EVENT_LIST' : 'KNOWN',
        preflightState,
        eventListDates,
        researchPriorityGames: priorityGames,
        paidRefreshAuthorized: isPaidRefreshAllowed(),
        games: await Promise.all(selectable.map(async (entry) => ({
          gameId: entry.game.id,
          matchup: `${entry.game.awayTeam.name} @ ${entry.game.homeTeam.name}`,
          gameTime: entry.game.gameTime ?? null,
          status: entry.game.status,
          eventId: entry.event!.id,
          marketsCacheState: (await inspectEventPlayerPropsCacheState(entry.event!.id)).props,
          selected: selectedPlan.some((s) => s.game.id === entry.game.id),
        }))),
      },
    };
  }

  const games = (selectedIds ? planned.filter((entry) => selectedIds.has(entry.game.id)) : planned).map((entry) => entry.game);
  const playerLogCache = new Map<number, Awaited<ReturnType<typeof getPlayerGameLogs>>>();
  const playerTeamCache = new Map<number, number | null>();
  const results: FinderResult[] = [];
  const booksSeen = new Set<string>();
  let propsAnalyzed = 0;
  let rawPropsTotal = 0;
  let eventsMatched = 0;
  let sawNetworkCall = false;
  let maxCacheAgeMs: number | null = null;
  let budgetLimited = false;
  let blockReason: 'RESERVE' | 'NOT_AUTHORIZED' | 'VALIDATION_CREDIT_CAP' | null = null;
  let validationBudgetLimited = false;
  let gamesSkippedByCreditCap = 0;
  let estimatedNextGameCostReported: number | undefined;
  let creditsRemainingInValidationBudgetReported: number | undefined;

  for (const game of games) {
    // TRUE hard ceiling: computed BEFORE any paid work starts for this game, using a conservative
    // (worst-case) per-event cost. Checking only AFTER a game finished let a 2-game batch exceed
    // the cap (game 1 alone under the cap, but game 1 + game 2 over it) — see canAffordNextValidationGame.
    if (options.validationMaxCredits != null) {
      const spent = getActiveOddsSpendTracker()?.creditsSpent ?? 0;
      const estimatedNextGameCost = VALIDATION_COST_PER_EVENT.high;
      if (!canAffordNextValidationGame(spent, options.validationMaxCredits, estimatedNextGameCost)) {
        validationBudgetLimited = true;
        budgetLimited = true;
        blockReason = 'VALIDATION_CREDIT_CAP';
        estimatedNextGameCostReported = estimatedNextGameCost;
        creditsRemainingInValidationBudgetReported = options.validationMaxCredits - spent;
        gamesSkippedByCreditCap += 1;
        continue;
      }
    }
    let eventProps;
    try {
      eventProps = await getEventProps(game.homeTeam.name, game.awayTeam.name, slateDate);
      const info = getLastOddsCreditInfo();
      if (info) {
        if (info.source === 'network') sawNetworkCall = true;
        if (info.cacheAgeMs != null) maxCacheAgeMs = Math.max(maxCacheAgeMs ?? 0, info.cacheAgeMs);
      }
    } catch (error) {
      if (error instanceof OddsBudgetGuardError) { budgetLimited = true; blockReason = 'RESERVE'; }
      else if (error instanceof OddsRefreshNotAuthorizedError) { budgetLimited = true; blockReason ??= 'NOT_AUTHORIZED'; }
      continue;
    }
    if (eventProps.event) eventsMatched += 1;
    if (!eventProps.event || eventProps.props.length === 0) continue;
    rawPropsTotal += eventProps.props.length;

    const opportunities = buildAllMarketOpportunities(eventProps.props);
    propsAnalyzed += opportunities.length;
    opportunities.forEach((opportunity) => booksSeen.add(opportunity.sportsbookKey));

    const seenPlayerMarketLine = new Set<string>();
    for (const opportunity of opportunities) {
      const dedupeKey = `${opportunity.player}|${opportunity.marketKey}|${opportunity.line}|${opportunity.side}`;
      if (seenPlayerMarketLine.has(dedupeKey)) continue;
      seenPlayerMarketLine.add(dedupeKey);

      const { best, books } = bestBookFor(opportunity, opportunities);

      // Persist the best-price observation (no extra API cost — this is data we already fetched)
      // so future runs can detect real line/price movement instead of ever inventing a trend.
      let marketMovement: MarketMovementSignal = { available: false, direction: 'unavailable', openingOdds: null, currentOdds: null, observedOverMinutes: null, pointCount: 0, label: null };
      if (best) {
        const snapshotParts = { eventId: opportunity.eventId, player: opportunity.player, marketKey: opportunity.marketKey, line: opportunity.line, sportsbookKey: best.sportsbookKey, side: opportunity.side };
        await recordSnapshot(snapshotParts, best.odds);
        marketMovement = computeMarketMovement(await getSnapshotHistory(snapshotParts));
      }

      let historical = { available: false } as ReturnType<typeof buildHistoricalSignal>;
      let opposingPitcherId: number | null = null;
      let resolvedTeamId: number | null = null;
      let outlier: OutlierDependency = { available: false, sampleGames: 0, raw: { games: 0, total: 0, mean: null }, withoutTopGame: { games: 0, total: 0, mean: null }, withoutTop2Games: { games: 0, total: 0, mean: null }, explosiveDependencePercent: null, median: null, standardDeviation: null };
      let volumeEfficiency: VolumeEfficiency = { available: false, basis: 'unavailable', estimatedVolume: null, requiredRatePerUnit: null, actualRatePerUnit: null, meetsRequiredRate: null };
      let historicalSampleGames = 0;

      if (opportunity.playerId) {
        try {
          if (!playerLogCache.has(opportunity.playerId)) {
            playerLogCache.set(opportunity.playerId, await getPlayerGameLogs(opportunity.playerId, new Date().getUTCFullYear()));
          }
          if (opportunity.historicalAnalysisAvailable) {
            // Only games strictly before the selected slate date count as history — critical for "Tomorrow" runs.
            const historicalLogs = playerLogCache.get(opportunity.playerId)!.filter((log) => log.date < slateDate);
            historical = buildHistoricalSignal(historicalLogs, opportunity.marketKey, opportunity.line, opportunity.side);
            historicalSampleGames = historicalLogs.length;
            const isPitcher = opportunity.marketKey.startsWith('pitcher_');
            outlier = computeOutlierDependency(historicalLogs, opportunity.marketKey);
            volumeEfficiency = computeVolumeEfficiency(historicalLogs, opportunity.marketKey, opportunity.line, opportunity.side, isPitcher);
          }

          if (!playerTeamCache.has(opportunity.playerId)) {
            const player = await getMLBPlayer(opportunity.playerId);
            playerTeamCache.set(opportunity.playerId, player.currentTeam?.id ?? null);
          }
          const teamId = playerTeamCache.get(opportunity.playerId);
          resolvedTeamId = teamId ?? null;
          if (teamId === game.homeTeam.id) opposingPitcherId = game.awayProbableStarter?.id ?? null;
          else if (teamId === game.awayTeam.id) opposingPitcherId = game.homeProbableStarter?.id ?? null;
        } catch { /* leave signals unavailable */ }
      }

      const alternateLineOptimizer = computeAlternateLineOptimizer(eventProps.props, opportunity.player, opportunity.marketKey, opportunity.side);
      const crossBookThreshold = computeCrossBookThreshold(eventProps.props, opportunity.player, opportunity.marketKey);
      const howItLoses = buildFailureModes({
        side: opportunity.side,
        line: opportunity.line,
        recentAverage: historical.available ? historical.recentAverage : null,
        consistency: historical.available ? historical.consistency : null,
        outlier,
        volumeEfficiency,
        sampleSize: historical.available ? historicalSampleGames : null,
      });

      const matchup = await buildMatchupSignal(opposingPitcherId, opportunity.marketKey, opportunity.side);
      const scoreResult = computeFinderScore({
        historical,
        matchup,
        evPercent: opportunity.evPercent,
        marketAgreement: opportunity.marketAgreement,
        availableBooks: books.size,
        historicalAnalysisAvailable: opportunity.historicalAnalysisAvailable,
      });

      if (process.env.FINDER_DEBUG === '1') {
        console.log('[finder-debug]', opportunity.player, opportunity.marketKey, opportunity.side, opportunity.line, 'score=', scoreResult.score, 'components=', scoreResult.components, 'historical.available=', historical.available, 'ev=', opportunity.evPercent);
      }
      // Every priced opportunity is ranked; only Elite/Strong/Good/Watch (>=75) receive a Pick Grade label (getFinderGrade returns null otherwise).
      // This keeps the Top 10 list meaningful even on slates with no Elite-tier plays, instead of hiding real analysis.

      const explanation = buildExplanation({
        player: opportunity.player,
        marketLabel: opportunity.marketLabel,
        side: opportunity.side,
        line: opportunity.line,
        historical,
        matchup,
        evPercent: opportunity.evPercent,
        bestBookName: best?.sportsbookName ?? null,
        isBestPrice: best?.sportsbookKey === opportunity.sportsbookKey,
        availableBooks: books.size,
      });

      results.push({
        sport: 'mlb',
        id: opportunity.id,
        player: opportunity.player,
        playerId: opportunity.playerId ?? null,
        teamId: resolvedTeamId,
        teamName: resolvedTeamId === game.homeTeam.id ? game.homeTeam.name : resolvedTeamId === game.awayTeam.id ? game.awayTeam.name : null,
        opponentTeamId: resolvedTeamId === game.homeTeam.id ? game.awayTeam.id : resolvedTeamId === game.awayTeam.id ? game.homeTeam.id : null,
        opponentName: resolvedTeamId === game.homeTeam.id ? game.awayTeam.name : resolvedTeamId === game.awayTeam.id ? game.homeTeam.name : null,
        homeAway: resolvedTeamId === game.homeTeam.id ? 'home' : resolvedTeamId === game.awayTeam.id ? 'away' : null,
        gameTimeIso: game.gameTime ?? null,
        marketLabel: opportunity.marketLabel,
        marketKey: opportunity.marketKey,
        line: opportunity.line,
        projection: historical.available ? historical.recentAverage : null,
        projectionUncertainty: historical.available ? historical.consistency : null,
        side: opportunity.side,
        isAlternate: opportunity.isAlternate,
        bestBook: best ? { sportsbookName: best.sportsbookName, odds: best.odds } : null,
        availableBooks: books.size,
        evPercent: opportunity.evPercent,
        finderScore: scoreResult.score,
        grade: scoreResult.grade,
        historical: {
          l5: historical.available ? `${historical.windows.l5.hits}/${historical.windows.l5.total}` : 'unavailable',
          l10: historical.available ? `${historical.windows.l10.hits}/${historical.windows.l10.total}` : 'unavailable',
          l20: historical.available ? `${historical.windows.l20.hits}/${historical.windows.l20.total}` : 'unavailable',
          l40: historical.available ? `${historical.windows.l40.hits}/${historical.windows.l40.total}` : 'unavailable',
          season: historical.available ? `${historical.windows.season.hits}/${historical.windows.season.total}` : 'unavailable',
          l5Rate: historical.available ? historical.windows.l5.rate : null,
          l10Rate: historical.available ? historical.windows.l10.rate : null,
          l20Rate: historical.available ? historical.windows.l20.rate : null,
          seasonRate: historical.available ? historical.windows.season.rate : null,
        },
        signals: marketMovement.available && marketMovement.direction === 'shortened' ? [...explanation.signals, marketMovement.label!] : explanation.signals,
        concerns: marketMovement.available && marketMovement.direction === 'lengthened' ? [...explanation.concerns, marketMovement.label!] : explanation.concerns,
        gameId: game.id,
        eventId: opportunity.eventId,
        marketUpdatedAt: opportunity.lastUpdate ?? null,
        marketMovement,
        outlierDependency: outlier,
        volumeEfficiency,
        alternateLineOptimizer,
        crossBookThreshold,
        howItLoses,
        sources: REAL_DATA_SOURCES,
      });
    }
  }

  results.sort((a, b) => b.finderScore - a.finderScore);
  return {
    // Every valid, deduped opportunity above is already fully researched and scored — no cap here.
    // Callers (rank_candidates, the UI) apply Elite Filter + a top-15 display cap afterward.
    results,
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
    cacheAgeMs: maxCacheAgeMs,
    budgetLimited,
    blockReason,
    oddsSpend: getActiveOddsSpendTracker(),
    validationBudgetLimited,
    ...(gamesSkippedByCreditCap > 0 ? {
      gamesSkippedByCreditCap,
      estimatedNextGameCost: estimatedNextGameCostReported,
      creditsRemainingInValidationBudget: creditsRemainingInValidationBudgetReported,
    } : {}),
  };
}
