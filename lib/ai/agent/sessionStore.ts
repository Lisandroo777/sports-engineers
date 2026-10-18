import type * as Fs from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import type { ResearchSession } from './session';
import { allowLocalPersistenceFallback, hasDurableKV, kvDel, kvGetJson, kvSetJson } from '../../storage/kv';

/**
 * Durable server-side store for full research sessions (disk-backed, mirrors lib/odds/persistentCache.ts).
 * Survives `next dev` restarts, server restarts, and deployment restarts as long as the disk persists.
 * The browser only ever holds the ID this returns — never the (possibly hundreds-of-candidates) object
 * itself. Production note: swap this module for Redis/KV/DB storage; callers only depend on the
 * read/write/delete function signatures below, not the filesystem.
 */

const STORE_DIR = join(process.cwd(), '.cache', 'ai-sessions');
/** Research sessions are a same-day artifact; expire well after any reasonable follow-up window. */
const TTL_MS = 24 * 60 * 60 * 1000;
/** Hard ceiling regardless of TTL, so disk usage never grows unbounded even under heavy use. */
const MAX_SESSIONS = 100;
const SESSION_KEY_PREFIX = 'ai-session:';
const KV_CHUNK_SIZE = 500_000;
const MAX_KV_CHUNKS = 1024;
const KV_CHUNK_READ_CONCURRENCY = 4;
const MAX_RECOVERY_SESSIONS = 20;
const MAX_RECOVERY_BYTES = 5 * 1024 * 1024;
const recoverySessions = new Map<string, { stored: StoredSession; bytes: number }>();

interface StoredSession {
  id: string;
  savedAt: number;
  expiresAt: number;
  session?: ResearchSession;
  sessionEncoding?: 'deflate-base64-v1';
  compressedSession?: string;
  compressedSessionChunks?: number;
}

function compressedKVSession(session: ResearchSession): Pick<StoredSession, 'sessionEncoding' | 'compressedSession'> {
  return { sessionEncoding: 'deflate-base64-v1', compressedSession: deflateSync(Buffer.from(JSON.stringify(session))).toString('base64') };
}

function chunkKeys(id: string, stored: StoredSession): string[] | null {
  const count = stored.compressedSessionChunks;
  if (stored.sessionEncoding !== 'deflate-base64-v1' || typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_KV_CHUNKS) return null;
  return Array.from({ length: count }, (_, index) => `${SESSION_KEY_PREFIX}${id}:chunk:${index}`);
}

async function saveDurableSession(stored: StoredSession): Promise<void> {
  const key = `${SESSION_KEY_PREFIX}${stored.id}`;
  const { compressedSession, ...manifest } = stored;
  if (!compressedSession || compressedSession.length <= KV_CHUNK_SIZE) {
    await kvSetJson(key, stored, TTL_MS);
    return;
  }
  const chunked = { ...manifest, compressedSessionChunks: Math.ceil(compressedSession.length / KV_CHUNK_SIZE) };
  const keys = chunkKeys(stored.id, chunked);
  if (!keys) throw new Error('Research session exceeds storage capacity.');
  const attempted: string[] = [];
  try {
    for (const [index, chunkKey] of keys.entries()) {
      attempted.push(chunkKey);
      await kvSetJson(chunkKey, compressedSession.slice(index * KV_CHUNK_SIZE, (index + 1) * KV_CHUNK_SIZE), TTL_MS);
    }
    await kvSetJson(key, chunked, TTL_MS);
  } catch (error) {
    await Promise.allSettled([key, ...attempted].map((entry) => kvDel(entry)));
    throw error;
  }
}

function sessionFromStored(stored: StoredSession): ResearchSession | null {
  if (isWellFormed(stored.session)) return stored.session;
  if (stored.sessionEncoding !== 'deflate-base64-v1' || typeof stored.compressedSession !== 'string') return null;
  try {
    const session = JSON.parse(inflateSync(Buffer.from(stored.compressedSession, 'base64')).toString('utf8')) as unknown;
    return isWellFormed(session) ? session : null;
  } catch {
    return null;
  }
}

function pruneRecoverySessions() {
  for (const [id, entry] of recoverySessions) {
    if (entry.stored.expiresAt <= Date.now()) recoverySessions.delete(id);
  }
}

function rememberDurableSession(id: string, stored: StoredSession, session: ResearchSession) {
  pruneRecoverySessions();
  recoverySessions.delete(id);
  const expiresAt = Math.min(stored.expiresAt, stored.savedAt + TTL_MS, Date.now() + TTL_MS);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
  const compressed = !stored.session && stored.sessionEncoding === 'deflate-base64-v1' && typeof stored.compressedSession === 'string'
    ? { sessionEncoding: stored.sessionEncoding, compressedSession: stored.compressedSession }
    : compressedKVSession(session);
  const snapshot: StoredSession = { id, savedAt: stored.savedAt, expiresAt, ...compressed };
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  if (bytes > MAX_RECOVERY_BYTES) return;
  recoverySessions.set(id, { stored: snapshot, bytes });
  let totalBytes = Array.from(recoverySessions.values()).reduce((total, entry) => total + entry.bytes, 0);
  for (const [oldestId, entry] of recoverySessions) {
    if (recoverySessions.size <= MAX_RECOVERY_SESSIONS && totalBytes <= MAX_RECOVERY_BYTES) break;
    recoverySessions.delete(oldestId);
    totalBytes -= entry.bytes;
  }
}

function filePathFor(id: string) {
  return join(STORE_DIR, `${id}.json`);
}

async function fsApi(): Promise<typeof Fs> {
  return import('fs');
}

/** Removes expired entries and, if still over the cap, the oldest remaining ones. Runs on every save
 * so disk usage is bounded without needing a separate cron/background job. */
async function sweep() {
  try {
    const { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } = await fsApi();
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
    const files = readdirSync(STORE_DIR).filter((f) => f.endsWith('.json'));
    const live: Array<{ file: string; savedAt: number }> = [];
    for (const file of files) {
      const path = join(STORE_DIR, file);
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as StoredSession;
        if (parsed.expiresAt <= Date.now()) {
          unlinkSync(path);
          continue;
        }
        live.push({ file, savedAt: parsed.savedAt });
      } catch {
        // corrupt/partial file from an interrupted write; drop it
        try { unlinkSync(path); } catch { /* ignore */ }
      }
    }
    if (live.length > MAX_SESSIONS) {
      live.sort((a, b) => a.savedAt - b.savedAt);
      for (const entry of live.slice(0, live.length - MAX_SESSIONS)) {
        try { unlinkSync(join(STORE_DIR, entry.file)); } catch { /* ignore */ }
      }
    }
  } catch {
    // best-effort; a failed sweep must never break a request
  }
}

export async function saveResearchSession(session: ResearchSession): Promise<string> {
  const id = randomUUID();
  const savedAt = Date.now();
  const expiresAt = savedAt + TTL_MS;
  try {
    if (hasDurableKV()) {
      const stored = { id, savedAt, expiresAt, ...compressedKVSession(session) };
      await saveDurableSession(stored);
      rememberDurableSession(id, stored, session);
      return id;
    }
    if (process.env.NODE_ENV === 'production' || !allowLocalPersistenceFallback()) {
      throw new Error('Research session could not be persisted.');
    }
    const { existsSync, mkdirSync, writeFileSync } = await fsApi();
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(filePathFor(id), JSON.stringify({ id, savedAt, expiresAt, session }), 'utf-8');
  } catch {
    throw new Error('Research session could not be persisted.');
  }
  await sweep();
  return id;
}

/** True only for a session shaped the way current code expects; guards against a corrupt, truncated,
 * or old-schema file ever reaching a tool function that assumes fields like `candidates` exist. */
function isWellFormed(session: unknown): session is ResearchSession {
  if (!session || typeof session !== 'object') return false;
  const s = session as Partial<ResearchSession>;
  return typeof s.sport === 'string' && typeof s.date === 'string' && Array.isArray(s.candidates);
}

export async function getResearchSession(id: string | null | undefined): Promise<ResearchSession | null> {
  if (!id) return null;
  if (hasDurableKV()) {
    try {
      let stored = await kvGetJson<StoredSession>(`${SESSION_KEY_PREFIX}${id}`);
      if (stored === null) {
        recoverySessions.delete(id);
        return null;
      }
      if (!stored || !Number.isFinite(stored.expiresAt) || !Number.isFinite(stored.savedAt)) {
        throw new Error('Research session is temporarily unavailable.');
      }
      if (stored.expiresAt <= Date.now()) {
        recoverySessions.delete(id);
        return null;
      }
      const chunked = stored.compressedSessionChunks !== undefined;
      if (chunked) {
        const keys = chunkKeys(id, stored);
        if (!keys) throw new Error('Research session is temporarily unavailable.');
        const chunks: string[] = [];
        for (let offset = 0; offset < keys.length; offset += KV_CHUNK_READ_CONCURRENCY) {
          const batch = await Promise.all(keys.slice(offset, offset + KV_CHUNK_READ_CONCURRENCY).map((key) => kvGetJson<string>(key)));
          if (!batch.every((chunk) => typeof chunk === 'string' && chunk.length > 0 && chunk.length <= KV_CHUNK_SIZE)) {
            throw new Error('Research session is temporarily unavailable.');
          }
          chunks.push(...batch as string[]);
        }
        stored = { ...stored, compressedSession: chunks.join('') };
      } else if (!isWellFormed(stored.session) && stored.compressedSession === undefined) {
        throw new Error('Research session is temporarily unavailable.');
      }
      const session = sessionFromStored(stored);
      if (!session && chunked) throw new Error('Research session is temporarily unavailable.');
      if (session) rememberDurableSession(id, stored, session);
      else recoverySessions.delete(id);
      return session;
    } catch {
      pruneRecoverySessions();
      const recovered = recoverySessions.get(id);
      if (recovered) return sessionFromStored(recovered.stored);
      throw new Error('Research session is temporarily unavailable.');
    }
  }
  if (!allowLocalPersistenceFallback()) return null;
  const file = filePathFor(id);
  try {
    const { existsSync, readFileSync, unlinkSync } = await fsApi();
    if (!existsSync(file)) return null;
    const stored = JSON.parse(readFileSync(file, 'utf-8')) as StoredSession;
    const session = sessionFromStored(stored);
    if (stored.expiresAt <= Date.now() || !session) {
      unlinkSync(file);
      return null;
    }
    return session;
  } catch {
    // Corrupt/unparseable file — self-heal by removing it so it doesn't keep failing on every read.
    try { const { unlinkSync } = await fsApi(); unlinkSync(file); } catch { /* ignore */ }
    return null;
  }
}

export async function deleteResearchSession(id: string | null | undefined): Promise<void> {
  if (!id) return;
  recoverySessions.delete(id);
  if (hasDurableKV()) {
    const stored = await kvGetJson<StoredSession>(`${SESSION_KEY_PREFIX}${id}`);
    await kvDel(`${SESSION_KEY_PREFIX}${id}`);
    if (stored) await Promise.all((chunkKeys(id, stored) ?? []).map((key) => kvDel(key)));
    return;
  }
  if (!allowLocalPersistenceFallback()) return;
  try {
    const { existsSync, unlinkSync } = await fsApi();
    const file = filePathFor(id);
    if (existsSync(file)) unlinkSync(file);
  } catch {
    // best-effort
  }
}

