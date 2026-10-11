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

interface StoredSession {
  id: string;
  savedAt: number;
  expiresAt: number;
  session?: ResearchSession;
  sessionEncoding?: 'deflate-base64-v1';
  compressedSession?: string;
}

function compressedKVSession(session: ResearchSession): Pick<StoredSession, 'sessionEncoding' | 'compressedSession'> {
  return { sessionEncoding: 'deflate-base64-v1', compressedSession: deflateSync(Buffer.from(JSON.stringify(session))).toString('base64') };
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
  if (hasDurableKV()) {
    await kvSetJson(`${SESSION_KEY_PREFIX}${id}`, { id, savedAt, expiresAt, ...compressedKVSession(session) }, TTL_MS);
    return id;
  }
  if (!allowLocalPersistenceFallback()) return id;
  try {
    const { existsSync, mkdirSync, writeFileSync } = await fsApi();
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(filePathFor(id), JSON.stringify({ id, savedAt, expiresAt, session }), 'utf-8');
  } catch {
    // best-effort; if the disk write fails the session simply won't survive a restart
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
    const stored = await kvGetJson<StoredSession>(`${SESSION_KEY_PREFIX}${id}`);
    if (!stored || stored.expiresAt <= Date.now()) return null;
    return sessionFromStored(stored);
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
  if (hasDurableKV()) {
    await kvDel(`${SESSION_KEY_PREFIX}${id}`);
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

