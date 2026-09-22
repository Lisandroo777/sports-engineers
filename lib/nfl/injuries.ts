import { espnSiteFetch } from './client';
import type { NFLAnalyzableMarketKey } from './oddsTypes';

export type NFLAvailabilityDesignation = 'AVAILABLE' | 'QUESTIONABLE' | 'DOUBTFUL' | 'OUT' | 'UNKNOWN';
export type NFLInjurySourceStatus = 'CURRENT' | 'STALE' | 'MISSING';
export type NFLAffectedRole = 'PLAYER' | 'QUARTERBACK' | 'BACKFIELD' | 'RECEIVING_OPTION' | 'OFFENSIVE_LINE' | 'OPPONENT_DEFENDER';

export interface NFLInjuryReport {
  playerId: number | null;
  player: string;
  teamId: number | null;
  team: string | null;
  injury: string | null;
  status: string | null;
  availabilityDesignation: NFLAvailabilityDesignation;
  position: string | null;
  evidence: string | null;
  updatedAt: string | null;
  sourceStatus: NFLInjurySourceStatus;
}

export interface NFLInjuryContextEntry extends NFLInjuryReport {
  affectedRole: NFLAffectedRole;
  missingFields: string[];
}

export interface NFLInjuryContext {
  player: NFLInjuryContextEntry;
  team: string | null;
  teammateAbsences: NFLInjuryContextEntry[];
  opponentAbsences: NFLInjuryContextEntry[];
  sourceStatus: { provider: 'ESPN'; status: NFLInjurySourceStatus };
  lastUpdated: string | null;
  missingFields: string[];
}

interface RawInjury {
  athlete?: {
    id?: string;
    displayName?: string;
    fullName?: string;
    links?: Array<{ href?: string }>;
    position?: { abbreviation?: string };
  };
  position?: { abbreviation?: string };
  status?: string;
  type?: string;
  shortComment?: string;
  longComment?: string;
  details?: { detail?: string; returnDate?: string };
  date?: string;
}

interface RawTeamInjuries {
  id?: string;
  displayName?: string;
  injuries?: RawInjury[];
}

export const NFL_INJURY_FRESHNESS_MS = 72 * 60 * 60 * 1000;

function athleteId(athlete: RawInjury['athlete']): number | null {
  if (athlete?.id && Number.isFinite(Number(athlete.id))) return Number(athlete.id);
  const href = athlete?.links?.find((link) => link.href?.includes('/id/'))?.href;
  const match = href?.match(/\/id\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

export function classifyNFLAvailability(status: string | null | undefined): NFLAvailabilityDesignation {
  if (!status) return 'UNKNOWN';
  if (/\bout\b|injured reserve|\bir\b|inactive|season.ending|out for the season/i.test(status)) return 'OUT';
  if (/doubtful/i.test(status)) return 'DOUBTFUL';
  if (/questionable|day.to.day|day-to-day/i.test(status)) return 'QUESTIONABLE';
  if (/active|available|probable|no designation/i.test(status)) return 'AVAILABLE';
  return 'UNKNOWN';
}

export function classifyNFLInjuryFreshness(updatedAt: string | null | undefined, now = new Date()): NFLInjurySourceStatus {
  if (!updatedAt) return 'MISSING';
  const age = now.getTime() - new Date(updatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= NFL_INJURY_FRESHNESS_MS ? 'CURRENT' : 'STALE';
}

export function parseNFLInjuryReports(payload: { injuries?: RawTeamInjuries[] }, now = new Date()): NFLInjuryReport[] {
  return (payload.injuries ?? []).flatMap((team) => (team.injuries ?? []).map((entry) => {
    const detail = entry.details?.detail?.trim();
    const injury = detail && !/^not specified$/i.test(detail) ? detail : null;
    const status = entry.status ?? entry.type ?? null;
    return {
      playerId: athleteId(entry.athlete),
      player: entry.athlete?.displayName ?? entry.athlete?.fullName ?? 'Data unavailable',
      teamId: team.id && Number.isFinite(Number(team.id)) ? Number(team.id) : null,
      team: team.displayName ?? null,
      injury,
      status,
      availabilityDesignation: classifyNFLAvailability(status),
      position: entry.athlete?.position?.abbreviation ?? entry.position?.abbreviation ?? null,
      evidence: entry.shortComment?.trim() || entry.longComment?.trim() || null,
      updatedAt: entry.date ?? null,
      sourceStatus: classifyNFLInjuryFreshness(entry.date, now),
    };
  }));
}

export async function getNFLInjuryReports(now = new Date()): Promise<NFLInjuryReport[]> {
  const data = await espnSiteFetch<{ injuries?: RawTeamInjuries[] }>('injuries', {}, 120);
  return parseNFLInjuryReports(data, now);
}

export function isNFLPlayerAvailabilityKnown(context: NFLInjuryContext | null | undefined): boolean {
  return context?.player.sourceStatus === 'CURRENT' && context.player.availabilityDesignation !== 'UNKNOWN';
}

export function evaluateNFLPlayerAvailability(context: NFLInjuryContext | null | undefined): { eligible: boolean; reason: string | null } {
  if (!context || context.player.sourceStatus !== 'CURRENT') return { eligible: true, reason: null };
  if (context.player.availabilityDesignation === 'OUT') return { eligible: false, reason: 'Player is listed OUT on the current ESPN injury report.' };
  if (context.player.availabilityDesignation === 'DOUBTFUL') return { eligible: false, reason: 'Player is listed DOUBTFUL on the current ESPN injury report.' };
  return { eligible: true, reason: null };
}

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isConcerning(report: NFLInjuryReport) {
  return report.sourceStatus === 'CURRENT' && ['QUESTIONABLE', 'DOUBTFUL', 'OUT'].includes(report.availabilityDesignation);
}

function offensiveRole(position: string | null): NFLAffectedRole | null {
  if (position === 'QB') return 'QUARTERBACK';
  if (position === 'RB' || position === 'FB') return 'BACKFIELD';
  if (position === 'WR' || position === 'TE') return 'RECEIVING_OPTION';
  if (['C', 'G', 'OG', 'OT', 'OL'].includes(position ?? '')) return 'OFFENSIVE_LINE';
  return null;
}

function relevantOffensiveRoles(market: NFLAnalyzableMarketKey, playerPosition: string | null): Set<NFLAffectedRole> {
  if (market.startsWith('player_pass_')) return new Set(['RECEIVING_OPTION', 'OFFENSIVE_LINE']);
  if (market.startsWith('player_rush_') || market === 'player_anytime_td') {
    return playerPosition === 'QB' ? new Set(['BACKFIELD', 'OFFENSIVE_LINE']) : new Set(['QUARTERBACK', 'BACKFIELD', 'OFFENSIVE_LINE']);
  }
  if (market.startsWith('player_reception')) return new Set(['QUARTERBACK', 'BACKFIELD', 'RECEIVING_OPTION', 'OFFENSIVE_LINE']);
  return new Set();
}

function relevantDefender(position: string | null, market: NFLAnalyzableMarketKey) {
  if (market.startsWith('player_pass_') || market.startsWith('player_reception')) return ['CB', 'S', 'DB', 'LB', 'DE', 'DT', 'DL', 'EDGE'].includes(position ?? '');
  if (market.startsWith('player_rush_') || market === 'player_anytime_td') return ['LB', 'DE', 'DT', 'DL', 'EDGE', 'NT'].includes(position ?? '');
  return false;
}

function contextEntry(report: NFLInjuryReport, affectedRole: NFLAffectedRole): NFLInjuryContextEntry {
  const missingFields: string[] = [];
  if (!report.injury) missingFields.push('injury detail');
  if (!report.updatedAt) missingFields.push('last updated');
  return { ...report, affectedRole, missingFields };
}

export function buildNFLInjuryContext(params: {
  playerId: number | null;
  player: string;
  teamId: number | null;
  team: string | null;
  opponentTeamId: number | null;
  market: NFLAnalyzableMarketKey;
  position: string | null;
  reports: NFLInjuryReport[];
  sourceAvailable?: boolean;
}): NFLInjuryContext {
  const own = params.reports.find((report) => report.playerId === params.playerId && params.playerId != null)
    ?? params.reports.find((report) => normalizedName(report.player) === normalizedName(params.player));
  const player = own
    ? contextEntry(own.sourceStatus === 'CURRENT' ? own : { ...own, availabilityDesignation: 'UNKNOWN' }, 'PLAYER')
    : contextEntry({
      playerId: params.playerId, player: params.player, teamId: params.teamId, team: params.team,
      injury: null, status: null, availabilityDesignation: 'UNKNOWN', position: params.position,
      evidence: null, updatedAt: null, sourceStatus: 'MISSING',
    }, 'PLAYER');
  const relevantRoles = relevantOffensiveRoles(params.market, params.position);
  const teammateAbsences = params.reports
    .filter((report) => report.teamId === params.teamId && report.playerId !== params.playerId && isConcerning(report))
    .map((report) => ({ report, role: offensiveRole(report.position) }))
    .filter((item): item is { report: NFLInjuryReport; role: NFLAffectedRole } => item.role != null && relevantRoles.has(item.role))
    .map((item) => contextEntry(item.report, item.role));
  const opponentAbsences = params.reports
    .filter((report) => report.teamId === params.opponentTeamId && isConcerning(report) && relevantDefender(report.position, params.market))
    .map((report) => contextEntry(report, 'OPPONENT_DEFENDER'));
  const currentRelevant = [player, ...teammateAbsences, ...opponentAbsences].filter((entry) => entry.sourceStatus === 'CURRENT');
  const lastUpdated = currentRelevant.map((entry) => entry.updatedAt).filter((value): value is string => value != null).sort().at(-1) ?? null;
  const sourceStatus: NFLInjurySourceStatus = params.sourceAvailable === false
    ? 'MISSING'
    : params.reports.some((report) => report.sourceStatus === 'CURRENT') ? 'CURRENT'
      : params.reports.length ? 'STALE' : 'MISSING';
  const missingFields = ['structured practice participation', 'current official inactive status for player'];
  if (player.sourceStatus !== 'CURRENT') missingFields.push('current player availability');
  return {
    player,
    team: params.team,
    teammateAbsences,
    opponentAbsences,
    sourceStatus: { provider: 'ESPN', status: sourceStatus },
    lastUpdated,
    missingFields,
  };
}