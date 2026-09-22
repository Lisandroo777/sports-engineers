type RedisCommand = Array<string | number>;

function redisConfig() {
  const url = process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export function hasDurableKV() {
  return redisConfig() != null;
}

export function allowLocalPersistenceFallback() {
  return !hasDurableKV() && process.env.NODE_ENV !== 'production';
}

async function redisCommand<T = unknown>(command: RedisCommand): Promise<T> {
  const config = redisConfig();
  if (!config) throw new Error('Durable KV is not configured.');
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Durable KV request failed (${response.status})`);
  const payload = await response.json() as { result?: T; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result as T;
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
