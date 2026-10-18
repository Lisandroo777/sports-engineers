import { hasDurableKV, kvEval, kvGetJson } from '../storage/kv';

const SPORTS = ['nfl', 'mlb', 'nba', 'all', 'unknown'] as const;
const STATUSES = [
  'OK', 'SUCCESS', 'COMPLETE', 'PARTIAL', 'NO_QUALIFYING_PICKS', 'NO_PICKS', 'NO_GAMES', 'UNAVAILABLE', 'ERROR',
  'RESEARCH_INCOMPLETE', 'NO_SPORTSBOOK_DATA', 'NO_CACHED_SPORTSBOOK_DATA', 'STALE_SPORTSBOOK_DATA',
  'SPORTSBOOK_DATA_REQUIRED', 'EVENT_LIST_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED', 'RESERVE_BLOCKED',
  'NO_CANDIDATES', 'NO_ELITE_RESULTS', 'PROJECTION_UNAVAILABLE', 'BUDGET_LIMITED', 'PROVIDER_ERROR',
  'INVALID_DATE', 'SPORT_UNAVAILABLE', 'SLATE_COMPLETE', 'NOT_FOUND', 'NO_GAMES_SCHEDULED', 'MARKETS_NOT_POSTED',
] as const;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_NUMBER = 1_000_000_000_000;
const COUNTERS = ['requests', 'complete', 'partial', 'failed', 'withPicks', 'resultsCount', 'gamesFound', 'gamesScheduled', 'durationTotal'] as const;

export type ResearchSport = typeof SPORTS[number];
export type ResearchOutcomeStatus = typeof STATUSES[number];
type ReceiptError = 'NOT_CONFIGURED' | 'CONFIGURATION_ERROR' | 'WRITE_FAILED' | 'READ_FAILED';
type Counters = Record<typeof COUNTERS[number], number>;
type Observation = Counters & { lastAt: number; lastDuration: number; lastOutcome: ResearchOutcomeStatus };
type DailyBucket = { hours: Record<string, Observation> };

export interface ResearchOutcomeInput {
  sport: unknown;
  status: string;
  researchComplete?: boolean;
  partialCoverage?: boolean;
  resultsCount: number;
  gamesFound?: number;
  gamesScheduled?: number;
  durationMs: number;
}

export interface ResearchHealthSummary extends Counters {
  sport: ResearchSport;
  status: 'observed' | 'unknown';
  durability: 'durable' | 'process-local' | 'unavailable';
  receiptError: ReceiptError | null;
  completionRate: number | null;
  lastAt: number | null;
  lastDuration: number | null;
  lastOutcome: ResearchOutcomeStatus | null;
}

export interface ResearchHealthSnapshot {
  checkedAt: number;
  windowStart: number;
  windowEnd: number;
  windowResolution: 'hour';
  retentionDays: 7;
  zeroOddsCalls: true;
  sports: Record<ResearchSport, ResearchHealthSummary>;
}

const local = new Map<string, DailyBucket>();
const receiptErrors = new Map<ResearchSport, ReceiptError>();

const INCREMENT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local stored = raw and cjson.decode(raw) or {}
local incoming = cjson.decode(ARGV[1])
local hour = ARGV[2]
local counters = {'requests','complete','partial','failed','withPicks','resultsCount','gamesFound','gamesScheduled','durationTotal'}
local allowedStatuses = cjson.decode('${JSON.stringify(STATUSES)}')
local function bounded(value, maximum)
  if type(value) ~= 'number' or value ~= value or value == math.huge or value == -math.huge then return 0 end
  return math.min(maximum, math.max(0, math.floor(value)))
end
local function sanitized(value)
  local clean = {}
  for _, field in ipairs(counters) do clean[field] = bounded(value[field], 1000000000000) end
  for _, field in ipairs({'complete','partial','failed','withPicks'}) do
    clean[field] = math.min(clean.requests, clean[field])
  end
  clean.lastAt = bounded(value.lastAt, 8640000000000000)
  clean.lastDuration = bounded(value.lastDuration, 86400000)
  clean.lastOutcome = 'ERROR'
  for _, status in ipairs(allowedStatuses) do
    if value.lastOutcome == status then clean.lastOutcome = status end
  end
  return clean
end
local bucket = { hours = {} }
local dayStart = math.floor(tonumber(hour) / 86400000) * 86400000
if type(stored) == 'table' and type(stored.hours) == 'table' then
  for offset = 0, 23 do
    local timestamp = dayStart + offset * 3600000
    local key = string.format('%.0f', timestamp)
    local value = stored.hours[key]
    if type(value) == 'table' then
      local clean = sanitized(value)
      if clean.requests > 0 and clean.lastAt >= timestamp and clean.lastAt < timestamp + 3600000 then
        bucket.hours[key] = clean
      end
    end
  end
end
local previous = bucket.hours[hour] or {}
for _, field in ipairs(counters) do
  incoming[field] = bounded((previous[field] or 0) + incoming[field], 1000000000000)
end
if (previous.lastAt or 0) > incoming.lastAt then
  incoming.lastAt = previous.lastAt
  incoming.lastDuration = previous.lastDuration
  incoming.lastOutcome = previous.lastOutcome
end
bucket.hours[hour] = incoming
for _, field in ipairs(counters) do bucket[field] = 0 end
bucket.lastAt = 0
for _, value in pairs(bucket.hours) do
  for _, field in ipairs(counters) do bucket[field] = bounded(bucket[field] + value[field], 1000000000000) end
  if value.lastAt >= bucket.lastAt then
    bucket.lastAt = value.lastAt
    bucket.lastDuration = value.lastDuration
    bucket.lastOutcome = value.lastOutcome
  end
end
redis.call('SET', KEYS[1], cjson.encode(bucket), 'EX', ARGV[3])
return 1
`;

function bounded(value: unknown, maximum = MAX_NUMBER): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.floor(value))) : 0;
}

function normalizeSport(value: unknown): ResearchSport {
  return SPORTS.includes(value as ResearchSport) ? value as ResearchSport : 'unknown';
}

function normalizeStatus(value: unknown): ResearchOutcomeStatus {
  return STATUSES.includes(value as ResearchOutcomeStatus) ? value as ResearchOutcomeStatus : 'ERROR';
}

function emptyCounters(): Counters {
  return { requests: 0, complete: 0, partial: 0, failed: 0, withPicks: 0, resultsCount: 0, gamesFound: 0, gamesScheduled: 0, durationTotal: 0 };
}

function dayKey(sport: ResearchSport, timestamp: number): string {
  return `research-health:v1:${sport}:${new Date(timestamp).toISOString().slice(0, 10)}`;
}

function merge(previous: Observation | undefined, incoming: Observation): Observation {
  const merged = { ...incoming };
  for (const field of COUNTERS) merged[field] = bounded((previous?.[field] ?? 0) + incoming[field]);
  if (previous && previous.lastAt > incoming.lastAt) {
    merged.lastAt = previous.lastAt;
    merged.lastDuration = previous.lastDuration;
    merged.lastOutcome = previous.lastOutcome;
  }
  return merged;
}

function remember(key: string, hour: number, observation: Observation, now: number): void {
  for (const [existingKey] of local) {
    const date = Date.parse(existingKey.slice(-10));
    if (date <= now - TTL_SECONDS * 1000) local.delete(existingKey);
  }
  const bucket = local.get(key) ?? { hours: {} };
  bucket.hours[String(hour)] = merge(bucket.hours[String(hour)], observation);
  local.set(key, bucket);
}

function warn(sport: ResearchSport, status: ResearchOutcomeStatus, category: ReceiptError): void {
  try { console.warn('[research-health]', JSON.stringify({ sport, status, category })); } catch {}
}

export async function recordResearchOutcome(input: ResearchOutcomeInput): Promise<boolean> {
  const sport = normalizeSport(input.sport);
  const status = normalizeStatus(input.status);
  const now = Date.now();
  const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const partial = input.partialCoverage === true || status === 'PARTIAL';
  const failure = ['ERROR', 'UNAVAILABLE', 'PROVIDER_ERROR', 'RESEARCH_INCOMPLETE'].includes(status);
  const complete = input.researchComplete === true && !partial && !failure;
  const observation: Observation = {
    requests: 1,
    complete: Number(complete),
    partial: Number(partial),
    failed: Number(failure || (!complete && !partial)),
    withPicks: Number(bounded(input.resultsCount, 1_000_000) > 0),
    resultsCount: bounded(input.resultsCount, 1_000_000),
    gamesFound: bounded(input.gamesFound, 100_000),
    gamesScheduled: bounded(input.gamesScheduled, 100_000),
    durationTotal: bounded(input.durationMs, DAY_MS),
    lastAt: now,
    lastDuration: bounded(input.durationMs, DAY_MS),
    lastOutcome: status,
  };
  const key = dayKey(sport, now);
  remember(key, hour, observation, now);
  let category: ReceiptError = 'CONFIGURATION_ERROR';
  try {
    if (!hasDurableKV()) {
      category = 'NOT_CONFIGURED';
    } else {
      category = 'WRITE_FAILED';
      const receipt = await kvEval(INCREMENT_SCRIPT, [key], [JSON.stringify(observation), String(hour), TTL_SECONDS]);
      if (receipt !== 1) throw new Error('Missing telemetry receipt');
      receiptErrors.delete(sport);
      try { console.info('[research-health]', JSON.stringify({ sport, status, ...observation, durability: 'durable' })); } catch {}
      return true;
    }
  } catch {}
  receiptErrors.set(sport, category);
  warn(sport, status, category);
  return false;
}

function readObservation(value: unknown): Observation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.lastAt) || (candidate.lastAt as number) < 0) return null;
  const observation: Observation = {
    ...emptyCounters(),
    lastAt: candidate.lastAt as number,
    lastDuration: bounded(candidate.lastDuration, DAY_MS),
    lastOutcome: normalizeStatus(candidate.lastOutcome),
  };
  for (const field of COUNTERS) observation[field] = bounded(candidate[field]);
  if (!observation.requests) return null;
  for (const field of ['complete', 'partial', 'failed', 'withPicks'] as const) {
    observation[field] = Math.min(observation.requests, observation[field]);
  }
  return observation;
}

function summarize(buckets: unknown[], start: number, end: number): Observation | undefined {
  let total: Observation | undefined;
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object') continue;
    const hours = (bucket as DailyBucket).hours;
    if (!hours || typeof hours !== 'object' || Array.isArray(hours)) continue;
    for (let hour = start; hour <= end; hour += HOUR_MS) {
      const observation = readObservation(hours[String(hour)]);
      if (!observation || observation.lastAt < hour || observation.lastAt >= hour + HOUR_MS || observation.lastAt > end) continue;
      total = merge(total, observation);
    }
  }
  return total;
}

export async function readResearchHealth(): Promise<ResearchHealthSnapshot> {
  const now = Date.now();
  const start = Math.floor((now - DAY_MS) / HOUR_MS) * HOUR_MS;
  let configured = false;
  let configError: ReceiptError | null = null;
  try { configured = hasDurableKV(); } catch { configError = 'CONFIGURATION_ERROR'; }
  const summaries = await Promise.all(SPORTS.map(async (sport): Promise<ResearchHealthSummary> => {
    const keys = [dayKey(sport, now), dayKey(sport, now - DAY_MS)];
    let durability: ResearchHealthSummary['durability'] = 'durable';
    let error = configError ?? (configured ? receiptErrors.get(sport) ?? null : 'NOT_CONFIGURED');
    let buckets: unknown[];
    try {
      if (!configured) throw new Error('No durable telemetry');
      buckets = await Promise.all(keys.map((key) => kvGetJson<unknown>(key)));
    } catch {
      if (configured) {
        error = 'READ_FAILED';
        warn(sport, 'ERROR', error);
      }
      buckets = keys.map((key) => local.get(key));
      durability = buckets.some(Boolean) ? 'process-local' : 'unavailable';
    }
    const observed = summarize(buckets, start, now);
    return {
      sport,
      ...emptyCounters(),
      ...observed,
      status: observed && durability === 'durable' && !error ? 'observed' : 'unknown',
      durability,
      receiptError: error,
      completionRate: observed ? observed.complete / observed.requests : null,
      lastAt: observed?.lastAt ?? null,
      lastDuration: observed?.lastDuration ?? null,
      lastOutcome: observed?.lastOutcome ?? null,
    };
  }));
  return {
    checkedAt: now,
    windowStart: start,
    windowEnd: now,
    windowResolution: 'hour',
    retentionDays: 7,
    zeroOddsCalls: true,
    sports: Object.fromEntries(summaries.map((summary) => [summary.sport, summary])) as ResearchHealthSnapshot['sports'],
  };
}