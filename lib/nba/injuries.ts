import { espnNBASiteFetch } from './client';

export interface NBAInjuryStatus {
  playerId: number | null;
  playerName: string;
  teamId: number | null;
  status: string;
  detail: string | null;
  updatedAt: string | null;
}

interface RawInjury {
  id?: string;
  athlete?: { id?: string; fullName?: string; displayName?: string; links?: Array<{ href?: string }> };
  player?: { id?: string; fullName?: string; displayName?: string };
  team?: { id?: string };
  status?: string;
  type?: string;
  longComment?: string;
  shortComment?: string;
  details?: { detail?: string; returnDate?: string };
  date?: string;
}

interface RawTeamInjuries {
  id?: string;
  injuries?: RawInjury[];
}

function athleteId(athlete: RawInjury['athlete']) {
  if (athlete?.id) return Number(athlete.id);
  const href = athlete?.links?.find((link) => link.href?.includes('/id/'))?.href;
  const match = href?.match(/\/id\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

/** Free ESPN injury feed. Unknown/malformed fields remain null instead of becoming a status guess. */
export async function getNBAInjuryStatuses(): Promise<NBAInjuryStatus[]> {
  const data = await espnNBASiteFetch<{ injuries?: RawTeamInjuries[] }>('injuries', {}, 120);
  return (data.injuries ?? []).flatMap((team) => (team.injuries ?? []).map((injury) => {
    const athlete = injury.athlete ?? injury.player;
    return {
      playerId: athleteId(athlete),
      playerName: athlete?.fullName ?? athlete?.displayName ?? 'Data unavailable',
      teamId: injury.team?.id ? Number(injury.team.id) : team.id ? Number(team.id) : null,
      status: injury.status ?? injury.type ?? 'Data unavailable',
      detail: injury.details?.detail ?? injury.details?.returnDate ?? injury.shortComment ?? injury.longComment ?? null,
      updatedAt: injury.date ?? null,
    };
  }));
}

export async function getNBAPlayerInjuryStatus(playerId: number): Promise<NBAInjuryStatus | null> {
  const statuses = await getNBAInjuryStatuses();
  return statuses.find((status) => status.playerId === playerId) ?? null;
}

/**
 * Deterministic tier used by the projection engine's reliability rules.
 *   OUT          -> player cannot qualify for a projection at all.
 *   DOUBTFUL     -> reliability capped at LOW.
 *   QUESTIONABLE -> reliability capped at MEDIUM.
 *   ACTIVE       -> no reported injury status of concern; this does NOT mean role is stable,
 *                   recent-minutes volatility/role-change signals still apply independently.
 *   UNKNOWN      -> no injury feed entry for this player (not the same as ACTIVE); reliability
 *                   capped at MEDIUM, same as before this status was tracked at all.
 */
export type NBAInjuryTier = 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'ACTIVE' | 'UNKNOWN';

/**
 * Normalizes ESPN's free-text injury status into a deterministic tier. Never guesses: any status
 * string that doesn't match a known pattern falls back to UNKNOWN rather than being assumed ACTIVE.
 */
export function classifyNBAInjuryTier(status: string | null | undefined): NBAInjuryTier {
  if (!status) return 'UNKNOWN';
  const s = status.toLowerCase();
  if (/\bout\b|injured reserve|\bir\b|season.ending|out for the season/.test(s)) return 'OUT';
  if (/doubtful/.test(s)) return 'DOUBTFUL';
  if (/questionable|day.to.day|day-to-day/.test(s)) return 'QUESTIONABLE';
  if (/probable|active|available/.test(s)) return 'ACTIVE';
  return 'UNKNOWN';
}

/** Convenience: look up and classify a player's current tier in one call. Defaults to ACTIVE only
 *  when the player has no entry in the injury feed at all — absence of a report is treated as
 *  ACTIVE by ESPN convention, not as UNKNOWN (which is reserved for unparseable status text). */
export async function getNBAPlayerInjuryTier(
  playerId: number,
  lookup: (id: number) => Promise<NBAInjuryStatus | null> = getNBAPlayerInjuryStatus,
): Promise<NBAInjuryTier> {
  const entry = await lookup(playerId);
  if (!entry) return 'ACTIVE';
  return classifyNBAInjuryTier(entry.status);
}
