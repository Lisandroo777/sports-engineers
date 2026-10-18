import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canReuseResearchEvidence, captureResearchEvidence, classifyEvidenceFreshness,
  recoverResearchEvidence, resolveRecoverySessionId } from './researchRecovery';

const scope = { sport: 'NFL', date: '2026-10-18' };
const now = Date.parse('2026-10-18T15:00:00Z');
const record = { sport: 'NFL', player: 'Player', market: 'Passing yards', direction: 'over', line: 200.5,
  book: 'Book', odds: -110, retrievedAt: '2026-10-18T14:59:00Z', priceCurrent: true, eliteQualified: true,
  trueProbability: 90, edge: 30, pickTier: 'ELITE', ledgerReceipt: 'signed', candidateId: 'candidate' };

describe('scoped historical research recovery', () => {
  it('requires an exact supported sport/date scope', () => {
    expect(canReuseResearchEvidence(scope, scope)).toBe(true);
    expect(canReuseResearchEvidence(scope, { ...scope, sport: 'NBA' })).toBe(false);
    expect(canReuseResearchEvidence(scope, { ...scope, date: '2026-10-19' })).toBe(false);
    expect(canReuseResearchEvidence({ sport: 'ALL', date: scope.date }, { sport: 'ALL', date: scope.date })).toBe(false);
  });

  it.each(['MLB', 'NFL', 'NBA'])('captures only simplified %s quote evidence, never a signed receipt or recommendation', sport => {
    const snapshot = captureResearchEvidence({ ...scope, sport }, [{ ...record, sport }], now)!;
    expect(Object.keys(snapshot)).toEqual(['scope', 'capturedAt', 'evidence']);
    expect(snapshot.evidence).toEqual([{ player: 'Player', market: 'Passing yards', direction: 'over',
      line: 200.5, book: 'Book', odds: -110, quotedAt: '2026-10-18T14:59:00.000Z' }]);
  });

  it.each(['HTTP_ERROR', 'CONNECTION_ERROR', 'PROVIDER_ERROR', 'RESEARCH_INCOMPLETE', 'BUDGET_LIMITED'])('recovers same-scope evidence after %s only', status => {
    const snapshot = captureResearchEvidence(scope, [record], now);
    expect(recoverResearchEvidence(snapshot, scope, status)).toBe(snapshot);
    expect(recoverResearchEvidence(snapshot, { ...scope, sport: 'MLB' }, status)).toBeNull();
    expect(recoverResearchEvidence(snapshot, { ...scope, date: '2026-10-19' }, status)).toBeNull();
  });

  it.each(['NO_CANDIDATES', 'NO_ELITE_RESULTS', 'NO_GAMES', 'NO_GAMES_SCHEDULED', 'SLATE_COMPLETE', 'INVALID_DATE', 'MARKETS_NOT_POSTED'])('does not revive evidence for %s', status => {
    expect(recoverResearchEvidence(captureResearchEvidence(scope, [record], now), scope, status)).toBeNull();
  });

  it('never labels even a recent timestamp as current or LIVE', () => {
    expect(classifyEvidenceFreshness(record.retrievedAt, now)).toBe('Expired or not reverified');
    expect(classifyEvidenceFreshness('2000-01-01T00:00:00Z', now)).toBe('Expired or not reverified');
    for (const timestamp of [null, undefined, 'invalid', '2026-10-19T00:00:00Z']) {
      expect(classifyEvidenceFreshness(timestamp, now)).toBe('Timestamp unavailable');
    }
    expect(classifyEvidenceFreshness(record.retrievedAt, NaN)).toBe('Timestamp unavailable');
  });

  it('skips unknown, unqualified, stale-at-capture, malformed and mismatched records', () => {
    for (const value of [undefined, {}, { ...record, retrievedAt: undefined }, { ...record, retrievedAt: 'invalid' },
      { ...record, retrievedAt: '2026-10-19' }, { ...record, priceCurrent: false }, { ...record, pickTier: 'PASS' },
      { ...record, odds: NaN }, { ...record, line: Infinity }, { ...record, book: null }, { ...record, sport: 'NBA' }]) {
      expect(captureResearchEvidence(scope, [value], now)).toBeNull();
    }
  });

  it('preserves a same-scope session on failure but honors explicit null and never leaks scopes', () => {
    const previous = { scope, id: 'old-session' };
    expect(resolveRecoverySessionId(previous, scope, undefined, true)).toBe('old-session');
    expect(resolveRecoverySessionId(previous, scope, 'failed-session', true)).toBe('old-session');
    expect(resolveRecoverySessionId(previous, scope, null, true)).toBeNull();
    expect(resolveRecoverySessionId(previous, { ...scope, sport: 'MLB' }, undefined, true)).toBeNull();
    expect(resolveRecoverySessionId(previous, { ...scope, date: '2026-10-19' }, undefined, true)).toBeNull();
    expect(resolveRecoverySessionId(previous, scope, 'new-session', false)).toBe('new-session');
  });
});

describe('AI page recovery wiring', () => {
  const source = readFileSync(new URL('../app/ai/page.tsx', import.meta.url), 'utf8');
  const search = source.slice(source.indexOf('async function runSearch('), source.indexOf('function handleSubmit('));
  const historicalSection = source.slice(source.indexOf('<section aria-label="Previous research evidence"'), source.indexOf('</section>', source.indexOf('<section aria-label="Previous research evidence"')));

  it('clears official state and receipts before a request and in every recoverable failure path', () => {
    const start = search.slice(0, search.indexOf('let payload:'));
    for (const setter of ['setResults([])', 'setClosestMisses([])', 'setTotalMatched(0)', 'setLedgerReceipt(null)',
      'setGameResults([])', 'setNbaPresentation(null)', 'setSelectedIds(new Set())']) expect(start).toContain(setter);
    const failure = start.slice(start.indexOf('const recoverFailure'), start.indexOf('setRecoveredResearch(null)'));
    for (const setter of ['setResults([])', 'setGameResults([])', 'setModeledGames([])', 'setNbaPresentation(null)',
      'setMlbGameMarkets(null)', 'setLedgerReceipt(null)', 'setAgentMeta(null)']) expect(failure).toContain(setter);
    expect(search).toContain("recoverFailure('HTTP_ERROR', requestScope, payload.researchSessionId)");
    expect(search).toContain("recoverFailure('CONNECTION_ERROR')");
    expect(search).toContain('recoverFailure(recoveryStatus, responseScope, payload.researchSessionId)');
    expect(search).toContain('else lastVerifiedResearch.current = null');
  });

  it('renders only labelled quote evidence outside official cards, counts, selection and ledger handling', () => {
    expect(historicalSection).toContain('Previous research - refresh failed; not current recommendations');
    expect(historicalSection).toContain('Quote updated {evidence.quotedAt}');
    expect(historicalSection).toContain('classifyEvidenceFreshness(evidence.quotedAt, Date.parse(recoveredResearch.capturedAt))');
    expect(source).toContain('canReuseResearchEvidence(recoveredResearch.scope, { sport: finderSport, date: finderDate })');
    expect(historicalSection).not.toMatch(/LIVE|ELITE|trueProbability|edge|onClick|ledgerReceipt|candidateId|NBAPresentationCards|AddPick|totalMatched/);
    expect(search).toContain('setLedgerReceipt(structuredResults.length > 0 ? payload.ledgerReceipt ?? null : null)');
    expect(search).not.toContain('setLedgerReceipt(payload.ledgerReceipt ?? null)');
  });

  it('does not persist or restore the historical snapshot as official results', () => {
    const persistence = source.slice(source.indexOf('const session: PersistedAIFinderSession'), source.indexOf('// ── search'));
    expect(persistence).not.toMatch(/lastVerifiedResearch|recoveredResearch/);
    expect(persistence).toContain('canReuseResearchEvidence(researchSessionScope.current, { sport: finderSport, date: finderDate })');
    expect(search).toContain('researchSessionId: requestSessionId');
    expect(search).toContain('meta.sport ?? requestScope.sport');
    expect(search).toContain('meta.date : requestScope.date');
  });
});