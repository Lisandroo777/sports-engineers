import type { LineupIntelligence, TargetEvent, VerifiedClaim } from './types';

export function buildLineups(target: TargetEvent, claims: VerifiedClaim[]): LineupIntelligence[] {
  return [target.homeTeamId, target.awayTeamId].map(teamId => {
    const stale = claims.filter(record => record.claim.teamId === teamId && ['LINEUP', 'STARTING_ROLE'].includes(record.claim.topic) && record.state === 'STALE');
    const applicable = claims.filter(record => record.claim.teamId === teamId && ['LINEUP', 'STARTING_ROLE'].includes(record.claim.topic) && ['CURRENT', 'CONFLICTED'].includes(record.state));
    const confirmed = applicable.filter(record => record.claim.topic === 'LINEUP' && record.state === 'CURRENT' && record.verification === 'OFFICIAL'
      && record.claim.lineupLevel === 'OFFICIALLY_CONFIRMED' && new Set(record.claim.playerIds).size === 5 && record.claim.playerIds.length === 5);
    const reported = applicable.filter(record => record.claim.topic === 'LINEUP' && record.state === 'CURRENT' && ['ATTRIBUTED_REPORT', 'CORROBORATED', 'OFFICIAL'].includes(record.verification)
      && record.claim.lineupLevel === 'REPORTED' && new Set(record.claim.playerIds).size === 5 && record.claim.playerIds.length === 5);
    const projected = applicable.filter(record => record.claim.topic === 'LINEUP' && record.claim.lineupLevel === 'PROJECTED' && record.state === 'CURRENT' && record.verification === 'SPECULATION'
      && new Set(record.claim.playerIds).size === 5 && record.claim.playerIds.length === 5);
    const chosen = confirmed.length ? confirmed : reported.length ? reported : projected;
    const lists = new Set(chosen.map(record => [...record.claim.playerIds].sort((first, second) => first - second).join(':')));
    const injured = claims.filter(record => record.claim.teamId === teamId && record.claim.topic === 'INJURY' && ['CURRENT', 'CONFLICTED'].includes(record.state));
    const selected = chosen[0]?.claim.playerIds ?? [];
    const incompatible = injured.some(record => record.claim.value === 'OUT' && record.claim.playerIds.some(id => selected.includes(id)) && ['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED', 'CONFLICTED'].includes(record.verification));
    const conflicted = lists.size > 1 || applicable.some(record => record.state === 'CONFLICTED') || incompatible;
    return { teamId, level: conflicted ? 'UNKNOWN' : confirmed.length ? 'OFFICIALLY_CONFIRMED' : reported.length ? 'REPORTED' : projected.length ? 'PROJECTED' : 'UNKNOWN',
      state: conflicted ? 'CONFLICTED' : chosen.length ? 'CURRENT' : stale.length ? 'STALE' : 'UNKNOWN', playerIds: conflicted ? [] : selected,
      partialStarterIds: [...new Set(applicable.filter(record => record.claim.topic === 'STARTING_ROLE' && record.state === 'CURRENT' && ['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED'].includes(record.verification) && record.claim.value === 'STARTER').flatMap(record => record.claim.playerIds))],
      supportingClaimIds: [...new Set([...chosen, ...applicable.filter(record => record.claim.topic === 'STARTING_ROLE'), ...(!chosen.length ? stale : [])].map(record => record.claim.id))],
      unresolvedPlayerIds: [...new Set(injured.filter(record => record.state === 'CONFLICTED' || ['QUESTIONABLE', 'DOUBTFUL', 'UNKNOWN'].includes(record.claim.value)).flatMap(record => record.claim.playerIds).filter(id => selected.includes(id)))],
      reasons: conflicted ? ['Conflicting lineup or injury evidence; no confirmed starting five can be asserted.'] : chosen.length ? ['Announced starting role does not guarantee minutes or full-game participation.'] : stale.length ? ['Only stale lineup statements are available; no current starting five asserted.'] : ['No valid complete target-game starting five. Historical starts do not fill this gap.'] };
  });
}