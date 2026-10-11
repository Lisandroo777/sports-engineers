import type { NBAMarket } from '../context/types';
import type { IntelligenceEvidence, NBAIntelligenceSnapshot, VerifiedClaim } from './types';

export const MARKETS: NBAMarket[] = ['points', 'rebounds', 'assists', '3pm', 'pra', 'pr', 'pa', 'ra', 'steals', 'blocks', 'turnovers', 'minutes'];
const components: Partial<Record<NBAMarket, NBAMarket[]>> = { pra: ['points', 'rebounds', 'assists'], pr: ['points', 'rebounds'], pa: ['points', 'assists'], ra: ['rebounds', 'assists'] };
export function marketEvidence(claims: VerifiedClaim[]): IntelligenceEvidence[] {
  const retained = claims.filter(record => record.state !== 'AFTER_CUTOFF' && record.state !== 'SUPERSEDED');
  const byId = new Map(retained.map(record => [record.claim.id, record]));
  const copies = retained.filter(record => record.claim.originalClaimId != null && byId.has(record.claim.originalClaimId)
    && record.claim.value === byId.get(record.claim.originalClaimId)!.claim.value && record.claim.topic === byId.get(record.claim.originalClaimId)!.claim.topic
    && record.claim.gameId === byId.get(record.claim.originalClaimId)!.claim.gameId && record.claim.teamId === byId.get(record.claim.originalClaimId)!.claim.teamId
    && [...record.claim.playerIds].sort().join(':') === [...byId.get(record.claim.originalClaimId)!.claim.playerIds].sort().join(':') && record.state === byId.get(record.claim.originalClaimId)!.state);
  const copiedIds = new Set(copies.map(record => record.claim.id));
  const common: IntelligenceEvidence[] = retained.filter(record => !copiedIds.has(record.claim.id)).map(record => {
    const eligible = record.state === 'CURRENT' && ['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED'].includes(record.verification);
    const restriction = record.claim.topic === 'MINUTES_RESTRICTION';
    const role = ['LINEUP', 'STARTING_ROLE', 'ROTATION', 'ROLE'].includes(record.claim.topic);
    const direction = !eligible ? 'UNKNOWN' : record.claim.topic === 'INJURY' && record.claim.value === 'OUT' || restriction && record.claim.value !== 'NO_RESTRICTION' ? 'OPPOSING' : role && record.claim.value === 'STARTER' ? 'SUPPORTING' : 'NEUTRAL';
    const detail = !eligible ? `This ${record.verification.toLowerCase()} report is ${record.state.toLowerCase()}; no current opportunity conclusion.`
      : restriction && record.claim.value === 'NO_RESTRICTION' ? 'A reported absence of a minutes restriction does not guarantee normal minutes or a stable role.'
      : restriction ? 'A verified report of a restriction is negative participation/opportunity evidence for minutes-dependent markets; the stated plan is not a guaranteed realized limit.'
      : record.claim.topic === 'INJURY' && record.claim.value === 'OUT' ? 'Verified target-game OUT designation opposes participation-dependent opportunity; no probability or teammate benefit is calculated.'
      : role ? 'Verified reported role/lineup information is relevant to participation and opportunity. Starting does not by itself establish increased minutes, shots, assists or rebounds.'
      : 'Current reported information supplies participation context; numerical market effects remain unavailable.';
    return { id: `intelligence.${record.claim.id}`, kind: eligible ? 'FACT' : 'UNAVAILABLE', claimIds: [record.claim.id, ...copies.filter(copy => copy.claim.originalClaimId === record.claim.id).map(copy => copy.claim.id)], contextEvidenceIds: [],
      markets: MARKETS, direction, detail,
      counterarguments: ['Points/threes also require observed attempts; role announcements do not guarantee shot allocation.', 'Rebounds require rebound opportunity and lineup context; assists require creation responsibility and teammate conversion.',
        'Intent can change before tip-off; questionable status is not nonparticipation.', ...(record.reasons.length ? record.reasons : [])],
      reliability: eligible ? record.verification === 'OFFICIAL' ? 'HIGH' : 'MEDIUM' : 'UNKNOWN', correlationGroup: `participation.${record.claim.teamId}.${record.claim.playerIds.join(':')}` };
  });
  const rules: Array<{ market: NBAMarket; detail: string; counterargument: string }> = [
    { market: 'points', detail: 'A participation/role development could change scoring opportunity, but points require measured minutes, FGA/FTA and scoring matchup. No usage or shot-volume increase is inferred from a start alone.', counterargument: 'A starter can keep the same minutes or attempts; efficiency, opponent defense and teammates can offset opportunity.' },
    { market: 'rebounds', detail: 'A participation/lineup development could change time on court and rebounding role. Rebound chances, lineup size and opponent miss profile are not supplied by the news statement.', counterargument: 'An absent center does not automatically give another player rebounds; assignments and actual missed shots matter.' },
    { market: 'assists', detail: 'A verified creation-role statement may be relevant to assists, but a teammate absence or new starting role alone does not prove ball-handling redistribution or potential assists.', counterargument: 'Fewer available finishers or changed rotation can counteract any possible creation opportunity; use measured cohorts, not position assumptions.' },
    { market: '3pm', detail: 'A reported minutes/role change could affect floor time for threes, but 3PA and spacing/lineup responsibilities require independent observed evidence.', counterargument: 'A start or coach comment about shooting does not guarantee three-point attempts, accuracy or a perimeter role.' },
  ];
  return [...common, ...common.flatMap(entry => rules.map(rule => ({ ...entry, id: `${entry.id}.${rule.market}`, kind: entry.kind === 'FACT' ? 'INFERENCE' as const : 'UNAVAILABLE' as const,
    markets: [rule.market], direction: entry.direction === 'OPPOSING' ? 'OPPOSING' as const : entry.direction === 'UNKNOWN' ? 'UNKNOWN' as const : 'NEUTRAL' as const,
    reliability: entry.kind === 'FACT' ? 'LOW' as const : 'UNKNOWN' as const,
    detail: rule.detail, counterarguments: [...entry.counterarguments, rule.counterargument] })))];
}

export function marketViews(evidence: IntelligenceEvidence[]): NBAIntelligenceSnapshot['marketViews'] {
  return Object.fromEntries(MARKETS.map(market => {
    const supported = new Set([market, ...(components[market] ?? [])]);
    const selected = evidence.filter(entry => entry.markets.some(market => supported.has(market)));
    return [market, { evidenceIds: [...new Set(selected.map(entry => entry.id))], groupedEvidence: Object.fromEntries([...new Set(selected.map(entry => entry.correlationGroup))].map(group => [group, selected.filter(entry => entry.correlationGroup === group).map(entry => entry.id)])) }];
  })) as NBAIntelligenceSnapshot['marketViews'];
}