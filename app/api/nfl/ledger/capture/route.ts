import { NextResponse } from 'next/server';
import { captureAcknowledgedNFLRows } from '../../../../../lib/nfl/predictionLedger/capture';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { receipt?: unknown; candidateIds?: unknown };
  try { body = await request.json() as { receipt?: unknown; candidateIds?: unknown }; }
  catch { return NextResponse.json({ error: 'Invalid capture request.' }, { status: 400 }); }
  if (typeof body.receipt !== 'string' || !Array.isArray(body.candidateIds)
    || body.candidateIds.length > 15 || body.candidateIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'Invalid capture request.' }, { status: 400 });
  }
  try {
    const result = await captureAcknowledgedNFLRows(body.receipt, body.candidateIds as string[]);
    return NextResponse.json({ created: result.created, duplicates: result.duplicates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Capture rejected.';
    const status = /invalid or expired|not included/i.test(message) ? 403 : /durable Redis|not configured/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
