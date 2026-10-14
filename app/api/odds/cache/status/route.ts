import { NextResponse } from 'next/server';
import { readCreditStatus } from '@/lib/odds/persistentCache';
import { getOddsBudgetStatus } from '@/lib/odds/budget';
import { getDurableKVStatus } from '@/lib/storage/kv';
import { getOddsRefreshLimits, isAutomaticOddsRefreshEnabled } from '@/lib/odds/autoRefreshLedger';

export const revalidate = 0;

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const storage = getDurableKVStatus();
    const automaticRefresh = { enabled: isAutomaticOddsRefreshEnabled(), limits: getOddsRefreshLimits() };
    if (!storage.configured) {
      return NextResponse.json({ storage, automaticRefresh, error: 'REDIS_NOT_CONFIGURED' }, { status: 503, headers });
    }
    const credits = await readCreditStatus();
    const budget = await getOddsBudgetStatus();
    return NextResponse.json({ credits, budget, storage: { ...storage, readable: true }, automaticRefresh }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = message.startsWith('Durable KV configuration invalid:') ? 'REDIS_CONFIGURATION_INVALID'
      : /^Durable KV request failed \((401|403)\)$/.test(message) ? 'REDIS_AUTH_REJECTED'
      : /^Invalid ODDS_REFRESH_/.test(message) ? 'ODDS_REFRESH_CONFIGURATION_INVALID'
      : 'REDIS_UNAVAILABLE';
    return NextResponse.json({ error: code }, { status: 503, headers });
  }
}
