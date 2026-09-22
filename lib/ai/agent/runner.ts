import { createAgentContext, executeTool, selectRankedCandidates, TOOL_DEFINITIONS, MAX_RESULTS_CEILING } from './tools';
import { getClosestMisses } from './session';
import { getResearchSession } from './sessionStore';
import type { ResearchSession } from './session';

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
- You may only state sportsbook lines, odds, projections, statistics, injuries or hit rates that came from a tool result in this conversation. Never invent, estimate or recall them from memory.
- You never decide whether a pick qualifies as Elite. Only the run_elite_filter and rank_candidates tools decide that, via their eliteQualified flag. You explain their verdict.
- Every new request is re-filtered and re-ranked from structured session data using its latest constraints. Cached data may be reused; a previous ranked answer may not.
- Official plays must have current American odds of -900 or longer. Requested prices are hard filters, never permission to weaken Elite qualification.
- If a tool returns a non-SUCCESS status, report that exact situation. Never substitute a different explanation.
- If a candidate's field is null or absent from a tool result, say "unavailable". Never fill it with a plausible-sounding guess.

RESEARCH PHILOSOPHY — season averages, L5/L10 hit rates, and basic opponent rankings are SUPPORTING evidence only, never the main reason for a pick. Every candidate carries deeper computed research; use it:
- grade: a letter grade (A+, A, A-, B+, B, C, D, F) layered on top of the Elite Filter. Most candidates should NOT be A/A+ — that requires both passing Elite AND clearing the outlier-dependency and volume-efficiency checks. Never state a grade yourself; only quote the tool's grade field.
- outlierDependencePercent: how much of the player's recent production came from a single standout game. High values mean the production is not repeatable — mention this when relevant.
- howItLoses: the candidate's real, computed failure modes. When presenting or defending a pick, include at least one of these verbatim (or their substance) — never invent a different failure scenario.
- bestAlternateLine: the best risk-adjusted threshold found among all posted lines for that player+market (may differ from the standard line). Mention it when the user asks about alternates or pricing.
- evidenceBoard: named signals (Projection vs Line, Recent Form, Long-Term Baseline, Opponent Matchup, Expected Role, Injury Cascade, Film/Scouting, Trench Matchup, Game Script) each marked agree/disagree/unavailable. Several are always "unavailable" because DeepSide has no connected data source for them (injury cascades, film/scouting, OL/DL trench data, team totals for game-script weighting) — say so plainly rather than guessing; do not treat "unavailable" as a negative signal, just an honest gap.
- playerEdgePercent vs priceEdgePercent: these are different things. A good player prediction (playerEdgePercent) can still be a bad bet at a bad price (negative priceEdgePercent) — distinguish them when both are present.

DISTINGUISHING FAILURES — these are completely different and must never be conflated:
- NO_CACHED_SPORTSBOOK_DATA: no props are cached or currently offered for this slate. Say sportsbook data is not cached for this slate. Do NOT say "no Elite picks found" and do NOT blame credits.
- PAID_REFRESH_NOT_AUTHORIZED: current data is not cached and a paid refresh has not been authorized. Say exactly that — a fresh sportsbook refresh is required but is not authorized. Never attribute this to the credit reserve.
- SPORTSBOOK_DATA_REQUIRED: the free preflight ran, sportsbook candidates are unavailable, and research did not run. Report the requested sport/date and preflight cost/cache fields. Never say "no Elite picks" or "0 matching opportunities" for this state.
- EVENT_LIST_REQUIRED: the free Odds event list does not contain the requested slate. This is an event-discovery/cache state, not an Elite result and not a paid player-prop refresh; report estimated cost as unknown until events are available.
- RESERVE_BLOCKED: the Odds API credit reserve genuinely blocked a refresh. Only use this wording when the tool returned this exact status.
- STALE_SPORTSBOOK_DATA: research ran on stale prices. Report findings but state that current EV is unavailable and nothing can qualify as official Elite.
- SLATE_COMPLETE: every game already finished, so no props exist. Suggest the next slate.
- NO_CANDIDATES: props loaded but produced no researchable candidates.
- NO_ELITE_RESULTS: candidates were researched but none passed. Say how many were researched and give the main rejection reasons.
- SPORT_UNAVAILABLE: that sport has no connected data. Say what is missing; never pretend.

REUSING LOADED DATA — sportsbook refreshes cost real money, so never reload a slate you already have:
- Once a research session exists for a sport+date, EVERY narrowing or rephrased question must be answered with rank_candidates (or get_closest_misses / get_last_research_session) against that stored pool.
- "best pitcher strikeout spots" -> rank_candidates(marketContains:"strikeout"). "strongest overs" -> side:"over". "best Yankees props" -> team:"Yankees". "top 5 closest misses" -> get_closest_misses.
- Only call get_sportsbook_candidates when the sport or date actually changes, or when no session exists yet. Different wording about the SAME slate is never a reason to reload.
- When the user explicitly asks to refresh, research/search again, or check newly available/fresh/latest markets, call get_sportsbook_candidates even for the same slate. This checks for provider data added since the stored session and never relaxes qualification.

"BEST"/"FAVORITE"/"STRONGEST"/"TOP" NEVER MEANS BYPASSING THE ELITE FILTER. If Elite qualifiers exist, return them ranked. If none do, say plainly that none passed — then you may show closest misses only if they are explicitly labelled NON-ELITE. Never present a miss as an official pick.

WORKFLOW for a request like "find me the best MLB plays tomorrow":
1. If this is a follow-up about candidates, players, or results already discussed in this conversation (e.g. "why did the closest one fail", "show me the 5 closest misses", "compare the top two", "what was X's projection"), call get_last_research_session or get_closest_misses FIRST. These read stored data and make no new sportsbook calls. Only fall back to get_sportsbook_candidates if one of them returns NO_CANDIDATES.
2. For a genuinely new request (a different sport, date, or slate, or no session stored yet), call get_sportsbook_candidates(sport, date) to load the slate from cache.
3. If it succeeded, rank_candidates(...) with the user's filters and maxResults.
4. Explain the outcome using only returned numbers. When citing a specific candidate, use its exact player, market, line, projection, grade, researchScore, signalAgreement, trapRisk, howItLoses and rejectionReasons from the tool result — never approximate or omit a field, and say "unavailable" for any field that is null.
You may call get_slate first if the user asks about games rather than props, and get_sport_capabilities if a sport's status is unclear.

MAX RESULTS: default and ceiling is ${MAX_RESULTS_CEILING}. It is a maximum, never a quota. If only 3 qualify, present 3. If zero qualify, present zero and explain why — a slate returning no picks is a valid, expected outcome, not a failure. Never lower standards to fill slots.

STYLE: Be concise and factual. Start with a short summary, separate sections with blank lines, use short paragraphs, and use headings or bullets for reasons and risks. Never return one giant paragraph. Report counts (games, props, books, candidates, qualified). When presenting picks include player, market, line, side, best book, odds, grade, and the research score, plus at least one real failure mode from howItLoses. Never use hype.`;

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

export function resolveStructuredResults(results: unknown[], rankingAttempted: boolean, session: ResearchSession | null, query = ''): unknown[] {
  if (rankingAttempted) return results;
  if (!session) return [];
  const ranked = selectRankedCandidates(session.candidates, query);
  if ((ranked.constraints.sport && ranked.constraints.sport !== session.sport) || (ranked.constraints.date && ranked.constraints.date !== session.date)) return [];
  return ranked.selected;
}

function isCachedRankingRequest(query: string) {
  return /\b(?:best|top|strongest|favorite|safer|safest|higher value|higher payout|better payout|more upside|plays? around|props? around)\b/i.test(query);
}

export function rankCachedSession(session: ResearchSession, query: string, researchSessionId: string | null): AgentTurnResult | null {
  const { constraints, pool, selected } = selectRankedCandidates(session.candidates, query);
  if ((constraints.sport && constraints.sport !== session.sport) || (constraints.date && constraints.date !== session.date)) return null;
  const eliteFound = pool.filter((candidate) => candidate.eliteQualified).length;
  const meta = { sport: session.sport, date: session.date, ...session.toolMeta, candidatesFound: pool.length, eliteFound, cached: true, reusedExistingSession: true };
  const toolTrace: AgentToolTrace[] = [
    { name: 'get_last_research_session', status: 'SUCCESS', summary: { status: 'SUCCESS', ...meta } },
    { name: 'rank_candidates', status: selected.length ? 'SUCCESS' : 'NO_ELITE_RESULTS', summary: { status: selected.length ? 'SUCCESS' : 'NO_ELITE_RESULTS', ...meta, constraints } },
  ];
  const reply = selected.length
    ? `Found ${selected.length} Elite NFL play${selected.length === 1 ? '' : 's'} from the cached researched pool.`
    : pool.length === 0
      ? 'No Elite candidates matched those requested constraints.'
      : `Researched ${pool.length} matching candidates and none passed the Elite threshold.`;
  return { reply, toolTrace, results: selected, closestMisses: selected.length ? [] : getClosestMisses(session, 5), meta, researchSessionId };
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

export async function runAgentTurn(history: AgentTurnMessage[], researchSessionId: string | null = null, refreshApproval: AgentRefreshApproval | null = null): Promise<AgentTurnResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AIUnavailableError('OPENAI_API_KEY is not configured on the server. Add it to .env.local and restart.');
  }
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  const context = createAgentContext(await getResearchSession(researchSessionId), researchSessionId, refreshApproval);
  const lastUserMessage = [...history].reverse().find((message) => message.role === 'user');
  context.pendingQueryIntent = lastUserMessage?.content ?? '';
  if (!refreshApproval && context.researchSession && isCachedRankingRequest(context.pendingQueryIntent)) {
    const ranked = rankCachedSession(context.researchSession, context.pendingQueryIntent, context.researchSessionId);
    if (ranked) return ranked;
  }
  const input: InputItem[] = history.map((message) => ({ role: message.role, content: message.content }));
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
      return { reply: textFrom(output) || 'No response was produced.', toolTrace, results: resolveStructuredResults(results, rankingAttempted, context.researchSession, context.pendingQueryIntent), closestMisses, meta, researchSessionId: context.researchSessionId };
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

      if (call.name === 'rank_candidates') {
        rankingAttempted = true;
        const payload = data as { results?: unknown[] } | undefined;
        results = result.status === 'SUCCESS' ? payload?.results ?? [] : [];
        const misses = (data as { closestMisses?: unknown[] } | undefined)?.closestMisses;
        if (result.status === 'NO_ELITE_RESULTS' && Array.isArray(misses)) closestMisses = misses;
        meta = { ...(meta ?? {}), ...resultMeta };
      } else if (['get_sportsbook_candidates', 'get_last_research_session', 'get_closest_misses', 'run_elite_filter'].includes(call.name)) {
        // These are session-scoped reads/refreshes; merge so the UI's "last analysis" summary
        // still reflects the stored session even on a turn that only answers from memory.
        meta = { ...(meta ?? {}), ...resultMeta };
      }

      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
  }

  return { reply: 'Research stopped after too many tool steps. Please narrow the request.', toolTrace, results: resolveStructuredResults(results, rankingAttempted, context.researchSession, context.pendingQueryIntent), closestMisses, meta, researchSessionId: context.researchSessionId };
}
