import { NextResponse } from 'next/server';
import { runAgentTurn, AIUnavailableError, type AgentRefreshApproval, type AgentTurnMessage } from '@/lib/ai/agent/runner';
import { deleteResearchSession } from '@/lib/ai/agent/sessionStore';

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
  let body: { messages?: AgentTurnMessage[]; researchSessionId?: string | null; refreshApproval?: AgentRefreshApproval | null };
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
    const result = await runAgentTurn(messages, body.researchSessionId ?? null, body.refreshApproval ?? null);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AIUnavailableError) {
      return NextResponse.json({ error: error.message, code: 'AI_UNAVAILABLE' }, { status: 503 });
    }
    console.error('[ai] agent turn failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The research agent failed to complete this request.', code: 'PROVIDER_ERROR' }, { status: 500 });
  }
}

