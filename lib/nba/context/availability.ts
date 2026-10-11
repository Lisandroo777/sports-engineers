import { addEvidence, freshness } from './evidence';
import type { AvailabilityContext, AvailabilityStatus, BuildEnvironment, InjuryObservation } from './types';

export function resolveAvailability(env: BuildEnvironment, playerId: number, teamId: number): { status: AvailabilityStatus; state: AvailabilityContext['state']; reports: InjuryObservation[] } {
  const feed = env.snapshot.injuryFeed;
  const feedFresh = feed.state === 'AVAILABLE' && feed.source != null && freshness(feed.source, env.cutoff, 6) === 'FRESH';
  const linked = env.snapshot.injuries.filter(report => report.playerId === playerId && report.teamId === teamId);
  const reports = linked.filter(report => freshness(report.source, env.cutoff, 48) === 'FRESH');
  if (!feedFresh) return { status: 'UNKNOWN', state: 'UNKNOWN', reports: [] };
  if (!reports.length) return { status: linked.length ? 'UNKNOWN' : 'NOT_REPORTED', state: 'UNKNOWN', reports: [] };
  const updated = reports.map(report => report.source.updatedAt ?? report.source.publishedAt ?? '').sort().at(-1);
  const latest = reports.filter(report => (report.source.updatedAt ?? report.source.publishedAt ?? '') === updated);
  const statuses = new Set(latest.map(report => report.status));
  if (statuses.size > 1) return { status: 'UNKNOWN', state: 'CONFLICTED', reports: latest };
  const status = latest[0].status;
  return { status, state: status === 'UNKNOWN' ? 'UNKNOWN' : 'AVAILABLE', reports: latest };
}

export function buildAvailability(env: BuildEnvironment): AvailabilityContext {
  const result = resolveAvailability(env, env.request.playerId, env.request.teamId);
  const evidenceIds = [addEvidence(env, {
    id: 'availability.current', metric: 'reportedAvailability', correlationGroup: 'availability.player',
    kind: result.reports.length ? 'FACT' : 'UNAVAILABLE', state: result.state,
    value: result.reports.length ? result.status : null,
    sourceRefs: result.reports.length ? result.reports.map(report => ({ ...report.source, freshness: freshness(report.source, env.cutoff, 48) }))
      : env.snapshot.injuryFeed.source ? [{ ...env.snapshot.injuryFeed.source, freshness: freshness(env.snapshot.injuryFeed.source, env.cutoff, 6) }] : [],
    detail: result.status === 'NOT_REPORTED' ? 'No fresh game-specific report found; absence from the feed does not confirm availability.'
      : result.reports.length ? `Provider-reported status: ${result.status}. This is not confirmation of participation or minutes.` : 'Injury feed or report unavailable, stale or collected after cutoff.',
    reliability: result.state === 'AVAILABLE' ? 'MEDIUM' : 'UNKNOWN',
    reliabilityReasons: ['Secondary provider report; game applicability and participation may remain unconfirmed.'],
    missingReasons: result.state === 'AVAILABLE' ? [] : ['Current game-specific availability unresolved.'],
  })];
  evidenceIds.push(addEvidence(env, { id: 'availability.restriction', metric: 'minutesRestriction', correlationGroup: 'availability.player', state: 'UNKNOWN', detail: 'No structured, game-specific verified minutes restriction is connected. Comments remain attributed report text, not a numeric limit.' }));
  return { status: result.status, state: result.state, evidenceIds };
}