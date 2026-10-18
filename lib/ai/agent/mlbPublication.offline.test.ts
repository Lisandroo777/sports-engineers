import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinderResult } from '../../finder/engine';
import type { MLBContextEvidence, MLBResearchContext } from '../../mlb/researchContext';
import { getMarketMetadata } from '../../odds/types';
import { analyzePickCandidate, finderResultToEliteCandidate } from '../eliteResearchFilter';
import { buildResearchSession, type ResearchCandidateRecord } from './session';
import { classifyPickTier } from './pickTiers';
import { selectRankedCandidates } from './tools';

const now = '2026-10-16T12:00:00.000Z';
const fetchMock = vi.fn(() => { throw new Error('Network forbidden in MLB publication tests'); });

function available<Value>(value: Value): MLBContextEvidence<Value> {
  return { status: 'AVAILABLE', value, source: 'Offline MLB publication fixture', retrievedAt: now,
    sourceTimestamp: now, dataQualityNote: 'Synthetic source evidence' };
}

function unavailable<Value>(): MLBContextEvidence<Value> {
  return { status: 'UNAVAILABLE', value: null, source: null, retrievedAt: now,
    sourceTimestamp: null, dataQualityNote: 'Not supplied by fixture' };
}

function context(overrides: Partial<MLBResearchContext> = {}): MLBResearchContext {
  return {
    gameId: 'game-1', retrievedAt: now, sourceTimestamp: now,
    sources: ['Offline MLB publication fixture'], dataQualityNote: 'Synthetic facts only',
    gameStatus: unavailable(), probablePitchers: { home: unavailable(), away: unavailable() },
    confirmedLineups: { home: available([{ id: 100, fullName: 'Fixture Player', battingOrder: 1 }]), away: unavailable() },
    playerInjuries: available([{ playerId: 100, name: 'Fixture Player', code: 'A', description: 'Active', explicitlyInjured: false }]),
    weather: unavailable(), venue: unavailable(), bullpenWorkload: unavailable(),
    ...overrides,
  };
}

function result(overrides: Partial<FinderResult> = {}): FinderResult {
  return {
    sport: 'mlb', id: 'mlb-publication', player: 'Fixture Player', playerId: 100,
    teamId: 147, teamName: 'New York Yankees', opponentTeamId: 111, opponentName: 'Boston Red Sox',
    homeAway: 'home', gameTimeIso: '2026-10-16T19:00:00Z', gameId: 'game-1', eventId: 'event-1',
    marketLabel: 'Hits', marketKey: 'batter_hits', line: 0.5, side: 'over', isAlternate: false,
    bestBook: { sportsbookName: 'Fixture Book', odds: -110 }, availableBooks: 3,
    evPercent: 30, projection: 1.8, projectionUncertainty: 0.6, finderScore: 95, grade: null,
    historical: { l5: '5/5', l10: '9/10', l20: '18/20', l40: '36/40', season: '27/30',
      l5Rate: 100, l10Rate: 90, l20Rate: 90, seasonRate: 90 },
    signals: [], concerns: [], marketUpdatedAt: now, matchupEvidenceAvailable: true, mlbContext: context(),
    marketMovement: { available: false, direction: 'unavailable', openingOdds: null, currentOdds: null,
      observedOverMinutes: null, pointCount: 0, label: null },
    outlierDependency: { available: true, sampleGames: 20, raw: { games: 20, total: 36, mean: 1.8 },
      withoutTopGame: { games: 19, total: 33, mean: 1.74 }, withoutTop2Games: { games: 18, total: 30, mean: 1.67 },
      explosiveDependencePercent: 8.3, median: 2, standardDeviation: 0.6 },
    volumeEfficiency: { available: true, basis: 'plate_appearances', estimatedVolume: 4,
      requiredRatePerUnit: 0.125, actualRatePerUnit: 0.45, meetsRequiredRate: true },
    alternateLineOptimizer: { available: false, side: 'over', options: [], recommended: null },
    crossBookThreshold: { available: true, standardLines: [{ line: 0.5, books: ['Fixture Book'] }], discrepancy: false, spread: 0 },
    howItLoses: [], sources: ['Offline MLB publication fixture'],
    ...overrides,
  };
}

function session(results: FinderResult[]) {
  return buildResearchSession({ sport: 'mlb', date: '2026-10-16', queryIntent: 'Best MLB props', results,
    toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: results.length, booksFound: 3,
      candidatesFound: results.length, cached: false, dataFreshnessSeconds: 0, budgetLimited: false } });
}

function select(candidates: ResearchCandidateRecord[], query = 'Best MLB props') {
  return selectRankedCandidates(candidates, query, { sport: 'mlb' }).selected;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MLB source eligibility at publication (offline)', () => {
  it.each([
    ['injury', 'MLB player explicitly injured', () => context({ playerInjuries: available([
      { playerId: 100, name: 'Fixture Player', code: 'D10', description: 'Injured list', explicitlyInjured: true },
    ]) })],
    ['team mismatch', 'MLB player team mismatch', () => context({ player: {
      teamMembership: available({ currentTeamId: 999, scheduledTeamIds: [147, 111], matchesScheduledTeam: false }),
      scheduledStarter: unavailable(),
    } })],
    ['lineup exclusion', 'MLB player absent from confirmed batting order', () => context({
      confirmedLineups: { home: available([{ id: 200, fullName: 'Other Player', battingOrder: 1 }]), away: unavailable() },
    })],
  ] as const)('keeps high-quality %s rejections PASS through ranked selection', (_label, reason, makeContext) => {
    const source = result({ mlbContext: makeContext() });
    const analysis = analyzePickCandidate(finderResultToEliteCandidate(source));
    expect(analysis.qualification).toBe('REJECT');
    expect(analysis.dataQuality).toBeGreaterThanOrEqual(70);
    expect(analysis.valueQualified).toBe(true);
    expect(analysis.rawEdge).toBeGreaterThan(0);
    const [record] = session([source]).candidates;
    expect(record.mlbEligibilityFailures).toContain(reason);
    expect(record.pickTier).toBe('PASS');
    expect(record.tierRequirementsFailed).toContain(reason);
    expect(select([record])).toEqual([]);
    const revived = { ...record, pickTier: 'ELITE' as const, qualification: 'ELITE', eliteQualified: true, researchScore: 100 };
    expect(select([revived])).toEqual([]);
    expect(select([revived], 'Show rejected MLB props')[0]?.pickTier).toBe('PASS');
  });

  it('preserves eligible publication, numeric scores, and session ordering', () => {
    const sources = [result({ id: 'first' }), result({ id: 'second', projection: 1.5 })];
    const expected = sources.map(source => ({ id: source.id, analysis: analyzePickCandidate(finderResultToEliteCandidate(source)) }))
      .sort((first, second) => second.analysis.researchScore - first.analysis.researchScore);
    const records = session(sources).candidates;
    expect(records.map(record => record.candidateId)).toEqual(expected.map(entry => entry.id));
    expect(records.map(record => record.researchScore)).toEqual(expected.map(entry => entry.analysis.researchScore));
    expect(records.map(record => record.rank)).toEqual([1, 2]);
    expect(records[0].mlbEligibilityFailures).toEqual([]);
    expect(records[0].pickTier).not.toBe('PASS');
    expect(select(records)).toHaveLength(2);
  });

  it.each([[74, 'LEAN'], [75, 'EDGE'], [84, 'EDGE'], [85, 'SHARP']] as const)(
    'preserves the %s score boundary as %s for eligible MLB', (researchScore, pickTier) => {
      const [record] = session([result()]).candidates;
      expect(classifyPickTier({ ...record, eliteQualified: false, researchScore }, 'mlb').pickTier).toBe(pickTier);
    });

  it.each(['batter_stolen_bases', 'pitcher_walks', 'unknown_market'])('blocks unsupported history for %s even with attractive numbers', marketKey => {
    expect(getMarketMetadata(marketKey)?.historicalAnalysisAvailable ?? false).toBe(false);
    const [record] = session([result({ marketKey })]).candidates;
    expect(record.pickTier).toBe('PASS');
    expect(record.tierRequirementsFailed).toContain('MLB market has supported historical analysis');
    expect(select([record])).toEqual([]);
  });

  it.each([
    { projection: null },
    { historical: { l5: '0/0', l10: '0/0', l20: '0/0', l40: '0/0', season: '0/0',
      l5Rate: null, l10Rate: null, l20Rate: null, seasonRate: null } },
  ])('does not publish missing model or history (%j)', overrides => {
    const [record] = session([result(overrides)]).candidates;
    expect(record.pickTier).toBe('PASS');
    expect(select([record])).toEqual([]);
  });

  it('preserves the valid Poisson model when count-market uncertainty is absent', () => {
    const [record] = session([result({ projectionUncertainty: null })]).candidates;
    expect(record.modelProbability).toBeGreaterThan(0);
    expect(record.pickTier).not.toBe('PASS');
  });

  it.each([null, NaN, Infinity])('does not revive a saved record without a valid model probability (%s)', modelProbability => {
    const [record] = session([result()]).candidates;
    expect(select([{ ...record, modelProbability }])).toEqual([]);
  });

  it('rechecks explicit injury in legacy cached records without the new optional fields', () => {
    const [record] = session([result()]).candidates;
    delete record.mlbEligibilityFailures;
    delete record.mlbEligibilityFacts;
    expect(select([record])).toHaveLength(1);
    record.mlbContext = context({ playerInjuries: available([
      { playerId: 100, name: 'Fixture Player', code: 'D10', description: 'Injured list', explicitlyInjured: true },
    ]) });
    expect(classifyPickTier(record, 'mlb').pickTier).toBe('PASS');
    expect(select([record])).toEqual([]);
    record.mlbContext = context({ playerInjuries: available([
      { playerId: 200, name: 'Other Player', code: 'D10', description: 'Injured list', explicitlyInjured: true },
    ]) });
    expect(select([record])).toHaveLength(1);
  });

  it.each([false, true])('uses actual role and matchup evidence, not identities (available=%s)', evidenceAvailable => {
    const [record] = session([result({ mlbContext: evidenceAvailable ? context() : context({
      confirmedLineups: { home: unavailable(), away: unavailable() }, playerInjuries: unavailable(),
    }), matchupEvidenceAvailable: evidenceAvailable })]).candidates;
    expect(record.mlbEligibilityFacts).toEqual({ roleKnown: evidenceAvailable, statusKnown: evidenceAvailable, matchupAvailable: evidenceAvailable });
    for (const signal of ['Expected Role', 'Opponent Matchup']) {
      const entries = record.evidenceBoard.filter(entry => entry.signal === signal);
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe(evidenceAvailable ? 'agree' : 'unavailable');
      expect(entries[0].detail).not.toContain('identity');
    }
  });

  it.each(['nfl', 'nba'])('does not apply MLB-only source, market, or model gates to %s', sport => {
    const [record] = session([result()]).candidates;
    const sourceRejected = { ...record, mlbEligibilityFailures: ['MLB player explicitly injured'], marketKey: 'unknown_market', modelProbability: null };
    expect(classifyPickTier(sourceRejected, sport)).toEqual(classifyPickTier(record, sport));
  });
});