export type ResearchFailureOutcome = 'RESEARCH_INCOMPLETE' | 'CONNECTION_ERROR' | 'SLATE_COMPLETE'
  | 'NO_ELITE_RESULTS' | 'CLARIFY' | 'TEMP_UNAVAILABLE' | 'DATA_UNAVAILABLE';

export function classifyResearchFailure(status: string, researchComplete?: boolean): ResearchFailureOutcome | null {
  if (status === 'RESEARCH_INCOMPLETE') return 'RESEARCH_INCOMPLETE';
  if (status === 'PROVIDER_ERROR') return 'CONNECTION_ERROR';
  if (status === 'SLATE_COMPLETE') return 'SLATE_COMPLETE';
  if (status === 'NO_GAMES' || status === 'NO_GAMES_SCHEDULED'
    || status === 'EVENT_LIST_REQUIRED' || status === 'NO_CACHED_SPORTSBOOK_DATA'
    || status === 'NO_SPORTSBOOK_DATA' || status === 'MARKETS_NOT_POSTED') return 'DATA_UNAVAILABLE';
  if (status === 'NO_CANDIDATES' || status === 'NO_ELITE_RESULTS') return 'NO_ELITE_RESULTS';
  if (status === 'INVALID_DATE' || status === 'NOT_FOUND') return 'CLARIFY';
  if (['SPORTSBOOK_DATA_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED', 'RESERVE_BLOCKED', 'BUDGET_LIMITED'].includes(status)) return 'TEMP_UNAVAILABLE';
  return researchComplete === false ? 'RESEARCH_INCOMPLETE' : null;
}