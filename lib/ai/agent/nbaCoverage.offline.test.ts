import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzePickCandidate } from '../eliteResearchFilter';
import { runNBAFinderDeepSearch, type NBACandidate, type NBAFinderSummary } from '../../finder/nbaEngine';
import { computeMarketMovement } from '../../finder/marketMovement';
import { buildNBAEliteCandidate } from '../../nba/research';
import { predictNBAMarket } from '../../nba/prediction/engine';
import { loadCachedNBAEventResearch } from '../../nba/prediction/gameLines/cachedEventResearch';
import type { NBAGameLogEntry } from '../../nba/types';
import { runAgentTurn } from './runner';
import { getResearchSession, saveResearchSession } from './sessionStore';
import { createAgentContext, executeTool } from './tools';

vi.mock('../../finder/nbaEngine', () => ({ runNBAFinderDeepSearch: vi.fn() }));
vi.mock('./sessionStore', () => ({ getResearchSession: vi.fn(), saveResearchSession: vi.fn() }));
vi.mock('../../nba/prediction/gameLines/cachedEventResearch', () => ({ loadCachedNBAEventResearch: vi.fn() }));

const date = '2026-01-21';
const timestamp = `${date}T19:30:00Z`;
const query = `Best NBA player props ${date}`;
const coverage: NonNullable<NBAFinderSummary['nbaGameCoverage']> = [
  { gameId: 'target-game', eventId: 'event-1', state: 'RESEARCHED' },
  { gameId: 'failed-game', eventId: 'event-2', state: 'PROVIDER_ERROR' },
];

function candidate(): NBACandidate {
  const logs: NBAGameLogEntry[] = Array.from({ length: 20 }, (_, index) => ({
    gameId: `history-${index}`, date: `2026-01-${String(index + 1).padStart(2, '0')}T18:00:00Z`,
    season: 2026, phase: 'REGULAR', round: null, opponent: 'Opponent', opponentAbbreviation: 'OPP',
    homeAway: 'home', result: 'W', stats: { points: index % 2 ? 22 : 28, minutes: 32, totalRebounds: 7, assists: 5 },
  }));
  const model = predictNBAMarket({ playerId: 10, teamId: 1, playerName: 'Fixture Player', market: 'points',
    targetPhase: 'REGULAR', targetSeason: 2026, targetGameId: 'target-game', targetTipoff: `${date}T20:00:00Z`,
    observations: logs.map(log => ({ log, season: 2026, phase: 'REGULAR', source: 'fixture' })),
    injury: 'REPORTED_AVAILABLE', line: 20.5, direction: 'over', americanOdds: -110, sportsbook: 'Fixture Book',
    quoteTimestamp: timestamp, oppositeQuote: { market: 'points', line: 20.5, direction: 'under', americanOdds: -110,
      sportsbook: 'Fixture Book', quoteTimestamp: timestamp } });
  const input = buildNBAEliteCandidate({ candidateId: 'good', playerId: 10, player: 'Fixture Player', market: 'points',
    line: 20.5, direction: 'over', projection: model.expectedStat, projectionUncertainty: model.statUncertainty, logs,
    matchupAvailable: true, injuryTier: 'ACTIVE', oddsAmerican: -110, lastUpdatedAt: timestamp,
    isAlternate: false, marketSupport: 'full', opponentContextAvailable: true });
  const analysis = analyzePickCandidate({ ...input, sampleSize: model.sampleSize,
    historicalRates: [model.historyRates.l5, model.historyRates.l10, model.historyRates.l20, model.historyRates.season]
      .map(rate => rate == null ? null : rate * 100), marketFairProbability: model.noVigMarketProbability,
    nbaProbabilityOverride: { over: model.probabilities!.over, under: model.probabilities!.under, push: model.probabilities!.push,
      expectedValuePercent: model.expectedValuePercent, fairAmericanOdds: model.fairAmericanOdds,
      noVigMarketProbability: model.noVigMarketProbability, eligibleForReview: model.eligibleForReview,
      modelVersion: model.modelVersion, validationStatus: model.validationStatus } });
  return { sport: 'nba', id: 'good', eventId: 'event-1', gameId: 'target-game', playerId: 10, playerName: 'Fixture Player',
    playerMatch: 'MATCHED', team: 'Home Team', opponent: 'Away Team', market: 'points', marketLabel: 'Points',
    historicalSupport: 'full', line: 20.5, side: 'over', book: 'Fixture Book', oddsAmerican: -110, isAlternate: false,
    priceTimestamp: timestamp, priceFreshness: 'FRESH', history: { supported: true, marketKey: 'points', line: 20.5,
      side: 'over', windows: {
        l5: { hits: 5, total: 5, rate: 100, mean: 25, median: 25 },
        l10: { hits: 10, total: 10, rate: 100, mean: 25, median: 25 },
        l20: { hits: 18, total: 20, rate: 90, mean: 25, median: 25 },
        season: { hits: 18, total: 20, rate: 90, mean: 25, median: 25 },
      } }, projection: { status: 'OK', projection: model.expectedStat, uncertainty: model.statUncertainty,
      sampleSize: model.sampleSize, reliability: model.reliability, reliabilityReasons: [], method: 'nba_model_v1', inputs: {} },
    injuryTier: 'ACTIVE', injuryEvidence: 'REPORTED_AVAILABLE', outlierDependency: null, alternateLines: null,
    crossBookThreshold: null, marketMovement: computeMarketMovement([]), howItLoses: ['Minutes and role can change.'],
    position: 'G', opponentContext: null, eliteAnalysis: analysis, nbaPrediction: model,
    researchContext: null, intelligenceSnapshot: null };
}

function summary(overrides: Partial<NBAFinderSummary> = {}): NBAFinderSummary {
  return { gamesScheduled: 2, gamesEligible: 2, gamesAnalyzed: 1, propsAnalyzed: 1, booksAnalyzed: 1,
    results: [], nbaCandidates: [candidate()], gameCandidates: [], modeledGames: [],
    fromCache: true, cacheAgeMs: 0, budgetLimited: false, partialCoverage: true, researchComplete: false,
    nbaGameCoverage: coverage, ...overrides } as NBAFinderSummary;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(timestamp));
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in NBA coverage tests'); }));
  vi.mocked(getResearchSession).mockResolvedValue(null);
  vi.mocked(saveResearchSession).mockResolvedValue('nba-coverage');
  vi.mocked(loadCachedNBAEventResearch).mockResolvedValue([]);
  vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(summary());
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('NBA runner coverage metadata (offline)', () => {
  it('persists partial coverage while retaining an independently qualified card', async () => {
    const result = await runAgentTurn([{ role: 'user', content: query }]);
    expect(result.results).toMatchObject([{ candidateId: 'good', pickTier: 'ELITE' }]);
    expect(result.meta).toMatchObject({ status: 'SUCCESS', partialCoverage: true, researchComplete: false,
      nbaGameCoverage: coverage, candidatesFound: 1 });
    expect(result.reply).toContain('partial coverage');
    expect(result.nbaPresentation?.recommendations).toMatchObject([{ candidateId: 'good' }]);
    expect(saveResearchSession).toHaveBeenCalledWith(expect.objectContaining({
      toolMeta: expect.objectContaining({ partialCoverage: true, researchComplete: false, nbaGameCoverage: coverage }),
    }));
  });

  it('keeps partial authoritative even when the summary claims completion', async () => {
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(summary({ researchComplete: true }));
    const result = await runAgentTurn([{ role: 'user', content: query }]);
    expect(result.meta).toMatchObject({ partialCoverage: true, researchComplete: false });
    expect(result.results).toHaveLength(1);
  });

  it('reuses the matching partial full pool without a refresh or new coverage gate', async () => {
    await runAgentTurn([{ role: 'user', content: query }]);
    const saved = vi.mocked(saveResearchSession).mock.calls[0][0];
    const original = structuredClone(saved);
    vi.mocked(getResearchSession).mockResolvedValue(saved);
    vi.mocked(runNBAFinderDeepSearch).mockClear();
    const result = await runAgentTurn([{ role: 'user', content: query }], 'nba-coverage');
    expect(result.results).toMatchObject([{ candidateId: 'good' }]);
    expect(result.meta).toMatchObject({ partialCoverage: true, researchComplete: false });
    expect(runNBAFinderDeepSearch).not.toHaveBeenCalled();
    expect(saved).toEqual(original);
  });

  it.each<{ status: string; overrides: Partial<NBAFinderSummary> }>([
    { status: 'NO_GAMES', overrides: { gamesScheduled: 0, gamesEligible: 0, nbaGameCoverage: [], partialCoverage: false, researchComplete: true } },
    { status: 'SLATE_COMPLETE', overrides: { gamesEligible: 0, slateComplete: true, nbaGameCoverage: [], partialCoverage: false, researchComplete: true } },
    { status: 'NO_SPORTSBOOK_DATA', overrides: { nbaGameCoverage: [{ ...coverage[0], state: 'NO_MARKETS' }] } },
    { status: 'PROVIDER_ERROR', overrides: { nbaGameCoverage: [{ ...coverage[0], state: 'PROVIDER_ERROR' }] } },
    { status: 'PROVIDER_ERROR', overrides: { gamesScheduled: 0, nbaGameCoverage: [],
      oddsSpend: { providerErrors: 1 } as NBAFinderSummary['oddsSpend'] } },
    { status: 'RESEARCH_INCOMPLETE', overrides: { budgetLimited: true, nbaGameCoverage: [{ ...coverage[0], state: 'BUDGET_BLOCKED' }] } },
    { status: 'RESEARCH_INCOMPLETE', overrides: { nbaGameCoverage: [{ ...coverage[0], state: 'NOT_FETCHED' }] } },
  ])('reports $status for zero evaluated candidates with $overrides', async ({ status, overrides }) => {
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(summary({ nbaCandidates: [], propsAnalyzed: 0,
      gamesAnalyzed: 0, ...overrides }));
    const result = await runAgentTurn([{ role: 'user', content: query }]);
    expect(result.meta).toMatchObject({ status, candidatesFound: 0, marketsEvaluated: 0,
      researchComplete: overrides.researchComplete === true });
    expect(result.results).toEqual([]);
    expect(result.nbaPresentation).toBeDefined();
    expect(result.reply).not.toMatch(/Found \d+ qualified/);
    if (status === 'NO_GAMES' || status === 'SLATE_COMPLETE') expect(result.reply).not.toMatch(/unavailable|provider/i);
  });

  it('keeps presentation-only research separate from evaluated sportsbook candidates', async () => {
    const unclassified = { ...candidate(), playerMatch: 'UNMATCHED' as const, eliteAnalysis: null };
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(summary({ nbaCandidates: [unclassified],
      nbaGameCoverage: [{ ...coverage[0], state: 'NO_MARKETS' }] }));
    const result = await runAgentTurn([{ role: 'user', content: query }]);
    expect(result.results).toEqual([]);
    expect(result.nbaPresentation?.picks).toHaveLength(1);
    expect(result.meta).toMatchObject({ status: 'NO_SPORTSBOOK_DATA', candidatesFound: 0,
      marketsEvaluated: 0, partialCoverage: true, researchComplete: false });
    expect(result.reply).not.toMatch(/passed the existing publication requirements|Found \d+ qualified/);
  });

  it('retains a completed full slate and its qualified result', async () => {
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(summary({ partialCoverage: false, researchComplete: true,
      nbaGameCoverage: coverage.map(game => ({ ...game, state: 'RESEARCHED' })) }));
    const result = await runAgentTurn([{ role: 'user', content: query }]);
    expect(result.results).toHaveLength(1);
    expect(result.meta).toMatchObject({ status: 'SUCCESS', researchComplete: true, partialCoverage: false });
    expect(result.reply).not.toContain('partial coverage');
  });
});

describe('NBA generic tool coverage metadata (offline)', () => {
  it('returns and persists partial metadata without dropping the available candidate', async () => {
    const context = createAgentContext();
    context.pendingQueryIntent = query;
    const result = await executeTool('get_sportsbook_candidates', { sport: 'nba', date }, context);
    expect(result).toMatchObject({ status: 'SUCCESS', partialCoverage: true, researchComplete: false,
      nbaGameCoverage: coverage, candidatesFound: 1 });
    expect(context.researchSession?.candidates).toMatchObject([{ candidateId: 'good' }]);
    expect(context.researchSession?.toolMeta).toMatchObject({ nbaGameCoverage: coverage,
      partialCoverage: true, researchComplete: false });
    const calls = vi.mocked(runNBAFinderDeepSearch).mock.calls.length;
    const reused = await executeTool('get_sportsbook_candidates', { sport: 'nba', date }, context);
    expect(reused).toMatchObject({ reusedExistingSession: true, partialCoverage: true, researchComplete: false });
    expect(runNBAFinderDeepSearch).toHaveBeenCalledTimes(calls);
  });

  it.each([true, false])('forwards completion=%s and the same coverage from the summary', async complete => {
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(summary({ partialCoverage: !complete, researchComplete: true }));
    const result = await executeTool('get_sportsbook_candidates', { sport: 'nba', date }, createAgentContext());
    expect(result).toMatchObject({ status: 'SUCCESS', nbaGameCoverage: coverage,
      partialCoverage: !complete, researchComplete: complete });
  });
});