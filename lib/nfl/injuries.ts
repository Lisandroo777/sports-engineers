import { espnSiteFetch } from './client';
import type { NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLParticipationVerdict } from './participation';
import { normalizedNFLInput } from './researchSnapshot';

export type NFLAvailabilityDesignation = 'CONFIRMED_AVAILABLE' | 'NO_CURRENT_INJURY_DESIGNATION' | 'EXPECTED_AVAILABLE' | 'QUESTIONABLE' | 'DOUBTFUL' | 'OUT' | 'INACTIVE' | 'UNKNOWN' | 'DATA_FAILURE';
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
  participation?: NFLParticipationVerdict | null;
  player: NFLInjuryContextEntry;
  team: string | null;
  teammateAbsences: NFLInjuryContextEntry[];
  opponentAbsences: NFLInjuryContextEntry[];
  sourceStatus: { provider: 'ESPN'; status: NFLInjurySourceStatus };
  lastUpdated: string | null;
  missingFields: string[];
}

export interface NFLInjurySnapshot {
  reports: NFLInjuryReport[];
  complete: boolean;
  fetchedAt: string;
  sourceStatus: NFLInjurySourceStatus;
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
export const NFL_INJURY_CLOCK_SKEW_MS = 60 * 1000;

function athleteId(athlete: RawInjury['athlete']): number | null {
  if (athlete?.id && Number.isFinite(Number(athlete.id))) return Number(athlete.id);
  const href = athlete?.links?.find((link) => link.href?.includes('/id/'))?.href;
  const match = href?.match(/\/id\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

export function classifyNFLAvailability(status: string | null | undefined): NFLAvailabilityDesignation {
  if (!status) return 'UNKNOWN';
  if (/inactive/i.test(status)) return 'INACTIVE';
  if (/\bout\b|injured reserve|\bir\b|inactive|season.ending|out for the season/i.test(status)) return 'OUT';
  if (/doubtful/i.test(status)) return 'DOUBTFUL';
  if (/questionable|day.to.day|day-to-day/i.test(status)) return 'QUESTIONABLE';
  if (/probable/i.test(status)) return 'QUESTIONABLE';
  if (/active|available|no designation/i.test(status)) return 'CONFIRMED_AVAILABLE';
  return 'UNKNOWN';
}

export function classifyNFLInjuryFreshness(updatedAt: string | null | undefined, now = new Date()): NFLInjurySourceStatus {
  if (!updatedAt) return 'MISSING';
  const age = now.getTime() - new Date(updatedAt).getTime();
  return Number.isFinite(age) && age >= -NFL_INJURY_CLOCK_SKEW_MS && Math.max(0, age) <= NFL_INJURY_FRESHNESS_MS ? 'CURRENT' : 'STALE';
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
  return (await getNFLInjurySnapshot(now)).reports;
}

export async function getNFLInjurySnapshot(now = new Date()): Promise<NFLInjurySnapshot> {
  return normalizedNFLInput('injury-snapshot', 120000, () => loadNFLInjurySnapshot(now));
}

async function loadNFLInjurySnapshot(now: Date): Promise<NFLInjurySnapshot> {
  const data = await espnSiteFetch<{ injuries?: RawTeamInjuries[] }>('injuries', {}, 0);
  const complete = Array.isArray(data.injuries);
  if (!complete) throw new Error('NFL injury response is incomplete.');
  return { reports: parseNFLInjuryReports(data, now), complete, fetchedAt: now.toISOString(), sourceStatus: complete ? 'CURRENT' : 'MISSING' };
}

export function isNFLPlayerAvailabilityKnown(context: NFLInjuryContext | null | undefined, now = new Date()): boolean {
  return isNFLInjuryContextFresh(context, now) && context != null
    && !['UNKNOWN', 'DATA_FAILURE'].includes(context.player.availabilityDesignation);
}

/** Re-evaluates cached injury evidence at use time; sourceStatus alone is only a saved label. */
export function isNFLInjuryContextFresh(context: NFLInjuryContext | null | undefined, now = new Date()): boolean {
  if (!context || !context.player || context.player.sourceStatus !== 'CURRENT'
    || classifyNFLInjuryFreshness(context.player.updatedAt, now) !== 'CURRENT') return false;
  const participationFresh = context.participation != null && context.participation.expiresAt > now.getTime()
    && classifyNFLInjuryFreshness(context.participation.checkedAt, now) === 'CURRENT'
    && !['UNKNOWN', 'DATA_FAILURE'].includes(context.participation.designation);
  const injurySnapshotFresh = context.sourceStatus?.status === 'CURRENT'
    && classifyNFLInjuryFreshness(context.lastUpdated, now) === 'CURRENT';
  if (!participationFresh && !injurySnapshotFresh) return false;
  const surrounding = [...(context.teammateAbsences ?? []), ...(context.opponentAbsences ?? [])];
  if (surrounding.some((entry) => entry.sourceStatus !== 'CURRENT'
    || classifyNFLInjuryFreshness(entry.updatedAt, now) !== 'CURRENT')) return false;
  if (context.participation && !participationFresh) return false;
  return true;
}

export function evaluateNFLPlayerAvailability(context: NFLInjuryContext | null | undefined, now = new Date()): { eligible: boolean; reason: string | null } {
  if (!isNFLPlayerAvailabilityKnown(context, now)) return { eligible: false, reason: 'Current player availability could not be verified.' };
  if (!context) return { eligible: false, reason: 'Current player availability could not be verified.' };
  if (context.player.availabilityDesignation === 'INACTIVE') return { eligible: false, reason: 'Player is listed INACTIVE in current participation evidence.' };
  if (context.player.availabilityDesignation === 'OUT') return { eligible: false, reason: 'Player is listed OUT on the current ESPN injury report.' };
  if (context.player.availabilityDesignation === 'DOUBTFUL') return { eligible: false, reason: 'Player is listed DOUBTFUL on the current ESPN injury report.' };
  return { eligible: true, reason: null };
}

export function nflAvailabilityRisk(context: NFLInjuryContext | null | undefined): { points: number; uncertaintyMultiplier: number; reason: string | null } {
  if (!isNFLPlayerAvailabilityKnown(context)) return { points: 30, uncertaintyMultiplier: 1.5, reason: 'Player availability is unknown or injury retrieval failed.' };
  if (context?.player.availabilityDesignation === 'QUESTIONABLE') return { points: 20, uncertaintyMultiplier: 1.35, reason: 'QUESTIONABLE player: workload and participation uncertainty.' };
  if (context?.player.availabilityDesignation === 'OUT' || context?.player.availabilityDesignation === 'DOUBTFUL' || context?.player.availabilityDesignation === 'INACTIVE') return { points: 40, uncertaintyMultiplier: 1.5, reason: 'Player is OUT, INACTIVE or DOUBTFUL.' };
  if (context?.player.availabilityDesignation === 'EXPECTED_AVAILABLE') return { points: 5, uncertaintyMultiplier: 1.1, reason: 'Expected participation from current roster/depth/game evidence; game-day activation is not confirmed.' };
  return { points: 0, uncertaintyMultiplier: 1, reason: null };
}

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isConcerning(report: NFLInjuryReport) {
  return report.sourceStatus === 'CURRENT' && ['QUESTIONABLE', 'DOUBTFUL', 'OUT', 'INACTIVE'].includes(report.availabilityDesignation);
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
  snapshot?: NFLInjurySnapshot | null;
  now?: Date;
  participation?: NFLParticipationVerdict | null;
}): NFLInjuryContext {
  const own = params.reports.find((report) => report.playerId === params.playerId && params.playerId != null)
    ?? params.reports.find((report) => normalizedName(report.player) === normalizedName(params.player));
  const snapshotFresh = params.snapshot != null && classifyNFLInjuryFreshness(params.snapshot.fetchedAt, params.now) === 'CURRENT';
  const fetched = params.sourceAvailable !== false && (params.snapshot?.complete === true && params.snapshot.sourceStatus === 'CURRENT' && snapshotFresh);
  const teamEvidence = params.sourceAvailable !== false && params.reports.some((report) => report.teamId === params.teamId && report.sourceStatus === 'CURRENT');
  const noDesignation = fetched || teamEvidence;
  const sourceFailed = params.sourceAvailable === false || (params.snapshot != null && (!params.snapshot.complete || params.snapshot.sourceStatus !== 'CURRENT' || !snapshotFresh));
  let player = own
    ? contextEntry(own.sourceStatus === 'CURRENT' && !sourceFailed ? own : { ...own, availabilityDesignation: 'UNKNOWN', sourceStatus: sourceFailed ? 'MISSING' : own.sourceStatus }, 'PLAYER')
    : contextEntry({
      playerId: params.playerId, player: params.player, teamId: params.teamId, team: params.team,
      injury: null, status: noDesignation ? 'No current injury designation found' : null,
      availabilityDesignation: noDesignation && !sourceFailed ? 'NO_CURRENT_INJURY_DESIGNATION' : 'UNKNOWN', position: params.position,
      evidence: noDesignation ? 'No player designation was found in successfully retrieved current injury evidence; this is not confirmation of active status.' : null,
      updatedAt: noDesignation ? params.snapshot?.fetchedAt ?? params.reports.filter((report) => report.teamId === params.teamId && report.sourceStatus === 'CURRENT').map((report) => report.updatedAt).filter((date): date is string => date != null).sort().at(-1) ?? null : null,
      sourceStatus: noDesignation && !sourceFailed ? 'CURRENT' : 'MISSING',
    }, 'PLAYER');
  if (params.participation) {
    const verdict = params.participation;
    const valid = verdict.expiresAt > (params.now?.getTime() ?? Date.now());
    const known = valid && !['UNKNOWN', 'DATA_FAILURE'].includes(verdict.designation);
    player = { ...player, availabilityDesignation: valid ? verdict.designation : 'UNKNOWN',
      sourceStatus: known ? 'CURRENT' : verdict.designation === 'DATA_FAILURE' ? 'MISSING' : 'STALE',
      status: valid ? verdict.designation : 'Participation evidence expired',
      updatedAt: verdict.checkedAt, evidence: verdict.evidence.map((entry) => `${entry.source}: ${entry.detail} (${entry.status})`).join(' '),
    };
  }
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
  const sourceStatus: NFLInjurySourceStatus = sourceFailed
    ? 'MISSING'
    : fetched || params.reports.some((report) => report.sourceStatus === 'CURRENT') ? 'CURRENT'
      : params.reports.length ? 'STALE' : 'MISSING';
  const missingFields = ['structured practice participation', 'current official inactive status for player'];
  if (player.sourceStatus !== 'CURRENT') missingFields.push('current player availability');
  return {
    participation: params.participation ?? null,
    player,
    team: params.team,
    teammateAbsences,
    opponentAbsences,
    sourceStatus: { provider: 'ESPN', status: sourceStatus },
    lastUpdated,
    missingFields,
  };
}