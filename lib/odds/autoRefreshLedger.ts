import { createHash, randomUUID } from 'node:crypto';
import { hasDurableKV, kvEval } from '../storage/kv';

export const AUTO_REFRESH_LIMITS = Object.freeze({ perSearchCredits: 50, dailyCredits: 300, minProviderRemaining: 2000 });
export function getOddsRefreshLimits() {
  const bounded = (name: string, fallback: number, minimum: number, maximum: number) => {
    const raw = process.env[name];
    if (raw == null || raw === '') return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${name}; paid refresh is blocked.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}; paid refresh is blocked.`);
    return value;
  };
  return Object.freeze({
    perSearchCredits: bounded('ODDS_REFRESH_MAX_SEARCH_CREDITS', 50, 1, AUTO_REFRESH_LIMITS.perSearchCredits),
    dailyCredits: bounded('ODDS_REFRESH_MAX_DAILY_CREDITS', 300, 1, AUTO_REFRESH_LIMITS.dailyCredits),
    minProviderRemaining: bounded('ODDS_REFRESH_MIN_REMAINING', 2000, AUTO_REFRESH_LIMITS.minProviderRemaining, Number.MAX_SAFE_INTEGER),
    requestsPerMinute: bounded('ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE', 10, 1, 50),
  });
}
const PREFIX = 'deepside:odds:auto:v2:';
const ACCOUNT = `${PREFIX}account`;
export type LedgerBlockReason = 'DAILY_CAP' | 'RESERVE' | 'REMAINING_UNKNOWN' | 'STORAGE_UNAVAILABLE' | 'RATE_LIMIT';
export class AutoRefreshLedgerError extends Error {
  constructor(readonly reason: LedgerBlockReason) {
    super(`Automatic odds refresh blocked (${reason}).`);
  }
}
export function isAutomaticOddsRefreshEnabled() { return process.env.ODDS_AUTO_REFRESH === 'true'; }
export function dailyLedgerKey(now = new Date()) { return `${PREFIX}day:${now.toISOString().slice(0, 10)}`; }

export const RESERVE_SCRIPT = `
local remaining = tonumber(redis.call('HGET', KEYS[2], 'remaining'))
local observed = tonumber(redis.call('HGET', KEYS[2], 'observed') or '0')
local now = tonumber(redis.call('TIME')[1])
if not remaining or now - observed > 300 then return 'REMAINING_UNKNOWN' end
local spent = tonumber(redis.call('HGET', KEYS[1], 'spent') or '0')
local pending = tonumber(redis.call('HGET', KEYS[2], 'pending') or '0')
local cost = tonumber(ARGV[1])
if spent + pending + cost > tonumber(ARGV[2]) then return 'DAILY_CAP' end
if remaining - cost < tonumber(ARGV[3]) then return 'RESERVE' end
local window = math.floor(now / 60)
local lastWindow = tonumber(redis.call('HGET', KEYS[2], 'rateWindow') or '-1')
local requests = tonumber(redis.call('HGET', KEYS[2], 'rateCount') or '0')
if lastWindow ~= window then requests = 0 end
if requests >= tonumber(ARGV[4]) then return 'RATE_LIMIT' end
redis.call('HSET', KEYS[2], 'rateWindow', window, 'rateCount', requests + 1)
redis.call('HINCRBY', KEYS[2], 'remaining', -cost)
redis.call('HINCRBY', KEYS[2], 'pending', cost)
redis.call('SET', KEYS[3], cost)
return 'OK'`;

export const SETTLE_SCRIPT = `
local cost = tonumber(redis.call('GET', KEYS[3]))
if not cost then return 'ALREADY_SETTLED' end
local charged = math.max(cost, tonumber(ARGV[1]))
redis.call('HINCRBY', KEYS[2], 'pending', -cost)
redis.call('HINCRBY', KEYS[1], 'spent', charged)
if ARGV[2] == '1' then
  redis.call('HINCRBY', KEYS[1], 'actual', tonumber(ARGV[1]))
else
  redis.call('HINCRBY', KEYS[1], 'unknown', cost)
end
if KEYS[4] ~= KEYS[1] then redis.call('HINCRBY', KEYS[4], 'spent', charged) end
if charged > cost then
  redis.call('HINCRBY', KEYS[2], 'remaining', -(charged-cost))
  redis.call('HDEL', KEYS[2], 'observed')
end
redis.call('DEL', KEYS[3])
return 'OK'`;

export const OBSERVE_SCRIPT = `
local old = tonumber(redis.call('HGET', KEYS[1], 'remaining'))
local observed = tonumber(ARGV[1])
if not old or observed < old then redis.call('HSET', KEYS[1], 'remaining', observed) end
redis.call('HSET', KEYS[1], 'observed', redis.call('TIME')[1])
return 'OK'`;

export const LOCK_SCRIPT = `return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) or 'BUSY'`;
/** Bounds an unknown-outcome lock so a crashed/timed-out refresh cannot block that market forever. */
export const REFRESH_LOCK_TTL_MS = 10 * 60 * 1000;
export const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

async function execute<T>(script: string, keys: string[], args: Array<string | number>): Promise<T> {
  if (!hasDurableKV()) throw new AutoRefreshLedgerError('STORAGE_UNAVAILABLE');
  try { return await kvEval<T>(script, keys, args); }
  catch { throw new AutoRefreshLedgerError('STORAGE_UNAVAILABLE'); }
}
export interface DailyReservation { dayKey: string; credits: number; id: string }
export async function reserveDailyCredits(credits: number, now = new Date()): Promise<DailyReservation> {
  const limits = getOddsRefreshLimits();
  if (!Number.isSafeInteger(credits) || credits < 1 || credits > limits.perSearchCredits) throw new AutoRefreshLedgerError('RESERVE');
  const reservation = { dayKey: dailyLedgerKey(now), credits, id: `${PREFIX}reservation:${randomUUID()}` };
  const result = await execute<string>(RESERVE_SCRIPT, [reservation.dayKey, ACCOUNT, reservation.id],
    [credits, limits.dailyCredits, limits.minProviderRemaining, limits.requestsPerMinute]);
  if (result !== 'OK') throw new AutoRefreshLedgerError(result as LedgerBlockReason);
  return reservation;
}
export async function settleDailyCredits(reservation: DailyReservation, actualCredits: number | null) {
  const known = actualCredits != null && Number.isSafeInteger(actualCredits) && actualCredits >= 0;
  const actual = known ? actualCredits! : reservation.credits;
  await execute(SETTLE_SCRIPT, [reservation.dayKey, ACCOUNT, reservation.id, dailyLedgerKey()], [actual, known ? 1 : 0]);
}
export async function recordProviderRemaining(remaining: string | null) {
  if (remaining == null || !/^\d+$/.test(remaining) || !hasDurableKV()) return;
  const value = Number(remaining);
  if (!Number.isSafeInteger(value)) return;
  await execute(OBSERVE_SCRIPT, [ACCOUNT], [value]);
}
function lockKey(requestKey: string) {
  let identity = requestKey;
  try {
    const url = new URL(requestKey);
    url.searchParams.delete('apiKey');
    if (/\/events\/[^/]+\/odds$/.test(url.pathname)) url.search = '';
    for (const field of ['markets', 'regions', 'bookmakers']) {
      const value = url.searchParams.get(field);
      if (value) url.searchParams.set(field, [...new Set(value.split(','))].sort().join(','));
    }
    url.searchParams.sort();
    identity = url.toString();
  } catch {}
  return `${PREFIX}lock:${createHash('sha256').update(identity).digest('hex')}`;
}
export async function acquireRefreshLock(requestKey: string): Promise<string | null> {
  const owner = randomUUID();
  return await execute<string>(LOCK_SCRIPT, [lockKey(requestKey)], [owner, REFRESH_LOCK_TTL_MS]) === 'OK' ? owner : null;
}
export async function releaseRefreshLock(requestKey: string, owner: string) {
  await execute(UNLOCK_SCRIPT, [lockKey(requestKey)], [owner]);
}
