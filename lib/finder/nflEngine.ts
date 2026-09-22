import { getNFLSchedule } from '../nfl/schedule';
import { searchNFLPlayers } from '../nfl/players';
import { getPlayerGameLogs as getNFLPlayerGameLogs, getPlayerRoleWorkloadLogs } from '../nfl/stats';
import { getNFLMarketMetadata, NFL_MARKET_LABELS, type NFLAnalyzableMarketKey } from '../nfl/oddsTypes';
import { findNFLOddsEvent } from '../nfl/odds';
import {
  getOddsEventsForSport, getDiscoveredEventPlayerProps, getLastOddsCreditInfo,
  OddsBudgetGuardError, OddsRefreshNotAuthorizedError,
  beginOddsSpendTrackingAsync, getActiveOddsSpendTracker,
  inspectEventPlayerPropsCacheState, isPaidRefreshAllowed,
} from '../odds/client';
import { classifyPriceFreshness, analyzePickCandidate, type PriceFreshness, type EliteResearchAnalysis } from '../ai/eliteResearchFilter';
import { projectNFLMarket } from '../nfl/projection';
import { buildNFLEliteCandidate, type NFLResearchCandidate } from '../nfl/research';
import { buildNFLRoleContext, type NFLRoleContext } from '../nfl/roleContext';
import { buildNFLOpponentContext, getNFLOpponentDefenseGames, type NFLDefenseGame, type NFLOpponentContext } from '../nfl/opponentContext';
import { buildNFLInjuryContext, evaluateNFLPlayerAvailability, getNFLInjuryReports, type NFLInjuryContext, type NFLInjuryReport } from '../nfl/injuries';
import { getNFLWeatherContext, type NFLWeatherContext } from '../nfl/weather';
import { evaluateNFLReliabilityPolicy } from '../nfl/reliabilityPolicy';
import { buildNFLFailureModes } from '../nfl/failureModes';
import { computeNFLOutlierDependency, type NFLOutlierDependency } from '../nfl/outlierAnalysis';
import { buildNFLHistory, type NFLMarketHistory } from '../nfl/history';
import { computeAlternateLineOptimizer, type AlternateLineOptimizerResult } from './alternateLineOptimizer';
import { computeCrossBookThreshold, type CrossBookThresholdResult } from './crossBookThreshold';
import { computeMarketMovement, type MarketMovementSignal } from './marketMovement';
import { todaySlateDate } from '../dateModel';
import type { SportProjection } from '../projection/types';
import type { FinderRunSummary, FinderValidationOptions, ValidationPreflight } from './engine';
import { VALIDATION_COST_PER_EVENT, canAffordNextValidationGame, classifyValidationPreflight } from './engine';

export const NFL_ODDS_SPORT_KEY = 'americanfootball_nfl';
export const NFL_VALIDATION_COST_PER_EVENT = { low: 31, expected: 61, high: 61 } as const;

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
  priceFreshness: PriceFreshness;
  history: NFLMarketHistory | null;
  projection: SportProjection | null;
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
}

export interface NFLFinderSummary extends FinderRunSummary {
  nflCandidates: NFLCandidate[];
  playerMatching: { matched: number; ambiguous: number; unmatched: number };
  marketSupport: { full: number; partial: number; unsupported: number };
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
 * Real NFL Finder run: schedule -> odds event match -> cached props -> normalization -> player
 * matching -> ESPN game-log history -> baseline projection.
 *
 * Cost behaviour is identical to MLB: every sportsbook read goes through the shared odds client, so
 * the persistent cache, freshness states, reserve guard and paid-refresh authorization all apply.
 * With ODDS_ALLOW_PAID_REFRESH=false this can only serve cached data and spends 0 credits.
 */
export async function runNFLFinderDeepSearch(
  slateDate: string = todaySlateDate(),
  options: FinderValidationOptions = {},
): Promise<NFLFinderSummary> {
  await beginOddsSpendTrackingAsync();
  const scheduled = await getNFLSchedule({ date: slateDate }).catch(() => []);
  const bettable = scheduled.filter((game) => !game.completed);
  const slateComplete = scheduled.length > 0 && bettable.length === 0;

  let oddsEvents: Awaited<ReturnType<typeof getOddsEventsForSport>> = [];
  let budgetLimited = false;
  let blockReason: 'RESERVE' | 'NOT_AUTHORIZED' | 'VALIDATION_CREDIT_CAP' | null = null;
  try {
    oddsEvents = await getOddsEventsForSport(NFL_ODDS_SPORT_KEY);
  } catch (error) {
    if (error instanceof OddsBudgetGuardError) { budgetLimited = true; blockReason = 'RESERVE'; }
    else if (error instanceof OddsRefreshNotAuthorizedError) { budgetLimited = true; blockReason = 'NOT_AUTHORIZED'; }
    else throw error;
  }

  const selectable = bettable
    // NFL kickoffs can cross midnight UTC (for example, a Sunday evening local game at 00:15Z
    // Monday). Teams uniquely identify an NFL event on a slate, while forcing the local slate date
    // against the provider's UTC date incorrectly drops that event.
    .map((game) => ({ game, event: findNFLOddsEvent(game.homeTeam.displayName, game.awayTeam.displayName, oddsEvents) }))
    .filter((entry): entry is { game: (typeof bettable)[number]; event: NonNullable<ReturnType<typeof findNFLOddsEvent>> } => entry.event != null);
  const explicitlySelected = options.validationGameIds?.length
    ? selectable.filter((entry) => options.validationGameIds!.includes(entry.game.id))
    : selectable;
  const games = options.validationMaxGames != null && options.validationMaxGames > 0
    ? explicitlySelected.slice(0, options.validationMaxGames)
    : explicitlySelected;

  if (options.preflight) {
    const needsPaid = (await Promise.all(games.map(async (entry) => ({ entry, state: await inspectEventPlayerPropsCacheState(entry.event.id, NFL_ODDS_SPORT_KEY) }))))
      .filter(({ state }) => state.props !== 'CACHE_FRESH')
      .map(({ entry }) => entry);
    const eventListUnavailable = bettable.length > 0 && selectable.length === 0;
    const preflight: ValidationPreflight = {
      eligibleGames: bettable.length,
      matchedEvents: selectable.length,
      selectedValidationGames: games.length,
      cacheHits: games.length - needsPaid.length,
      cacheMisses: needsPaid.length,
      estimatedPaidSubRequests: needsPaid.length * 2,
      estimatedCreditCostLow: eventListUnavailable ? null : needsPaid.length * NFL_VALIDATION_COST_PER_EVENT.low,
      estimatedCreditCostExpected: eventListUnavailable ? null : needsPaid.length * NFL_VALIDATION_COST_PER_EVENT.expected,
      estimatedCreditCostHigh: eventListUnavailable ? null : needsPaid.length * NFL_VALIDATION_COST_PER_EVENT.high,
      estimatedCostStatus: eventListUnavailable ? 'UNKNOWN_UNTIL_EVENT_LIST' : 'KNOWN',
      preflightState: classifyValidationPreflight({ scheduledGames: bettable.length, matchedEvents: selectable.length, cacheMisses: needsPaid.length }),
      paidRefreshAuthorized: isPaidRefreshAllowed(),
      games: await Promise.all(bettable.map(async (game) => {
        const matched = selectable.find((entry) => entry.game.id === game.id);
        return {
          gameId: game.id,
          matchup: `${game.awayTeam.displayName} @ ${game.homeTeam.displayName}`,
          gameTime: game.gameTime ?? null,
          status: game.completed ? 'Final' : 'Scheduled',
          eventId: matched?.event.id ?? null,
          marketsCacheState: matched ? (await inspectEventPlayerPropsCacheState(matched.event.id, NFL_ODDS_SPORT_KEY)).props : 'EVENT_UNAVAILABLE',
          selected: matched != null,
        };
      })),
    };
    return {
      results: [], nflCandidates: [], playerMatching: { matched: 0, ambiguous: 0, unmatched: 0 }, marketSupport: { full: 0, partial: 0, unsupported: 0 },
      gamesAnalyzed: 0, gamesEligible: bettable.length, gamesScheduled: scheduled.length, slateComplete,
      propsAnalyzed: 0, eventsMatched: 0, rawPropsTotal: 0, booksAnalyzed: 0,
      analyzedAt: new Date().toISOString(), slateDate, credits: getLastOddsCreditInfo(),
      fromCache: true, cacheAgeMs: null, budgetLimited: false, blockReason: null, oddsSpend: getActiveOddsSpendTracker(),
      validationPreflight: preflight,
    };
  }

  const candidates: NFLCandidate[] = [];
  const booksSeen = new Set<string>();
  const matchCache = new Map<string, Awaited<ReturnType<typeof matchNFLPlayer>>>();
  const logCache = new Map<number, Awaited<ReturnType<typeof getNFLPlayerGameLogs>>>();
  const roleLogCache = new Map<number, Awaited<ReturnType<typeof getPlayerRoleWorkloadLogs>>>();
  const opponentDefenseCache = new Map<number, Promise<NFLDefenseGame[]>>();
  const weatherContextCache = new Map<string, Promise<NFLWeatherContext>>();
  let injuryReports: NFLInjuryReport[] = [];
  let injurySourceAvailable = true;
  try {
    injuryReports = await getNFLInjuryReports();
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
    // TRUE hard ceiling, computed BEFORE any paid work starts for this game (see
    // canAffordNextValidationGame's doc comment for why an after-the-fact check let 2 games
    // together exceed a 40-credit cap even though neither game alone did).
    if (options.validationMaxCredits != null) {
      const spent = getActiveOddsSpendTracker()?.creditsSpent ?? 0;
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
      props = await getDiscoveredEventPlayerProps(event.id, undefined, NFL_ODDS_SPORT_KEY, NFL_FALLBACK_MARKETS);
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
      const meta = getNFLMarketMetadata(prop.marketKey);
      // Unsupported markets (kicking) fail closed — never turned into fake zero-history candidates.
      if (!meta || meta.historicalSupport === 'unsupported') { unsupportedProps += 1; continue; }

      for (const [side, odds] of [['over', prop.overOdds] as const, ['under', prop.underOdds] as const]) {
        if (odds == null) continue;
        const key = `${prop.player}|${meta.canonicalMarketKey}|${prop.line}|${side}`;
        if (seen.has(key)) continue;
        seen.add(key);
        propsAnalyzed += 1;
        booksSeen.add(prop.sportsbookKey);

        if (!matchCache.has(prop.player)) matchCache.set(prop.player, await matchNFLPlayer(prop.player));
        const match = matchCache.get(prop.player)!;

        const market = meta.canonicalMarketKey as NFLAnalyzableMarketKey;
        let history: NFLMarketHistory | null = null;
        let projection: SportProjection | null = null;
        let eliteAnalysis: EliteResearchAnalysis | null = null;
        let howItLoses: string[] = [];
        let roleContext: NFLRoleContext | null = null;
        let opponentContext: NFLOpponentContext | null = null;
        let injuryContext: NFLInjuryContext | null = null;
        let weatherContext: NFLWeatherContext | null = null;
        let outlierDependency: NFLOutlierDependency | null = null;
        // Reuses the MLB-proven, already sport-agnostic optimizer/cross-book functions — they operate
        // on NormalizedProp[] only, never on MLB-specific types.
        const alternateLines = computeAlternateLineOptimizer(props, prop.player, market, side);
        const crossBookThreshold = computeCrossBookThreshold(props, prop.player, market);
        // Only a confidently matched player may carry official research.
        if (match.state === 'MATCHED' && match.playerId != null) {
          if (!logCache.has(match.playerId)) {
            logCache.set(match.playerId, await getNFLPlayerGameLogs(match.playerId).catch(() => []));
          }
          const logs = logCache.get(match.playerId)!;
          if (!roleLogCache.has(match.playerId)) {
            roleLogCache.set(match.playerId, await getPlayerRoleWorkloadLogs(match.playerId).catch(() => logs));
          }
          roleContext = buildNFLRoleContext(roleLogCache.get(match.playerId)!, market);
          const opponentTeamId = match.teamId === game.homeTeam.id ? game.awayTeam.id : match.teamId === game.awayTeam.id ? game.homeTeam.id : null;
          if (opponentTeamId != null) {
            if (!opponentDefenseCache.has(opponentTeamId)) {
              opponentDefenseCache.set(opponentTeamId, getNFLOpponentDefenseGames(opponentTeamId).catch(() => []));
            }
            opponentContext = buildNFLOpponentContext({
              opponentTeamId,
              games: await opponentDefenseCache.get(opponentTeamId)!,
              market,
              position: match.position,
            });
          }
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
          });
          if (!weatherContextCache.has(game.id)) weatherContextCache.set(game.id, getNFLWeatherContext(game));
          weatherContext = await weatherContextCache.get(game.id)!;
          history = buildNFLHistory(logs, market, prop.line, side);
          projection = projectNFLMarket({ logs, market, roleContext });
          outlierDependency = computeNFLOutlierDependency(logs, market);

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
            matchupAvailable: opponentContext?.status !== 'UNAVAILABLE',
            oddsAmerican: odds,
            lastUpdatedAt: prop.lastUpdate ?? null,
            isAlternate: prop.isAlternate,
            marketSupport: meta.historicalSupport,
            roleContext,
            injuryContext,
            weatherContext,
          };
          eliteAnalysis = analyzePickCandidate(buildNFLEliteCandidate(researchCandidate));
          const availability = evaluateNFLPlayerAvailability(injuryContext);
          if (!availability.eligible) {
            eliteAnalysis = {
              ...eliteAnalysis,
              eliteQualified: false,
              researchQualified: false,
              qualification: 'REJECT',
              rejectedReasons: [...eliteAnalysis.rejectedReasons, availability.reason!],
            };
          }
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
          });
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
        });
      }
    }
  }

  return {
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
