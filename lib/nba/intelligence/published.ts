import { hasDurableKV, kvGetJson, kvSetJson } from '../../storage/kv';
import type { NBAIntelligenceSnapshot, TargetEvent } from './types';

const key = (target: TargetEvent) => `nba-intelligence:v1:${target.gameId}:${target.startsAt}`;

export async function publishNBAIntelligence(snapshot: NBAIntelligenceSnapshot): Promise<void> {
  if (!hasDurableKV()) return;
  const ttl = Date.parse(snapshot.target.startsAt) - Date.now();
  if (!Number.isFinite(ttl) || ttl <= 0 || snapshot.schemaVersion !== '1' || snapshot.sport !== 'nba') return;
  await kvSetJson(key(snapshot.target), snapshot, Math.min(ttl, 24 * 3600000));
}

export async function loadPublishedNBAIntelligence(target: TargetEvent, asOf: string): Promise<NBAIntelligenceSnapshot | null> {
  if (!hasDurableKV()) return null;
  const snapshot = await kvGetJson<NBAIntelligenceSnapshot>(key(target));
  if (!snapshot || snapshot.schemaVersion !== '1' || snapshot.sport !== 'nba'
    || snapshot.target.gameId !== target.gameId || snapshot.target.homeTeamId !== target.homeTeamId
    || snapshot.target.awayTeamId !== target.awayTeamId || Date.parse(snapshot.target.startsAt) !== Date.parse(target.startsAt)
    || !Number.isFinite(Date.parse(snapshot.asOf)) || !Number.isFinite(Date.parse(snapshot.cutoff))
    || Date.parse(snapshot.asOf) > Date.parse(asOf) || Date.parse(snapshot.cutoff) > Date.parse(asOf)
    || Date.parse(asOf) >= Date.parse(target.startsAt) || !Array.isArray(snapshot.claims)) return null;
  return snapshot;
}