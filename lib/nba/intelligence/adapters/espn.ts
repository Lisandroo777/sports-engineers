import { createRevision, digest, freeze, timestamp } from '../documents';
import type { IdentityEntry, IntelligenceClaim, ReportRevision, TargetEvent } from '../types';

export function espnInjuryRevision(payload: unknown, fetchedAt: string, previous?: ReportRevision | null): ReportRevision {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  return createRevision({ sourceId: 'espn-nba-injuries', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries', bytes: JSON.stringify(payload), mediaType: 'JSON', fetchedAt, previous,
    parsed: { title: 'ESPN NBA injury feed', author: null, publishedAt: timestamp(data.timestamp), updatedAt: timestamp(data.timestamp), text: JSON.stringify(payload), originalUrls: [], issues: Array.isArray(data.injuries) && timestamp(data.timestamp) ? [] : ['Malformed injury feed.'] } });
}

export function espnInjuryClaims(payload: unknown, document: ReportRevision, target: TargetEvent, identities: IdentityEntry[]): IntelligenceClaim[] {
  if (document.issues.length) return [];
  const groups = (payload as { injuries?: Array<{ id?: string; injuries?: Array<{ athlete?: { id?: string }; status?: string; date?: string }> }> }).injuries ?? [];
  return groups.flatMap(group => (group.injuries ?? []).flatMap(injury => {
    const teamId = Number(group.id);
    const playerId = Number(injury.athlete?.id);
    const at = timestamp(injury.date);
    if (!at || !['Out', 'Doubtful', 'Questionable', 'Probable', 'Available'].includes(injury.status ?? '') || !identities.some(identity => identity.espnId === playerId && identity.teamId === teamId)) return [];
    const excerpt = JSON.stringify(injury);
    const start = document.text.indexOf(excerpt);
    if (start < 0) return [];
    return [freeze({ id: digest(`${document.revisionId}:${teamId}:${playerId}`), documentRevisionId: document.revisionId, sourceId: document.sourceId,
      topic: 'INJURY' as const, playerIds: [playerId], teamId, gameId: null, appliesFrom: null, appliesUntil: null, statementAt: at, reportedAt: at,
      value: injury.status!.toUpperCase(), qualifier: 'EXPLICIT' as const, lineupLevel: null, speaker: null,
      evidence: { excerpt, start, end: start + excerpt.length, page: null, timecode: null }, originalClaimId: null, originalUrls: [], extraction: 'OFFICIAL_STRUCTURED' as const,
      reviewedBy: null, reviewedAt: null, correctionOf: null })];
  }));
}