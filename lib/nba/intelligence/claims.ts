import { digest, freeze, timestamp } from './documents';
import type { IntelligenceClaim, ReportRevision } from './types';

export type ReviewedClaimInput = Omit<IntelligenceClaim, 'id' | 'documentRevisionId' | 'sourceId' | 'extraction' | 'evidence'> & {
  excerpt: string; occurrence?: number; page?: number | null; timecode?: string | null;
};

export function createReviewedClaim(document: ReportRevision, input: ReviewedClaimInput): IntelligenceClaim {
  if (!input.reviewedBy?.trim() || !timestamp(input.reviewedAt) || !input.excerpt.trim() || input.excerpt.length > 1500) throw new Error('Reviewer, review timestamp and bounded supporting excerpt required.');
  let start = -1;
  let cursor = 0;
  for (let occurrence = 0; occurrence <= (input.occurrence ?? 0); occurrence += 1) {
    start = document.text.indexOf(input.excerpt, cursor);
    if (start < 0) throw new Error('Supporting excerpt must be exact text in this revision.');
    cursor = start + input.excerpt.length;
  }
  const { excerpt, occurrence: _occurrence, page, timecode, ...claim } = input;
  void _occurrence;
  const id = digest(JSON.stringify([document.revisionId, claim.topic, claim.gameId, claim.teamId, claim.playerIds, claim.value, start, claim.reviewedAt]));
  return freeze({ ...claim, id, documentRevisionId: document.revisionId, sourceId: document.sourceId, extraction: 'REVIEWED',
    evidence: { excerpt, start, end: start + excerpt.length, page: page ?? null, timecode: timecode ?? null } });
}

export function supportedClaim(claim: IntelligenceClaim, document: ReportRevision): boolean {
  const { start, end, excerpt } = claim.evidence;
  return claim.documentRevisionId === document.revisionId && claim.sourceId === document.sourceId && excerpt.length > 0 && excerpt.length <= 1500
    && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && document.text.slice(start, end) === excerpt;
}

export const claimKey = (claim: IntelligenceClaim): string => JSON.stringify([claim.gameId, claim.teamId, claim.topic, claim.topic === 'LINEUP' ? [] : [...claim.playerIds].sort((first, second) => first - second)]);