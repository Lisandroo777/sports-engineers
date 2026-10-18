import { createElement } from 'react';

export type ResearchFailureOutcome = 'RESEARCH_INCOMPLETE' | 'CONNECTION_ERROR' | 'SLATE_COMPLETE'
  | 'NO_ELITE_RESULTS' | 'CLARIFY' | 'TEMP_UNAVAILABLE' | 'DATA_UNAVAILABLE' | 'STORAGE_UNAVAILABLE';

export function classifyResearchFailure(status: string, researchComplete?: boolean): ResearchFailureOutcome | null {
  if (status === 'RESEARCH_STORAGE_UNAVAILABLE') return 'STORAGE_UNAVAILABLE';
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

export function ResearchStorageUnavailablePanel({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return createElement('section', { role: 'status', className: 'border-y border-amber-400/25 py-4' },
    createElement('p', { className: 'text-sm font-bold text-amber-200' }, 'Research Storage Temporarily Unavailable'),
    createElement('p', { className: 'mt-2 text-sm text-slate-300' }, 'Sportsbook research could not be saved or restored. Previous quotes shown below are historical, not current recommendations.'),
    error && createElement('p', { className: 'mt-2 text-sm text-slate-400' }, error),
    createElement('button', { onClick: onRetry, className: 'mt-4 min-h-10 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 text-sm font-semibold text-amber-200' }, 'Try Again'),
  );
}