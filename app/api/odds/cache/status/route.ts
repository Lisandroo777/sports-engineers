import { NextResponse } from 'next/server';
import { readCreditStatus } from '@/lib/odds/persistentCache';
import { getOddsBudgetStatus } from '@/lib/odds/budget';
import { getDurableKVStatus, kvEval } from '@/lib/storage/kv';
import { dailyLedgerKey, getOddsRefreshLimits, isAutomaticOddsRefreshEnabled } from '@/lib/odds/autoRefreshLedger';

export const revalidate = 0;

export async function GET(request?: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const storage = getDurableKVStatus();
    const automaticRefresh = { enabled: isAutomaticOddsRefreshEnabled(), limits: getOddsRefreshLimits() };
    if (!storage.configured) {
      return NextResponse.json({ storage, automaticRefresh, error: 'REDIS_NOT_CONFIGURED' }, { status: 503, headers });
    }
    const credits = await readCreditStatus();
    const budget = await getOddsBudgetStatus();
    let refreshPreflight;
    if (request && new URL(request.url).searchParams.get('refreshPreflight') === '1') {
      const values = await kvEval<Array<number | string>>(`
local now = tonumber(redis.call('TIME')[1])
return {redis.call('HGET',KEYS[1],'remaining') or '-1',
redis.call('HGET',KEYS[1],'observed') or '0',
redis.call('HGET',KEYS[1],'pending') or '0',
redis.call('HGET',KEYS[2],'spent') or '0', now}
`, ['deepside:odds:auto:v2:account', dailyLedgerKey()], []);
      const parsed = values.map(Number);
      if (parsed.length !== 5 || parsed.some(value => !Number.isSafeInteger(value))
        || parsed.slice(1).some(value => value < 0)) throw new Error('Invalid refresh preflight');
      const [remaining, observed, pending, spent, now] = parsed;
      const requestedCredits = automaticRefresh.limits.perSearchCredits;
      const balanceCurrent = remaining >= 0 && observed > 0 && now >= observed && now - observed <= 300;
      refreshPreflight = {
        remaining: remaining < 0 ? null : remaining, observedAt: observed * 1000, balanceCurrent,
        dailySpent: spent, pendingCredits: pending, requestedCredits,
        dailyAvailable: Math.max(0, automaticRefresh.limits.dailyCredits - spent - pending),
        allowed: automaticRefresh.enabled && balanceCurrent
          && spent + pending + requestedCredits <= automaticRefresh.limits.dailyCredits
          && remaining - requestedCredits >= automaticRefresh.limits.minProviderRemaining,
      };
    }
    return NextResponse.json({ credits, budget, storage: { ...storage, readable: true }, automaticRefresh,
      ...(refreshPreflight ? { refreshPreflight } : {}) }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = message.startsWith('Durable KV configuration invalid:') ? 'REDIS_CONFIGURATION_INVALID'
      : /^Durable KV request failed \((401|403)\)$/.test(message) ? 'REDIS_AUTH_REJECTED'
      : /^Invalid ODDS_REFRESH_/.test(message) ? 'ODDS_REFRESH_CONFIGURATION_INVALID'
      : 'REDIS_UNAVAILABLE';
    return NextResponse.json({ error: code }, { status: 503, headers });
  }
}
