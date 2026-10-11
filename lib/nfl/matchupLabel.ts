export type NFLMatchupLabel = 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE' | 'PARTIAL DATA' | 'UNAVAILABLE';

export function nflMatchupLabel(context: { status?: string; assessment?: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE' } | null | undefined): NFLMatchupLabel {
  if (!context || context.status === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (context.status === 'PARTIAL') return 'PARTIAL DATA';
  if (context.status !== 'AVAILABLE') return 'UNAVAILABLE';
  return context.assessment ?? 'NEUTRAL';
}