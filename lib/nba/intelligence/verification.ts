import { supportedClaim, claimKey } from './claims';
import { timestamp } from './documents';
import { validPlayer } from './identity';
import { sourceAllowsUrl, verifiedAuthor } from './sources';
import type { IntelligenceInput, VerifiedClaim, Verification } from './types';

export function verifyClaims(input: IntelligenceInput, cutoff: string): VerifiedClaim[] {
  const documents = new Map(input.documents.map(document => [document.revisionId, document]));
  const sources = new Map((input.sources ?? []).map(source => [source.id, source]));
  const results: VerifiedClaim[] = [];
  for (const claim of [...new Map(input.claims.map(claim => [claim.id, claim])).values()]) {
    const document = documents.get(claim.documentRevisionId);
    if (!document) continue;
    const source = sources.get(claim.sourceId);
    const reasons: string[] = [];
    const record: VerifiedClaim = { claim, document, verification: 'UNVERIFIED', state: 'UNKNOWN', reasons, independentSourceIds: [], supersededBy: null };
    const observed = [document.firstSeenAt, document.fetchedAt, document.updatedAt ?? document.publishedAt, claim.reviewedAt ?? document.fetchedAt];
    if (observed.some(at => at != null && timestamp(at) != null && Date.parse(at) > Date.parse(cutoff))) {
      record.state = 'AFTER_CUTOFF'; reasons.push('Revision or review was not known by cutoff.'); results.push(record); continue;
    }
    if (!source || !sourceAllowsUrl(source, document.url) || !supportedClaim(claim, document)) reasons.push('Source ownership or exact supporting span unverified.');
    if (!timestamp(document.firstSeenAt) || !timestamp(document.fetchedAt) || !timestamp(document.publishedAt) || !timestamp(claim.reportedAt)) reasons.push('Exact publication/observation/report timestamps required.');
    if (document.issues.length) reasons.push(...document.issues);
    if (claim.gameId !== input.target.gameId || claim.teamId == null || ![input.target.homeTeamId, input.target.awayTeamId].includes(claim.teamId)) reasons.push('Exact target game/team applicability unverified.');
    if (!timestamp(claim.appliesFrom) || !timestamp(claim.appliesUntil) || Date.parse(input.target.startsAt) < Date.parse(claim.appliesFrom!) || Date.parse(input.target.startsAt) >= Date.parse(claim.appliesUntil!)) reasons.push('Claim does not cover target start in an explicit validity interval.');
    if (claim.playerIds.some(id => !validPlayer(id, claim.teamId!, input.target.startsAt, input.identities))) reasons.push('Player identity or dated team membership unverified.');
    if (!claim.playerIds.length && claim.topic !== 'MISSING_SUBMISSION') reasons.push('Player identities required.');
    if (claim.extraction === 'REVIEWED' && (!claim.reviewedBy || !timestamp(claim.reviewedAt))) reasons.push('Article claim has no accountable review.');
    if (claim.extraction === 'REVIEWED' && claim.reviewedAt && Date.parse(claim.reviewedAt) < Date.parse(document.firstSeenAt)) reasons.push('Review predates observation of this document revision.');
    if (claim.topic === 'MINUTES_RESTRICTION' && claim.value !== 'NO_RESTRICTION') {
      const numbers = claim.value.match(/\d+(?:\.\d+)?/g) ?? [];
      if (numbers.some(number => !claim.evidence.excerpt.includes(number)) || /\bno\s+(?:minutes\s+)?restriction|\bnot\s+(?:on|under)\s+(?:a\s+)?(?:minutes\s+)?restriction/i.test(claim.evidence.excerpt)) reasons.push('Numeric restriction or negation not supported by the exact excerpt.');
    }
    if (claim.topic === 'LINEUP' && claim.qualifier === 'EXPLICIT' && /\b(?:not|isn.t|hasn.t)\s+(?:yet\s+)?(?:decided|confirmed|announced)/i.test(claim.evidence.excerpt)) reasons.push('Explicit lineup claim contradicts undecided/unconfirmed supporting text.');
    if (claim.speaker) {
      if (!timestamp(claim.statementAt) || claim.speaker.eventDate !== claim.statementAt?.slice(0, 10) || claim.speaker.teamId !== claim.teamId
        || !claim.speaker.verifiedProfileUrl.startsWith('https://') || !timestamp(claim.speaker.verifiedAt) || Date.parse(claim.speaker.verifiedAt) > Date.parse(cutoff)) reasons.push('Speaker identity, statement time or interview context unverified.');
    }
    const applicableAt = claim.statementAt ?? claim.reportedAt;
    if (applicableAt && timestamp(applicableAt) && (Date.parse(applicableAt) > Date.parse(cutoff) || Date.parse(claim.reportedAt!) > Date.parse(cutoff))) {
      record.state = 'AFTER_CUTOFF'; reasons.push('Statement/report after cutoff.');
    } else if (reasons.length === 0) {
      const age = Date.parse(cutoff) - Date.parse(applicableAt!);
      const maxAge = claim.topic === 'LINEUP' || claim.topic === 'STARTING_ROLE' ? 12 * 3600000 : 48 * 3600000;
      record.state = age > maxAge ? 'STALE' : 'CURRENT';
      if (record.state === 'STALE') reasons.push('Statement age exceeded topic policy; republication does not renew applicability.');
      let verification: Verification = 'UNVERIFIED';
      if (claim.qualifier === 'RUMOR') verification = 'RUMOR';
      else if (['PROJECTED', 'CONDITIONAL', 'SPECULATIVE'].includes(claim.qualifier)) verification = 'SPECULATION';
      else if (source?.category === 'OFFICIAL_LEAGUE' && claim.extraction === 'OFFICIAL_STRUCTURED' && ['INJURY', 'MISSING_SUBMISSION'].includes(claim.topic)) verification = 'OFFICIAL';
      else if (source?.category === 'OFFICIAL_TEAM' && claim.extraction === 'REVIEWED') verification = 'OFFICIAL';
      else if (source && verifiedAuthor(source, document.author, cutoff) && claim.extraction === 'REVIEWED') verification = 'ATTRIBUTED_REPORT';
      else if (source?.category === 'SECONDARY' && claim.extraction === 'OFFICIAL_STRUCTURED') verification = 'ATTRIBUTED_REPORT';
      record.verification = verification;
      if (verification === 'UNVERIFIED') { record.state = 'UNKNOWN'; reasons.push('Byline/announcement authority not verified.'); }
      if (claim.lineupLevel === 'OFFICIALLY_CONFIRMED' && (verification !== 'OFFICIAL' || claim.qualifier !== 'EXPLICIT' || claim.speaker != null)) {
        record.verification = 'UNVERIFIED'; record.state = 'UNKNOWN'; reasons.push('Final official lineup requires an explicit team announcement, not projected intent or a coach quote.');
      }
    }
    results.push(record);
  }
  for (const record of results.filter(record => record.state === 'CURRENT')) {
    const newer = results.filter(other => other.state === 'CURRENT' && claimKey(other.claim) === claimKey(record.claim) && other.claim.id !== record.claim.id
      && other.claim.qualifier === 'EXPLICIT' && ['OFFICIAL', 'ATTRIBUTED_REPORT'].includes(other.verification)
      && Date.parse(other.claim.reportedAt!) > Date.parse(record.claim.reportedAt!)
      && (other.claim.correctionOf === record.claim.id && other.claim.sourceId === record.claim.sourceId
        || other.claim.sourceId === record.claim.sourceId && other.document.supersedesRevisionId === record.document.revisionId
        || other.claim.sourceId === record.claim.sourceId && other.verification === 'OFFICIAL' && record.verification === 'OFFICIAL'
          && other.claim.extraction === 'OFFICIAL_STRUCTURED' && record.claim.extraction === 'OFFICIAL_STRUCTURED' && other.claim.topic === 'INJURY'));
    if (newer.length) { record.state = 'SUPERSEDED'; record.supersededBy = newer.sort((first, second) => Date.parse(second.claim.reportedAt!) - Date.parse(first.claim.reportedAt!))[0].claim.id; }
  }
  for (const missing of results.filter(record => record.state === 'CURRENT' && record.verification === 'OFFICIAL' && record.claim.topic === 'MISSING_SUBMISSION')) {
    const submitted = results.find(record => record.state === 'CURRENT' && record.verification === 'OFFICIAL' && record.claim.topic === 'INJURY'
      && record.claim.teamId === missing.claim.teamId && record.claim.gameId === missing.claim.gameId && record.claim.sourceId === missing.claim.sourceId
      && Date.parse(record.claim.reportedAt!) > Date.parse(missing.claim.reportedAt!));
    if (submitted) { missing.state = 'SUPERSEDED'; missing.supersededBy = submitted.claim.id; }
  }
  for (const record of results.filter(record => record.state === 'CURRENT' && ['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED'].includes(record.verification))) {
    const peers = results.filter(other => other.state === 'CURRENT' && claimKey(other.claim) === claimKey(record.claim) && ['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED'].includes(other.verification));
    if (peers.some(other => other.claim.value !== record.claim.value)) {
      for (const peer of peers) { peer.state = 'CONFLICTED'; peer.verification = 'CONFLICTED'; peer.reasons.push('Applicable explicit reports disagree; no newest-source guessing.'); }
    } else {
      const independent = peers.filter(other => other.claim.independence === 'DIRECT' && other.claim.originalClaimId == null && other.claim.originalUrls.length === 0);
      record.independentSourceIds = [...new Set(independent.map(other => other.claim.sourceId))];
      const independentPublishers = new Set(independent.map(other => new URL(other.document.url).hostname.replace(/^www\./, '')));
      if (record.verification !== 'OFFICIAL' && record.independentSourceIds.length >= 2 && independentPublishers.size >= 2) record.verification = 'CORROBORATED';
    }
  }
  return results.sort((first, second) => first.claim.id.localeCompare(second.claim.id));
}