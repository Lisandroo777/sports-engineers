import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, unlink, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

async function redis(command: Array<string | number>): Promise<unknown> {
  const url = process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const response = await fetch(url!, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('NFL refresh coordination unavailable');
  const payload = await response.json() as { result?: unknown; error?: string };
  if (payload.error) throw new Error('NFL refresh coordination unavailable');
  return payload.result;
}

export async function withNFLRefreshLease<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const id = createHash('sha256').update(key).digest('hex');
  const owner = randomUUID();
  const durable = Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
  if (!durable && process.env.NODE_ENV === 'production') throw new Error('NFL durable refresh coordination is not configured');
  const file = join(process.cwd(), '.cache', 'nfl-refresh-locks', id);
  if (!durable) await mkdir(join(process.cwd(), '.cache', 'nfl-refresh-locks'), { recursive: true });
  const deadline = Date.now() + 30000;
  let acquired = false;
  while (!acquired && Date.now() < deadline) {
    if (durable) acquired = await redis(['SET', `nfl-refresh-lock:${id}`, owner, 'NX', 'PX', 90000]) === 'OK';
    else {
      try { const handle = await open(file, 'wx'); await handle.writeFile(owner); await handle.close(); acquired = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const age = await stat(file).then((info) => Date.now() - info.mtimeMs).catch(() => 0);
        if (age > 90000) await rm(file, { force: true });
      }
    }
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!acquired) throw Object.assign(new Error('NFL refresh already in progress'), { name: 'TimeoutError' });
  try { return await operation(); }
  finally {
    if (durable) await redis(['EVAL', 'if redis.call("GET",KEYS[1]) == ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end', 1, `nfl-refresh-lock:${id}`, owner]).catch(() => undefined);
    else await unlink(file).catch(() => undefined);
  }
}