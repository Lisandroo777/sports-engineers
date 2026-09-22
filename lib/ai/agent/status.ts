/**
 * Typed outcomes shared by every AI-callable tool. The model decides what to do next from
 * `status`, so these must stay mutually exclusive and never collapse into a generic failure.
 */
export type ToolStatus =
  | 'SUCCESS'
  | 'NO_SPORTSBOOK_DATA'
  | 'NO_CACHED_SPORTSBOOK_DATA'
  | 'STALE_SPORTSBOOK_DATA'
  | 'SPORTSBOOK_DATA_REQUIRED'
  | 'EVENT_LIST_REQUIRED'
  | 'PAID_REFRESH_NOT_AUTHORIZED'
  | 'RESERVE_BLOCKED'
  | 'NO_CANDIDATES'
  | 'NO_ELITE_RESULTS'
  | 'PROJECTION_UNAVAILABLE'
  | 'BUDGET_LIMITED'
  | 'PROVIDER_ERROR'
  | 'INVALID_DATE'
  | 'SPORT_UNAVAILABLE'
  | 'SLATE_COMPLETE'
  | 'NOT_FOUND';

export interface ToolMetadata {
  status: ToolStatus;
  sport?: string;
  date?: string;
  gamesFound?: number;
  gamesScheduled?: number;
  booksFound?: number;
  propsFound?: number;
  candidatesFound?: number;
  eliteFound?: number;
  cached?: boolean;
  /** True when the answer came from an already-stored research session, so no slate work or paid call occurred. */
  reusedExistingSession?: boolean;
  /** Why a refresh was blocked, when one was. */
  blockReason?: 'RESERVE' | 'NOT_AUTHORIZED' | 'VALIDATION_CREDIT_CAP' | null;
  sportsbookPreflight?: {
    eligibleGames: number;
    matchedEvents: number;
    selectedValidationGames: number;
    cacheHits: number;
    cacheMisses: number;
    estimatedPaidSubRequests: number;
    estimatedCreditCostLow: number | null;
    estimatedCreditCostExpected: number | null;
    estimatedCreditCostHigh: number | null;
    estimatedCostStatus?: 'KNOWN' | 'UNKNOWN_UNTIL_EVENT_LIST';
    preflightState?: 'NO_SCHEDULE' | 'EVENT_LIST_REQUIRED' | 'EVENT_MATCH_FAILED' | 'SPORTSBOOK_DATA_REQUIRED' | 'READY';
    eventListDates?: string[];
    paidRefreshAuthorized: boolean;
  } | null;
  dataFreshnessSeconds?: number | null;
  budgetLimited?: boolean;
  /** Provider-spend observability for this tool call's underlying sportsbook data load. */
  oddsSpend?: {
    creditsBefore: number | null;
    creditsAfter: number | null;
    creditsSpent: number;
    paidRequestsMade: number;
    cacheHits: number;
    staleCacheHits: number;
    cacheMisses: number;
  } | null;
  /** Human-readable explanation the model may quote when status is not SUCCESS. */
  error?: string;
}

export type ToolResult<T> = ToolMetadata & { data?: T };

export function ok<T>(data: T, meta: Omit<ToolMetadata, 'status'> = {}): ToolResult<T> {
  return { status: 'SUCCESS', ...meta, data };
}

export function fail<T = never>(status: ToolStatus, error: string, meta: Omit<ToolMetadata, 'status' | 'error'> = {}): ToolResult<T> {
  return { status, error, ...meta };
}
