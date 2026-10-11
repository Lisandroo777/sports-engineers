import { affectedTeammates } from './affectedTeammates';
import { detectChanges } from './changes';
import { buildCoaching } from './coaching';
import { digest, freeze, timestamp } from './documents';
import { buildLineups } from './lineups';
import { marketEvidence, marketViews } from './marketRelevance';
import { INTELLIGENCE_SOURCES } from './sources';
import { verifyClaims } from './verification';
import type { IntelligenceInput, NBAIntelligenceSnapshot } from './types';

export function buildNBAIntelligence(input: IntelligenceInput): NBAIntelligenceSnapshot {
  const asOf = timestamp(input.asOf);
  const start = timestamp(input.target.startsAt);
  if (!asOf || !start || !input.target.gameId || !input.target.homeTeamId || !input.target.awayTeamId || input.target.homeTeamId === input.target.awayTeamId) throw new Error('Valid target and observation time required.');
  const cutoff = new Date(Math.min(Date.parse(asOf), Date.parse(start))).toISOString();
  const sources = input.sources ?? [...INTELLIGENCE_SOURCES];
  const claims = verifyClaims({ ...input, sources }, cutoff);
  const evidence = marketEvidence(claims);
  const affected = affectedTeammates(claims, input.researchContexts ?? [], input.target.gameId, cutoff);
  for (const [index, member] of affected.entries()) evidence.push({ id: `teammate.${member.claimId}.${member.playerId}.${index}`, kind: 'INFERENCE', claimIds: [member.claimId], contextEvidenceIds: member.contextEvidenceIds,
    markets: ['points', 'rebounds', 'assists', '3pm', 'pra', 'pr', 'pa', 'ra', 'minutes'], direction: 'UNKNOWN', detail: member.detail, counterarguments: member.counterarguments, reliability: 'LOW', correlationGroup: `participation.${member.playerId}` });
  const previous = input.previous && Date.parse(input.previous.asOf) <= Date.parse(asOf) ? input.previous : null;
  const output: NBAIntelligenceSnapshot = { schemaVersion: '1', sport: 'nba', snapshotId: digest(JSON.stringify([input.target.gameId, asOf, claims, evidence])), target: input.target, asOf, cutoff,
    claims, lineups: buildLineups(input.target, claims), coaching: buildCoaching(claims), changes: detectChanges(previous, claims, asOf, input.target.gameId),
    evidence, affectedTeammates: affected, marketViews: marketViews(evidence), coverage: { sourceIds: [...new Set(input.documents.map(document => document.sourceId))],
      missing: [...(input.missing ?? []), ...claims.filter(record => ['UNKNOWN', 'CONFLICTED', 'STALE'].includes(record.state)).flatMap(record => record.reasons),
        ...(!claims.length ? ['No verified applicable intelligence reports. Missing coverage does not imply availability.'] : []), 'Seed source registry is not complete 30-team coverage.'],
      refreshMode: 'MANUAL', lastAttemptAt: input.refresh?.lastAttemptAt ?? null, lastSuccessAt: input.refresh?.lastSuccessAt ?? null } };
  return freeze(JSON.parse(JSON.stringify(output)) as NBAIntelligenceSnapshot);
}