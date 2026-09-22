export interface ResearchTarget {
  playerId?: number | string | null;
  opportunityId?: string | null;
  /** Canonical market key (e.g. batter_home_runs) to deep-link to the exact prop that was clicked. */
  market?: string | null;
  /** Defaults to 'mlb' for backwards compatibility with existing MLB call sites. */
  sport?: 'mlb' | 'nfl' | 'nba';
  /** Slate date (YYYY-MM-DD) the opportunity belongs to — omit to link to today. */
  date?: string | null;
}

export function getResearchHref({ playerId, opportunityId, market, sport = 'mlb', date }: ResearchTarget) {
  const params = new URLSearchParams();
  if (market) params.set('market', market);
  if (date) params.set('date', date);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  if (playerId != null && String(playerId).trim()) {
    if (sport === 'nfl') return `/research/nfl/${playerId}${suffix}`;
    // No NBA player detail route exists yet — link to the research index rather than an MLB-shaped 404.
    if (sport === 'nba') return `/research${suffix}`;
    return `/research/live-${playerId}${suffix}`;
  }

  return opportunityId ? `/research/${opportunityId}${suffix}` : '/research';
}

