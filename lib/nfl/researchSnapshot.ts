import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { hasDurableKV, kvGetJson, kvSetJson } from '../storage/kv';
import { withNFLRefreshLease } from './refreshLease';

interface SnapshotEntry<T> { value: T; fetchedAt: number; expiresAt: number; fingerprint: string }
interface RequestSnapshot { startedAt: number; inputs: Map<string, Promise<unknown>> }
const requests = new AsyncLocalStorage<RequestSnapshot>();
const memory = new Map<string, SnapshotEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

export function withNFLResearchSnapshot<T>(operation: () => Promise<T>): Promise<T> {
  if (requests.getStore()) return operation();
  return requests.run({ startedAt: Date.now(), inputs: new Map() }, operation);
}

export function nflResearchNow(): number { return requests.getStore()?.startedAt ?? Date.now(); }

export function memoNFLResearchInput<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const scope = requests.getStore();
  if (!scope) return operation();
  const existing = scope.inputs.get(key);
  if (existing) return existing as Promise<T>;
  const promise = Promise.resolve().then(operation);
  scope.inputs.set(key, promise);
  return promise;
}

export function normalizedNFLInput<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  return memoNFLResearchInput(key, () => {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const operation = Promise.resolve().then(async () => {
      const cacheKey = `nfl-research:v1:${key}`;
      const persist = process.env.NODE_ENV !== 'test';
      const durable = persist && hasDurableKV();
      const read = async () => durable ? kvGetJson<SnapshotEntry<T>>(cacheKey) : persist ? memory.get(cacheKey) as SnapshotEntry<T> | undefined : null;
      const valid = (entry: SnapshotEntry<T> | null | undefined): entry is SnapshotEntry<T> => Boolean(entry && entry.expiresAt > Date.now() && entry.fetchedAt <= Date.now()
        && entry.fingerprint === createHash('sha256').update(JSON.stringify(entry.value)).digest('hex'));
      const cached = await read();
      if (valid(cached)) return cached.value;
      const hydrate = async () => {
      const refreshed = await read();
      if (valid(refreshed)) return refreshed.value;
      const value = await load();
      const entry = { value, fetchedAt: Date.now(), expiresAt: Date.now() + ttlMs,
        fingerprint: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
      if (durable) await kvSetJson(cacheKey, entry, ttlMs);
      else if (persist) memory.set(cacheKey, entry);
      return value;
      };
      return durable ? withNFLRefreshLease(cacheKey, hydrate) : hydrate();
    });
    pending.set(key, operation);
    return operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); });
  });
}