import type { NBAContextSnapshot, AvailabilityStatus } from '../../context/types';
import type { NBAIntelligenceSnapshot, VerifiedClaim, LineupLevel } from '../../intelligence/types';
import type { GameEvidenceReadiness } from './recommendations';
import { selectTeamGames } from './history';
import { NBA_AGENT2_ADAPTER_VERSION, seasonNumberFromAgent2, seasonPhaseForAgent2 } from '../contextAdapter';

export interface GamePlayerAvailability {
  playerId: number;
  status: AvailabilityStatus;
  starter: 'CONFIRMED' | 'PROJECTED' | 'REPORTED' | 'UNKNOWN';
  recentMinutes: number | null;
  observedGames: number;
  minutesRange: { min: number; max: number; standardDeviation: number } | null;
  claimIds: string[];
  secondaryStatus: AvailabilityStatus | null;
  sourceIds: string[];
  restrictions: string[];
}

export interface GameTeamAvailability {
  teamId: number;
  report: 'VERIFIED' | 'MISSING' | 'STALE' | 'CONFLICTED';
  lineup: LineupLevel;
  confirmedStarterIds: number[];
  projectedStarterIds: number[];
  players: GamePlayerAvailability[];
}

export interface GameAvailabilityAssessment extends GameEvidenceReadiness {
  assessedAt: string;
  expiresAt: string | null;
  intelligenceSnapshotId: string | null;
  phase: { seasonId: string | null; phase: NBAContextSnapshot['target']['phase']; verified: boolean; sourceId: string;
    adapterVersion: typeof NBA_AGENT2_ADAPTER_VERSION; season: number | null;
    modelPhase: ReturnType<typeof seasonPhaseForAgent2>; round: string | null; sourceObservedAt: string };
  teams: GameTeamAvailability[];
  blockers: string[];
  evidence: string[];
  impactReviewResolved: boolean;
  numericAdjustmentsApplied: false;
  futureLineupVerified: boolean;
}

const hour = 3600000;
const accepted = new Set(['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED']);
const statuses = new Set<AvailabilityStatus>(['OUT', 'DOUBTFUL', 'QUESTIONABLE', 'PROBABLE', 'AVAILABLE']);

function current(record: VerifiedClaim, at: number, start: number): boolean {
  const claim = record.claim;
  const times = [claim.statementAt ?? claim.reportedAt, claim.reportedAt, record.document.publishedAt,
    record.document.firstSeenAt, record.document.fetchedAt, record.document.updatedAt ?? record.document.publishedAt,
    claim.reviewedAt ?? record.document.fetchedAt].map(value => value == null ? NaN : Date.parse(value));
  const maxAge = ['LINEUP', 'STARTING_ROLE'].includes(claim.topic) ? 3 * hour : 6 * hour;
  return record.state === 'CURRENT' && times.every(time => Number.isFinite(time) && time <= at)
    && at - times[0] <= maxAge && Date.parse(claim.appliesFrom ?? '') <= start && start < Date.parse(claim.appliesUntil ?? '')
    && record.document.issues.length === 0;
}

export function assessNBAGameAvailability(snapshot: NBAContextSnapshot, intelligence: NBAIntelligenceSnapshot | null,
  predictionAt = snapshot.asOf): GameAvailabilityAssessment {
  const target = snapshot.target;
  const at = Date.parse(predictionAt);
  const start = Date.parse(target.startsAt);
  const result: GameAvailabilityAssessment = { assessedAt: predictionAt, expiresAt: null, intelligenceSnapshotId: null,
    injuriesVerified: false, startingLineupsVerified: false, conflictsResolved: false, impactReviewResolved: false,
    numericAdjustmentsApplied: false, futureLineupVerified: false, teams: [], blockers: [], evidence: [],
    phase: { seasonId: target.seasonId, phase: target.phase, sourceId: target.source.id,
      adapterVersion: NBA_AGENT2_ADAPTER_VERSION, season: seasonNumberFromAgent2(target.seasonId),
      modelPhase: seasonPhaseForAgent2(target.phase, target.round), round: target.round, sourceObservedAt: target.source.fetchedAt,
      verified: Boolean(target.seasonId && /^\d{4}$/.test(target.seasonId) && target.phase !== 'UNKNOWN'
        && Number.isFinite(Date.parse(target.source.fetchedAt)) && Date.parse(target.source.fetchedAt) <= at
        && [target.source.publishedAt, target.source.updatedAt].every(value => value == null || Number.isFinite(Date.parse(value)) && Date.parse(value) <= at)) } };
  if (!result.phase.verified) result.blockers.push('Verified target season/phase evidence is missing. No date-based phase inference or phase boost.');
  const bound = intelligence?.schemaVersion === '1' && intelligence.sport === 'nba' && intelligence.target.gameId === target.gameId
    && intelligence.target.homeTeamId === target.homeTeamId && intelligence.target.awayTeamId === target.awayTeamId
    && Date.parse(intelligence.target.startsAt) === start && Number.isFinite(at) && at < start
    && Number.isFinite(Date.parse(intelligence.asOf)) && Date.parse(intelligence.asOf) <= at
    && Number.isFinite(Date.parse(intelligence.cutoff)) && Date.parse(intelligence.cutoff) <= at;
  const records = bound ? intelligence!.claims.filter(record => record.claim.gameId === target.gameId) : [];
  if (!bound) result.blockers.push('No cutoff-safe, exact-game Agent #2 intelligence snapshot.');
  else result.intelligenceSnapshotId = intelligence!.snapshotId;
  const deadlines: number[] = [];
  for (const teamId of [target.homeTeamId, target.awayTeamId]) {
    const teamRecords = records.filter(record => record.claim.teamId === teamId);
    const usable = teamRecords.filter(record => current(record, at, start));
    const officialInjuries = usable.filter(record => record.claim.topic === 'INJURY' && record.verification === 'OFFICIAL'
      && record.claim.qualifier === 'EXPLICIT' && statuses.has(record.claim.value as AvailabilityStatus));
    const missingSubmission = usable.some(record => record.claim.topic === 'MISSING_SUBMISSION' && record.verification === 'OFFICIAL');
    const conflicts = teamRecords.some(record => record.state === 'CONFLICTED');
    const confirmed = usable.filter(record => record.claim.topic === 'LINEUP' && record.verification === 'OFFICIAL'
      && record.claim.qualifier === 'EXPLICIT' && record.claim.lineupLevel === 'OFFICIALLY_CONFIRMED'
      && record.claim.playerIds.length === 5 && new Set(record.claim.playerIds).size === 5);
    const lists = new Set(confirmed.map(record => [...record.claim.playerIds].sort((first, second) => first - second).join(':')));
    const lineupConflicts = lists.size > 1;
    const starters = lists.size === 1 && !conflicts ? confirmed[0].claim.playerIds : [];
    const projected = usable.filter(record => record.claim.topic === 'LINEUP' && record.claim.lineupLevel === 'PROJECTED');
    const reported = usable.filter(record => record.claim.topic === 'LINEUP' && record.claim.lineupLevel === 'REPORTED' && accepted.has(record.verification));
    const history = selectTeamGames({ snapshot, predictionAt }).games.filter(game => [game.homeTeamId, game.awayTeamId].includes(teamId))
      .sort((first, second) => Date.parse(second.startsAt) - Date.parse(first.startsAt)).slice(0, 10);
    const workload = new Map<number, number[]>();
    for (const game of history) for (const player of game.teams.find(team => team.teamId === teamId)?.players ?? []) {
      if (player.didNotPlay !== false || player.stats.minutes == null || !Number.isFinite(player.stats.minutes)) continue;
      workload.set(player.playerId, [...(workload.get(player.playerId) ?? []), player.stats.minutes]);
    }
    const sourceCurrent = (source: NBAContextSnapshot['target']['source'], hours: number) => {
      const observed = Date.parse(source.fetchedAt);
      const published = Date.parse(source.updatedAt ?? source.publishedAt ?? '');
      return Number.isFinite(observed) && Number.isFinite(published) && published <= observed && observed <= at && at - published <= hours * hour;
    };
    const secondary = snapshot.injuryFeed.state === 'AVAILABLE' && snapshot.injuryFeed.source && sourceCurrent(snapshot.injuryFeed.source, 6)
      ? snapshot.injuries.filter(report => report.teamId === teamId && report.playerId != null && sourceCurrent(report.source, 48)) : [];
    const playerIds = new Set([...workload.keys(), ...starters, ...usable.flatMap(record => record.claim.playerIds), ...secondary.map(report => report.playerId!)]);
    const players: GamePlayerAvailability[] = [...playerIds].map(playerId => {
      const relevant = usable.filter(record => record.claim.playerIds.includes(playerId) && accepted.has(record.verification) && record.claim.qualifier === 'EXPLICIT');
      const injuries = relevant.filter(record => record.claim.topic === 'INJURY');
      const values = new Set(injuries.map(record => record.claim.value));
      const status: AvailabilityStatus = values.size === 1 && statuses.has(injuries[0].claim.value as AvailabilityStatus)
        ? injuries[0].claim.value as AvailabilityStatus : values.size > 1 ? 'UNKNOWN' : 'NOT_REPORTED';
      const minutes = workload.get(playerId) ?? [];
      const averageMinutes = minutes.length ? minutes.reduce((sum, value) => sum + value, 0) / minutes.length : null;
      const secondaryReports = secondary.filter(report => report.playerId === playerId);
      const secondaryValues = new Set(secondaryReports.map(report => report.status));
      return { playerId, status, starter: starters.includes(playerId) ? 'CONFIRMED'
        : projected.some(record => record.claim.playerIds.includes(playerId)) ? 'PROJECTED'
          : reported.some(record => record.claim.playerIds.includes(playerId)) ? 'REPORTED' : 'UNKNOWN',
        recentMinutes: averageMinutes,
        minutesRange: minutes.length ? { min: Math.min(...minutes), max: Math.max(...minutes),
          standardDeviation: Math.sqrt(minutes.reduce((sum, value) => sum + (value - averageMinutes!) ** 2, 0) / minutes.length) } : null,
        observedGames: minutes.length, claimIds: relevant.map(record => record.claim.id),
        secondaryStatus: secondaryValues.size > 1 ? 'UNKNOWN' : secondaryReports[0]?.status ?? null,
        sourceIds: secondaryReports.map(report => report.source.id),
        restrictions: relevant.filter(record => ['MINUTES_RESTRICTION', 'ROTATION', 'ROLE'].includes(record.claim.topic)).map(record => record.claim.value) };
    });
    const report = conflicts ? 'CONFLICTED' : missingSubmission ? 'MISSING' : officialInjuries.length ? 'VERIFIED'
      : teamRecords.some(record => record.claim.topic === 'INJURY' && record.verification === 'OFFICIAL'
        && (record.state === 'STALE' || record.state === 'CURRENT' && !current(record, at, start))) ? 'STALE' : 'MISSING';
    result.teams.push({ teamId, report, lineup: starters.length ? 'OFFICIALLY_CONFIRMED' : projected.length ? 'PROJECTED' : reported.length ? 'REPORTED' : 'UNKNOWN',
      confirmedStarterIds: starters, projectedStarterIds: [...new Set(projected.flatMap(record => record.claim.playerIds))], players });
    if (report !== 'VERIFIED') result.blockers.push(`Team ${teamId}: official target-game injury report ${report.toLowerCase()}; missing reports do not imply availability.`);
    const stableFutureParticipation = start - at > 90 * 60000 && report === 'VERIFIED' && players.length >= 5
      && players.every(player => player.status === 'AVAILABLE' && player.observedGames >= 5 && player.recentMinutes != null
        && player.restrictions.every(value => ['NO_RESTRICTION', 'STABLE', 'UNCHANGED', 'NORMAL_ROTATION'].includes(value)));
    if (!starters.length && !stableFutureParticipation) result.blockers.push(`Team ${teamId}: no fresh officially confirmed starting five or complete stable future-game participation evidence. Projected/reported starters are not confirmed.`);
    if (conflicts || lineupConflicts) result.blockers.push(`Team ${teamId}: unresolved injury/lineup conflict.`);
    for (const player of players) {
      const material = player.starter === 'CONFIRMED' || player.starter === 'PROJECTED' || player.recentMinutes == null || player.observedGames < 5 || player.recentMinutes >= 15;
      if (material && player.secondaryStatus != null && player.secondaryStatus !== player.status) result.blockers.push(`Team ${teamId}, player ${player.playerId}: fresh secondary ${player.secondaryStatus} conflicts with ${player.status}; review required.`);
      if (material && player.secondaryStatus && ['OUT', 'DOUBTFUL', 'QUESTIONABLE', 'UNKNOWN'].includes(player.secondaryStatus)) {
        result.blockers.push(`Team ${teamId}, player ${player.playerId}: secondary ${player.secondaryStatus} evidence cannot establish acceptable participation.`);
      }
      if (material && player.status === 'NOT_REPORTED') result.blockers.push(`Team ${teamId}, player ${player.playerId}: key rotation availability is not explicitly verified. Report omission is not AVAILABLE.`);
      if (['QUESTIONABLE', 'DOUBTFUL', 'PROBABLE', 'UNKNOWN'].includes(player.status)) result.blockers.push(`Team ${teamId}, player ${player.playerId}: ${player.status}; participation remains uncertain.`);
      if (player.status === 'OUT' && (player.starter === 'CONFIRMED' || player.recentMinutes == null || player.observedGames < 5 || player.recentMinutes >= 15)) {
        result.blockers.push(`Team ${teamId}, player ${player.playerId}: meaningful/unknown-impact absence. V1 has no validated absence adjustment.`);
      }
      if (player.restrictions.some(value => !['NO_RESTRICTION', 'STABLE', 'UNCHANGED', 'NORMAL_ROTATION'].includes(value))) result.blockers.push(`Team ${teamId}, player ${player.playerId}: restriction/rotation change ${player.restrictions.join(', ')} is not numerically modeled.`);
      if (material && teamRecords.some(record => record.claim.playerIds.includes(player.playerId)
        && ['INJURY', 'MINUTES_RESTRICTION', 'ROTATION', 'ROLE'].includes(record.claim.topic)
        && record.state !== 'SUPERSEDED' && record.state !== 'AFTER_CUTOFF' && !current(record, at, start)
        && accepted.has(record.verification))) result.blockers.push(`Team ${teamId}, player ${player.playerId}: stale or unresolved material availability/workload evidence.`);
    }
    for (const record of [...officialInjuries, ...confirmed, ...usable.filter(record => accepted.has(record.verification))]) {
      const duration = ['LINEUP', 'STARTING_ROLE'].includes(record.claim.topic) ? 3 * hour : 6 * hour;
      deadlines.push(Date.parse(record.claim.statementAt ?? record.claim.reportedAt!) + duration,
        Date.parse(record.claim.appliesUntil!), start);
      result.evidence.push(`${record.claim.id}: ${record.verification}/${record.claim.topic}/${record.claim.value}; ${record.document.url}; reported ${record.claim.reportedAt}; observed ${record.document.firstSeenAt}.`);
    }
  }
  result.injuriesVerified = result.teams.every(team => team.report === 'VERIFIED');
  result.startingLineupsVerified = result.teams.every(team => team.confirmedStarterIds.length === 5);
  result.futureLineupVerified = !result.startingLineupsVerified && start - at > 90 * 60000 && result.teams.length === 2
    && result.teams.every(team => team.report === 'VERIFIED' && team.players.length >= 5
      && team.players.every(player => player.status === 'AVAILABLE' && player.observedGames >= 5 && player.recentMinutes != null))
    && result.blockers.length === 0;
  result.conflictsResolved = !result.blockers.some(reason => /conflict/i.test(reason));
  result.impactReviewResolved = result.blockers.length === 0;
  if (result.futureLineupVerified) deadlines.push(start - 90 * 60000);
  result.expiresAt = deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null;
  return result;
}