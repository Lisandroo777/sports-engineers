import type { NBAResearchContext } from '../context/types';
import type { NBAIntelligenceSnapshot, VerifiedClaim } from './types';

export function affectedTeammates(claims: VerifiedClaim[], contexts: readonly NBAResearchContext[], gameId: string, cutoff: string): NBAIntelligenceSnapshot['affectedTeammates'] {
  const output: NBAIntelligenceSnapshot['affectedTeammates'] = [];
  for (const report of claims.filter(record => record.state === 'CURRENT' && ['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED'].includes(record.verification)
    && record.claim.topic === 'INJURY' && ['OUT', 'DOUBTFUL', 'QUESTIONABLE'].includes(record.claim.value))) {
    for (const context of contexts.filter(context => context.gameId === gameId && context.teamId === report.claim.teamId && Date.parse(context.asOf) <= Date.parse(cutoff) && Date.parse(context.cutoff) <= Date.parse(cutoff))) {
      for (const edge of context.sections.injuryNetwork.edges.filter(edge => report.claim.playerIds.includes(edge.teammateId))) {
        const evidence = context.evidence.filter(evidence => edge.evidenceIds.includes(evidence.id) && evidence.kind === 'DERIVED' && evidence.value != null && evidence.sample != null);
        if (!evidence.length) continue;
        const restrictions = claims.filter(record => record.state === 'CURRENT' && record.claim.topic === 'MINUTES_RESTRICTION' && record.claim.playerIds.includes(context.playerId));
        output.push({ playerId: context.playerId, unavailableTeammateId: edge.teammateId, claimId: report.claim.id, contextEvidenceIds: evidence.map(evidence => evidence.id),
          detail: `Existing measured cohorts link this player to teammate ${edge.teammateId}; any relevance is conditional on actual nonparticipation. No automatic redistribution or player boost.`,
          counterarguments: [...edge.confounders, ...(restrictions.length ? ['A current restriction may invalidate historical opportunity comparisons.'] : []), 'Current lineup, opponent and coaching decisions may differ from the measured cohort.'] });
      }
    }
  }
  return output;
}