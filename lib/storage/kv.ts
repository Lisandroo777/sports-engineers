import { fetchWithReadRetry } from '../reliability/retry';

type RedisCommand = Array<string | number>;

function redisConfig() {
  const source = process.env.KV_REST_API_URL?.trim() || process.env.KV_REST_API_TOKEN?.trim()
    ? 'KV_REST_API' : 'UPSTASH_REDIS_REST';
  const url = process.env[`${source}_URL`]?.trim();
  const token = process.env[`${source}_TOKEN`]?.trim();
  if (!url && !token) return null;
  if (!url || !token) throw new Error(`Durable KV configuration invalid: ${source}_URL and ${source}_TOKEN must be configured together.`);
  let endpoint: URL;
  try { endpoint = new URL(url); } catch {
    throw new Error(`Durable KV configuration invalid: ${source}_URL must be an HTTPS REST endpoint.`);
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/?$/.test(endpoint.pathname)) {
    throw new Error(`Durable KV configuration invalid: ${source}_URL must be an HTTPS REST endpoint without credentials, query, or path.`);
  }
  if (/^Bearer\s/i.test(token) || /[\s"']/.test(token) || token === '[SENSITIVE]') {
    throw new Error(`Durable KV configuration invalid: ${source}_TOKEN must be the raw REST token without quotes or a Bearer prefix.`);
  }
  return { url: endpoint.origin, token, source };
}

export function hasDurableKV() {
  return redisConfig() != null;
}

export function getDurableKVStatus() {
  const config = redisConfig();
  return {
    configured: config != null,
    source: config?.source ?? null,
    bothFamiliesPresent: Boolean(
      (process.env.KV_REST_API_URL?.trim() || process.env.KV_REST_API_TOKEN?.trim())
      && (process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim()),
    ),
  };
}

export function allowLocalPersistenceFallback() {
  return !hasDurableKV() && process.env.NODE_ENV !== 'production';
}

async function redisCommand<T = unknown>(command: RedisCommand): Promise<T> {
  const config = redisConfig();
  if (!config) throw new Error('Durable KV is not configured.');
  const init: RequestInit = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  };
  const isRead = ['GET', 'SCAN', 'PING', 'HGET', 'HGETALL'].includes(String(command[0]).toUpperCase());
  const response = isRead
    ? await fetchWithReadRetry(config.url, init)
    : await fetch(config.url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Durable KV request failed (${response.status})`);
  const payload = await response.json() as { result?: T; error?: string };
  if (payload.error) throw new Error('Durable KV command failed.');
  return payload.result as T;
}

/** Runs a Lua script atomically on the shared store; throws when durable KV is not configured. */
export async function kvEval<T = unknown>(script: string, keys: string[], args: Array<string | number>): Promise<T> {
  return redisCommand<T>(['EVAL', script, keys.length, ...keys, ...args]);
}

export async function kvSetNx(key: string, value: string, ttlMs: number): Promise<boolean> {
  return (await redisCommand<string | null>(['SET', key, value, 'NX', 'PX', Math.ceil(ttlMs)])) === 'OK';
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  if (!hasDurableKV()) return null;
  const value = await redisCommand<string | null>(['GET', key]);
  if (value == null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(key: string, value: unknown, ttlMs?: number): Promise<void> {
  if (!hasDurableKV()) return;
  const serialized = JSON.stringify(value);
  if (ttlMs != null && ttlMs > 0) await redisCommand(['SET', key, serialized, 'PX', Math.ceil(ttlMs)]);
  else await redisCommand(['SET', key, serialized]);
}

export async function kvDel(key: string): Promise<void> {
  if (!hasDurableKV()) return;
  await redisCommand(['DEL', key]);
}

export async function kvDeleteByPrefix(prefix: string): Promise<void> {
  if (!hasDurableKV()) return;
  let cursor = '0';
  do {
    const result = await redisCommand<[string, string[]]>(['SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', 100]);
    cursor = result?.[0] ?? '0';
    const keys = result?.[1] ?? [];
    if (keys.length > 0) await redisCommand(['DEL', ...keys]);
  } while (cursor !== '0');
}
