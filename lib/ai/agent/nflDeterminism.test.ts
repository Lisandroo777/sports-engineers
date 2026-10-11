import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgentTurn, toClientResult } from './runner';
import { runNFLFinderDeepSearch } from '../../finder/nflEngine';
import { getNFLInjurySnapshot } from '../../nfl/injuries';
import { analyzePickCandidate, type EliteCandidateInput } from '../eliteResearchFilter';
import { createHash } from 'node:crypto';

vi.mock('../../finder/nflEngine', () => ({ runNFLFinderDeepSearch: vi.fn() }));
vi.mock('./sessionStore', async () => {
  const sessions = new Map();
  return { getResearchSession: vi.fn().mockResolvedValue(null), saveResearchSession: vi.fn(async (session) => { sessions.set('session', session); return 'session'; }) };
});
vi.mock('../../nfl/injuries', async (importOriginal) => ({ ...await importOriginal<typeof import('../../nfl/injuries')>(), getNFLInjurySnapshot: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('normal NFL agent underlying-result determinism', () => {
  it('five identical snapshot requests produce one best-price Elite play, not two book picks', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const input: EliteCandidateInput = { candidateId: 'one', sport: 'nfl', playerId: 1, player: 'Tyler Shough', market: 'player_pass_yds', line: 254.5, direction: 'over',
      isAlternate: false, projection: 310, projectionUncertainty: 40, historicalRates: [90, 90, 90], sampleSize: 10,
      oddsAmerican: -113, marketFairProbability: null, matchupAvailable: true, usageAvailable: true, roleKnown: true, gameContextAvailable: true,
      opponentPersonnelAvailable: false, marketConfirmationAvailable: true, statusKnown: true, lastUpdatedAt: new Date().toISOString(),
      requiredMarketSupported: true, marketSupport: 'SUPPORTED', unsupportedSignals: ['projectionAgreement', 'opponentPersonnel'] };
    const profile = {
      hardGates: Object.fromEntries(['currentPrice', 'majorInjuryResolved', 'roleClear', 'requiredDataPresent', 'currentLineReEvaluated',
        'footballThesisExplained', 'sourceConflictsResolved', 'projectionAdvantage', 'priceValueRemains', 'evidenceQuality']
        .map((key) => [key, { passed: true, reason: null }])),
      productionEliteQualified: true,
      evidence: { verdict: 'PLAY', counterCaseReviewed: true, conflictStatus: 'NONE', for: [{}], against: [{}], unresolvedRisks: [] },
      role: { value: { roleStatus: 'STABLE' } },
    } as never;
    const window = { games: 10, gamesConsidered: 10, missing: 0, hits: 9, misses: 1, pushes: 0, decisions: 10, hitRate: 90 };
    const history = { gamesUsed: 10, mean: 300, median: 300, stdDev: 20, windows: { l3: window, l5: window, l10: window, season: window, rolling: window }, splits: { home: window, away: window } };
    const candidate = { id: 'one', playerName: input.player, playerId: 1, gameId: 'game', eventId: 'event', teamId: 18, playerMatch: 'MATCHED',
      team: 'New Orleans Saints', opponent: 'Atlanta Falcons', market: 'player_pass_yds', marketLabel: 'Passing Yards', line: 254.5, side: 'over', book: 'FanDuel', oddsAmerican: -113,
      injuryContext: { player: { player: input.player, playerId: 1, teamId: 18, team: 'New Orleans Saints', position: 'QB', injury: null, status: 'Active',
        availabilityDesignation: 'CONFIRMED_AVAILABLE', updatedAt: new Date().toISOString(), sourceStatus: 'CURRENT', evidence: null, affectedRole: 'PLAYER', missingFields: [] },
        team: 'New Orleans Saints', teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: new Date().toISOString(), missingFields: [] },
      eliteAnalysis: analyzePickCandidate(input), projection: { projection: 310, uncertainty: 40 },
      history, nflResearchProfile: profile,
      roleContext: { status: 'STABLE', requirement: 'IMPORTANT', reasons: [], opportunity: {}, evidence: [], unavailableEvidence: [] },
      marketMovement: { available: false }, howItLoses: ['Older comparable history supplements the current season.'] };
    const preflight = { validationPreflight: { games: [{ gameId: 'game', matchup: 'Atlanta Falcons @ New Orleans Saints', eventId: 'event' }] } };
    const summary = { gamesAnalyzed: 1, gamesEligible: 1, gamesScheduled: 1, propsAnalyzed: 2, booksAnalyzed: 2, fromCache: true,
      nflLedger: { eligiblePregame: 1, researchComplete: true, games: [{ gameId: 'game', matchup: 'Atlanta Falcons @ New Orleans Saints', kickoff: '2026-10-06T00:15:00Z', eligibility: 'PREGAME', state: 'RESEARCHED' }] }, nflCandidates: [candidate,
        { ...candidate, id: 'two', book: 'BetMGM', oddsAmerican: -115, eliteAnalysis: analyzePickCandidate({ ...input, candidateId: 'two', oddsAmerican: -115 }) }] };
    vi.mocked(runNFLFinderDeepSearch).mockImplementation(async (_date, options) => (options?.preflight ? preflight : summary) as never);
    const digests: string[] = [];
    for (let run = 0; run < 5; run++) {
      const result = toClientResult(await runAgentTurn([{ role: 'user', content: 'Give me the best NFL passing props Falcons vs Saints today' }]), false);
      expect(result.results).toHaveLength(1);
      const pick = result.results[0] as { book: string; odds: number; availablePrices: unknown[]; eliteQualified: boolean };
      expect(pick.book).toBe('FanDuel'); expect(pick.odds).toBe(-113); expect(pick.availablePrices).toHaveLength(2); expect(pick.eliteQualified).toBe(true);
      expect(result.meta?.eliteFound).toBe(1);
      digests.push(createHash('sha256').update(JSON.stringify(result.results)).digest('hex'));
    }
    expect(new Set(digests).size).toBe(1);
    expect(getNFLInjurySnapshot).not.toHaveBeenCalled();
  });
});