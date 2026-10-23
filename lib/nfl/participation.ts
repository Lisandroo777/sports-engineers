import { espnSiteFetch } from './client';
import type { NFLGame } from './types';
import type { NFLAvailabilityDesignation, NFLInjurySnapshot } from './injuries';
import { normalizedNFLInput } from './researchSnapshot';
import { fetchWithReadRetry } from '../reliability/retry';
import { loadOfficialNFLParticipation, type NFLOfficialParticipation } from './officialParticipation';

export interface NFLParticipationEvidence {
  source: 'TEAM_ROSTER' | 'DEPTH_CHART' | 'GAME_PREVIEW' | 'INJURY_REPORT' | 'GAME_INJURY_REPORT' | 'GAME_ROSTER' | 'OFFICIAL_TEAM_REPORT';
  fetchedAt: string;
  observedAt: string | null;
  status: 'CURRENT' | 'STALE' | 'FAILED';
  detail: string;
}

interface RawInjury { status?: string; date?: string; athlete?: { id?: string } }
interface RawAthlete { id?: string; fullName?: string; displayName?: string; status?: { name?: string; type?: string }; injuries?: RawInjury[] }
export interface NFLRosterEvidence {
  teamId: number;
  timestamp: string | null;
  complete: boolean;
  athletes: RawAthlete[];
}
export interface NFLDepthEvidence {
  teamId: number;
  timestamp: string | null;
  complete: boolean;
  athletes: Array<{ id: string; position: string; order: number; injuries?: RawInjury[] }>;
}
export interface NFLParticipationSnapshot {
  gameId: string;
  kickoff: string;
  fetchedAt: string;
  expiresAt: number;
  gameVerified: boolean;
  teamIds: number[];
  rosters: NFLRosterEvidence[];
  depthCharts: NFLDepthEvidence[];
  gameInjuries: Array<{ teamId: number; complete: boolean; reports: RawInjury[] }>;
  gameRosters?: Array<{ teamId: number; complete: boolean; activePlayerIds: number[]; inactivePlayerIds: number[] }>;
  officialParticipation?: NFLOfficialParticipation[];
  failures: string[];
}
export interface NFLParticipationVerdict {
  designation: NFLAvailabilityDesignation;
  confidence: 'HIGH' | 'MEDIUM' | 'NONE';
  stage: 'EARLY_WEEK' | 'PRACTICE_WEEK' | 'FINAL_DESIGNATION' | 'GAME_DAY';
  gameId: string;
  checkedAt: string;
  expiresAt: number;
  depthOrder: number | null;
  evidence: NFLParticipationEvidence[];
  missingEvidence: string[];
}

export function nflParticipationTtlMs(kickoff: string, now = Date.now()): number {
  const hours = (Date.parse(kickoff) - now) / 3600000;
  return hours > 72 ? 6 * 3600000 : hours > 24 ? 3600000 : hours > 1.5 ? 15 * 60000 : 5 * 60000;
}

export function parseNFLRosterEvidence(raw: { timestamp?: string; team?: { id?: string }; athletes?: Array<{ items?: RawAthlete[] }> }, teamId: number): NFLRosterEvidence {
  const complete = Number(raw.team?.id) === teamId && Array.isArray(raw.athletes) && raw.athletes.every((group) => Array.isArray(group.items));
  return { teamId, timestamp: raw.timestamp ?? null, complete, athletes: complete ? raw.athletes!.flatMap((group) => group.items!) : [] };
}

export function parseNFLDepthEvidence(raw: { timestamp?: string; team?: { id?: string }; depthchart?: Array<{ positions?: Record<string, { position?: { abbreviation?: string }; athletes?: RawAthlete[] }> }> }, teamId: number): NFLDepthEvidence {
  const complete = Number(raw.team?.id) === teamId && Array.isArray(raw.depthchart) && raw.depthchart.every((chart) => chart.positions != null);
  return { teamId, timestamp: raw.timestamp ?? null, complete,
    athletes: complete ? raw.depthchart!.flatMap((chart) => Object.values(chart.positions!).flatMap((position) => (position.athletes ?? []).filter((athlete) => athlete.id).map((athlete, index) => ({
      id: athlete.id!, position: position.position?.abbreviation ?? 'UNKNOWN', order: index + 1, injuries: athlete.injuries,
    })))) : [] };
}

export async function getNFLParticipationSnapshot(game: NFLGame, now = new Date()): Promise<NFLParticipationSnapshot> {
  const ttl = nflParticipationTtlMs(game.gameTime, now.getTime());
  return normalizedNFLInput(`participation:${game.id}:${game.gameTime}:${ttl}`, ttl, () => loadNFLParticipationSnapshot(game, now, ttl));
}

async function loadNFLParticipationSnapshot(game: NFLGame, now: Date, ttl: number): Promise<NFLParticipationSnapshot> {
  const failures: string[] = [];
  const teams = [game.homeTeam.id, game.awayTeam.id];
  const [summary, rosters, depthCharts, gameRosters] = await Promise.all([
    espnSiteFetch<{ header?: { id?: string; competitions?: Array<{ date?: string; competitors?: Array<{ team?: { id?: string } }> }> }; injuries?: Array<{ team?: { id?: string }; injuries?: RawInjury[] }> }>('summary', { event: game.id }, 0).catch(() => { failures.push('game preview'); return null; }),
    Promise.all(teams.map(async (teamId) => {
      try { return parseNFLRosterEvidence(await espnSiteFetch(`teams/${teamId}/roster`, {}, 0), teamId); }
      catch { failures.push(`team ${teamId} roster`); return { teamId, timestamp: null, complete: false, athletes: [] }; }
    })),
    Promise.all(teams.map(async (teamId) => {
      try { return parseNFLDepthEvidence(await espnSiteFetch(`teams/${teamId}/depthcharts`, {}, 0), teamId); }
      catch { failures.push(`team ${teamId} depth chart`); return { teamId, timestamp: null, complete: false, athletes: [] }; }
    })),
    Promise.all(teams.map(async (teamId) => {
      try {
        const response = await fetchWithReadRetry(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${encodeURIComponent(game.id)}/competitions/${encodeURIComponent(game.id)}/competitors/${teamId}/roster`,
          { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) throw new Error('Game roster unavailable.');
        return parseNFLGameRoster(await response.json(), game.id, teamId);
      } catch { return { teamId, complete: false, activePlayerIds: [], inactivePlayerIds: [] }; }
    })),
  ]);
  const competition = summary?.header?.competitions?.[0];
  const officialParticipation = (await Promise.all(rosters.map(roster => loadOfficialNFLParticipation(game, roster, now)))).flat();
  const teamIds = (competition?.competitors ?? []).map((entry) => Number(entry.team?.id)).filter(Number.isFinite);
  const gameVerified = summary?.header?.id === game.id && teams.every((id) => teamIds.includes(id))
    && competition?.date != null && Math.abs(Date.parse(competition.date) - Date.parse(game.gameTime)) <= 15 * 60000;
  return { gameId: game.id, kickoff: game.gameTime, fetchedAt: now.toISOString(), expiresAt: now.getTime() + ttl,
    gameVerified, teamIds, rosters, depthCharts, gameRosters, officialParticipation,
    gameInjuries: (summary?.injuries ?? []).map((entry) => ({ teamId: Number(entry.team?.id), complete: Array.isArray(entry.injuries), reports: entry.injuries ?? [] })), failures: failures.sort() };
}

export function parseNFLGameRoster(raw: { competition?: { $ref?: string }; team?: { $ref?: string };
  entries?: Array<{ playerId?: number; valid?: boolean; active?: boolean }> }, gameId: string, teamId: number) {
  const matches = (reference: string | undefined, suffix: string) => {
    try { const url = new URL(reference ?? ''); return url.hostname === 'sports.core.api.espn.com' && url.pathname.endsWith(suffix); }
    catch { return false; }
  };
  const entries = raw.entries ?? [];
  const complete = matches(raw.competition?.$ref, `/events/${gameId}/competitions/${gameId}`)
    && matches(raw.team?.$ref, `/teams/${teamId}`) && entries.length > 0
    && entries.every(entry => entry.valid === true && Number.isInteger(entry.playerId) && typeof entry.active === 'boolean')
    && entries.some(entry => entry.active === true);
  return { teamId, complete, activePlayerIds: complete ? entries.filter(entry => entry.active).map(entry => entry.playerId!) : [],
    inactivePlayerIds: complete ? entries.filter(entry => !entry.active).map(entry => entry.playerId!) : [] };
}

function negative(status: string | null | undefined): NFLAvailabilityDesignation | null {
  if (!status) return null;
  if (/inactive/i.test(status)) return 'INACTIVE';
  if (/\bout\b|injured reserve|\bir\b|suspended|reserve|non.football injury/i.test(status)) return 'OUT';
  if (/doubtful/i.test(status)) return 'DOUBTFUL';
  if (/questionable|probable|day.to.day/i.test(status)) return 'QUESTIONABLE';
  return null;
}

export function evaluateNFLParticipation(params: { playerId: number; teamId: number | null; position: string | null; snapshot: NFLParticipationSnapshot; injuries: NFLInjurySnapshot | null; now?: Date }): NFLParticipationVerdict {
  const { snapshot, injuries, playerId, teamId, position } = params;
  const now = params.now ?? new Date();
  const ageToGame = Date.parse(snapshot.kickoff) - now.getTime();
  const ttl = nflParticipationTtlMs(snapshot.kickoff, now.getTime());
  const current = (timestamp: string | null, limit = ttl) => timestamp != null && Number.isFinite(Date.parse(timestamp)) && now.getTime() - Date.parse(timestamp) >= -60000 && now.getTime() - Date.parse(timestamp) <= limit;
  const snapshotCurrent = current(snapshot.fetchedAt) && snapshot.expiresAt > now.getTime();
  const stage = ageToGame > 72 * 3600000 ? 'EARLY_WEEK' : ageToGame > 24 * 3600000 ? 'PRACTICE_WEEK' : ageToGame > 90 * 60000 ? 'FINAL_DESIGNATION' : 'GAME_DAY';
  const evidence: NFLParticipationEvidence[] = [];
  const missingEvidence = ['structured practice participation', 'official game-day active/inactive list'];
  const row = snapshot.rosters.find((entry) => entry.teamId === teamId);
  const depth = snapshot.depthCharts.find((entry) => entry.teamId === teamId);
  const athlete = row?.athletes.find((entry) => Number(entry.id) === playerId);
  const depthEntry = depth?.athletes.find((entry) => Number(entry.id) === playerId && entry.position === position);
  const rosterCurrent = snapshotCurrent && row?.complete === true && current(row.timestamp);
  const depthCurrent = snapshotCurrent && depth?.complete === true && current(depth.timestamp);
  const gameCurrent = snapshotCurrent && snapshot.gameVerified && teamId != null && snapshot.teamIds.includes(teamId) && ageToGame > 0;
  const add = (source: NFLParticipationEvidence['source'], observedAt: string | null, valid: boolean, detail: string) => evidence.push({ source, fetchedAt: snapshot.fetchedAt, observedAt, status: valid ? 'CURRENT' : observedAt ? 'STALE' : 'FAILED', detail });
  add('GAME_PREVIEW', snapshot.fetchedAt, gameCurrent, gameCurrent ? 'The verified upcoming game contains the resolved player team.' : 'Upcoming game or team identity could not be verified.');
  add('TEAM_ROSTER', row?.timestamp ?? null, rosterCurrent, athlete ? `Current roster entry status: ${athlete.status?.name ?? athlete.status?.type ?? 'unknown'}.` : 'Player was not found on the resolved team roster.');
  add('DEPTH_CHART', depth?.timestamp ?? null, depthCurrent, depthEntry ? `Listed in ${depthEntry.position} depth-chart order ${depthEntry.order}; not official game-day activation.` : 'Player was not found in the expected position depth chart.');
  const currentNegatives: NFLAvailabilityDesignation[] = [];
  let unresolvedOldNegative = false;
  const ownReports = injuries?.reports.filter((report) => report.playerId === playerId && report.teamId === teamId) ?? [];
  const injurySourceCurrent = injuries?.complete === true && injuries.sourceStatus === 'CURRENT' && current(injuries.fetchedAt);
  if (ownReports.length === 0) add('INJURY_REPORT', injuries?.fetchedAt ?? null, injurySourceCurrent,
    injurySourceCurrent ? 'Successfully retrieved current injury feed has no individual designation for this player.' : 'Current injury-feed evidence is unavailable; another restriction source is required.');
  for (const report of ownReports) {
    const isCurrent = injurySourceCurrent && report.sourceStatus === 'CURRENT' && current(report.updatedAt, 72 * 3600000);
    add('INJURY_REPORT', report.updatedAt, isCurrent, `${report.status ?? 'Unknown'} designation; individual timestamp is preserved.`);
    const restriction = negative(report.status);
    if (isCurrent && restriction) currentNegatives.push(restriction);
    if (!isCurrent && restriction) unresolvedOldNegative = true;
  }
  const gameReports = snapshot.gameInjuries.find((entry) => entry.teamId === teamId);
  add('GAME_INJURY_REPORT', snapshot.fetchedAt, snapshotCurrent && gameReports?.complete === true,
    gameReports?.complete ? 'Game-specific team injury list was retrieved; individual restrictions retain their own timestamps.' : 'Game-specific injury list is unavailable.');
  const embedded = [...(athlete?.injuries ?? []), ...(depthEntry?.injuries ?? [])];
  for (const report of [...(gameReports?.reports.filter((report) => Number(report.athlete?.id) === playerId) ?? []), ...embedded]) {
    const isCurrent = snapshotCurrent && current(report.date ?? null, 72 * 3600000);
    const restriction = negative(report.status);
    add('GAME_INJURY_REPORT', report.date ?? null, isCurrent, `${report.status ?? 'Unknown'} game/roster injury designation.`);
    if (isCurrent && restriction) currentNegatives.push(restriction);
    if (!isCurrent && restriction) unresolvedOldNegative = true;
  }
  const rosterRestriction = rosterCurrent ? negative(athlete?.status?.name ?? athlete?.status?.type) : null;
  if (rosterRestriction) currentNegatives.push(rosterRestriction);
  const ordered: NFLAvailabilityDesignation[] = ['INACTIVE', 'OUT', 'DOUBTFUL', 'QUESTIONABLE'];
  const restriction = ordered.find((designation) => currentNegatives.includes(designation));
  const official = snapshot.officialParticipation?.find(entry => entry.playerId === playerId && entry.teamId === teamId
    && gameCurrent && current(entry.publishedAt, 12 * 3600000));
  if (official) add('OFFICIAL_TEAM_REPORT', official.publishedAt, true, `${official.detail} Source: ${official.url}`);
  const officialClearsQuestionable = official?.designation === 'CONFIRMED_AVAILABLE' && restriction === 'QUESTIONABLE'
    && !unresolvedOldNegative && evidence.filter(entry => /designation/.test(entry.detail) && entry.source !== 'TEAM_ROSTER')
      .every(entry => entry.observedAt != null && Date.parse(entry.observedAt) <= Date.parse(official.publishedAt));
  const restrictionsChecked = injurySourceCurrent || (snapshotCurrent && gameReports?.complete === true);
  const gameRoster = snapshot.gameRosters?.find(entry => entry.teamId === teamId && entry.complete);
  const gameActive = gameCurrent && gameRoster?.activePlayerIds.includes(playerId) === true;
  const gameInactive = gameCurrent && gameRoster?.inactivePlayerIds.includes(playerId) === true;
  add('GAME_ROSTER', snapshot.fetchedAt, gameCurrent && gameRoster != null,
    gameActive ? 'Explicit active entry on the exact-game roster.' : gameInactive ? 'Explicit inactive entry on the exact-game roster.' : 'No published exact-game active roster evidence.');
  const cleanEmbedded = Array.isArray(athlete?.injuries) && athlete.injuries.length === 0 && Array.isArray(depthEntry?.injuries) && depthEntry.injuries.length === 0;
  const rosterActive = /^(active|available)$/i.test(athlete?.status?.name ?? athlete?.status?.type ?? '');
  let designation: NFLAvailabilityDesignation;
  if (gameInactive || official?.designation === 'INACTIVE') designation = 'INACTIVE';
  else if (restriction && !officialClearsQuestionable) designation = restriction;
  else if (official?.designation === 'CONFIRMED_AVAILABLE' && athlete && restrictionsChecked && !unresolvedOldNegative) designation = 'CONFIRMED_AVAILABLE';
  else if (gameActive && rosterCurrent && athlete && rosterActive && restrictionsChecked && !unresolvedOldNegative) designation = 'CONFIRMED_AVAILABLE';
  else if (!snapshotCurrent || snapshot.failures.includes('game preview') || (!restrictionsChecked && snapshot.failures.length > 0)) designation = 'DATA_FAILURE';
  else if (gameCurrent && rosterCurrent && depthCurrent && athlete && depthEntry && rosterActive && cleanEmbedded && restrictionsChecked && !unresolvedOldNegative && stage !== 'GAME_DAY') designation = 'EXPECTED_AVAILABLE';
  else designation = 'UNKNOWN';
  if (designation === 'EXPECTED_AVAILABLE') evidence.push({ source: 'TEAM_ROSTER', fetchedAt: snapshot.fetchedAt, observedAt: row!.timestamp, status: 'CURRENT', detail: 'Expected participation based on current roster, depth chart, correct game, and no current restriction; not officially confirmed active.' });
  return { designation, confidence: restriction || designation === 'CONFIRMED_AVAILABLE' || designation === 'INACTIVE' ? 'HIGH' : designation === 'EXPECTED_AVAILABLE' ? 'MEDIUM' : 'NONE', stage, gameId: snapshot.gameId,
    checkedAt: now.toISOString(), expiresAt: Math.min(snapshot.expiresAt, now.getTime() + ttl,
      designation === 'EXPECTED_AVAILABLE' ? Date.parse(snapshot.kickoff) - 90 * 60000 : Infinity),
    depthOrder: depthEntry?.order ?? null, evidence, missingEvidence };
}