import { NextResponse } from 'next/server';
import { runNFLAutomaticGrading, appendOperatorDisposition } from '../../../../../lib/nfl/predictionLedger/grading';
import { gradingAuthorized } from '../../../../../lib/nfl/predictionLedger/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!gradingAuthorized(request.headers.get('authorization'))) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  let body: { action?: unknown; predictionId?: unknown; grade?: unknown; reason?: unknown } = {};
  try { body = await request.json() as typeof body; } catch { /* Empty request runs automatic grading. */ }
  try {
    if (body.action === 'adjudicate') {
      if (typeof body.predictionId !== 'string' || (body.grade !== 'VOID' && body.grade !== 'UNGRADABLE') || typeof body.reason !== 'string') {
        return NextResponse.json({ error: 'Invalid adjudication.' }, { status: 400 });
      }
      const result = await appendOperatorDisposition({ predictionId: body.predictionId, grade: body.grade, reason: body.reason });
      return NextResponse.json({ created: result.created, currentGrade: result.record.currentGrade });
    }
    return NextResponse.json(await runNFLAutomaticGrading());
  } catch (error) {
    console.error('[nfl-ledger] grading failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Grading could not complete; unresolved outcomes remain unchanged.' }, { status: 503 });
  }
}
