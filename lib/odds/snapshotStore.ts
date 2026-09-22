import type * as Fs from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { allowLocalPersistenceFallback, hasDurableKV, kvGetJson, kvSetJson } from '../storage/kv';

/**
 * Persistent odds snapshot history — survives `next dev` restarts (disk-backed, like persistentCache.ts).
 * Records every odds observation we ALREADY fetched (network or cache) so line/price movement can be
 * derived later without any additional Odds API requests. Never itself triggers a network call.
 */

const SNAPSHOT_DIR = join(process.cwd(), '.cache', 'odds-snapshots');
const MAX_POINTS_PER_KEY = 60;
const SNAPSHOT_KEY_PREFIX = 'odds-snapshot:';

export interface SnapshotPoint {
  odds: number;
  timestamp: number;
}

export interface SnapshotKeyParts {
  eventId: string;
  player: string;
  marketKey: string;
  line: number;
  sportsbookKey: string;
  side: 'over' | 'under';
}

export function snapshotKey(parts: SnapshotKeyParts): string {
  const raw = `${parts.eventId}|${parts.player}|${parts.marketKey}|${parts.line}|${parts.sportsbookKey}|${parts.side}`;
  return createHash('sha1').update(raw).digest('hex');
}

function filePathFor(key: string) {
  return join(SNAPSHOT_DIR, `${key}.json`);
}

async function fsApi(): Promise<typeof Fs> {
  return import('fs');
}

async function readHistory(key: string): Promise<SnapshotPoint[]> {
  if (hasDurableKV()) return await kvGetJson<SnapshotPoint[]>(`${SNAPSHOT_KEY_PREFIX}${key}`) ?? [];
  if (!allowLocalPersistenceFallback()) return [];
  try {
    const { existsSync, readFileSync } = await fsApi();
    const file = filePathFor(key);
    if (!existsSync(file)) return [];
    return JSON.parse(readFileSync(file, 'utf-8')) as SnapshotPoint[];
  } catch {
    return [];
  }
}

async function writeHistory(key: string, points: SnapshotPoint[]) {
  const bounded = points.slice(-MAX_POINTS_PER_KEY);
  if (hasDurableKV()) {
    await kvSetJson(`${SNAPSHOT_KEY_PREFIX}${key}`, bounded);
    return;
  }
  if (!allowLocalPersistenceFallback()) return;
  try {
    const { existsSync, mkdirSync, writeFileSync } = await fsApi();
    if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(filePathFor(key), JSON.stringify(bounded), 'utf-8');
  } catch {
    // best-effort; never let snapshot writes break a request
  }
}

/** Appends a new observation only if the price actually changed, or the last point is stale (>10 min old). */
export async function recordSnapshot(parts: SnapshotKeyParts, odds: number, timestamp = Date.now()): Promise<void> {
  const key = snapshotKey(parts);
  const history = await readHistory(key);
  const last = history[history.length - 1];
  const staleMs = 10 * 60 * 1000;
  if (last && last.odds === odds && timestamp - last.timestamp < staleMs) return;
  history.push({ odds, timestamp });
  await writeHistory(key, history);
}

export async function getSnapshotHistory(parts: SnapshotKeyParts): Promise<SnapshotPoint[]> {
  return readHistory(snapshotKey(parts));
}
