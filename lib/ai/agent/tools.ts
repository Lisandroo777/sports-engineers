import { runFinderDeepSearch, type FinderResult, type FinderRunSummary, type FinderValidationOptions } from '../../finder/engine';
import { runNFLFinderDeepSearch, type NFLFinderSummary } from '../../finder/nflEngine';
import { runNBAFinderDeepSearch, type NBAFinderSummary } from '../../finder/nbaEngine';
import { getMLBSchedule } from '../../mlb/schedule';
import { getNFLSchedule } from '../../nfl/schedule';
import { getNBASchedule } from '../../nba/schedule';
import { getMLBPlayer, searchMLBPlayers } from '../../mlb/players';
import { getPlayerGameLogs } from '../../mlb/stats';
import { searchNFLPlayers } from '../../nfl/players';
import { getPlayerGameLogs as getNFLPlayerGameLogs, getPlayerRoleWorkloadLogs } from '../../nfl/stats';
import { buildNFLPlayerWorkloadProfile } from '../../nfl/roleContext';
import { buildNFLOpponentContext, getNFLOpponentDefenseGames } from '../../nfl/opponentContext';
import { buildNFLInjuryContext, getNFLInjuryReports, isNFLPlayerAvailabilityKnown } from '../../nfl/injuries';
import { getNFLWeatherContext } from '../../nfl/weather';
import { searchNBAPlayers } from '../../nba/players';
import { getNBAPlayerGameLogs } from '../../nba/stats';
import { NFL_QB_MARKETS, NFL_RB_MARKETS, NFL_WR_TE_MARKETS, NFL_KICKER_MARKETS, NFL_DEFENSE_MARKETS } from '../../nfl/oddsTypes';
import { SPORT_RESEARCH_ADAPTERS, normalizeSport, type SupportedSport } from '../sportResearchAdapters';
import { OddsBudgetGuardError, OddsRefreshNotAuthorizedError, withOneRunPaidRefresh } from '../../odds/client';
import { addDaysToSlateDate, todaySlateDate, tomorrowSlateDate, type SlateDate } from '../../dateModel';
import { fail, ok, type ToolResult } from './status';
import { buildResearchSession, buildResearchSessionFromCandidates, getClosestMisses, type ResearchCandidateRecord, type ResearchSession, type GenericResearchCandidate } from './session';
import { saveResearchSession } from './sessionStore';

export const MAX_RESULTS_CEILING = 15;

/** Which sports can actually produce Elite candidates today, and which only have partial data. */
const SPORT_STATUS: Record<SupportedSport, { props: boolean; schedule: boolean; note: string }> = {
  mlb: { props: true, schedule: true, note: 'Fully operational: schedule, sportsbook props, research and Elite Filter.' },
  nfl: { props: true, schedule: true, note: 'Schedule, sportsbook props (where cached), player matching, ESPN attempt/target workload, baseline projection and Elite Filter are connected. Snap share and depth-chart status remain unavailable.' },
  nba: { props: true, schedule: true, note: 'Schedule, sportsbook props (where cached), player matching, injury-aware rate x minutes projection and Elite Filter are connected.' },
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
}

export function createAgentContext(seed?: ResearchSession | null, seedId?: string | null, refreshApproval?: AgentContext['refreshApproval']): AgentContext {
  return { runs: new Map(), researchSession: seed ?? null, researchSessionId: seedId ?? null, pendingQueryIntent: '', refreshApproval: refreshApproval ?? null };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveDate(input?: string | null): { date: SlateDate } | { error: string } {
  const value = (input ?? 'today').trim().toLowerCase();
  if (value === 'today' || value === 'tonight') return { date: todaySlateDate() };
  if (value === 'tomorrow') return { date: tomorrowSlateDate() };
  if (value === 'yesterday') return { date: addDaysToSlateDate(todaySlateDate(), -1) };
  if (DATE_RE.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return { error: `"${input}" is not a valid calendar date.` };
    return { date: value };
  }
  return { error: `Could not interpret "${input}". Use today, tonight, tomorrow, or YYYY-MM-DD.` };
}

async function loadRun(context: AgentContext, sport: SupportedSport, date: string, options: FinderValidationOptions = {}): Promise<FinderRunSummary> {
  const key = `${sport}:${date}`;
  const existing = context.runs.get(key);
  if (existing) return existing;
  const summary = sport === 'nfl' ? await runNFLFinderDeepSearch(date, options) : sport === 'nba' ? await runNBAFinderDeepSearch(date, options) : await runFinderDeepSearch(date, options);
  context.runs.set(key, summary);
  return summary;
}

async function runPreflight(sport: SupportedSport, date: string, forceProviderRefresh = false): Promise<FinderRunSummary> {
  const options: FinderValidationOptions = { preflight: true, forceProviderRefresh };
  if (sport === 'nfl') return runNFLFinderDeepSearch(date, options);
  if (sport === 'nba') return runNBAFinderDeepSearch(date, options);
  return runFinderDeepSearch(date, options);
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
      supportedMarkets: SPORT_RESEARCH_ADAPTERS[sport as SupportedSport].marketSupport,
    })),
  );
}

async function getSlate(args: { sport?: string; date?: string }): Promise<ToolResult<unknown>> {
  const sport = normalizeSport(args.sport ?? 'mlb');
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);
  const resolved = resolveDate(args.date);
  if ('error' in resolved) return fail('INVALID_DATE', resolved.error, { sport });

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

async function getSportsbookCandidates(context: AgentContext, args: { sport?: string; date?: string }): Promise<ToolResult<unknown>> {
  const sport = normalizeSport(args.sport ?? 'mlb');
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);
  const resolved = resolveDate(args.date);
  if ('error' in resolved) return fail('INVALID_DATE', resolved.error, { sport });

  const status = SPORT_STATUS[sport];
  if (!status.props) return fail('SPORT_UNAVAILABLE', status.note, { sport, date: resolved.date });

  const approval = context.refreshApproval;
  const approvedForRequest = approval?.sport === sport && approval.date === resolved.date ? approval : null;
  const deliberateRefresh = /\b(refresh|research again|search again|check again|newly available|new (?:search|research|plays|props)|new data|fresh data|latest (?:props|lines|markets))\b/i.test(context.pendingQueryIntent);

  // Reuse first: a stored session for this exact sport+date already holds the full researched pool,
  // so a reworded question never re-runs the slate or risks a paid refresh.
  const existing = context.researchSession;
  if (!deliberateRefresh && !approvedForRequest && existing && existing.sport === sport && existing.date === resolved.date && existing.candidates.length > 0) {
    return ok(
      { loaded: true, reusedExistingSession: true, candidatesFound: existing.candidates.length, nextStep: 'Call rank_candidates to filter and rank the already-researched pool.' },
      { ...existing.toolMeta, sport, date: resolved.date, reusedExistingSession: true },
    );
  }

  let preflight: FinderRunSummary;
  try {
    preflight = await runPreflight(sport, resolved.date, deliberateRefresh);
  } catch (error) {
    return fail('PROVIDER_ERROR', error instanceof Error ? error.message : 'Sportsbook preflight failed.', { sport, date: resolved.date });
  }

  const preflightData = preflight.validationPreflight;
  if (!approvedForRequest && preflightData && (preflightData.cacheMisses > 0 || (preflightData.eligibleGames > 0 && preflightData.matchedEvents === 0))) {
    const eventListRequired = preflightData.preflightState === 'EVENT_LIST_REQUIRED';
    return fail(eventListRequired ? 'EVENT_LIST_REQUIRED' : 'SPORTSBOOK_DATA_REQUIRED', eventListRequired
      ? 'The free sportsbook event list does not contain this requested slate yet; paid player-prop research cannot start until the target events are discoverable.'
      : 'Sportsbook data is required before DeepSide can research this slate.', {
      sport,
      date: resolved.date,
      gamesScheduled: preflight.gamesScheduled,
      gamesFound: preflight.gamesEligible,
      cached: true,
      budgetLimited: false,
      sportsbookPreflight: preflightData,
      oddsSpend: preflight.oddsSpend,
    });
  }

  let summary: FinderRunSummary;
  try {
    const load = () => loadRun(context, sport, resolved.date, approvedForRequest ? {
      validationMaxGames: approvedForRequest.maxGames,
      validationGameIds: approvedForRequest.selectedGameIds,
      validationMaxCredits: approvedForRequest.maxCredits,
    } : {});
    summary = approvedForRequest
      ? await withOneRunPaidRefresh(load)
      : await load();
  } catch (error) {
    if (error instanceof OddsBudgetGuardError) {
      return fail('RESERVE_BLOCKED', 'The Odds API credit reserve blocked a refresh and no cached props were available.', { sport, date: resolved.date, budgetLimited: true });
    }
    if (error instanceof OddsRefreshNotAuthorizedError) {
      return fail('PAID_REFRESH_NOT_AUTHORIZED', 'Current sportsbook data is not cached for this slate, and a paid refresh has not been authorized in this environment.', { sport, date: resolved.date, budgetLimited: true });
    }
    return fail('PROVIDER_ERROR', error instanceof Error ? error.message : 'Sportsbook provider failed.', { sport, date: resolved.date });
  }

  // NFL/NBA don't yet have the MLB-only FinderResult signal modules, so their researched pool
  // lives on sport-specific candidate arrays (each carrying its own EliteResearchAnalysis) rather
  // than summary.results, which those two engines intentionally always leave empty.
  const genericCandidates: GenericResearchCandidate[] | null =
    sport === 'nfl'
      ? (summary as NFLFinderSummary).nflCandidates
        .filter((c) => c.playerMatch === 'MATCHED' && c.eliteAnalysis != null)
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
          analysis: c.eliteAnalysis!,
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
            status: c.opponentContext.status, sampleSize: c.opponentContext.sampleSize, trend: c.opponentContext.trend,
            sourceStatus: c.opponentContext.sourceStatus, metrics: c.opponentContext.metrics,
            availableMetrics: c.opponentContext.availableMetrics, unavailableMetrics: c.opponentContext.missingFields,
            evidence: c.opponentContext.evidence,
          } : { status: 'UNAVAILABLE', availableMetrics: [], unavailableMetrics: ['opponent defensive boxscores'], evidence: [] },
          injuryContext: c.injuryContext,
          weatherContext: c.weatherContext,
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
          .map((c) => ({
            candidateId: c.id, playerId: c.playerId, player: c.playerName, team: c.team, opponent: c.opponent,
            marketLabel: c.marketLabel, marketKey: c.market, line: c.line, direction: c.side,
            book: c.book, odds: c.oddsAmerican, projection: c.projection?.projection ?? null,
            projectionUncertainty: c.projection?.uncertainty ?? null,
            l5Rate: c.history?.windows.l5.rate ?? null, l10Rate: c.history?.windows.l10.rate ?? null,
            l20Rate: c.history?.windows.l20.rate ?? null, seasonRate: c.history?.windows.season.rate ?? null,
            analysis: c.eliteAnalysis!,
            sport: 'nba',
            matchupAvailable: true,
            roleKnown: c.injuryTier != null && c.injuryTier !== 'UNKNOWN',
            injuryKnown: c.injuryTier != null && c.injuryTier !== 'UNKNOWN',
            outlierDependencePercent: c.outlierDependency?.available ? c.outlierDependency.explosiveDependencePercent : null,
            crossBookDiscrepancy: c.crossBookThreshold?.available ? c.crossBookThreshold.discrepancy : null,
            marketMovementAvailable: c.marketMovement.available,
            howItLoses: c.howItLoses,
            position: c.position,
            projectionReliability: c.projection?.reliability ?? null,
            crossBookThreshold: c.crossBookThreshold,
            marketMovement: c.marketMovement,
            outlierAnalysis: c.outlierDependency ? {
              applicability: 'APPLICABLE', available: c.outlierDependency.available,
              sampleGames: c.outlierDependency.sampleGames, explosiveDependencePercent: c.outlierDependency.explosiveDependencePercent,
            } : null,
            roleContext: null,
            opponentContext: c.opponentContext ? {
              status: c.opponentContext.status, availableMetrics: c.opponentContext.availableMetrics,
              unavailableMetrics: c.opponentContext.unavailableMetrics, evidence: c.opponentContext.evidence,
            } : null,
            bestAlternateLine: c.alternateLines?.recommended ? {
              line: c.alternateLines.recommended.line, side: c.alternateLines.recommended.side,
              bestBook: c.alternateLines.recommended.bestBook, bestOdds: c.alternateLines.recommended.bestOdds,
              trueProbability: c.alternateLines.recommended.trueProbability, breakEvenProbability: c.alternateLines.recommended.breakEvenProbability,
              edgePercent: c.alternateLines.recommended.edgePercent, band: c.alternateLines.recommended.band,
            } : null,
          }))
        : null;

  const candidatesFound = genericCandidates != null ? genericCandidates.length : summary.results.length;
  const meta = {
    sport,
    date: resolved.date,
    gamesFound: summary.gamesAnalyzed,
    gamesScheduled: summary.gamesScheduled,
    propsFound: summary.propsAnalyzed,
    booksFound: summary.booksAnalyzed,
    candidatesFound,
    cached: summary.fromCache,
    dataFreshnessSeconds: summary.cacheAgeMs != null ? Math.round(summary.cacheAgeMs / 1000) : null,
    budgetLimited: summary.budgetLimited,
    blockReason: summary.blockReason,
    oddsSpend: summary.oddsSpend,
  };

  if (summary.slateComplete) {
    return fail('SLATE_COMPLETE', `Every game on ${resolved.date} has already finished, so no props are offered.`, meta);
  }
  if (summary.propsAnalyzed === 0) {
    // Report the ACTUAL blocker. Only say "reserve" when the reserve guard really fired.
    if (summary.blockReason === 'RESERVE') {
      return fail('RESERVE_BLOCKED', 'No sportsbook player props are cached for this slate and the Odds API credit reserve blocked a refresh.', meta);
    }
    if (summary.blockReason === 'NOT_AUTHORIZED') {
      return fail('SPORTSBOOK_DATA_REQUIRED', 'Sportsbook data is required before DeepSide can research this slate.', {
        ...meta,
        sportsbookPreflight: preflightData,
      });
    }
    return fail('NO_CACHED_SPORTSBOOK_DATA', 'No sportsbook player props are currently available or cached for this slate.', meta);
  }
  if (candidatesFound === 0) return fail('NO_CANDIDATES', 'Props were loaded but no researchable candidates were produced.', meta);

  // Successful research replaces the stored session so follow-ups always answer from the latest slate.
  context.researchSession = genericCandidates != null
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
    });
  // Persisted server-side only; the client gets back an opaque ID, never the (possibly hundreds-of-
  // candidates) session object. Replaces any previous session for this conversation.
  context.researchSessionId = await saveResearchSession(context.researchSession);

  // Candidates are NOT returned here — with the per-run cap removed there can be hundreds, which
  // would blow the model's context/rate limit. They are held server-side in the research session;
  // call rank_candidates next to retrieve the top (Elite-filtered, ranked, max 15) results.
  return ok({ loaded: true, candidatesFound: meta.candidatesFound, nextStep: 'Call rank_candidates to retrieve the top researched picks.' }, meta);
}

async function runEliteFilter(context: AgentContext, args: { sport?: string; date?: string; candidateIds?: string[] }): Promise<ToolResult<unknown>> {
  const sport = normalizeSport(args.sport ?? 'mlb');
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);
  const resolved = resolveDate(args.date);
  if ('error' in resolved) return fail('INVALID_DATE', resolved.error, { sport });

  const session = context.researchSession;
  if (!session || session.sport !== sport || session.date !== resolved.date) {
    return fail('NO_CANDIDATES', 'No candidates are loaded yet. Call get_sportsbook_candidates first.', { sport, date: resolved.date });
  }

  const wanted = args.candidateIds?.length ? new Set(args.candidateIds) : null;
  const pool = wanted ? session.candidates.filter((c) => wanted.has(c.candidateId)) : session.candidates;
  if (pool.length === 0) return fail('NO_CANDIDATES', 'No matching candidates to analyse.', { sport, date: resolved.date });

  const qualified = pool.filter((c) => c.eliteQualified);

  const reasonCounts: Record<string, number> = {};
  for (const candidate of pool) for (const reason of candidate.rejectionReasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;

  const meta = { sport, date: resolved.date, candidatesFound: pool.length, eliteFound: qualified.length };

  if (qualified.length === 0) {
    return {
      status: 'NO_ELITE_RESULTS',
      error: `Researched ${pool.length} candidates and none passed the Elite threshold.`,
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
  sport: SupportedSport | null;
  date: string | null;
  side: 'over' | 'under' | null;
  targetOdds: number | null;
  minOdds: number | null;
  maxOdds: number | null;
  sort: 'research' | 'value' | 'payout' | 'safety';
  maxResults: number;
  player: string | null;
  team: string | null;
  market: string | null;
  sportsbook: string | null;
  selectedCandidateIds: string[] | null;
}

type CandidateRankArgs = {
  sport?: string; date?: string; maxResults?: number; eliteOnly?: boolean;
  playerType?: 'hitter' | 'pitcher' | 'any'; side?: 'over' | 'under' | 'any'; team?: string; player?: string; marketContains?: string;
  positionGroup?: string;
};

const MIN_OFFICIAL_ODDS = -900;
const TARGET_ODDS_TOLERANCE = 50;

export function parseCandidateSearchConstraints(query: string, candidates: ResearchCandidateRecord[]): CandidateSearchConstraints {
  const normalized = query.toLowerCase();
  const range = normalized.match(/(?:between|from)\s*([+-]\d{2,4})\s*(?:and|to)\s*([+-]\d{2,4})/i);
  const target = range ? null : normalized.match(/(?:around|near|at|priced?\s*(?:around|near|at)?)?\s*([+-]\d{2,4})\b/i);
  const requestedCount = normalized.match(/\b(\d{1,2})\b(?=[^.!?\n]{0,30}\b(?:plays?|picks?|props?)\b)/i);
  const player = candidates.find((candidate) => normalized.includes(candidate.player.toLowerCase()))?.player ?? null;
  const books = [...new Set(candidates.map((candidate) => candidate.book).filter((book): book is string => Boolean(book)))];
  const sportsbook = books.find((book) => normalized.includes(book.toLowerCase())) ?? null;
  const markets = [...new Set(candidates.flatMap((candidate) => [candidate.market, candidate.marketKey.replaceAll('_', ' ')]))]
    .sort((a, b) => b.length - a.length);
  const market = markets.find((value) => normalized.includes(value.toLowerCase())) ?? null;
  const mentionedTeams = [...new Set(candidates.flatMap((candidate) => [candidate.team, candidate.opponent]).filter((team): team is string => Boolean(team)))]
    .filter((team) => normalized.includes(team.toLowerCase()));
  const selectedGames = mentionedTeams.length >= 2
    ? candidates.filter((candidate) => mentionedTeams.some((team) => candidate.team?.toLowerCase() === team.toLowerCase())
      && mentionedTeams.some((team) => candidate.opponent?.toLowerCase().includes(team.toLowerCase()))).map((candidate) => candidate.candidateId)
    : null;

  return {
    sport: /\bnfl\b/i.test(query) ? 'nfl' : /\bnba\b/i.test(query) ? 'nba' : /\bmlb|baseball\b/i.test(query) ? 'mlb' : null,
    date: query.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null,
    side: /\bunders?\b/i.test(query) ? 'under' : /\bovers?\b/i.test(query) ? 'over' : null,
    targetOdds: target ? Number(target[1]) : null,
    minOdds: range ? Math.min(Number(range[1]), Number(range[2])) : null,
    maxOdds: range ? Math.max(Number(range[1]), Number(range[2])) : null,
    sort: /\bhigher value\b/i.test(query) ? 'value'
      : /\b(?:better payout|more upside|higher payout)\b/i.test(query) ? 'payout'
      : /\b(?:safer|lower risk|safest)\b/i.test(query) ? 'safety' : 'research',
    maxResults: Math.min(MAX_RESULTS_CEILING, Math.max(1, requestedCount ? Number(requestedCount[1]) : MAX_RESULTS_CEILING)),
    player,
    team: mentionedTeams.length === 1 ? mentionedTeams[0] : null,
    market,
    sportsbook,
    selectedCandidateIds: selectedGames?.length ? [...new Set(selectedGames)] : null,
  };
}

export function selectRankedCandidates(candidates: ResearchCandidateRecord[], query: string, args: CandidateRankArgs = {}): { constraints: CandidateSearchConstraints; pool: ResearchCandidateRecord[]; selected: ResearchCandidateRecord[] } {
  const constraints = parseCandidateSearchConstraints(query, candidates);
  let pool = candidates.filter((candidate) => candidate.odds != null && candidate.odds >= MIN_OFFICIAL_ODDS);
  const playerType = args.playerType;
  const side = constraints.side ?? (args.side !== 'any' ? args.side : null);
  const team = constraints.team ?? args.team ?? null;
  const player = constraints.player ?? args.player ?? null;
  const market = constraints.market ?? args.marketContains ?? null;

  if (playerType === 'pitcher') pool = pool.filter((candidate) => candidate.marketKey.startsWith('pitcher_'));
  if (playerType === 'hitter') pool = pool.filter((candidate) => candidate.marketKey.startsWith('batter_'));
  if (side) pool = pool.filter((candidate) => candidate.direction === side);
  if (team) pool = pool.filter((candidate) => (candidate.team ?? '').toLowerCase().includes(team.toLowerCase()) || (candidate.opponent ?? '').toLowerCase().includes(team.toLowerCase()));
  if (player) pool = pool.filter((candidate) => candidate.player.toLowerCase().includes(player.toLowerCase()));
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

  const eligible = (args.eliteOnly === false ? pool : pool.filter((candidate) => candidate.eliteQualified));
  const selected = [...eligible].sort((a, b) => constraints.sort === 'payout'
    ? b.odds! - a.odds! || b.researchScore - a.researchScore
    : constraints.sort === 'value'
      ? (b.evPercent ?? -Infinity) - (a.evPercent ?? -Infinity)
        || (b.priceEdgePercent ?? -Infinity) - (a.priceEdgePercent ?? -Infinity)
        || b.researchScore - a.researchScore
    : constraints.sort === 'safety'
      ? (b.trueProbability ?? -Infinity) - (a.trueProbability ?? -Infinity) || a.trapRisk - b.trapRisk || b.researchScore - a.researchScore
      : b.researchScore - a.researchScore)
    .slice(0, Math.min(constraints.maxResults, args.maxResults ?? MAX_RESULTS_CEILING));
  return { constraints, pool, selected };
}

async function rankCandidates(context: AgentContext, args: CandidateRankArgs): Promise<ToolResult<unknown>> {
  const sport = normalizeSport(args.sport ?? 'mlb');
  if (!sport) return fail('SPORT_UNAVAILABLE', `"${args.sport}" is not a supported sport.`);
  const resolved = resolveDate(args.date);
  if ('error' in resolved) return fail('INVALID_DATE', resolved.error, { sport });

  const session = context.researchSession;
  if (!session || session.sport !== sport || session.date !== resolved.date) {
    return fail('NO_CANDIDATES', 'No candidates are loaded yet. Call get_sportsbook_candidates first.', { sport, date: resolved.date });
  }

  const { constraints, pool, selected } = selectRankedCandidates(session.candidates, context.pendingQueryIntent, args);
  if ((constraints.sport && constraints.sport !== session.sport) || (constraints.date && constraints.date !== session.date)) {
    return fail('NO_CANDIDATES', 'The cached research session does not match the requested sport or date.', { sport, date: resolved.date });
  }
  const eliteOnly = args.eliteOnly !== false;

  const meta = { sport, date: resolved.date, candidatesFound: pool.length, eliteFound: pool.filter((c) => c.eliteQualified).length };

  if (selected.length === 0) {
    return eliteOnly
      ? { status: 'NO_ELITE_RESULTS', error: pool.length === 0 ? 'No Elite candidates matched the requested constraints.' : `Researched ${pool.length} matching candidates and none passed the Elite threshold.`, ...meta,
          data: { constraints, closestMisses: getClosestMisses({ ...session, candidates: pool }, 5) } }
      : fail('NO_CANDIDATES', 'No candidates matched those filters.', meta);
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
      const injuryReports = await getNFLInjuryReports().catch(() => {
        injurySourceAvailable = false;
        return [];
      });
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
            opponentTeamId: opponent?.id ?? null, market, position: player.position, reports: injuryReports, sourceAvailable: injurySourceAvailable,
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

  // The full structured pool stays server-side for rank_candidates. Sending hundreds of rich
  // records back through the model can exceed its context window before it can issue that rank.
  const limit = args.limit != null ? Math.max(1, Math.min(50, args.limit)) : MAX_RESULTS_CEILING;
  return ok(
    {
      sport: session.sport,
      date: session.date,
      queryIntent: session.queryIntent,
      generatedAt: session.generatedAt,
      candidates: session.candidates.slice(0, limit),
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
  const misses = getClosestMisses(session, count);
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
    description: 'Run the deterministic Elite Research Filter over loaded candidates. You must never decide qualification yourself; use the eliteQualified flag this returns.',
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
    description: 'Filter, rank and limit ALREADY-LOADED candidates from the stored research session. This is the tool for every "best/favorite/strongest/top" or narrowing request (by market, side, team or player) — it reuses the existing pool and never triggers a sportsbook refresh. Applies the Elite Filter first unless eliteOnly is false. maxResults is a ceiling, never a quota.',
    parameters: {
      type: 'object',
      properties: {
        sport: { type: 'string' },
        date: { type: 'string' },
        maxResults: { type: ['integer', 'null'], description: `Ceiling, max ${MAX_RESULTS_CEILING}. Defaults to ${MAX_RESULTS_CEILING}.` },
        eliteOnly: { type: ['boolean', 'null'], description: 'Default true. Set false to inspect non-qualifying candidates.' },
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
    description: 'Retrieve the previously loaded research session (sport, date, and every researched candidate with its Elite Filter verdict) without making any new sportsbook or provider calls. Always try this FIRST for follow-up questions about candidates, players, or results already discussed in this conversation — only call get_sportsbook_candidates when the user asks about a different sport, date, or slate, or when this returns NO_CANDIDATES.',
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
    case 'get_slate': return getSlate(args as { sport?: string; date?: string });
    case 'get_sportsbook_candidates': return getSportsbookCandidates(context, args as { sport?: string; date?: string });
    case 'run_elite_filter': return runEliteFilter(context, args as { sport?: string; date?: string; candidateIds?: string[] });
    case 'rank_candidates': return rankCandidates(context, args as Parameters<typeof rankCandidates>[1]);
    case 'research_player': return researchPlayer(args as { name?: string; season?: number; sport?: string });
    case 'get_last_research_session': return getLastResearchSession(context, args as { limit?: number });
    case 'get_closest_misses': return getClosestMissesTool(context, args as { count?: number });
    default: return fail('PROVIDER_ERROR', `Unknown tool "${name}".`);
  }
}
