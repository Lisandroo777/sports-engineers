import { claimKey } from './claims';
import { digest } from './documents';
import type { IntelligenceChange, NBAIntelligenceSnapshot, VerifiedClaim } from './types';

export function detectChanges(previous: NBAIntelligenceSnapshot | null | undefined, claims: VerifiedClaim[], detectedAt: string, gameId: string): IntelligenceChange[] {
  if (!previous || previous.target.gameId !== gameId) return [];
  const groups = new Map<string, VerifiedClaim[]>();
  for (const record of claims.filter(record => record.state !== 'AFTER_CUTOFF' && record.state !== 'SUPERSEDED')) groups.set(claimKey(record.claim), [...(groups.get(claimKey(record.claim)) ?? []), record]);
  const changes: IntelligenceChange[] = [];
  for (const [key, records] of groups) {
    const before = previous.claims.filter(record => claimKey(record.claim) === key && record.state !== 'AFTER_CUTOFF' && record.state !== 'SUPERSEDED');
    const first = records[0];
    const values = (items: VerifiedClaim[]) => [...new Set(items.map(record => `${record.claim.value}:${record.claim.lineupLevel}:${record.claim.playerIds.join(',')}`))].sort().join('|');
    const status = (items: VerifiedClaim[]) => [...new Set(items.map(record => `${record.state}:${record.verification}`))].sort().join('|');
    const type = records.some(record => record.claim.correctionOf && before.some(prior => prior.claim.id === record.claim.correctionOf)) ? 'CORRECTION'
      : records.some(record => record.state === 'CONFLICTED') && !before.some(record => record.state === 'CONFLICTED') ? 'CONFLICT'
      : records.every(record => record.state === 'STALE') && !before.every(record => record.state === 'STALE') ? 'STALE'
      : !before.length ? 'NEW' : values(before) !== values(records) ? 'VALUE_CHANGED' : status(before) !== status(records) ? 'VERIFICATION_CHANGED' : null;
    if (!type) continue;
    changes.push({ id: digest(`${gameId}:${key}:${type}:${records.map(record => record.claim.id).sort()}:${detectedAt}`), type, topic: first.claim.topic, teamId: first.claim.teamId,
      playerIds: [...new Set(records.flatMap(record => record.claim.playerIds))], previousClaimIds: before.map(record => record.claim.id), currentClaimIds: records.map(record => record.claim.id),
      detectedAt, eventAt: records.map(record => record.claim.statementAt ?? record.claim.reportedAt).filter((at): at is string => at != null).sort().at(-1) ?? null,
      priority: ['INJURY', 'LINEUP', 'MINUTES_RESTRICTION'].includes(first.claim.topic) ? 'CRITICAL' : ['STARTING_ROLE', 'ROTATION', 'ROLE'].includes(first.claim.topic) ? 'IMPORTANT' : 'INFO',
      detail: `${type}: ${first.claim.topic}. Detection is between collected snapshots, not continuous monitoring; verification and conflicts remain visible.` });
  }
  const beforeLineups = previous.lineups;
  const currentLineups = claims.filter(record => record.claim.topic === 'LINEUP' && record.state === 'CURRENT');
  for (const team of beforeLineups.filter(lineup => lineup.playerIds.length === 5)) {
    const current = currentLineups.filter(record => record.claim.teamId === team.teamId);
    if (current.length === 1 && [...current[0].claim.playerIds].sort().join(':') !== [...team.playerIds].sort().join(':') && !changes.some(change => change.topic === 'LINEUP' && change.teamId === team.teamId)) {
      changes.push({ id: digest(`lineup:${team.teamId}:${current[0].claim.id}:${detectedAt}`), type: 'VALUE_CHANGED', topic: 'LINEUP', teamId: team.teamId,
        playerIds: [...new Set([...team.playerIds, ...current[0].claim.playerIds])], previousClaimIds: team.supportingClaimIds, currentClaimIds: current.map(record => record.claim.id), detectedAt, eventAt: current[0].claim.reportedAt,
        priority: 'CRITICAL', detail: 'Starting-five membership differs between collected reports; not a guaranteed minutes change.' });
    }
  }
  return changes;
}