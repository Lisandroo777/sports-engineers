import { NextResponse } from 'next/server';
import { runAgentTurn, toClientResult, AIUnavailableError, type AgentRefreshApproval, type AgentTurnMessage } from '../../../../lib/ai/agent/runner';
import { deleteResearchSession } from '../../../../lib/ai/agent/sessionStore';
import { interpretBettingIntent } from '../../../../communication/intent';
import { issueNFLPresentationReceipt } from '../../../../lib/nfl/predictionLedger/capture';

export const runtime = 'nodejs';

const MAX_HISTORY = 24;

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
  let body: { messages?: AgentTurnMessage[]; researchSessionId?: string | null; refreshApproval?: AgentRefreshApproval | null; context?: { sport?: 'nfl' | 'nba' | 'mlb'; date?: string } };
  try {
    body = (await request.json()) as { messages?: AgentTurnMessage[]; researchSessionId?: string | null; refreshApproval?: AgentRefreshApproval | null };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const messages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY);

  if (messages.length === 0) return NextResponse.json({ error: 'At least one message is required.' }, { status: 400 });

  try {
    // The client only persists/resends a small session ID; the full research session lives server-side.
    const context = body.context && ['nfl', 'nba', 'mlb'].includes(body.context.sport ?? '') ? { sport: body.context.sport,
      date: typeof body.context.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.context.date) ? body.context.date : undefined } : undefined;
    const result = await runAgentTurn(messages, body.researchSessionId ?? null, body.refreshApproval ?? null, context);
    const clientResult = toClientResult(result);
    let ledgerReceipt: string | null = null;
    if (clientResult.meta?.sport === 'nfl' && clientResult.results.length) {
      try {
        const query = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
        const intent = interpretBettingIntent(query, clientResult.results as never[], null, 'nfl');
        ledgerReceipt = await issueNFLPresentationReceipt({ results: clientResult.results, meta: clientResult.meta,
          researchSessionId: clientResult.researchSessionId, rankingIntent: intent.rankingIntent });
      } catch (error) {
        console.error('[nfl-ledger] presentation receipt unavailable', error instanceof Error ? error.message : error);
      }
    }
    return NextResponse.json({ ...clientResult, ledgerReceipt });
  } catch (error) {
    if (error instanceof AIUnavailableError) {
      return NextResponse.json({ error: error.message, code: 'AI_UNAVAILABLE' }, { status: 503 });
    }
    console.error('[ai] agent turn failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The research agent failed to complete this request.', code: 'PROVIDER_ERROR' }, { status: 500 });
  }
}

