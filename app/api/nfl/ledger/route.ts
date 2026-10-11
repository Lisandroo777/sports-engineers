import { NextResponse } from 'next/server';
import { buildNFLPerformanceReport, recentPublicRows } from '../../../../lib/nfl/predictionLedger/aggregate';
import { redisNFLLedgerRepository } from '../../../../lib/nfl/predictionLedger/redisStore';
import { isLedgerReadAuthorized } from '../../../../lib/nfl/predictionLedger/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLedgerReadAuthorized(request.headers.get('cookie'))) return NextResponse.json({ error: 'Access denied.' }, { status: 401 });
  try {
    const records = [];
    for (let offset = 0; ; offset += 250) {
      const batch = await redisNFLLedgerRepository.list({ offset, limit: 250 });
      records.push(...batch);
      if (batch.length < 250) break;
    }
    return NextResponse.json({ report: buildNFLPerformanceReport(records), recent: recentPublicRows(records) }, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[nfl-ledger] read failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Track record storage is unavailable.' }, { status: 503 });
  }
}
