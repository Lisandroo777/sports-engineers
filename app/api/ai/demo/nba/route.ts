import { NextResponse } from 'next/server';
import { buildNBAHistoricalDemo, NBA_DEMO_MARKET_IDS } from '../../../../../lib/nba/prediction/historicalDemo';
import { normalizeNBAResearchFilter } from '../../../../../lib/nba/researchMarkets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filter = normalizeNBAResearchFilter({
    marketIds: url.searchParams.has('market') ? url.searchParams.getAll('market') : [...NBA_DEMO_MARKET_IDS],
    sides: url.searchParams.has('side') ? url.searchParams.getAll('side') : ['over', 'under'],
  });
  const presentation = buildNBAHistoricalDemo(filter);
  return NextResponse.json({
    demo: true,
    label: 'TEST DATA · SYNTHETIC NBA FIXTURES',
    notice: 'Mock values for UI testing only. Not a saved sportsbook receipt, historical game, live quote, recommendation or wager. No external API or storage access was used.',
    presentation,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}