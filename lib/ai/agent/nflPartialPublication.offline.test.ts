import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzePickCandidate } from '../eliteResearchFilter';
import { runNFLFinderDeepSearch, type NFLFinderSummary } from '../../finder/nflEngine';
import { finishNFLSlateLedger, type NFLGameLedger } from '../../nfl/slateLedger';
import { buildResearchSessionFromCandidates, type GenericResearchCandidate } from './session';
import { getResearchSession, saveResearchSession } from './sessionStore';
import { createAgentContext, executeTool } from './tools';
import { rankCachedSession, resolveStructuredResults, runAgentTurn, toClientResult, type AgentTurnResult } from './runner';

vi.mock('../../finder/nflEngine', () => ({ runNFLFinderDeepSearch: vi.fn() }));
vi.mock('./sessionStore', () => ({ getResearchSession: vi.fn(), saveResearchSession: vi.fn() }));

const date = '2026-10-18';
const now = Date.parse(`${date}T12:00:00Z`);
const timestamp = new Date(now).toISOString();
const market = 'player_pass_yds';

function ledger() {
  return finishNFLSlateLedger({ sport: 'nfl', date, requestedMarkets: [market, 'player_pass_attempts'],
    games: Array.from({ length: 12 }, (_, index): NFLGameLedger => ({
      gameId: `game-${index}`, eventId: `event-${index}`, matchup: 'Las Vegas Raiders @ Kansas City Chiefs',
      kickoff: `${date}T20:00:00Z`, eligibility: 'PREGAME', state: index < 10 ? 'RESEARCHED' : 'FAILED',
      returnedMarkets: index < 10 ? [market] : [], zeroMarkets: index < 10 ? ['player_pass_attempts'] : [],
      failedMarkets: index < 10 ? [] : [market, 'player_pass_attempts'], retrievedAt: timestamp,
      expiresAt: now + 600000, failure: index < 10 ? null : 'TIMEOUT', propsEvaluated: index < 10 ? 1 : 0, fromCache: true,
    })) });
}

function candidate(candidateId = 'good', gameIndex = 0): GenericResearchCandidate {
  const analysis = analyzePickCandidate({
    candidateId, sport: 'nfl', playerId: 1, player: 'Patrick Mahomes', market,
    line: 244.5, direction: 'over', isAlternate: false, projection: 300, projectionUncertainty: 40,
    historicalRates: Array(10).fill(100), sampleSize: 10, oddsAmerican: -110, marketFairProbability: null,
    matchupAvailable: true, usageAvailable: true, roleKnown: true, gameContextAvailable: true,
    opponentPersonnelAvailable: false, marketConfirmationAvailable: true, statusKnown: true, lastUpdatedAt: timestamp,
    requiredMarketSupported: true, marketSupport: 'SUPPORTED', unsupportedSignals: ['projectionAgreement', 'opponentPersonnel'],
  });
  return {
    candidateId, playerId: 1, player: 'Patrick Mahomes', team: 'Kansas City Chiefs', opponent: 'Las Vegas Raiders',
    marketLabel: 'Passing Yards', marketKey: market, line: 244.5, direction: 'over', book: 'Fixture', odds: -110,
    projection: 300, projectionUncertainty: 40, l5Rate: 100, l10Rate: 100, l20Rate: null, seasonRate: 100,
    analysis, sport: 'nfl', sampleSize: 10, retrievedAt: timestamp, gameId: `game-${gameIndex}`, eventId: `event-${gameIndex}`,
    injuryContext: { player: { player: 'Patrick Mahomes', playerId: 1, teamId: 12, team: 'Kansas City Chiefs', position: 'QB',
      injury: null, status: 'Active', availabilityDesignation: 'CONFIRMED_AVAILABLE', sourceStatus: 'CURRENT', updatedAt: timestamp,
      evidence: null, affectedRole: 'PLAYER', missingFields: [] }, team: 'Kansas City Chiefs', teammateAbsences: [], opponentAbsences: [],
    sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: timestamp, missingFields: [] },
    nflResearchProfile: {
      hardGates: Object.fromEntries(['currentPrice', 'majorInjuryResolved', 'roleClear', 'requiredDataPresent', 'currentLineReEvaluated',
        'footballThesisExplained', 'sourceConflictsResolved', 'projectionAdvantage', 'priceValueRemains', 'evidenceQuality']
        .map((key) => [key, { passed: true, reason: null }])),
      productionEliteQualified: analysis.eliteQualified,
      evidence: { verdict: 'PLAY', counterCaseReviewed: true, conflictStatus: 'NONE', for: [{}], against: [{}], unresolvedRisks: [] },
      role: { value: { roleStatus: 'STABLE' } },
    } as never,
  };
}

function session(candidates = [candidate(), candidate('badElite', 10)]) {
  return buildResearchSessionFromCandidates({ sport: 'nfl', date, queryIntent: 'Best NFL props', candidates,
    toolMeta: { gamesFound: 10, gamesScheduled: 12, propsFound: 10, booksFound: 1, candidatesFound: candidates.length,
      cached: true, dataFreshnessSeconds: 0, budgetLimited: false, researchComplete: false, partialCoverage: true, nflLedger: ledger() } });
}

function response(saved = session()): AgentTurnResult {
  return { reply: 'Research complete.', results: saved.candidates, closestMisses: saved.candidates,
    meta: { ...saved.toolMeta, sport: 'nfl' }, toolTrace: [], researchSessionId: 'partial' };
}

function summary(): NFLFinderSummary {
  return { gamesScheduled: 12, gamesEligible: 12, gamesAnalyzed: 10, propsAnalyzed: 10, booksAnalyzed: 1,
    fromCache: true, cacheAgeMs: 0, budgetLimited: false, results: [], nflLedger: ledger(),
    nflCandidates: [candidate(), candidate('badElite', 10)].map((generic) => ({
      ...generic, id: generic.candidateId, playerName: generic.player, market, side: generic.direction, oddsAmerican: generic.odds,
      playerMatch: 'MATCHED', eliteAnalysis: generic.analysis, projection: { projection: 300, uncertainty: 40, reliability: 'HIGH' },
      history: { gamesUsed: 10, mean: 300, median: 300, stdDev: 40,
        windows: { l5: { hitRate: 100 }, l10: { hitRate: 100 }, season: { hitRate: 100 } },
        splits: { home: { hitRate: 100 }, away: { hitRate: 100 } } },
      roleContext: { status: 'STABLE', reasons: [], evidence: [], unavailableEvidence: [] },
      marketMovement: { available: false }, howItLoses: [],
    })) } as unknown as NFLFinderSummary;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in partial NFL tests'); }));
  vi.mocked(saveResearchSession).mockResolvedValue('partial');
  vi.mocked(getResearchSession).mockResolvedValue(null);
  vi.mocked(runNFLFinderDeepSearch).mockResolvedValue(summary());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('partial NFL publication (offline)', () => {
  it.each([true, false])('publishes only independently qualified complete-game cards in production=%s', (production) => {
    const saved = session();
    expect(saved.candidates.every((row) => row.eliteQualified)).toBe(true);
    const result = toClientResult(response(saved), production);
    expect(result.results).toMatchObject([{ candidateId: 'good' }]);
    expect(result.closestMisses).toEqual([]);
    expect(result.meta).toMatchObject({ researchComplete: false, partialCoverage: true,
      nflLedger: { researchedGames: 10, eligiblePregame: 12, failedGames: 2 } });
    expect(result.reply).toBe('Partial NFL coverage: 10/12 pregame games researched. Only independently qualified picks from fully researched games are shown.');
    const clientLedger = result.meta!.nflLedger as ReturnType<typeof ledger>;
    expect(clientLedger.games[0]).toMatchObject({ returnedMarkets: [market], zeroMarkets: ['player_pass_attempts'],
      failedMarkets: [], retrievedAt: timestamp, expiresAt: now + 600000 });
    expect(clientLedger.games[10]).toMatchObject({ failure: 'TIMEOUT', failedMarkets: [market, 'player_pass_attempts'] });
    expect(clientLedger.games[0]).not.toHaveProperty('eventId');
    expect(saved.toolMeta.nflLedger!.games[0].eventId).toBe('event-0');
  });

  it('filters before cached ranking and structured selection without mutating or reloading', () => {
    const saved = session();
    const original = structuredClone(saved);
    const ranked = rankCachedSession(saved, 'Best NFL props', 'partial');
    expect(ranked?.results).toMatchObject([{ candidateId: 'good' }]);
    expect(resolveStructuredResults(saved.candidates, true, saved, 'Best NFL props')).toMatchObject([{ candidateId: 'good' }]);
    expect(resolveStructuredResults([], false, saved, 'Best NFL props')).toMatchObject([{ candidateId: 'good' }]);
    expect(saved).toEqual(original);
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['missing ledger', 'duplicate game', 'stale ledger', 'stale candidate', 'wrong event', 'missing market', 'failed market', 'started game'])
  ('fails closed for %s', (failure) => {
    const saved = session([candidate()]);
    const game = saved.toolMeta.nflLedger!.games[0];
    if (failure === 'missing ledger') delete saved.toolMeta.nflLedger;
    if (failure === 'duplicate game') saved.toolMeta.nflLedger!.games.push({ ...game });
    if (failure === 'stale ledger') { game.retrievedAt = new Date(now - 7200000).toISOString(); game.expiresAt = now - 1; }
    if (failure === 'stale candidate') saved.candidates[0].retrievedAt = new Date(now - 7200000).toISOString();
    if (failure === 'wrong event') saved.candidates[0].eventId = 'event-10';
    if (failure === 'missing market') game.zeroMarkets = [];
    if (failure === 'failed market') game.failedMarkets = ['player_pass_attempts'];
    if (failure === 'started game') game.kickoff = new Date(now - 1).toISOString();
    expect(toClientResult(response(saved)).results).toEqual([]);
    expect(resolveStructuredResults(saved.candidates, false, saved, 'Best NFL props')).toEqual([]);
    expect(rankCachedSession(saved, 'Best NFL props', null)).toBeNull();
  });

  it('does not fabricate a recommendation when the complete-game candidate fails quality', () => {
    const saved = session();
    saved.candidates[0].nflResearchProfile!.hardGates.currentPrice = { passed: false, reason: 'Stale price.' };
    const result = toClientResult(response(saved));
    expect(result.results).toEqual([]);
    expect(result.reply).not.toMatch(/Research complete|Only independently qualified picks/);
    expect(result.meta).toMatchObject({ researchComplete: false, partialCoverage: true });
  });

  it('loads, saves, and ranks only own-game-safe candidates, clearing the incomplete context flag', async () => {
    const context = createAgentContext();
    context.pendingQueryIntent = 'Best NFL props';
    context.nflResearchIncomplete = true;
    const loaded = await executeTool('get_sportsbook_candidates', { sport: 'nfl', date }, context);
    expect(loaded).toMatchObject({ status: 'SUCCESS', researchComplete: false, partialCoverage: true, candidatesFound: 1 });
    expect(context.nflResearchIncomplete).toBe(false);
    expect(context.researchSession?.candidates).toMatchObject([{ candidateId: 'good' }]);
    expect(saveResearchSession).toHaveBeenCalledOnce();
    const ranked = await executeTool('rank_candidates', { sport: 'nfl', date }, context);
    expect(ranked).toMatchObject({ status: 'SUCCESS', data: { results: [{ candidateId: 'good' }] } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains RESEARCH_INCOMPLETE and clears the session when no game-safe candidates exist', async () => {
    const run = summary();
    run.nflLedger!.games[0].failedMarkets = [market];
    vi.mocked(runNFLFinderDeepSearch).mockResolvedValue(run);
    const context = createAgentContext();
    const loaded = await executeTool('get_sportsbook_candidates', { sport: 'nfl', date }, context);
    expect(loaded.status).toBe('RESEARCH_INCOMPLETE');
    expect(context.researchSession).toBeNull();
    expect(context.nflResearchIncomplete).toBe(true);
    expect(saveResearchSession).not.toHaveBeenCalled();
  });

  it('runs deterministic NFL intent through final partial filtering', async () => {
    const result = toClientResult(await runAgentTurn([{ role: 'user', content: `Best NFL props ${date}` }], null, null, { sport: 'nfl', date }));
    expect(result.results).toMatchObject([{ candidateId: 'good' }]);
    expect(result.meta).toMatchObject({ researchComplete: false, partialCoverage: true });
    expect(result.reply).toContain('Partial NFL coverage: 10/12');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ranks cached partial intent from a filtered copy without provider calls', async () => {
    const saved = session();
    const original = structuredClone(saved);
    vi.mocked(getResearchSession).mockResolvedValue(saved);
    const result = toClientResult(await runAgentTurn([{ role: 'user', content: `Best NFL props ${date}` }], 'partial', null, { sport: 'nfl', date }));
    expect(result.results).toMatchObject([{ candidateId: 'good' }]);
    expect(result.reply).toContain('Partial NFL coverage: 10/12');
    expect(saved).toEqual(original);
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});