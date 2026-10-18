import { isLedgerReadAuthorized } from '../../../../lib/nfl/predictionLedger/security';
import { getDurableKVStatus as readDurableKVStatus, kvGetJson } from '../../../../lib/storage/kv';
import { readCreditStatus } from '../../../../lib/odds/persistentCache';
import { getOddsRefreshLimits, isAutomaticOddsRefreshEnabled } from '../../../../lib/odds/autoRefreshLedger';
import { readResearchHealth } from '../../../../lib/reliability/monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type State = 'UNKNOWN' | 'NOT_CONFIGURED' | 'CONFIGURED' | 'HEALTHY' | 'DEGRADED' | 'DOWN';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function observation(value: unknown, now: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : null;
}

export async function GET(request: Request) {
  if (!isLedgerReadAuthorized(request.headers.get('cookie'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const checkedAt = Date.now();
  const healthReadErrors: string[] = [];
  let durable: { state: State; configured: boolean | null } = { state: 'UNKNOWN', configured: null };
  try {
    const status = readDurableKVStatus();
    durable = { configured: status.configured, state: status.configured ? 'CONFIGURED' : 'NOT_CONFIGURED' };
    if (status.configured) {
      await kvGetJson('deepside:system-health:read-only-sentinel');
      durable.state = 'HEALTHY';
    }
  } catch {
    durable.state = 'DOWN';
    healthReadErrors.push('durable');
  }

  let credits: { state: State; freshness: 'UNKNOWN' | 'FRESH' | 'STALE'; balance: number | null; observedAt: number | null; ageMs: number | null } = {
    state: 'UNKNOWN', freshness: 'UNKNOWN', balance: null, observedAt: null, ageMs: null,
  };
  try {
    const cached = await readCreditStatus();
    const observedAt = observation(cached?.updatedAt, checkedAt);
    const balance = cached?.remaining != null && /^\d+$/.test(cached.remaining) ? count(Number(cached.remaining)) : null;
    const ageMs = observedAt == null ? null : checkedAt - observedAt;
    credits = {
      state: 'UNKNOWN',
      freshness: ageMs == null ? 'UNKNOWN' : ageMs > 300_000 ? 'STALE' : 'FRESH',
      balance, observedAt, ageMs,
    };
  } catch { healthReadErrors.push('credits'); }

  let refresh: { state: State; enabled: boolean; limits: ReturnType<typeof getOddsRefreshLimits> | null } = {
    state: 'UNKNOWN', enabled: isAutomaticOddsRefreshEnabled(), limits: null,
  };
  try { refresh = { ...refresh, state: 'CONFIGURED', limits: getOddsRefreshLimits() }; }
  catch { refresh.state = 'DEGRADED'; healthReadErrors.push('refreshLimits'); }

  let monitoring: Record<string, unknown> = {};
  let monitoringState: State = 'UNKNOWN';
  try { monitoring = record(await readResearchHealth()); }
  catch { monitoringState = 'DEGRADED'; healthReadErrors.push('monitoring'); }
  const recordedSports = record(monitoring.sports);
  const sports = ['NFL', 'MLB', 'NBA'].map(sport => {
    const entry = record(recordedSports[sport] ?? recordedSports[sport.toLowerCase()]);
    const observedAt = observation(entry.lastAt, checkedAt);
    const receiptFailed = ['CONFIGURATION_ERROR', 'WRITE_FAILED', 'READ_FAILED'].includes(String(entry.receiptError));
    if (receiptFailed) {
      monitoringState = 'DEGRADED';
      if (!healthReadErrors.includes('monitoring')) healthReadErrors.push('monitoring');
    }
    let state: State = 'UNKNOWN';
    if (observedAt != null && entry.status === 'observed' && entry.durability === 'durable' && !entry.receiptError) {
      state = count(entry.failed) === 0 && count(entry.partial) === 0 ? 'HEALTHY' : 'DEGRADED';
    } else if (receiptFailed || entry.durability === 'process-local') state = 'DEGRADED';
    const completeRate = typeof entry.completionRate === 'number' && Number.isFinite(entry.completionRate) && entry.completionRate >= 0 && entry.completionRate <= 1 ? entry.completionRate : null;
    const outcomes = ['OK', 'SUCCESS', 'COMPLETE', 'PARTIAL', 'NO_QUALIFYING_PICKS', 'NO_PICKS', 'NO_GAMES', 'UNAVAILABLE', 'ERROR',
      'RESEARCH_INCOMPLETE', 'NO_SPORTSBOOK_DATA', 'NO_CACHED_SPORTSBOOK_DATA', 'STALE_SPORTSBOOK_DATA', 'SPORTSBOOK_DATA_REQUIRED',
      'EVENT_LIST_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED', 'RESERVE_BLOCKED', 'NO_CANDIDATES', 'NO_ELITE_RESULTS', 'PROJECTION_UNAVAILABLE',
      'BUDGET_LIMITED', 'PROVIDER_ERROR', 'INVALID_DATE', 'SPORT_UNAVAILABLE', 'SLATE_COMPLETE', 'NOT_FOUND', 'NO_GAMES_SCHEDULED', 'MARKETS_NOT_POSTED'];
    return {
      sport, state, observedAt, ageMs: observedAt == null ? null : checkedAt - observedAt,
      total: count(entry.requests), complete: count(entry.complete), partial: count(entry.partial), failed: count(entry.failed), completeRate,
      durability: ['durable', 'process-local', 'unavailable'].includes(String(entry.durability)) ? entry.durability : null,
      lastOutcome: observedAt != null && outcomes.includes(String(entry.lastOutcome)) ? entry.lastOutcome : null,
    };
  });

  return Response.json({
    checkedAt,
    state: healthReadErrors.length > 0 ? 'DEGRADED' : 'UNKNOWN',
    durable,
    providers: {
      odds: { state: process.env.THE_ODDS_API_KEY?.trim() ? 'CONFIGURED' : 'NOT_CONFIGURED', configured: Boolean(process.env.THE_ODDS_API_KEY?.trim()), authorization: 'UNKNOWN' },
      openai: { state: process.env.OPENAI_API_KEY?.trim() ? 'CONFIGURED' : 'NOT_CONFIGURED', configured: Boolean(process.env.OPENAI_API_KEY?.trim()), authorization: 'UNKNOWN' },
    },
    credits, refresh, monitoring: { state: monitoringState, sports }, healthReadErrors,
  }, { headers });
}