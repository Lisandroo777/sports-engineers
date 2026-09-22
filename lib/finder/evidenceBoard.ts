export type EvidenceStatus = 'agree' | 'disagree' | 'unavailable';

export interface EvidenceEntry {
  signal: string;
  status: EvidenceStatus;
  detail: string;
}

/**
 * Names every signal the philosophy calls for, whether or not DeepSide has a real source for it.
 * Signals with no connected data source are always marked 'unavailable' — never guessed.
 *
 * The optional params (added Phase 3) let NFL/NBA report their own Opportunity/Outlier/Price
 * Value/Cross-Book/Market Movement evidence. They default to unavailable so MLB's existing call
 * (which doesn't pass them) is byte-for-byte unchanged.
 */
export function buildEvidenceBoard(params: {
  side: 'over' | 'under';
  rawEdge: number | null;
  l10Rate: number | null;
  seasonRate: number | null;
  matchupAvailable: boolean;
  roleKnown: boolean;
  sport: string;
  opportunityStatus?: 'agree' | 'disagree' | 'unavailable';
  opportunityDetail?: string;
  outlierDependencePercent?: number | null;
  injuryKnown?: boolean;
  priceValueAvailable?: boolean;
  priceValueDetail?: string;
  crossBookDiscrepancy?: boolean | null;
  marketMovementAvailable?: boolean;
}): EvidenceEntry[] {
  const { rawEdge, l10Rate, seasonRate, matchupAvailable, roleKnown, sport } = params;

  return [
    {
      signal: 'Projection vs Line',
      status: rawEdge != null ? (rawEdge > 0 ? 'agree' : 'disagree') : 'unavailable',
      detail: rawEdge != null ? `Edge of ${rawEdge.toFixed(2)} in the recommended direction` : 'Projection unavailable',
    },
    {
      signal: 'Recent Form (L10)',
      status: l10Rate != null ? (l10Rate >= 50 ? 'agree' : 'disagree') : 'unavailable',
      detail: l10Rate != null ? `${l10Rate}% hit rate over the last 10 games` : 'Unavailable',
    },
    {
      signal: 'Long-Term Baseline (Season)',
      status: seasonRate != null ? (seasonRate >= 50 ? 'agree' : 'disagree') : 'unavailable',
      detail: seasonRate != null ? `${seasonRate}% season hit rate` : 'Unavailable',
    },
    { signal: 'Opponent Matchup', status: matchupAvailable ? 'agree' : 'unavailable', detail: matchupAvailable ? 'Matchup data available' : 'Unavailable' },
    { signal: 'Expected Role', status: roleKnown ? 'agree' : 'unavailable', detail: roleKnown ? 'Player identity and role confirmed' : 'Unavailable' },
    { signal: 'Injury Cascade', status: params.injuryKnown ? 'agree' : 'unavailable', detail: params.injuryKnown ? 'Real injury status checked for this player' : `Injury-chain tracking is not connected for ${sport.toUpperCase()}.` },
    { signal: 'Film / Scouting', status: 'unavailable', detail: 'No film or scouting data source is connected.' },
    { signal: 'Trench Matchup (OL/DL)', status: 'unavailable', detail: sport === 'nfl' ? 'OL/DL matchup data is not connected.' : 'Not applicable to this sport.' },
    { signal: 'Game Script', status: 'unavailable', detail: 'Team totals/spreads are not connected, so game-script weighting is unavailable.' },
    { signal: 'Opportunity/Workload', status: params.opportunityStatus ?? 'unavailable', detail: params.opportunityDetail ?? 'Unavailable' },
    {
      signal: 'Outlier Dependence',
      status: params.outlierDependencePercent != null ? (params.outlierDependencePercent < 35 ? 'agree' : 'disagree') : 'unavailable',
      detail: params.outlierDependencePercent != null ? `Best single recent game accounts for ${params.outlierDependencePercent}% of production` : 'Unavailable',
    },
    { signal: 'Price Value', status: params.priceValueAvailable ? 'agree' : 'unavailable', detail: params.priceValueDetail ?? 'Unavailable' },
    {
      signal: 'Cross-Book Market',
      status: params.crossBookDiscrepancy == null ? 'unavailable' : params.crossBookDiscrepancy ? 'disagree' : 'agree',
      detail: params.crossBookDiscrepancy == null ? 'Unavailable' : params.crossBookDiscrepancy ? 'Books disagree on the standard line' : 'Books agree on the standard line',
    },
    { signal: 'Market Movement', status: params.marketMovementAvailable ? 'agree' : 'unavailable', detail: params.marketMovementAvailable ? 'Timestamped price history available' : 'No timestamped price-snapshot history is recorded for this sport yet.' },
  ];
}
