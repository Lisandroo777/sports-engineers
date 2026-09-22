import type * as Fs from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { allowLocalPersistenceFallback, hasDurableKV, kvDel, kvDeleteByPrefix, kvGetJson, kvSetJson } from '../storage/kv';

/**
 * Development-only persistent cache for Odds API responses.
 * Survives `next dev` restarts so the free-tier credit budget isn't re-spent on every reload.
 * Never stores the API key — only the request path/params (as a hash key) and the response body.
 * Production note: swap this module for Redis/KV/DB-backed storage; callers only depend on the
 * read/write/invalidate function signatures below, not the filesystem.
 */

const CACHE_DIR = join(process.cwd(), '.cache', 'odds');
const CREDIT_STATUS_FILE = join(CACHE_DIR, '_credit-status.json');

export interface PersistentCacheEntry<T = unknown> {
  key: string;
  data: T;
  cachedAt: number;
  expiresAt: number;
}

export interface PersistedCreditStatus {
  lastCost: string | null;
  used: string | null;
  remaining: string | null;
  path: string;
  updatedAt: number;
}

function hashKey(key: string) {
  return createHash('sha1').update(key).digest('hex');
}

function filePathFor(key: string) {
  return join(CACHE_DIR, `${hashKey(key)}.json`);
}

const CACHE_KEY_PREFIX = 'odds-cache:';
const CREDIT_STATUS_KEY = 'odds-credit-status';

async function fsApi(): Promise<typeof Fs> {
  return import('fs');
}

export async function readPersistentCache<T>(key: string): Promise<PersistentCacheEntry<T> | null> {
  if (hasDurableKV()) {
    const entry = await kvGetJson<PersistentCacheEntry<T>>(`${CACHE_KEY_PREFIX}${hashKey(key)}`);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry;
  }
  if (!allowLocalPersistenceFallback()) return null;
  try {
    const { existsSync, readFileSync } = await fsApi();
    const file = filePathFor(key);
    if (!existsSync(file)) return null;
    const entry = JSON.parse(readFileSync(file, 'utf-8')) as PersistentCacheEntry<T>;
    if (entry.expiresAt <= Date.now()) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Expired-but-present entry, used only when a paid refresh is blocked by the credit reserve. */
export async function readStalePersistentCache<T>(key: string): Promise<PersistentCacheEntry<T> | null> {
  if (hasDurableKV()) return kvGetJson<PersistentCacheEntry<T>>(`${CACHE_KEY_PREFIX}${hashKey(key)}`);
  if (!allowLocalPersistenceFallback()) return null;
  try {
    const { existsSync, readFileSync } = await fsApi();
    const file = filePathFor(key);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8')) as PersistentCacheEntry<T>;
  } catch {
    return null;
  }
}

export async function writePersistentCache<T>(key: string, data: T, expiresAt: number) {
  const entry: PersistentCacheEntry<T> = { key, data, cachedAt: Date.now(), expiresAt };
  if (hasDurableKV()) {
    await kvSetJson(`${CACHE_KEY_PREFIX}${hashKey(key)}`, entry);
    return;
  }
  if (!allowLocalPersistenceFallback()) return;
  try {
    const { existsSync, mkdirSync, writeFileSync } = await fsApi();
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(filePathFor(key), JSON.stringify(entry), 'utf-8');
  } catch {
    // best-effort; never let cache writes break a request
  }
}

/** Deletes one cached entry (by its original request key) or every cached entry when no key is given. */
export async function invalidatePersistentCache(key?: string) {
  if (hasDurableKV()) {
    if (key) await kvDel(`${CACHE_KEY_PREFIX}${hashKey(key)}`);
    else await kvDeleteByPrefix(CACHE_KEY_PREFIX);
    return;
  }
  if (!allowLocalPersistenceFallback()) return;
  try {
    const { existsSync, mkdirSync, readdirSync, unlinkSync } = await fsApi();
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    if (key) {
      const file = filePathFor(key);
      if (existsSync(file)) unlinkSync(file);
      return;
    }
    for (const file of readdirSync(CACHE_DIR)) {
      if (file !== '_credit-status.json') unlinkSync(join(CACHE_DIR, file));
    }
  } catch {
    // best-effort
  }
}

export async function readCreditStatus(): Promise<PersistedCreditStatus | null> {
  if (hasDurableKV()) return kvGetJson<PersistedCreditStatus>(CREDIT_STATUS_KEY);
  if (!allowLocalPersistenceFallback()) return null;
  try {
    const { existsSync, readFileSync } = await fsApi();
    if (!existsSync(CREDIT_STATUS_FILE)) return null;
    return JSON.parse(readFileSync(CREDIT_STATUS_FILE, 'utf-8')) as PersistedCreditStatus;
  } catch {
    return null;
  }
}

export async function writeCreditStatus(status: PersistedCreditStatus) {
  if (hasDurableKV()) {
    await kvSetJson(CREDIT_STATUS_KEY, status);
    return;
  }
  if (!allowLocalPersistenceFallback()) return;
  try {
    const { existsSync, mkdirSync, writeFileSync } = await fsApi();
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CREDIT_STATUS_FILE, JSON.stringify(status), 'utf-8');
  } catch {
    // best-effort
  }
}
