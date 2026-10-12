import type { NBAResearchContext, NBAEvidence, NBAMarket, SourceReference } from './context/types';
import type { IntelligenceEvidence, NBAIntelligenceSnapshot, VerifiedClaim } from './intelligence/types';
import { INTELLIGENCE_SOURCES } from './intelligence/sources';
import { buildLineups } from './intelligence/lineups';

export interface NBAResearchEvidence {
  context: {
    state: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
    asOf: string | null;
    cutoff: string | null;
    availability: { status: string; state: string } | null;
    rotation: { recentRole: string; playedGames: number; dnpGames: number; missingGames: number } | null;
    injuryNetwork: NBAResearchContext['sections']['injuryNetwork'] | null;
    schedule: { homeAway: string } | null;
    opponentTeamId: number | null;
    season: NBAResearchContext['sections']['season'] | null;
    evidence: Array<Omit<NBAEvidence, 'sourceRefs'> & { sourceRefs: SourceReference[]; additionalSourceRefsOmitted: number }>;
    missing: string[];
  };
  intelligence: {
    state: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
    asOf: string | null;
    cutoff: string | null;
    reports: Array<{
      claimId: string;
      topic: string;
      value: string;
      qualifier: string;
      verification: string;
      state: string;
      reportedAt: string | null;
      statementAt: string | null;
      lineupLevel: string | null;
      source: { id: string; name: string; url: string; author: string | null; publishedAt: string | null; updatedAt: string | null; fetchedAt: string };
      excerpt: string;
      reasons: string[];
    }>;
    lineups: NBAIntelligenceSnapshot['lineups'];
    evidence: IntelligenceEvidence[];
    affectedTeammates: NBAIntelligenceSnapshot['affectedTeammates'];
    missing: string[];
  };
}

function relatedClaims(snapshot: NBAIntelligenceSnapshot, playerId: number, teamIds: number[]): VerifiedClaim[] {
  return snapshot.claims.filter(({ claim, state }) => state !== 'AFTER_CUTOFF' && state !== 'SUPERSEDED'
    && claim.gameId === snapshot.target.gameId
    && (claim.playerIds.includes(playerId) || claim.teamId != null && teamIds.includes(claim.teamId)));
}

export function buildNBAResearchEvidence(input: {
  gameId: string;
  market: NBAMarket;
  playerId: number;
  teamIds: number[];
  context?: NBAResearchContext | null;
  intelligence?: NBAIntelligenceSnapshot | null;
  contextUnavailableReason?: string;
  intelligenceUnavailableReason?: string;
  asOf?: string;
  targetTipoff?: string;
}): NBAResearchEvidence {
  const suppliedContext = input.context ?? null;
  const observation = Date.parse(input.asOf ?? suppliedContext?.asOf ?? input.intelligence?.asOf ?? '');
  const tipoff = input.targetTipoff == null ? null : Date.parse(input.targetTipoff);
  const knownAt = (value: string | null) => value == null || Number.isFinite(Date.parse(value)) && Date.parse(value) <= observation;
  const context = suppliedContext && suppliedContext.schemaVersion === '1' && suppliedContext.sport === 'nba'
    && suppliedContext.gameId === input.gameId && suppliedContext.playerId === input.playerId
    && input.teamIds.includes(suppliedContext.teamId) && Number.isFinite(observation)
    && Number.isFinite(Date.parse(suppliedContext.asOf)) && Number.isFinite(Date.parse(suppliedContext.cutoff))
    && Date.parse(suppliedContext.asOf) <= observation && Date.parse(suppliedContext.cutoff) <= observation
    && (tipoff == null || Number.isFinite(tipoff) && observation < tipoff) ? suppliedContext : null;
  const contextIds = context ? new Set([
    ...context.marketViews[input.market].evidenceIds,
    ...context.sections.availability.evidenceIds,
    ...context.sections.rotation.evidenceIds,
    ...context.sections.injuryNetwork.evidenceIds,
    ...context.sections.schedule.evidenceIds,
    ...context.sections.opponent.evidenceIds,
    ...context.sections.season.evidenceIds,
    ...context.sections.news.evidenceIds,
  ]) : new Set<string>();
  const selectedContextEvidence = context?.evidence.filter(entry => contextIds.has(entry.id)).map(entry => {
    const sourceRefs = [...entry.sourceRefs].sort((first, second) => (first.fetchedAt ?? '').localeCompare(second.fetchedAt ?? ''));
    const retainedRefs = sourceRefs.slice(-4);
    const unsafeSource = sourceRefs.some(source => !knownAt(source.fetchedAt) || !knownAt(source.publishedAt) || !knownAt(source.updatedAt)
      || source.freshness === 'AFTER_CUTOFF');
    const staleSource = sourceRefs.some(source => source.freshness === 'STALE');
    return { ...entry, ...(unsafeSource ? { kind: 'UNAVAILABLE' as const, state: 'UNAVAILABLE' as const, value: null,
      missingReasons: [...entry.missingReasons, 'Source observation/publication was not known by candidate cutoff.'] }
      : staleSource ? { state: 'PARTIAL' as const, reliability: 'LOW' as const,
        missingReasons: [...entry.missingReasons, 'One or more source references are stale.'] } : {}),
      sourceRefs: retainedRefs.filter(source => knownAt(source.fetchedAt) && knownAt(source.publishedAt) && knownAt(source.updatedAt)),
      additionalSourceRefsOmitted: Math.max(0, sourceRefs.length - retainedRefs.length) };
  }) ?? [];
  const contextMissing = context
    ? [...context.coverage.missing, ...selectedContextEvidence.flatMap(entry => entry.missingReasons)]
    : [suppliedContext
      ? 'ESPN research context identity did not match the candidate; it was not attached.'
      : input.contextUnavailableReason ?? 'ESPN research context is unavailable; no context facts were established.'];
  const contextState = !context ? 'UNAVAILABLE' : contextMissing.length || selectedContextEvidence.some(entry => ['PARTIAL', 'UNKNOWN', 'UNAVAILABLE', 'CONFLICTED'].includes(entry.state)) ? 'PARTIAL' : 'AVAILABLE';

  const intelligenceTimesValid = input.intelligence != null
    && Number.isFinite(Date.parse(input.intelligence.asOf)) && Number.isFinite(Date.parse(input.intelligence.cutoff))
    && Number.isFinite(Date.parse(input.intelligence.target.startsAt));
  const boundIntelligence = input.intelligence && input.intelligence.schemaVersion === '1' && input.intelligence.sport === 'nba'
    && intelligenceTimesValid && Number.isFinite(observation) && input.intelligence.target.gameId === input.gameId
    && new Set(input.teamIds).size === 2 && input.intelligence.target.homeTeamId !== input.intelligence.target.awayTeamId
    && [input.intelligence.target.homeTeamId, input.intelligence.target.awayTeamId].every(id => input.teamIds.includes(id))
    && Date.parse(input.intelligence.asOf) <= Date.parse(input.intelligence.target.startsAt)
    && Date.parse(input.intelligence.cutoff) <= Date.parse(input.intelligence.target.startsAt)
    && Date.parse(input.intelligence.asOf) <= observation && Date.parse(input.intelligence.cutoff) <= observation
    && (tipoff == null || Date.parse(input.intelligence.target.startsAt) === tipoff && observation < tipoff)
    ? input.intelligence : null;
  const checkedClaims = boundIntelligence?.claims.map(record => {
    const stamps = [record.document.publishedAt, record.document.updatedAt, record.document.firstSeenAt, record.document.fetchedAt,
      record.document.statementAt, record.claim.reportedAt, record.claim.statementAt, record.claim.reviewedAt];
    if (stamps.some(stamp => !knownAt(stamp))) return { ...record, state: 'AFTER_CUTOFF' as const,
      reasons: [...record.reasons, 'Report or review not known at candidate observation cutoff.'] };
    const statement = Date.parse(record.claim.statementAt ?? record.claim.reportedAt ?? '');
    const maxAge = ['LINEUP', 'STARTING_ROLE'].includes(record.claim.topic) ? 3 * 3600000 : 6 * 3600000;
    if (record.state === 'CURRENT' && (!Number.isFinite(statement) || observation - statement > maxAge)) return {
      ...record, state: 'STALE' as const, reasons: [...record.reasons, 'Statement exceeded descriptive research freshness policy.'] };
    return record;
  }) ?? [];
  const intelligence = boundIntelligence ? { ...boundIntelligence, claims: checkedClaims,
    lineups: buildLineups(boundIntelligence.target, checkedClaims) } : null;
  const reports = intelligence ? relatedClaims(intelligence, input.playerId, input.teamIds) : [];
  const reportClaimIds = new Set(reports.map(record => record.claim.id));
  const marketEvidenceIds = intelligence ? new Set(intelligence.marketViews[input.market].evidenceIds) : new Set<string>();
  const selectedIntelligenceEvidence = intelligence?.evidence.filter(entry => marketEvidenceIds.has(entry.id)
    && entry.claimIds.every(id => reportClaimIds.has(id))
    && (entry.claimIds.some(id => reportClaimIds.has(id)) || intelligence.affectedTeammates.some(edge => edge.playerId === input.playerId && edge.claimId === entry.claimIds[0]))) ?? [];
  const affectedTeammates = intelligence?.affectedTeammates.filter(edge => edge.playerId === input.playerId && reportClaimIds.has(edge.claimId)) ?? [];
  const selectedLineups = intelligence?.lineups.filter(lineup => input.teamIds.includes(lineup.teamId)) ?? [];
  const intelligenceMissing = intelligence
    ? [
      ...intelligence.coverage.missing,
      ...reports.filter(record => record.state !== 'CURRENT').flatMap(record => record.reasons),
      ...(intelligence.claims.some(record => record.state === 'AFTER_CUTOFF') ? ['One or more reports were excluded because they were first observed, updated, reviewed or reported after the target cutoff.'] : []),
    ]
    : [input.intelligenceUnavailableReason ?? 'No cutoff-valid stored NBA intelligence snapshot is available; no sourced report was established.'];
  const intelligenceState = !intelligence ? 'UNAVAILABLE' : intelligenceMissing.length || reports.some(record => record.state !== 'CURRENT') ? 'PARTIAL' : reports.length ? 'AVAILABLE' : 'PARTIAL';
  const availabilityUsable = selectedContextEvidence.some(entry => context?.sections.availability.evidenceIds.includes(entry.id)
    && entry.state === 'AVAILABLE' && entry.sourceRefs.length > 0);
  const rotationUsable = selectedContextEvidence.some(entry => context?.sections.rotation.evidenceIds.includes(entry.id)
    && !['UNKNOWN', 'UNAVAILABLE', 'CONFLICTED'].includes(entry.state) && entry.sourceRefs.length > 0);

  return {
    context: {
      state: contextState,
      asOf: context?.asOf ?? null,
      cutoff: context?.cutoff ?? null,
      availability: context ? availabilityUsable ? { ...context.sections.availability } : { status: 'UNKNOWN',
        state: context.sections.availability.state === 'AVAILABLE' ? 'UNAVAILABLE' : context.sections.availability.state } : null,
      rotation: context ? {
        recentRole: rotationUsable ? context.sections.rotation.recentRole : 'UNKNOWN',
        playedGames: context.sections.rotation.playedGames,
        dnpGames: context.sections.rotation.dnpGames,
        missingGames: context.sections.rotation.missingGames,
      } : null,
      injuryNetwork: context?.sections.injuryNetwork ?? null,
      schedule: context ? { homeAway: context.sections.schedule.homeAway } : null,
      opponentTeamId: context?.sections.opponent.opponentTeamId ?? null,
      season: context?.sections.season ?? null,
      evidence: selectedContextEvidence,
      missing: contextMissing,
    },
    intelligence: {
      state: intelligenceState,
      asOf: intelligence?.asOf ?? null,
      cutoff: intelligence?.cutoff ?? null,
      reports: reports.map(({ claim, verification, state, reasons, document }) => ({
        claimId: claim.id,
        topic: claim.topic,
        value: claim.value,
        qualifier: claim.qualifier,
        verification,
        state,
        reportedAt: claim.reportedAt,
        statementAt: claim.statementAt,
        lineupLevel: claim.lineupLevel,
        source: {
          id: claim.sourceId,
          name: INTELLIGENCE_SOURCES.find(source => source.id === claim.sourceId)?.name ?? claim.sourceId,
          url: document.url,
          author: document.author,
          publishedAt: document.publishedAt,
          updatedAt: document.updatedAt,
          fetchedAt: document.fetchedAt,
        },
        excerpt: claim.evidence.excerpt,
        reasons,
      })),
      lineups: selectedLineups,
      evidence: selectedIntelligenceEvidence,
      affectedTeammates,
      missing: intelligenceMissing,
    },
  };
}