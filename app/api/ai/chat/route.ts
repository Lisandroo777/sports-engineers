import { NextResponse } from 'next/server';
import { runAgentTurn, toClientResult, crossSportScope, AIUnavailableError, type AgentRefreshApproval, type AgentTurnMessage } from '../../../../lib/ai/agent/runner';
import { deleteResearchSession } from '../../../../lib/ai/agent/sessionStore';
import { interpretBettingIntent } from '../../../../communication/intent';
import { issueNFLPresentationReceipt } from '../../../../lib/nfl/predictionLedger/capture';
import { detectSport } from '../../../../lib/ai/sportResearchAdapters';
import { recordResearchOutcome, type ResearchOutcomeInput, type ResearchOutcomeStatus, type ResearchSport } from '../../../../lib/reliability/monitor';
import { getResearchFailureDiagnostic, withResearchStage } from '../../../../lib/reliability/researchFailure';
import { withCachedOddsOnly } from '../../../../lib/odds/client';

export const runtime = 'nodejs';

const MAX_HISTORY = 24;
const OUTCOME_STATUSES: readonly ResearchOutcomeStatus[] = [
  'OK', 'SUCCESS', 'COMPLETE', 'PARTIAL', 'NO_QUALIFYING_PICKS', 'NO_PICKS', 'NO_GAMES', 'UNAVAILABLE', 'ERROR',
  'RESEARCH_INCOMPLETE', 'NO_SPORTSBOOK_DATA', 'NO_CACHED_SPORTSBOOK_DATA', 'STALE_SPORTSBOOK_DATA',
  'SPORTSBOOK_DATA_REQUIRED', 'EVENT_LIST_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED', 'RESERVE_BLOCKED',
  'NO_CANDIDATES', 'NO_ELITE_RESULTS', 'PROJECTION_UNAVAILABLE', 'BUDGET_LIMITED', 'PROVIDER_ERROR',
  'INVALID_DATE', 'SPORT_UNAVAILABLE', 'SLATE_COMPLETE', 'NOT_FOUND', 'NO_GAMES_SCHEDULED', 'MARKETS_NOT_POSTED',
];

function outcomeSport(value: unknown): ResearchSport | undefined {
  return value === 'nfl' || value === 'nba' || value === 'mlb' || value === 'all' ? value : undefined;
}

function outcomeCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

async function recordOutcome(input: ResearchOutcomeInput): Promise<void> {
  try { await recordResearchOutcome(input); } catch {}
}

/** Reset clears the active research session server-side too, not just the client's ID. */
export async function DELETE(request: Request) {
  let body: { researchSessionId?: string | null };
  try {
    body = (await request.json()) as { researchSessionId?: string | null };
  } catch {
    return NextResponse.json({ ok: true });
  }
  await deleteResearchSession(body.researchSessionId ?? null);
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: { messages?: AgentTurnMessage[]; researchSessionId?: string | null; refreshApproval?: AgentRefreshApproval | null; cacheOnly?: boolean; context?: { sport?: 'nfl' | 'nba' | 'mlb'; date?: string } };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const messages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY);

  if (messages.length === 0) return NextResponse.json({ error: 'At least one message is required.' }, { status: 400 });

  const query = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const context = body.context && ['nfl', 'nba', 'mlb'].includes(body.context.sport ?? '') ? { sport: body.context.sport,
    date: typeof body.context.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.context.date) ? body.context.date : undefined } : undefined;
  const requestedSport = (!context && crossSportScope(query).length > 1 ? 'all' : outcomeSport(detectSport(query)))
    ?? outcomeSport(context?.sport) ?? 'unknown';
  try {
    // The client only persists/resends a small session ID; the full research session lives server-side.
    const result = await (body.cacheOnly === true
      ? withCachedOddsOnly(() => runAgentTurn(messages, body.researchSessionId ?? null, null, context))
      : runAgentTurn(messages, body.researchSessionId ?? null, null, context));
    const clientResult = await withResearchStage('response-serialization', () => toClientResult(result));
    let ledgerReceipt: string | null = null;
    if (clientResult.meta?.sport === 'nfl' && clientResult.results.length) {
      try {
        const intent = interpretBettingIntent(query, clientResult.results as never[], null, 'nfl');
        ledgerReceipt = await issueNFLPresentationReceipt({ results: clientResult.results, meta: clientResult.meta,
          researchSessionId: clientResult.researchSessionId, rankingIntent: intent.rankingIntent });
      } catch {
        console.error('[nfl-ledger] presentation receipt unavailable');
      }
    }
    const response = await withResearchStage('response-serialization', () => NextResponse.json({ ...clientResult, ledgerReceipt }));
    const meta = clientResult.meta;
    const ledger = meta?.nflLedger as { failedGames?: unknown } | undefined;
    const partialCoverage = meta?.partialCoverage === true || (outcomeCount(ledger?.failedGames) ?? 0) > 0;
    const status = typeof meta?.status === 'string' && OUTCOME_STATUSES.includes(meta.status as ResearchOutcomeStatus)
      ? meta.status : partialCoverage ? 'PARTIAL'
        : meta?.researchComplete === true || clientResult.results.length > 0 ? 'SUCCESS' : 'RESEARCH_INCOMPLETE';
    await recordOutcome({ sport: outcomeSport(meta?.sport) ?? requestedSport, status,
      researchComplete: meta?.researchComplete === true, partialCoverage,
      resultsCount: clientResult.results.length, gamesFound: outcomeCount(meta?.gamesFound),
      gamesScheduled: outcomeCount(meta?.gamesScheduled), durationMs: Date.now() - startedAt });
    return response;
  } catch (error) {
    const diagnostic = getResearchFailureDiagnostic(error);
    const storageUnavailable = diagnostic.stage === 'session-save' || diagnostic.stage === 'session-read'
      || diagnostic.category === 'STORAGE';
    await recordOutcome({ sport: requestedSport, status: error instanceof AIUnavailableError || storageUnavailable ? 'UNAVAILABLE' : 'PROVIDER_ERROR',
      researchComplete: false, partialCoverage: false, resultsCount: 0, durationMs: Date.now() - startedAt });
    if (error instanceof AIUnavailableError) {
      return NextResponse.json({ error: 'The research agent is currently unavailable.', code: 'AI_UNAVAILABLE' }, { status: 503 });
    }
    console.error('[ai] agent turn failed', diagnostic);
    if (storageUnavailable) {
      const message = diagnostic.stage === 'session-save'
        ? 'Research was evaluated, but saved research storage is temporarily unavailable. No new request was started automatically.'
        : 'Saved research is temporarily unavailable.';
      return NextResponse.json({ error: message, code: 'RESEARCH_STORAGE_UNAVAILABLE' }, { status: 503 });
    }
    return NextResponse.json({ error: 'The research agent failed to complete this request.', code: 'PROVIDER_ERROR' }, { status: 500 });
  }
}

