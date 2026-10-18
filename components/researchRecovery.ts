export interface ResearchScope {
  sport: string;
  date: string;
}

export interface ResearchEvidence {
  player: string;
  market: string;
  direction: string;
  line: number;
  book: string;
  odds: number;
  quotedAt: string;
}

export interface ResearchSnapshot {
  scope: ResearchScope;
  capturedAt: string;
  evidence: ResearchEvidence[];
}

export function canReuseResearchEvidence(previousScope: ResearchScope, nextScope: ResearchScope): boolean {
  return ['MLB', 'NFL', 'NBA'].includes(previousScope.sport)
    && /^\d{4}-\d{2}-\d{2}$/.test(previousScope.date)
    && previousScope.sport === nextScope.sport && previousScope.date === nextScope.date;
}

export function classifyEvidenceFreshness(timestamp: unknown, now: number): string {
  const quotedAt = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  return Number.isFinite(now) && Number.isFinite(quotedAt) && quotedAt <= now
    ? 'Expired or not reverified' : 'Timestamp unavailable';
}

export function isRecoverableResearchFailure(status: string): boolean {
  return ['HTTP_ERROR', 'CONNECTION_ERROR', 'PROVIDER_ERROR', 'RESEARCH_INCOMPLETE',
    'SPORTSBOOK_UNAVAILABLE', 'SPORTSBOOK_DATA_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED',
    'RESERVE_BLOCKED', 'BUDGET_LIMITED'].includes(status);
}

export function captureResearchEvidence(scope: ResearchScope, records: unknown[], now = Date.now()): ResearchSnapshot | null {
  if (!canReuseResearchEvidence(scope, scope) || !Number.isFinite(now)) return null;
  const evidence: ResearchEvidence[] = [];
  for (const value of records) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (record.sport != null && String(record.sport).toUpperCase() !== scope.sport) continue;
    if (record.priceCurrent !== true || record.pickTier === 'PASS'
      || !(record.eliteQualified === true || ['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN'].includes(String(record.pickTier)))) continue;
    if (typeof record.player !== 'string' || !record.player.trim()
      || typeof record.market !== 'string' || !record.market.trim()
      || !['over', 'under'].includes(String(record.direction))
      || typeof record.book !== 'string' || !record.book.trim()
      || typeof record.line !== 'number' || !Number.isFinite(record.line)
      || typeof record.odds !== 'number' || !Number.isFinite(record.odds) || Math.abs(record.odds) < 100
      || classifyEvidenceFreshness(record.retrievedAt, now) === 'Timestamp unavailable') continue;
    evidence.push({ player: record.player, market: record.market, direction: String(record.direction),
      line: record.line, book: record.book, odds: record.odds, quotedAt: new Date(String(record.retrievedAt)).toISOString() });
  }
  return evidence.length ? { scope: { ...scope }, capturedAt: new Date(now).toISOString(), evidence: evidence.slice(0, 15) } : null;
}

export function recoverResearchEvidence(snapshot: ResearchSnapshot | null, scope: ResearchScope, status: string): ResearchSnapshot | null {
  return snapshot && canReuseResearchEvidence(snapshot.scope, scope) && isRecoverableResearchFailure(status) ? snapshot : null;
}

export function resolveRecoverySessionId(previous: { scope: ResearchScope; id: string | null } | null,
  scope: ResearchScope, incoming: string | null | undefined, failed: boolean): string | null {
  if (incoming === null) return null;
  if (failed) return previous && canReuseResearchEvidence(previous.scope, scope) ? previous.id : null;
  return incoming ?? (previous && canReuseResearchEvidence(previous.scope, scope) ? previous.id : null);
}