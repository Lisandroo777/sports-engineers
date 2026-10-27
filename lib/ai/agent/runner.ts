import { applyRequestScope, createAgentContext, executeTool, hasNFLRequestedMarketCoverage, prepareNFLRequestScope, selectRankedCandidates, TOOL_DEFINITIONS, MAX_RESULTS_CEILING } from './tools';
import { getClosestMisses } from './session';
import { getResearchSession } from './sessionStore';
import { withResearchStage } from '../../reliability/researchFailure';
import type { ResearchSession } from './session';
import { todaySlateDate } from '../../dateModel';
import { formatDisplayDate, resolveDateFromText } from '../dateResolver';
import { NFL_ELITE_MARKETS, getNFLMarketMetadata, type NFLAnalyzableMarketKey } from '../../nfl/oddsTypes';
import { assignNFLDisplayRanks, groupNFLUnderlyingPlays } from '../../nfl/underlyingPlays';
import { annotateNFLCorrelation } from '../../nfl/correlation';
import type { ResearchCandidateRecord } from './session';
import { classifyPickTier, queryRequestsPasses } from './pickTiers';
import { isNFLInjuryContextFresh } from '../../nfl/injuries';
import { interpretBettingIntent, isMLBGameMarketRequest, requestedMLBTeams } from '../../../communication/intent';
import { executeBettingIntent, explainStoredCandidate, rankingQuery, searchQuery } from '../../../communication/execute';
import { saveResearchSession } from './sessionStore';
import { interpretWithLanguageModel, needsModelInterpretation } from '../../../communication/modelInterpretation';
import { classifyNBAMarketIntent, unsupportedNBAGameLineNotice } from '../../nba/prediction/marketIntent';
import { runNBAFinderDeepSearch } from '../../finder/nbaEngine';
import { getOddsEvents, withAutomaticOddsRefresh } from '../../odds/client';
import { getMLBSchedule } from '../../mlb/schedule';
import { researchMLBGameMarkets } from '../../mlb/gameMarkets';
import { matchOddsEvent } from '../../odds/match';
import { detectRequestedGames, hasMLBGameStarted } from './tools';
import { nbaFinderCandidateToGeneric } from './tools';
import { buildResearchSessionFromCandidates } from './session';
import { classifyGameRecommendation, isGameRecommendation } from '../../nba/prediction/gameLines/recommendations';
import { selectNBAMixedRecommendations } from '../../nba/prediction/gameLines/selection';
import { NBA_V2_VALIDATION } from '../../nba/prediction/v2/validation';
import { buildNBAV2Diagnostics } from '../../nba/prediction/v2/diagnostics';
import { detectSport } from '../sportResearchAdapters';
import { buildNBAResearchPresentation, unclassifiedNBAPropResearch } from '../../nba/prediction/gameLines/presentationBridge';
import { loadCachedNBAEventResearch } from '../../nba/prediction/gameLines/cachedEventResearch';
import { requestedNBATeams, matchesNBATeams } from '../../nba/prediction/gameLines/requestScope';
import { getNBASchedule } from '../../nba/schedule';
import { nbaFilterRankingQuery, nbaMarketAvailability, NBA_RESEARCH_MARKETS, type NBAResearchFilter } from '../../nba/researchMarkets';
import { nbaResearchMarketIntent, scopeNBAResearchMarkets } from '../../nba/researchMarketScope';
import { parseNFLRequestScope } from './nflRequestScope';
import { isNFLGameResearchPublishable } from '../../nfl/partialCoverage';
import type { NFLSlateLedger } from '../../nfl/slateLedger';

const CONNECTED_SPORTS = ['mlb', 'nba', 'nfl'] as const;
type ConnectedSport = typeof CONNECTED_SPORTS[number];

export function crossSportScope(query: string): ConnectedSport[] {
  if (!/\b(?:picks?|plays?|bets?|opportunities)\b/i.test(query)) return [];
  if (/\b(?:soccer|tennis|nhl|hockey|ufc|previous|settlements?|supported|capabilities)\b/i.test(query)) return [];
  const named = CONNECTED_SPORTS.filter(sport => ({ mlb: /\b(?:mlb|baseball)\b/i, nba: /\b(?:nba|basketball)\b/i, nfl: /\b(?:nfl|football)\b/i })[sport].test(query));
  if (named.length === 1) return [];
  if (!named.length && (parseNFLRequestScope(query).teams.length || requestedNBATeams(query).length)) return [];
  if (!named.length && /\b(?:for|vs\.?|versus|his|these|those|again|refresh)\b/i.test(query.replace(/\bfor\s+(?:today|tonight|tomorrow)\b/gi, ''))) return [];
  return named.length ? named : [...CONNECTED_SPORTS];
}

export async function runCrossSportSearch(query: string, date: string, sports: ConnectedSport[], search: (sport: ConnectedSport) => Promise<AgentTurnResult>): Promise<AgentTurnResult> {
  const responses: Array<{ sport: ConnectedSport; result: AgentTurnResult }> = [];
  const coverage: Array<Record<string, unknown>> = [];
  for (const sport of sports) {
    try {
      const result = await search(sport);
      responses.push({ sport, result });
      coverage.push({ sport, status: result.meta?.status ?? (result.meta?.gamesScheduled === 0 ? 'NO_GAMES_SCHEDULED' : result.results.length ? 'SUCCESS' : result.meta?.researchComplete === true ? 'NO_QUALIFIED_RESULTS' : 'DATA_UNAVAILABLE'),
        gamesDiscovered: result.meta?.gamesScheduled ?? result.meta?.gamesFound ?? null,
        gamesEvaluated: result.meta?.gamesFound ?? null, marketsEvaluated: result.meta?.marketsEvaluated ?? null,
        candidatesResearched: result.meta?.candidatesFound ?? null,
        qualifiedCandidates: result.meta?.qualifiedCandidates ?? null, rejectedCandidates: result.meta?.rejectedCandidates ?? null,
        recommended: result.results.length });
    } catch {
      coverage.push({ sport, status: 'PROVIDER_ERROR', gamesDiscovered: null, gamesEvaluated: null, marketsEvaluated: null, candidatesResearched: null, recommended: 0 });
    }
  }
  const rows = responses.flatMap(({ sport, result }) => result.results.map(row => ({ ...(row as Record<string, unknown>), sport })));
  const numeric = (row: Record<string, unknown>, field: string) => typeof row[field] === 'number' && Number.isFinite(row[field]) ? row[field] as number : -Infinity;
  const metric = /\b(?:best value|highest ev|higher value)\b/i.test(query) ? 'evPercent'
    : /\b(?:most likely|safest|highest probability)\b/i.test(query) ? 'trueProbability' : 'researchScore';
  const count = query.match(/\b(?:best|top|give me)\s+(\d{1,2})\b/i)?.[1];
  const limit = sports.some(sport => sport === 'nfl' || sport === 'nba')
    ? count ? Math.max(1, Number(count)) : rows.length : Math.min(15, Math.max(1, count ? Number(count) : 15));
  const results = rows.sort((first, second) => numeric(second, metric) - numeric(first, metric)).slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const closestMisses = responses.flatMap(({ sport, result }) => result.closestMisses.map(row => ({ ...(row as Record<string, unknown>), sport }))).slice(0, 5);
  const complete = coverage.every(entry => ['SUCCESS', 'NO_QUALIFIED_RESULTS', 'SLATE_COMPLETE', 'NO_GAMES_SCHEDULED'].includes(String(entry.status)));
  return {
    reply: results.length ? `Found ${results.length} qualified recommendations across the requested sports.${complete ? '' : ' Some sports could not be fully researched; coverage is reported separately.'}`
      : 'No qualified recommendations were returned. Review sport coverage and any evaluated non-recommended candidates separately.',
    results, closestMisses, toolTrace: responses.flatMap(({ result }) => result.toolTrace), researchSessionId: null,
    modeledGames: responses.flatMap(({ result }) => result.modeledGames ?? []),
    meta: { sport: 'all', date, coverage, researchComplete: complete, partialCoverage: !complete, qualifiedFound: results.length,
      gamesFound: coverage.reduce((sum, entry) => sum + (typeof entry.gamesEvaluated === 'number' ? entry.gamesEvaluated : 0), 0),
      candidatesFound: coverage.reduce((sum, entry) => sum + (typeof entry.candidatesResearched === 'number' ? entry.candidatesResearched : 0), 0) },
  };
}

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4.1';
/** Enough for slate → candidates → elite → rank, plus recovery, without unbounded looping. */
const MAX_TOOL_ROUNDS = 8;

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

export const SYSTEM_PROMPT = `You are DeepSide's sports research analyst.

ABSOLUTE RULES
- You are specialized in sports-betting research. Answer betting terminology and research follow-ups; decline unrelated topics briefly. Discuss unsupported markets honestly without inventing verified recommendations.
- You may only state sportsbook lines, odds, projections, statistics, injuries or hit rates that came from a tool result in this conversation. Never invent, estimate or recall them from memory.
- You never decide a pick's tier. rank_candidates returns the deterministic pickTier and query-specific ranking after publication gates. run_elite_filter applies NFL mode-specific publication checks and retains separate Elite qualification.
- Every new request is re-filtered and re-ranked from structured session data using its latest constraints. Cached data may be reused; a previous ranked answer may not.
- Recommendations must pass all publication gates and have current American odds of -900 or longer. Requested prices and quality floors are hard filters, never permission to weaken safety/data requirements.
- If a tool returns a non-SUCCESS status, report that exact situation. Never substitute a different explanation.
- If a candidate's field is null or absent from a tool result, say "unavailable". Never fill it with a plausible-sounding guess.

RESEARCH PHILOSOPHY — season averages, L5/L10 hit rates, and basic opponent rankings are SUPPORTING evidence only, never the main reason for a pick. Every candidate carries deeper computed research; use it:
NFL RESEARCH MODES: STANDARD is the default for best, safe, most likely, value, Elite/Nuke, and low-threshold requests. DEEP activates only when the user explicitly requests deep research, deep dive, full research, or equivalent depth. Research mode is independent of ranking. Low thresholds are line preferences relative to expected production, never relaxed research quality. Return any legitimate NUKE/ELITE/SHARP/EDGE/LEAN, with its actual tool-assigned tier; zero Elite does not mean zero recommendations. PASS stays excluded. DEEP requires full case/counter-case enrichment; Standard-only cached research cannot satisfy Deep requests.
- grade: a letter grade (A+, A, A-, B+, B, C, D, F) layered on top of the Elite Filter. Most candidates should NOT be A/A+ — that requires both passing Elite AND clearing the outlier-dependency and volume-efficiency checks. Never state a grade yourself; only quote the tool's grade field.
- outlierDependencePercent: how much of the player's recent production came from a single standout game. High values mean the production is not repeatable — mention this when relevant.
- howItLoses: the candidate's real, computed failure modes. When presenting or defending a pick, include at least one of these verbatim (or their substance) — never invent a different failure scenario.
- bestAlternateLine: the best risk-adjusted threshold found among all posted lines for that player+market (may differ from the standard line). Mention it when the user asks about alternates or pricing.
- evidenceBoard: named signals (Projection vs Line, Recent Form, Long-Term Baseline, Opponent Matchup, Expected Role, Injury Cascade, Film/Scouting, Trench Matchup, Game Script) each marked agree/disagree/unavailable. Several are always "unavailable" because DeepSide has no connected data source for them (injury cascades, film/scouting, OL/DL trench data, team totals for game-script weighting) — say so plainly rather than guessing; do not treat "unavailable" as a negative signal, just an honest gap.
- playerEdgePercent vs priceEdgePercent: these are different things. A good player prediction (playerEdgePercent) can still be a bad bet at a bad price (negative priceEdgePercent) — distinguish them when both are present.

DISTINGUISHING FAILURES — these are completely different and must never be conflated:
- NO_CACHED_SPORTSBOOK_DATA / SPORTSBOOK_DATA_REQUIRED / PAID_REFRESH_NOT_AUTHORIZED / RESERVE_BLOCKED: sportsbook data could not be loaded for this search. Say only that sportsbook data is temporarily unavailable. Never say "no Elite picks", and never mention credits, costs, budgets, refresh authorization or providers.
- EVENT_LIST_REQUIRED: sportsbook markets are not posted for this slate yet. Say so plainly; never mention costs.
- STALE_SPORTSBOOK_DATA: research ran on stale prices. Report findings but state that current EV is unavailable and nothing can qualify as official Elite.
- SLATE_COMPLETE: every game already finished, so no props exist. Suggest the next slate.
- NO_CANDIDATES: props loaded but produced no researchable candidates.
- NO_ELITE_RESULTS: candidates were researched but none passed. Say how many were researched and give the main rejection reasons.
- SPORT_UNAVAILABLE: that sport has no connected data. Say what is missing; never pretend.

REUSING LOADED DATA — never reload a slate you already have:
- Once a research session exists for a sport+date, EVERY narrowing or rephrased question must be answered with rank_candidates (or get_closest_misses / get_last_research_session) against that stored pool.
- "best pitcher strikeout spots" -> rank_candidates(marketContains:"strikeout"). "strongest overs" -> side:"over". "best Yankees props" -> team:"Yankees". "top 5 closest misses" -> get_closest_misses.
- Only call get_sportsbook_candidates when the sport or date actually changes, or when no session exists yet. Different wording about the SAME slate is never a reason to reload.
- When the user explicitly asks to refresh, research/search again, or check newly available/fresh/latest markets, call get_sportsbook_candidates even for the same slate. This checks for provider data added since the stored session and never relaxes qualification.

"BEST"/"FAVORITE"/"STRONGEST"/"TOP" never means bypassing publication gates. By default return NUKE/ELITE/SHARP/EDGE/LEAN recommendations ranked by BALANCED BEST. Honor explicit quality floors such as "Nukes only", "Elite or better", or "Sharp or better". PASS candidates are excluded unless explicitly requested; label them PASS, never recommendations.

WORKFLOW for a request like "find me the best MLB plays tomorrow":
1. If this is a follow-up about candidates, players, or results already discussed in this conversation (e.g. "why did the closest one fail", "show me the 5 closest misses", "compare the top two", "what was X's projection"), call get_last_research_session or get_closest_misses FIRST. These read stored data and make no new sportsbook calls. Only fall back to get_sportsbook_candidates if one of them returns NO_CANDIDATES.
2. For a genuinely new request (a different sport, date, or slate, or no session stored yet), call get_sportsbook_candidates(sport, date) to load the slate from cache.
3. If it succeeded, rank_candidates(...) with the user's filters and maxResults.
4. Explain the outcome using only returned numbers. When citing a specific candidate, use its exact player, market, line, projection, grade, researchScore, signalAgreement, trapRisk, howItLoses and rejectionReasons from the tool result — never approximate or omit a field, and say "unavailable" for any field that is null.
You may call get_slate first if the user asks about games rather than props, and get_sport_capabilities if a sport's status is unclear.

MAX RESULTS: default and ceiling is ${MAX_RESULTS_CEILING}. It is a maximum, never a quota. If only 3 publishable recommendations exist above the requested quality floor, present 3. Never lower gates or the quality floor to fill slots.

STYLE: The app renders picks, coverage and empty/unavailable states as structured cards, so never restate them in prose. For pick/search requests reply with at most one short sentence. For explanation questions use a short ALL-CAPS heading per section (e.g. WHY THIS PLAY STANDS OUT, RISK) followed by "- " bullets; no paragraph longer than two sentences. Never mention tool names, status codes or internal steps. Cite only numbers returned by tools, and include at least one real failure mode from howItLoses when defending a pick. Never use hype.`;

interface OpenAIFunctionCall {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface OpenAIOutputMessage {
  type: 'message';
  content?: Array<{ type: string; text?: string }>;
}

type OpenAIOutputItem = OpenAIFunctionCall | OpenAIOutputMessage | { type: string };

interface OpenAIResponse {
  output?: OpenAIOutputItem[];
  error?: { message?: string };
}

export interface AgentTurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentRefreshApproval {
  sport: 'mlb' | 'nfl' | 'nba';
  date: string;
  maxCredits: number;
  maxGames?: number;
  selectedGameIds?: string[];
}

export interface AgentToolTrace {
  name: string;
  status: string;
  summary: Record<string, unknown>;
}

export interface AgentTurnResult {
  mlbGameMarkets?: Awaited<ReturnType<typeof researchMLBGameMarkets>>;
  nbaPresentation?: ReturnType<typeof buildNBAResearchPresentation>;
  modeledGames?: import('../../nba/prediction/gameLines/recommendations').ModeledGameResearch[];
  nbaV2Diagnostics?: import('../../nba/prediction/v2/diagnostics').NBAV2Diagnostic[];
  reply: string;
  toolTrace: AgentToolTrace[];
  /** Ranked rows the UI can render as cards, taken verbatim from the last successful ranking. */
  results: unknown[];
  closestMisses: unknown[];
  meta: Record<string, unknown> | null;
  /** Opaque ID for the AI's structured research memory, held server-side — send it back on the next turn. Never the full session object (it can hold hundreds of candidates). */
  researchSessionId: string | null;
}

type InputItem = Record<string, unknown>;

const INTERNAL_META_KEYS = ['oddsSpend', 'credits', 'sportsbookPreflight', 'budgetLimited', 'blockReason', 'error'];

export function filterOfficialResults(results: unknown[], sport?: string): unknown[] {
  return results.filter((result) => {
    if (result == null || typeof result !== 'object') return false;
    const candidate = result as { eliteQualified?: unknown; marketKey?: NFLAnalyzableMarketKey; isAlternate?: boolean; nflResearchProfile?: { productionEliteQualified?: boolean } };
    const nfl = sport === 'nfl' || (sport == null && candidate.marketKey != null && getNFLMarketMetadata(candidate.marketKey) != null);
    return candidate.eliteQualified === true && (!nfl || candidate.nflResearchProfile == null || candidate.nflResearchProfile.productionEliteQualified === true) && (!nfl
      || (candidate.marketKey != null && NFL_ELITE_MARKETS.includes(candidate.marketKey) && candidate.isAlternate !== true));
  });
}

export function filterRecommendationResults(results: unknown[], sport?: string, includePasses = false, now = new Date()): unknown[] {
  return results.flatMap<unknown>((result) => {
    if (result == null || typeof result !== 'object') return [];
    if (sport === 'all') {
      const sourceSport = (result as { sport?: string }).sport;
      if (!sourceSport || !['mlb', 'nba', 'nfl'].includes(sourceSport)) return [];
      return filterRecommendationResults([result], sourceSport, includePasses, now);
    }
    if (isGameRecommendation(result)) {
      if (sport !== 'nba') return [];
      const decision = classifyGameRecommendation(result, now);
      return decision.pickTier === 'PASS' && !includePasses ? [] : [{ ...result, ...decision }];
    }
    const candidate = result as ResearchCandidateRecord;
    if (sport === 'nba' && candidate.retrievedAt != null) {
      const receipt = Date.parse(candidate.retrievedAt);
      if (!Number.isFinite(receipt) || receipt > now.getTime() || now.getTime() - receipt > 3600000) return [];
    }
    const nfl = sport === 'nfl' || (sport == null && getNFLMarketMetadata(candidate.marketKey as NFLAnalyzableMarketKey) != null);
    if (nfl && !includePasses && !isNFLInjuryContextFresh(candidate.injuryContext as Parameters<typeof isNFLInjuryContextFresh>[0], now)) return [];
    const decision = classifyPickTier(candidate, nfl ? 'nfl' : sport);
    if (decision.pickTier === 'PASS' && !includePasses) return [];
    if (nfl && !includePasses && (!candidate.nflResearchProfile
      || (candidate.nflResearchProfile.productionEliteQualified !== true && candidate.nflResearchProfile.evidence.verdict !== 'PLAY')
      || Object.values(candidate.nflResearchProfile.hardGates).some((gate) => !gate.passed))) return [];
    if (nfl && (!NFL_ELITE_MARKETS.includes(candidate.marketKey as NFLAnalyzableMarketKey) || candidate.isAlternate)) return [];
    return [{ ...candidate, ...decision }];
  });
}

function nflIncompleteSummary(meta: Record<string, unknown> | null): string {
  const ledger = meta?.nflLedger as Partial<NFLSlateLedger> | undefined;
  const fullyCheckedEmpty = ledger != null && (ledger.eligiblePregame ?? 0) > 0
    && ledger.retrievedGames === ledger.eligiblePregame && ledger.zeroMarketGames === ledger.eligiblePregame
    && ledger.failedGames === 0 && ledger.notFetchedGames === 0;
  if (fullyCheckedEmpty) return 'NFL sportsbook player-prop markets have not been posted for this slate yet.';
  const failures = new Set((ledger?.games ?? [])
    .filter((game) => game.eligibility === 'PREGAME' && game.state !== 'RESEARCHED')
    .map((game) => game.failure));
  const reasons = [
    failures.has('CREDIT_BALANCE_UNKNOWN') ? 'NFL refresh could not verify the current provider credit balance. No new sportsbook request was made.' : null,
    failures.has('DAILY_LIMIT') || failures.has('SEARCH_LIMIT') ? 'NFL research reached its configured refresh limit; an authorized refresh is required to research the remaining games.' : null,
    failures.has('REFRESH_UNAVAILABLE') ? 'NFL refresh verification is currently unavailable. Current market coverage could not be confirmed.' : null,
    failures.has('REFRESH_NOT_AUTHORIZED') ? 'NFL sportsbook refresh was not authorized. An authorized refresh is required to research the remaining games.' : null,
    failures.has('CACHE_ONLY') ? 'No fresh cached NFL sportsbook data is available for the remaining games. An authorized refresh is required.' : null,
    failures.has('RATE_LIMIT') ? 'NFL sportsbook refresh reached a request rate limit. Research remains incomplete.' : null,
  ].filter((reason): reason is string => reason != null);
  if ((ledger?.researchedGames ?? 0) > 0) {
    return `Partial NFL coverage: ${ledger!.researchedGames}/${ledger!.eligiblePregame} pregame games researched. No independently qualified picks from the fully researched games are currently available; ${reasons.length ? `other games remain unchecked. ${reasons.join(' ')}` : 'other games remain unavailable.'}`;
  }
  return reasons.length ? reasons.join(' ') : 'Required NFL sportsbook market data is currently unavailable.';
}

function filterPartialNFLResults(results: unknown[], ledger: NFLSlateLedger | undefined): unknown[] {
  return results.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const candidate = row as ResearchCandidateRecord;
    return isNFLGameResearchPublishable(ledger, { gameId: candidate.gameId ?? '', eventId: candidate.eventId ?? '',
      marketKey: candidate.marketKey, retrievedAt: candidate.retrievedAt, sourceGameId: candidate.sourceGameId });
  });
}

/** Provider credit/cost data stays server-side (logged there); production clients only get research facts. */
export function toClientResult(result: AgentTurnResult, production = process.env.NODE_ENV === 'production'): AgentTurnResult {
  if (production && result.meta) result = { ...result, meta: Object.fromEntries(Object.entries(result.meta).filter(([key]) => key !== 'intentDebug')) };
  const partialNFL = result.meta?.sport === 'nfl' && result.meta.researchComplete === false;
  if (partialNFL) result = { ...result,
    results: filterPartialNFLResults(result.results, result.meta?.nflLedger as NFLSlateLedger | undefined), closestMisses: [],
    meta: { ...result.meta, partialCoverage: true } };
  const results = filterRecommendationResults(result.results, result.meta?.sport as string | undefined, result.meta?.includePasses === true);
  if (results.length !== result.results.length) result = { ...result, results };
  if (result.meta?.sport === 'nfl') result = { ...result, results: annotateNFLCorrelation(assignNFLDisplayRanks(groupNFLUnderlyingPlays(result.results as ResearchCandidateRecord[]))) };
  if (partialNFL) {
    const ledger = result.meta?.nflLedger as NFLSlateLedger | undefined;
    result = { ...result, reply: result.results.length && ledger
      ? `Partial NFL coverage: ${ledger.researchedGames}/${ledger.eligiblePregame} pregame games researched. Only independently qualified picks from fully researched games are shown.`
      : nflIncompleteSummary(result.meta) };
  }
  if (result.meta?.budgetLimited === true && !/some sportsbook markets/i.test(result.reply)) {
    result = { ...result, reply: `${result.reply}\n\nSome sportsbook markets for this search were unavailable, so only games with fresh market data were researched.` };
  }
  if (!production && result.meta?.sport !== 'nfl') return result;
  const meta = result.meta ? Object.fromEntries(Object.entries(result.meta).filter(([key]) => !INTERNAL_META_KEYS.includes(key))) : null;
  if (meta?.sport === 'nfl' && meta.nflLedger) {
    const ledger = meta.nflLedger as import('../../nfl/slateLedger').NFLSlateLedger;
    meta.nflLedger = { ...ledger, games: ledger.games.map((game) => ({ gameId: game.gameId, matchup: game.matchup, kickoff: game.kickoff,
      eligibility: game.eligibility, state: game.state, propsEvaluated: game.propsEvaluated, failure: game.failure,
      returnedMarkets: game.returnedMarkets, zeroMarkets: game.zeroMarkets, failedMarkets: game.failedMarkets,
      retrievedAt: game.retrievedAt, expiresAt: game.expiresAt })) };
  }
  return { ...result, meta, toolTrace: result.meta?.sport === 'nfl' ? [] : result.toolTrace.map(({ name, status }) => ({ name, status, summary: {} })) };
}

export function resolveStructuredResults(results: unknown[], rankingAttempted: boolean, session: ResearchSession | null, query = '', requestedDate?: string): unknown[] {
  if (!session || (requestedDate && session.date !== requestedDate)) return [];
  if (session.sport === 'nfl' && session.toolMeta.researchComplete === false) session = { ...session,
    candidates: filterPartialNFLResults(session.candidates, session.toolMeta.nflLedger) as ResearchCandidateRecord[] };
  if (session.sport === 'nfl' && session.candidates.some((candidate) => !isNFLInjuryContextFresh(candidate.injuryContext as Parameters<typeof isNFLInjuryContextFresh>[0]))) return [];
  let candidates = session.candidates;
  if (rankingAttempted) {
    const boundaryResults = queryRequestsPasses(query)
      ? results.filter((row) => row != null && typeof row === 'object' && classifyPickTier(row as ResearchCandidateRecord, session.sport).pickTier === 'PASS')
      : filterRecommendationResults(results, session.sport);
    const ids = new Set(boundaryResults.map((row) => (row as { candidateId: string }).candidateId));
    candidates = candidates.filter((candidate) => ids.has(candidate.candidateId));
  }
  const ranked = selectRankedCandidates(candidates, query, { sport: session.sport, resolvedDate: requestedDate });
  if (session.sport === 'nfl') ranked.selected = assignNFLDisplayRanks(groupNFLUnderlyingPlays(ranked.selected, selectRankedCandidates(session.candidates, query, { sport: session.sport, resolvedDate: requestedDate }).pool));
  if ((ranked.constraints.sport && ranked.constraints.sport !== session.sport) || (ranked.constraints.date && ranked.constraints.date !== session.date)) return [];
  return filterRecommendationResults(ranked.selected, session.sport, queryRequestsPasses(query));
}

function isCachedRankingRequest(query: string) {
  return /\b(?:best|top|strongest|favorite|safer|safest|most likely|low[-\s]threshold|low lines|deep research|highest probability|highest chance|higher value|best value|higher payout|better payout|more upside|nukes?|elite|sharps?|edges?|leans?|passes?|rejected|everything you like|plays? around|props? around)\b/i.test(query);
}

export function rankCachedSession(session: ResearchSession, query: string, researchSessionId: string | null): AgentTurnResult | null {
  if (session.sport === 'nfl' && session.toolMeta?.researchComplete === false) {
    session = { ...session, candidates: filterPartialNFLResults(session.candidates, session.toolMeta.nflLedger) as ResearchCandidateRecord[],
      toolMeta: { ...session.toolMeta, partialCoverage: true } };
    if (!session.candidates.length) return null;
  }
  if (session.sport === 'nfl' && session.candidates.some((candidate) => {
    if (!candidate.priceCurrent || !['LIVE', 'FRESH'].includes(candidate.priceFreshness)) return true;
    if (!isNFLInjuryContextFresh(candidate.injuryContext as Parameters<typeof isNFLInjuryContextFresh>[0])) return true;
    const timestamp = candidate.nflResearchProfile?.market?.provenance?.[0]?.publishedAt;
    if (!timestamp) return false;
    const age = Date.now() - Date.parse(timestamp);
    return !Number.isFinite(age) || age < 0 || age > 3600000;
  })) return null;
  const nbaMarketIntent = session.sport === 'nba' ? classifyNBAMarketIntent(query) : null;
  if (nbaMarketIntent?.gameLineMarkets.length && session.modeledGames != null) return {
    reply: 'Only selections passing the existing publication requirements are recommendations. Team research remains separate.',
    toolTrace: [], results: selectNBAMixedRecommendations(session, query), closestMisses: [], modeledGames: session.modeledGames,
    meta: { sport: 'nba', date: session.date, cached: true }, researchSessionId,
  };
  if (nbaMarketIntent?.gameLinesOnly) return {
    reply: unsupportedNBAGameLineNotice(nbaMarketIntent.gameLineMarkets), toolTrace: [], results: [], closestMisses: [],
    meta: { sport: 'nba', date: session.date, cached: true, unsupportedMarkets: nbaMarketIntent.gameLineMarkets }, researchSessionId,
  };
  const { constraints, pool, selected } = selectRankedCandidates(session.candidates, query, { sport: session.sport });
  if (session.sport === 'nfl' && constraints.researchMode === 'DEEP'
    && session.candidates.some((candidate) => candidate.nflResearchProfile?.researchMode === 'STANDARD')) return null;
  if ((constraints.sport && constraints.sport !== session.sport) || (constraints.date && constraints.date !== session.date)) return null;
  if (constraints.playerUnresolved || (session.scopeGameIds?.length && (!constraints.team && !constraints.selectedCandidateIds || pool.length === 0))) return null;
  const eliteFound = pool.filter((candidate) => candidate.eliteQualified).length;
  const meta = { sport: session.sport, date: session.date, ...session.toolMeta, researchMode: constraints.researchMode,
    lowThreshold: constraints.lowThreshold, candidatesFound: pool.length, eliteFound, cached: true, reusedExistingSession: true,
    ...(nbaMarketIntent?.gameLineMarkets.length ? { unsupportedMarkets: nbaMarketIntent.gameLineMarkets,
      unsupportedMarketNotice: unsupportedNBAGameLineNotice(nbaMarketIntent.gameLineMarkets) } : {}) };
  const unsupportedMarketNotice = nbaMarketIntent?.gameLineMarkets.length
    ? unsupportedNBAGameLineNotice(nbaMarketIntent.gameLineMarkets) : null;
  const toolTrace: AgentToolTrace[] = [
    { name: 'get_last_research_session', status: 'SUCCESS', summary: { status: 'SUCCESS', ...meta } },
    { name: 'rank_candidates', status: selected.length ? 'SUCCESS' : 'NO_ELITE_RESULTS', summary: { status: selected.length ? 'SUCCESS' : 'NO_ELITE_RESULTS', ...meta, constraints } },
  ];
  const wantsClosestMisses = /\bclosest\s+(?:misses|plays|picks)\b/i.test(query);
  if (wantsClosestMisses) return { reply: 'Here are the closest researched candidates and their current quality tiers.', toolTrace,
    results: [], closestMisses: getClosestMisses({ ...session, candidates: pool }, 5), meta, researchSessionId };
  const reply = selected.length
    ? `Found ${selected.length} ${session.sport.toUpperCase()} ${constraints.showPasses ? 'PASS candidate' : 'recommendation'}${selected.length === 1 ? '' : 's'} from the cached researched pool.${unsupportedMarketNotice ? ` ${unsupportedMarketNotice}` : ''}`
    : pool.length === 0
      ? 'No candidates matched those requested constraints.'
      : `Researched ${pool.length} matching NBA candidates and none passed the requested publication and quality requirements.${unsupportedMarketNotice ? ` ${unsupportedMarketNotice}` : ''}`;
  return { reply, toolTrace, results: selected, closestMisses: selected.length || (session.sport === 'nfl' && !/\bclosest\s+(?:misses|plays|picks)\b/i.test(query)) ? [] : getClosestMisses({ ...session, candidates: pool }, 5), meta: { ...meta, includePasses: constraints.showPasses }, researchSessionId };
}

async function callOpenAI(model: string, apiKey: string, input: InputItem[]): Promise<OpenAIResponse> {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input, tools: TOOL_DEFINITIONS, tool_choice: 'auto', instructions: SYSTEM_PROMPT, max_output_tokens: 4096 }),
  });

  if (!response.ok) {
    const body = await response.text();
    // Never echo the request (it carries the key); surface only the provider's message.
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch { /* keep status-only detail */ }
    throw new AIUnavailableError(`OpenAI request failed: ${detail}`);
  }
  return (await response.json()) as OpenAIResponse;
}

function textFrom(output: OpenAIOutputItem[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const chunk of (item as OpenAIOutputMessage).content ?? []) {
      if (chunk.type === 'output_text' && chunk.text) parts.push(chunk.text);
    }
  }
  return parts.join('\n').trim();
}

export async function runAgentTurn(history: AgentTurnMessage[], researchSessionId: string | null = null, refreshApproval: AgentRefreshApproval | null = null, uiContext?: { sport?: 'nfl' | 'nba' | 'mlb'; date?: string; nbaResearchFilter?: NBAResearchFilter }): Promise<AgentTurnResult> {
  void refreshApproval;
  const query = [...history].reverse().find(message => message.role === 'user')?.content ?? '';
  const sports = crossSportScope(query);
  if (sports.length) {
    const date = resolveDateFromText(query)?.resolvedDate ?? uiContext?.date ?? todaySlateDate();
    return withAutomaticOddsRefresh(() => runCrossSportSearch(query, date, sports, async sport => {
      const scopedQuery = `${sport.toUpperCase()} ${query.replace(/\b(?:nba|nfl|mlb|baseball|basketball|football)\b/gi, '')}${sport === 'nba' ? ' across all NBA markets' : ''} ${date}`;
      const result = await withAutomaticOddsRefresh(() => runScopedAgentTurn([{ role: 'user', content: scopedQuery }], null, null, { sport, date }, true));
      return toClientResult(result);
    }));
  }
  const resolvedSport = detectSport(query) ?? uiContext?.sport;
  return withAutomaticOddsRefresh(() => runScopedAgentTurn(history, researchSessionId, null, uiContext), resolvedSport === 'nba' ? 'nba' : undefined);
}

async function runScopedAgentTurn(history: AgentTurnMessage[], researchSessionId: string | null, refreshApproval: AgentRefreshApproval | null, uiContext?: { sport?: 'nfl' | 'nba' | 'mlb'; date?: string; nbaResearchFilter?: NBAResearchFilter }, deterministicMLB = false): Promise<AgentTurnResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  const storedSession = await withResearchStage('session-read', () => getResearchSession(researchSessionId));
  const context = createAgentContext(storedSession ? structuredClone(storedSession) : null, researchSessionId, refreshApproval);
  const lastUserMessage = [...history].reverse().find((message) => message.role === 'user');
  let query = lastUserMessage?.content ?? '';
  const nbaQuery = (detectSport(query) ?? (requestedNBATeams(query).length ? 'nba' : null) ?? uiContext?.sport ?? storedSession?.sport) === 'nba';
  const marketFilter = nbaQuery ? uiContext?.nbaResearchFilter : undefined;
  if (marketFilter) query = nbaFilterRankingQuery(query, marketFilter);
  const selectedMarketEntries = marketFilter ? NBA_RESEARCH_MARKETS.filter(entry => marketFilter.marketIds == null || marketFilter.marketIds.includes(entry.id)) : [];
  if (marketFilter && !selectedMarketEntries.some(entry => entry.candidateKey != null)) return {
    reply: selectedMarketEntries.length ? 'The selected NBA markets are not connected. No research was performed and no substitute market was used.' : 'No NBA markets selected. No research was performed.',
    toolTrace: [], results: [], closestMisses: [], researchSessionId,
    meta: { sport: 'nba', date: uiContext?.date ?? todaySlateDate(), status: 'NO_CANDIDATES', researchComplete: false,
      marketSelection: selectedMarketEntries, unsupportedMarketNotice: 'No selected market is connected; no market was researched.' },
  };
  let nbaMarkets = nbaQuery ? nbaResearchMarketIntent(query, marketFilter) : null;
  if (nbaMarkets && !nbaMarkets.gameLineMarkets.length && !nbaMarkets.playerPropsRequested && (marketFilter || /\b(?:picks?|plays?)\b/i.test(query))) {
    nbaMarkets = nbaResearchMarketIntent(`${query} across all NBA markets`, marketFilter);
  }
  if (nbaMarkets && (nbaMarkets.gameLineMarkets.length || nbaMarkets.playerPropsRequested)) {
    const requestedDate = resolveDateFromText(query)?.resolvedDate ?? uiContext?.date ?? storedSession?.date ?? todaySlateDate();
    const requestedTeams = requestedNBATeams(query);
    let nbaSession = storedSession?.sport === 'nba' && storedSession.date === requestedDate && storedSession.modeledGames != null
      && (nbaMarkets.gameLinesOnly || storedSession.queryIntent === query) && !marketFilter ? storedSession : null;
    if (!nbaSession || /\brefresh\b/i.test(query)) {
      const gameIds = requestedTeams.length ? (await getNBASchedule(requestedDate).catch(() => []))
        .filter(game => matchesNBATeams(requestedTeams, [game.homeTeam.displayName, game.awayTeam.displayName])).map(game => game.id) : null;
      const summary = await withAutomaticOddsRefresh(() => runNBAFinderDeepSearch(requestedDate, { gameLines: true, gameLinesOnly: nbaMarkets.gameLinesOnly,
        ...(marketFilter ? { researchMarkets: selectedMarketEntries.filter(entry => entry.candidateKey != null).map(entry => entry.id) } : {}),
        ...(gameIds ? { validationGameIds: gameIds } : {}) }));
      nbaSession = buildResearchSessionFromCandidates({ sport: 'nba', date: requestedDate, queryIntent: query,
        candidates: summary.nbaCandidates.filter(candidate => candidate.playerMatch === 'MATCHED' && candidate.eliteAnalysis != null).map(nbaFinderCandidateToGeneric),
        toolMeta: { gamesFound: summary.gamesAnalyzed, gamesScheduled: summary.gamesScheduled, propsFound: summary.propsAnalyzed,
          booksFound: summary.booksAnalyzed, candidatesFound: summary.nbaCandidates.length, cached: summary.fromCache,
          dataFreshnessSeconds: summary.cacheAgeMs == null ? null : summary.cacheAgeMs / 1000, budgetLimited: summary.budgetLimited,
          nbaGameCoverage: summary.nbaGameCoverage, nbaResearchPreflight: summary.nbaResearchPreflight, partialCoverage: summary.partialCoverage === true,
          researchComplete: summary.partialCoverage !== true && (summary.researchComplete ?? !summary.budgetLimited),
          slateComplete: summary.slateComplete, blockReason: summary.blockReason, oddsSpend: summary.oddsSpend } });
      nbaSession.gameCandidates = summary.gameCandidates ?? [];
      nbaSession.modeledGames = summary.modeledGames ?? [];
      nbaSession.nbaPresentationResearch = [...unclassifiedNBAPropResearch(summary.nbaCandidates),
        ...await (marketFilter ? loadCachedNBAEventResearch(requestedDate, undefined, marketFilter)
          : loadCachedNBAEventResearch(requestedDate)).catch(() => [])];
      researchSessionId = await saveResearchSession(nbaSession);
    }
    if (requestedTeams.length) {
      const gameIds = new Set([
        ...(nbaSession.modeledGames ?? []).filter(game => matchesNBATeams(requestedTeams, [game.home.name, game.away.name])).map(game => game.gameId),
        ...(nbaSession.gameCandidates ?? []).filter(game => matchesNBATeams(requestedTeams, [game.home.name, game.away.name])).map(game => game.gameId),
        ...nbaSession.candidates.filter(record => matchesNBATeams(requestedTeams, [record.team, record.opponent])).map(record => record.gameId),
      ]);
      nbaSession = { ...nbaSession, candidates: nbaSession.candidates.filter(record => gameIds.has(record.gameId)),
        gameCandidates: nbaSession.gameCandidates?.filter(record => gameIds.has(record.gameId)),
        modeledGames: nbaSession.modeledGames?.filter(record => gameIds.has(record.gameId)),
        nbaPresentationResearch: nbaSession.nbaPresentationResearch?.filter(record => record.subject.kind === 'GAME_LINE'
          ? matchesNBATeams(requestedTeams, [record.subject.home.name, record.subject.away.name])
          : gameIds.has(record.subject.gameId)) };
    }
    if (marketFilter) nbaSession = scopeNBAResearchMarkets(nbaSession, marketFilter);
    const results = selectNBAMixedRecommendations(nbaSession, query, new Date(), marketFilter);
    const earlySeasonBlocked = results.length === 0 && nbaSession.candidates.length > 0
      && nbaSession.candidates.every(candidate => (candidate.sampleSize ?? 0) < 8);
    const earlySeasonNote = earlySeasonBlocked ? ` ${[`NBA V1 requires 8 current-season games per player market; all ${nbaSession.candidates.length} evaluated props have fewer.`,
      ...NBA_V2_VALIDATION.reasons].join(' ')}` : '';
    const v1Unsampled = nbaSession.candidates.filter(candidate => (candidate.sampleSize ?? 0) < 8 && candidate.line != null);
    const tipoffs = v1Unsampled.length ? new Map((await Promise.race([getNBASchedule(requestedDate).catch(() => []),
      new Promise<[]>(resolve => setTimeout(() => resolve([]), 3000))])).map(game => [game.id, game.gameTime])) : new Map<string, string>();
    const nbaV2Diagnostics = v1Unsampled.length ? await buildNBAV2Diagnostics(v1Unsampled.map(candidate => ({ candidateId: candidate.candidateId,
      playerId: candidate.playerId ?? null, player: candidate.player, marketKey: String(candidate.marketKey), line: candidate.line!,
      direction: candidate.direction, odds: candidate.odds ?? null, book: candidate.book ?? null, tipoff: tipoffs.get(candidate.gameId ?? '') ?? null })))
      .catch(() => []) : [];
    const candidatesEvaluated = nbaSession.candidates.length + (nbaSession.gameCandidates?.length ?? 0);
    const verifiedQuotesAvailable = nbaSession.modeledGames?.some(game => game.status === 'QUOTE_AVAILABLE' && (game.quotes?.length ?? 0) > 0) === true
      || nbaSession.nbaPresentationResearch?.some(record => record.quoteStatus === 'CURRENT' && record.americanOdds != null) === true;
    const marketDataAvailable = candidatesEvaluated > 0 || verifiedQuotesAvailable;
    const missingSelectedMarkets = selectedMarketEntries.filter(entry => entry.candidateKey == null
      || !nbaSession.candidates.some(record => record.marketKey === entry.candidateKey)
        && !nbaSession.gameCandidates?.some(record => record.marketKey === entry.candidateKey)
        && !nbaSession.modeledGames?.some(game => game.quotes?.some(quote => quote.market === entry.candidateKey))
        && !nbaSession.nbaPresentationResearch?.some(record => [entry.id, entry.candidateKey].includes(record.subject.market.key)));
    const partialCoverage = nbaSession.toolMeta.partialCoverage === true || missingSelectedMarkets.length > 0;
    const researchComplete = !partialCoverage && (nbaSession.toolMeta.researchComplete ?? marketDataAvailable);
    const providerError = (nbaSession.toolMeta.oddsSpend?.providerErrors ?? 0) > 0
      || nbaSession.toolMeta.nbaGameCoverage?.some(game => game.state === 'PROVIDER_ERROR');
    const incomplete = nbaSession.toolMeta.budgetLimited || nbaSession.toolMeta.blockReason != null
      || nbaSession.toolMeta.nbaGameCoverage?.some(game => game.state === 'BUDGET_BLOCKED' || game.state === 'NOT_FETCHED');
    const status = candidatesEvaluated > 0 ? (earlySeasonBlocked ? 'RESEARCH_INCOMPLETE' : 'SUCCESS')
      : verifiedQuotesAvailable ? 'RESEARCH_INCOMPLETE'
      : providerError ? 'PROVIDER_ERROR'
        : incomplete ? 'RESEARCH_INCOMPLETE'
          : nbaSession.toolMeta.gamesScheduled === 0 && researchComplete ? 'NO_GAMES'
            : nbaSession.toolMeta.slateComplete ? 'SLATE_COMPLETE'
              : !researchComplete && !nbaSession.toolMeta.nbaGameCoverage?.some(game => game.state === 'NO_MARKETS') ? 'RESEARCH_INCOMPLETE'
                : 'NO_SPORTSBOOK_DATA';
    const emptyReply = status === 'NO_GAMES' ? `No NBA games are scheduled on ${requestedDate}.`
      : status === 'SLATE_COMPLETE' ? `The NBA slate on ${requestedDate} is complete; no pregame markets remain.`
        : status === 'PROVIDER_ERROR' ? 'NBA research is unavailable because a provider failed.'
          : status === 'RESEARCH_INCOMPLETE' ? `NBA research could not be completed for the requested slate. ${[...new Map((nbaSession.toolMeta.nbaGameCoverage ?? [])
            .filter(game => game.state !== 'RESEARCHED').map(game => [game.state, 0] as const)).keys()]
            .map(state => `${(nbaSession.toolMeta.nbaGameCoverage ?? []).filter(game => game.state === state).length} game(s) ${state === 'NOT_FETCHED' ? 'have no cached sportsbook quotes (refresh not performed)' : state.toLowerCase().replaceAll('_', ' ')}`)
            .concat([...new Set((nbaSession.modeledGames ?? []).filter(game => game.status === 'RESEARCH_UNAVAILABLE').map(game => game.reason))])
            .join('. ')}`.trim()
            : 'No current sportsbook NBA candidates were available for evaluation. Unpriced or modeled research is shown separately and is not a betting recommendation; it is not an evaluated rejection.';
    const partialNote = partialCoverage && marketDataAvailable ? ' NBA research has partial coverage; available selections were evaluated independently.' : '';
    const unsupported = nbaMarkets.gameLineMarkets.filter(market => market === 'FIRST_HALF' || market === 'FIRST_QUARTER');
    const plan = nbaSession.toolMeta.nbaResearchPreflight;
    const planNotice = plan?.games.flatMap(game => {
      const unavailable = game.markets.filter(market => market.needsRefresh || market.state === 'NOT_POSTED');
      return unavailable.length ? [`${game.awayTeam} at ${game.homeTeam}: ${game.status === 'BUDGET_BLOCKED' ? 'search budget prevented acquisition' :
        'selected markets not fully available'} (${unavailable.map(market => `${market.id}: ${market.state.toLowerCase()}`).join(', ')}). ${(game as typeof game & { reason?: string }).reason ?? ''}`] : [];
    }).join(' ') ?? '';
    return { reply: (results.length ? `Found ${results.length} qualified NBA recommendation${results.length === 1 ? '' : 's'}.`
      : !marketDataAvailable ? emptyReply
        : `No NBA selections passed the existing publication requirements.${verifiedQuotesAvailable ? ` Verified sportsbook quotes are available. ${(nbaSession.modeledGames ?? []).filter(game => game.status === 'QUOTE_AVAILABLE').map(game => `${game.gameId}: ${game.reason}`).join(' ')}` : ' Modeled team research is shown separately and is not a betting recommendation.'}`) + earlySeasonNote + partialNote,
      toolTrace: [], results, closestMisses: [], researchSessionId, modeledGames: nbaSession.modeledGames,
      nbaPresentation: buildNBAResearchPresentation(nbaSession, query, results.map(record => record.candidateId)),
      nbaV2Diagnostics,
      meta: { sport: 'nba', date: requestedDate, modelVersion: 'NBA_GAME_LINES_V1', validationStatus: 'UNVALIDATED',
        ...nbaSession.toolMeta,
        gamesFound: Math.max(nbaSession.toolMeta.gamesFound ?? 0, (nbaSession.modeledGames ?? []).filter(game => (game.quotes?.length ?? 0) > 0).length),
        candidatesFound: candidatesEvaluated, marketsEvaluated: marketDataAvailable ? null : 0,
        partialCoverage, researchComplete, status,
        marketSelection: selectedMarketEntries.map(entry => ({ ...entry, availability: nbaMarketAvailability(entry),
          researchQuoteCount: nbaSession.nbaPresentationResearch?.filter(record => [entry.id, entry.candidateKey].includes(record.subject.market.key)).length ?? 0,
          candidateCount: nbaSession.candidates.filter(record => record.marketKey === entry.candidateKey).length
            + (nbaSession.gameCandidates?.filter(record => record.marketKey === entry.candidateKey).length ?? 0) })),
        ...((missingSelectedMarkets.length || planNotice) ? { unsupportedMarketNotice: `${planNotice} ${missingSelectedMarkets.length ? `Not researched or no matching connected quotes/candidates: ${missingSelectedMarkets.map(entry => entry.label).join(', ')}. No substitute markets were used.` : ''}`.trim() } : {}),
        budgetLimited: nbaSession.toolMeta.budgetLimited === true, ...(unsupported.length ? { unsupportedMarketNotice: unsupportedNBAGameLineNotice(unsupported) } : {}) } };
  }
  let previous = context.researchSession?.conversation ?? null;
  if (!previous && context.researchSession) {
    const prior = [...history].filter((message) => message.role === 'user').slice(0, -1);
    for (const message of prior) {
      const reconstructed = interpretBettingIntent(message.content, context.researchSession.candidates, previous, context.researchSession.sport as 'nfl' | 'nba' | 'mlb');
      if (reconstructed.action === 'PICKS') previous = executeBettingIntent(context.researchSession, reconstructed, previous).conversation;
    }
  }
  let intent = interpretBettingIntent(query, context.researchSession?.candidates ?? [], previous, context.researchSession?.sport as 'nfl' | 'nba' | 'mlb' | undefined ?? uiContext?.sport);
  if ((detectSport(query) ?? uiContext?.sport ?? storedSession?.sport) === 'mlb'
    && isMLBGameMarketRequest(query) && !['EDUCATION', 'OUT_OF_SCOPE'].includes(intent.action)) {
    const date = resolveDateFromText(query)?.resolvedDate ?? uiContext?.date ?? storedSession?.date ?? todaySlateDate();
    let gamesScheduled = 0;
    let gamesMatched = 0;
    let gamesEligible = 0;
    let eventsMatched = 0;
    let report: Awaited<ReturnType<typeof researchMLBGameMarkets>> = { events: [], quotes: [] };
    let status = 'PROVIDER_ERROR';
    try {
      const schedule = (await getMLBSchedule(date)).filter(game => game.date === date);
      gamesScheduled = schedule.length;
      const teams = requestedMLBTeams(query);
      const matchups = schedule.map(game => ({ gameId: game.id, matchup: `${game.awayTeam.name} @ ${game.homeTeam.name}` }));
      const namedIds = detectRequestedGames(query, matchups);
      const explicitMatchup = /\b(?:vs\.?|versus)\b|@/i.test(query);
      const scoped = schedule.filter(game => teams.length
        ? (!explicitMatchup || teams.length >= 2) && teams.every(team => detectRequestedGames(team, matchups.filter(row => row.gameId === game.id)).length > 0)
        : !explicitMatchup && (!namedIds.length || namedIds.includes(game.id)));
      gamesMatched = scoped.length;
      const eligible = scoped.filter(game => !/final|game over|completed|postponed|cancell?ed|suspended/i.test(game.status) && !hasMLBGameStarted(game));
      gamesEligible = eligible.length;
      if (!schedule.length) status = 'NO_GAMES_SCHEDULED';
      else if (!scoped.length) status = 'NOT_FOUND';
      else if (!eligible.length) status = 'SLATE_COMPLETE';
      else {
        const oddsEvents = await getOddsEvents();
        const events = eligible.flatMap(game => {
          const event = matchOddsEvent(game, oddsEvents, date, game.gameTime);
          return event ? [event] : [];
        });
        const uniqueEvents = [...new Map(events.map(event => [event.id, event])).values()];
        eventsMatched = uniqueEvents.length;
        report = await researchMLBGameMarkets(uniqueEvents);
        status = report.quotes.length ? 'UNMODELED_QUOTES'
          : !eventsMatched ? 'EVENT_LIST_REQUIRED'
            : report.events.every(event => event.status === 'empty') ? 'MARKETS_NOT_POSTED' : 'SPORTSBOOK_DATA_REQUIRED';
      }
    } catch {
      status = 'PROVIDER_ERROR';
    }
    const quoteCoverageComplete = gamesEligible > 0 && eventsMatched === gamesEligible
      && report.events.length === eventsMatched && report.events.every(event => event.status === 'complete');
    const availability = report.quotes.length ? 'MLB sportsbook prices are available as unmodeled quotes'
      : status === 'NO_GAMES_SCHEDULED' ? 'No MLB games are scheduled for the requested date'
        : status === 'NOT_FOUND' ? 'The requested MLB matchup is not scheduled on that date'
          : status === 'SLATE_COMPLETE' ? 'No eligible pregame MLB games remain in the requested scope'
            : ['EVENT_LIST_REQUIRED', 'MARKETS_NOT_POSTED'].includes(status) ? 'MLB game-market prices are not posted for the requested scope yet'
              : 'MLB game-market prices are currently unavailable';
    return { reply: `${availability}; no validated MLB game-model probability or edge is available, so these are not qualified picks.`,
      results: [], closestMisses: [], toolTrace: [], researchSessionId: null, mlbGameMarkets: report,
      meta: { sport: 'mlb', date, status, coverage: 'MLB_GAME_MARKET_QUOTES', gamesScheduled, gamesMatched,
        gamesEligible, gamesSkipped: gamesMatched - gamesEligible, gamesFound: eventsMatched, eventsMatched,
        quotesFound: report.quotes.length, marketsEvaluated: new Set(report.quotes.map(quote => quote.marketKey)).size,
        booksFound: new Set(report.quotes.map(quote => quote.sportsbookKey)).size,
        candidatesFound: 0, qualifiedCandidates: 0, rejectedCandidates: 0, researchComplete: false,
        quoteCoverageComplete, partialCoverage: !quoteCoverageComplete } };
  }
  if (needsModelInterpretation(query, intent)) {
    if (apiKey) intent = await interpretWithLanguageModel(query, intent, apiKey, model);
    else return { reply: 'Could you clarify the picks or betting research you want?', results: [], closestMisses: [], toolTrace: [], meta: null, researchSessionId };
  }
  if (intent.action === 'OUT_OF_SCOPE') return { reply: 'DeepSide AI is designed for sports-betting research. Ask me about picks, odds, markets, or a bet you are considering.', results: [], closestMisses: [], toolTrace: [], meta: null, researchSessionId };
  if (intent.action === 'CLARIFY') return { reply: intent.clarification!, results: [], closestMisses: [], toolTrace: [], meta: null, researchSessionId };
  if (intent.unsupportedMarket && intent.action !== 'EDUCATION') return { reply: `I can discuss ${intent.unsupportedMarket}, but the connected ${(intent.sport ?? uiContext?.sport ?? storedSession?.sport ?? 'sports').toUpperCase()} recommendation engine currently researches player props. I cannot supply a verified pick for that market.`, results: [], closestMisses: [], toolTrace: [], meta: null, researchSessionId };
  if (intent.action === 'EDUCATION' && (!apiKey || /supported sports|sports do you|supported markets|markets do you|previous picks|pick results/i.test(query))) {
    const reply = /supported sports|sports do you/i.test(query) ? 'NFL, NBA and MLB have connected research filters. Soccer and tennis are not connected for verified picks yet.'
      : /supported markets|markets do you/i.test(query) ? 'The connected NFL engine researches supported player props, including passing yards and completions, rushing yards and attempts, receiving yards and receptions. Game, half and quarter market recommendations are not connected here yet.'
        : /previous picks|pick results/i.test(query) ? 'I can review the research already discussed, but no verified settlement ledger is connected here. I cannot invent a win, loss, or ROI.'
          : /\bev\b/i.test(query) ? 'EV is the expected average return at a price, based on an estimated probability. Positive estimated EV is not a guarantee, and an unvalidated probability can make it misleading.'
      : /vig|juice/i.test(query) ? 'Vig or juice is the sportsbook margin built into its prices. Compare both sides of the same market to estimate a no-vig probability; raw implied probability is not the same thing.'
        : 'I can explain betting terms and research recorded picks. Tell me the term or the line and odds you want to discuss.';
    return { reply, results: [], closestMisses: [], toolTrace: [], meta: null, researchSessionId };
  }
  if (intent.sport === 'nfl' && ['PICKS', 'EXPLAIN', 'COMPARE'].includes(intent.action)) {
    let pinnedDate = intent.date ?? context.researchSession?.date ?? uiContext?.date ?? todaySlateDate();
    const matchingCurrentPlayer = context.researchSession?.candidates.some((row) => intent.players.includes(row.player) && row.priceCurrent);
    const resolveUpcoming = !intent.date && !previous && intent.players.length === 1 && !matchingCurrentPlayer;
    const reference = intent.referenceIds.length === 1 ? context.researchSession?.candidates.find((row) => row.candidateId === intent.referenceIds[0]) : null;
    if (reference && intent.researchMode === 'DEEP') { intent.players = [reference.player]; intent.markets = [reference.marketKey]; if (reference.gameId) intent.games = [reference.gameId]; }
    applyRequestScope(context, searchQuery(intent));
    if (resolveUpcoming) context.canonicalDate = null;
    else context.canonicalDate = resolveDateFromText(pinnedDate);
    if (context.nflScope) {
      context.nflScope.playerQuery = intent.players.length === 1 ? intent.players[0] : null;
      context.nflScope.marketKeys = intent.markets.length ? intent.markets as NFLAnalyzableMarketKey[] : context.nflScope.marketKeys;
      context.nflScope.researchMode = intent.researchMode;
      context.nflScope.rankingIntent = intent.rankingIntent;
      context.nflScope.lowThreshold = intent.linePreference === 'LOW_THRESHOLD';
    }
    const clarification = await prepareNFLRequestScope(context);
    if (clarification) return { reply: clarification, results: [], closestMisses: [], toolTrace: [], meta: null, researchSessionId };
    pinnedDate = context.canonicalDate?.resolvedDate ?? pinnedDate;
    intent.date = pinnedDate;
    const cached = context.researchSession
      && (context.researchSession.toolMeta.researchComplete === false
        || hasNFLRequestedMarketCoverage(context.researchSession, context.nflScope?.marketKeys ?? undefined))
      && rankCachedSession(context.researchSession, rankingQuery(intent), context.researchSessionId);
    if (context.researchSession?.toolMeta.researchComplete === false) context.researchSession = { ...context.researchSession,
      candidates: filterPartialNFLResults(context.researchSession.candidates, context.researchSession.toolMeta.nflLedger) as ResearchCandidateRecord[],
      toolMeta: { ...context.researchSession.toolMeta, partialCoverage: true } };
    if (!cached && (intent.action === 'EXPLAIN' || intent.action === 'COMPARE') && context.researchSession) {
      const execution = executeBettingIntent(context.researchSession, intent, previous, query);
      const storedReference = context.researchSession.candidates.find((row) => intent.referenceIds.includes(row.candidateId));
      return { reply: execution.results.length ? execution.reply : intent.action === 'EXPLAIN' && storedReference ? explainStoredCandidate(storedReference, true, query) : 'The referenced research is stored, but its quote is no longer current. I cannot describe it as a current recommendation.', results: execution.results, closestMisses: [], toolTrace: [], meta: { ...context.researchSession.toolMeta, sport: 'nfl' }, researchSessionId };
    }
    if (!cached || refreshApproval) {
      const loaded = await executeTool('get_sportsbook_candidates', { sport: 'nfl', date: pinnedDate }, context);
      if (loaded.status !== 'SUCCESS') {
        const { data, ...loadMeta } = loaded;
        void data;
        return { reply: loaded.status === 'SLATE_COMPLETE' ? 'No eligible pregame games remain.' : 'Current research is unavailable for the requested slate. No unverified picks will be substituted.', results: [], closestMisses: [], toolTrace: [], meta: loadMeta, researchSessionId: context.researchSessionId };
      }
    }
    if (!context.researchSession) return { reply: 'No current researched candidates are available.', results: [], closestMisses: [], toolTrace: [], meta: { sport: 'nfl' }, researchSessionId: null };
    const execution = await withResearchStage('intent-ranking', () => executeBettingIntent(context.researchSession!, intent, previous, query));
    context.researchSession.conversation = execution.conversation;
    context.researchSessionId = await withResearchStage('session-save', () => saveResearchSession(context.researchSession!));
    return { reply: execution.reply, results: execution.results, closestMisses: [], toolTrace: [],
      meta: { ...context.researchSession.toolMeta, sport: 'nfl', date: pinnedDate, researchMode: intent.researchMode, candidatesFound: execution.beforeFilters,
        eliteFound: execution.results.filter((row) => row.pickTier === 'ELITE' || row.pickTier === 'NUKE').length,
        ...(process.env.NODE_ENV !== 'production' ? { intentDebug: { intent, beforeFilters: execution.beforeFilters, afterFilters: execution.afterFilters,
          returned: execution.results.length, constraintsSatisfied: execution.constraintsSatisfied, eliminatedBy: execution.eliminatedBy } } : {}) },
      researchSessionId: context.researchSessionId };
  }
  applyRequestScope(context, lastUserMessage?.content ?? '');
  if ((deterministicMLB || intent.sport === 'mlb') && context.canonicalSport === 'mlb' && /\b(?:picks?|plays?|bets?|props?)\b/i.test(query)) {
    const date = context.canonicalDate?.resolvedDate ?? uiContext?.date ?? todaySlateDate();
    const loaded = await executeTool('get_sportsbook_candidates', { sport: 'mlb', date }, context);
    const { data: loadedData, ...loadMeta } = loaded;
    void loadedData;
    if (loaded.status !== 'SUCCESS') return { reply: loaded.error ?? 'MLB research is currently unavailable.', results: [], closestMisses: [], toolTrace: [{ name: 'get_sportsbook_candidates', status: loaded.status, summary: loadMeta }], meta: loadMeta, researchSessionId: null };
    const ranked = await executeTool('rank_candidates', { sport: 'mlb', date }, context);
    const { data, ...rankMeta } = ranked;
    const rows = data as { results?: unknown[]; closestMisses?: unknown[] } | undefined;
    const evaluated = context.researchSession?.candidates ?? [];
    const qualifiedCandidates = evaluated.filter(row => classifyPickTier(row, 'mlb').pickTier !== 'PASS').length;
    const researchComplete = loadMeta.researchComplete !== false && (loadMeta as Record<string, unknown>).partialCoverage !== true;
    return { reply: !researchComplete ? 'MLB player-prop research has partial coverage; only available researched selections are shown.'
      : rows?.results?.length ? 'MLB research complete.' : 'No MLB selections passed the existing publication requirements.',
      results: rows?.results ?? [], closestMisses: rows?.closestMisses ?? [], toolTrace: [{ name: 'rank_candidates', status: ranked.status, summary: rankMeta }],
      meta: { ...loadMeta, ...rankMeta, marketsEvaluated: new Set(evaluated.map(row => row.marketKey)).size,
        candidatesEvaluated: evaluated.length, rankedCandidates: rankMeta.candidatesFound,
        qualifiedCandidates, rejectedCandidates: evaluated.length - qualifiedCandidates, researchComplete }, researchSessionId: context.researchSessionId };
  }
  const clarification = await prepareNFLRequestScope(context);
  if (clarification) return { reply: clarification, toolTrace: [], results: [], closestMisses: [], meta: { sport: 'nfl' }, researchSessionId: context.researchSessionId };
  if (context.canonicalSport === 'nfl' && /\b(?:best|top|find|give|show|refresh|check|only|everything|research|dive)\b/i.test(context.pendingQueryIntent)
    && ( /\b(?:props?|picks?|plays?)\b/i.test(context.pendingQueryIntent) || queryRequestsPasses(context.pendingQueryIntent)
      || /\b(?:nukes?|elite|sharps?|edges?|leans?)\b/i.test(context.pendingQueryIntent) || /\beverything\s+you\s+like\b/i.test(context.pendingQueryIntent))) {
    const loaded = await executeTool('get_sportsbook_candidates', { sport: 'nfl', date: context.canonicalDate?.resolvedDate ?? todaySlateDate() }, context);
    const { data: loadedData, ...loadMeta } = loaded;
    void loadedData;
    if (loaded.status !== 'SUCCESS') return { reply: loaded.status === 'SLATE_COMPLETE' ? 'No eligible pregame games remain on the requested NFL slate.'
      : loaded.status === 'NOT_FOUND' ? loaded.error ?? 'Which NFL game do you mean?' : 'The requested NFL slate could not be fully researched.',
      toolTrace: [], results: [], closestMisses: [], meta: loadMeta, researchSessionId: context.researchSessionId };
    const ranked = await executeTool('rank_candidates', { sport: 'nfl', date: loaded.date, eliteOnly: false }, context);
    const { data, ...rankMeta } = ranked;
    const rows = (data as { results?: unknown[]; closestMisses?: unknown[] } | undefined);
    return { reply: rows?.results?.length ? 'Research complete.' : 'DeepSide researched the requested slate but found no plays that met the publication requirements and requested quality floor.',
      toolTrace: [], results: resolveStructuredResults(rows?.results ?? [], true, context.researchSession, context.pendingQueryIntent, context.canonicalDate?.resolvedDate),
      closestMisses: rows?.closestMisses ?? [], meta: { ...loadMeta, ...rankMeta }, researchSessionId: context.researchSessionId };
  }
  if (!apiKey) throw new AIUnavailableError('The research agent is currently unavailable.');
  if (!refreshApproval && context.researchSession && isCachedRankingRequest(context.pendingQueryIntent)
    && (!context.canonicalDate || context.canonicalDate.resolvedDate === context.researchSession.date)
    && (!context.canonicalSport || context.canonicalSport === context.researchSession.sport)) {
    const ranked = rankCachedSession(context.researchSession, context.pendingQueryIntent, context.researchSessionId);
    if (ranked) return ranked;
  }
  const input: InputItem[] = history.map((message) => ({ role: message.role, content: message.content }));
  const scopeNote = [
    `Today is ${formatDisplayDate(todaySlateDate())} (${todaySlateDate()}).`,
    context.canonicalDate ? `This request's date is already resolved: "${context.canonicalDate.rawDateText}" = ${context.canonicalDate.displayDate} (${context.canonicalDate.resolvedDate}). Use exactly that date; never ask the user for a date format.` : null,
    context.canonicalSport ? `This request's sport is ${context.canonicalSport.toUpperCase()}.` : null,
  ].filter(Boolean).join(' ');
  input.unshift({ role: 'developer', content: scopeNote });
  const toolTrace: AgentToolTrace[] = [];
  let results: unknown[] = [];
  let closestMisses: unknown[] = [];
  let rankingAttempted = false;
  let meta: Record<string, unknown> | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callOpenAI(model, apiKey, input);
    const output = response.output ?? [];
    const calls = output.filter((item): item is OpenAIFunctionCall => item.type === 'function_call');

    if (calls.length === 0) {
      return { reply: textFrom(output) || 'No response was produced.', toolTrace, results: resolveStructuredResults(results, rankingAttempted, context.researchSession, context.pendingQueryIntent, context.canonicalDate?.resolvedDate), closestMisses, meta, researchSessionId: context.researchSessionId };
    }

    for (const item of output) input.push(item as InputItem);

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch { /* malformed args become an empty object; the tool reports the failure */ }

      const result = await executeTool(call.name, args, context);
      const { data, ...resultMeta } = result;
      toolTrace.push({ name: call.name, status: result.status, summary: resultMeta });
      if (result.status === 'RESEARCH_INCOMPLETE') return { reply: 'The requested NFL slate could not be fully researched.', toolTrace, results: [], closestMisses: [], meta: resultMeta, researchSessionId: null };

      if (call.name === 'rank_candidates') {
        rankingAttempted = true;
        const payload = data as { results?: unknown[] } | undefined;
        results = result.status === 'SUCCESS' ? payload?.results ?? [] : [];
        const misses = (data as { closestMisses?: unknown[] } | undefined)?.closestMisses;
        if (result.status === 'NO_ELITE_RESULTS' && Array.isArray(misses)) closestMisses = misses;
        meta = { ...(meta ?? {}), ...resultMeta };
      } else if (['get_sportsbook_candidates', 'get_last_research_session', 'get_closest_misses', 'run_elite_filter'].includes(call.name)) {
        if (call.name === 'get_closest_misses' && /\bclosest\s+(?:misses|plays|picks)\b/i.test(context.pendingQueryIntent)) {
          closestMisses = (data as { closestMisses?: unknown[] } | undefined)?.closestMisses ?? [];
        }
        // These are session-scoped reads/refreshes; merge so the UI's "last analysis" summary
        // still reflects the stored session even on a turn that only answers from memory.
        meta = { ...(meta ?? {}), ...resultMeta };
      }

      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
  }

  return { reply: 'Research stopped after too many tool steps. Please narrow the request.', toolTrace, results: resolveStructuredResults(results, rankingAttempted, context.researchSession, context.pendingQueryIntent, context.canonicalDate?.resolvedDate), closestMisses, meta, researchSessionId: context.researchSessionId };
}
