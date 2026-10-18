import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNFLFinderDeepSearch } from '../finder/nflEngine';
import { getPlayerGameLogs } from './stats';
import { getNFLInjurySnapshot } from './injuries';
import { getNFLSportsbookEvents, retrieveNFLSportsbookGame } from './sportsbook';
import { getNFLSchedule } from './schedule';
import { searchNFLPlayers } from './players';
import { getNFLParticipationSnapshot } from './participation';
import { buildResearchSessionFromCandidates } from '../ai/agent/session';
import type { NFLGameLogEntry } from './types';
import { getNFLNewsSnapshot } from './intelligence';
import { getNFLOpponentDefenseGames } from './opponentContext';

vi.mock('./schedule', () => ({ getNFLSchedule: vi.fn().mockResolvedValue([{
  id: 'game', gameTime: '2026-10-11T17:00:00Z', completed: false,
  homeTeam: { id: 12, displayName: 'Kansas City Chiefs' }, awayTeam: { id: 13, displayName: 'Las Vegas Raiders' },
}]) }));
vi.mock('./players', () => ({ searchNFLPlayers: vi.fn().mockResolvedValue([{ id: 1, name: 'Test QB', position: 'QB', team: { id: 12, displayName: 'Kansas City Chiefs' } }]) }));
vi.mock('./stats', async (importOriginal) => ({ ...await importOriginal<typeof import('./stats')>(), getPlayerGameLogs: vi.fn() }));
vi.mock('./injuries', async (importOriginal) => ({ ...await importOriginal<typeof import('./injuries')>(), getNFLInjurySnapshot: vi.fn() }));
vi.mock('./opponentContext', () => ({ getNFLOpponentDefenseGames: vi.fn().mockResolvedValue([]), buildNFLOpponentContext: vi.fn().mockReturnValue({ status: 'PARTIAL', sampleSize: 10 }) }));
vi.mock('./weather', () => ({ getNFLWeatherContext: vi.fn().mockResolvedValue({ sourceStatus: 'NOT_APPLICABLE' }) }));
vi.mock('./participation', async (importOriginal) => ({ ...await importOriginal<typeof import('./participation')>(), getNFLParticipationSnapshot: vi.fn().mockResolvedValue(null) }));
vi.mock('./intelligence', () => ({
  getNFLNewsSnapshot: vi.fn().mockResolvedValue({ status: 'AVAILABLE', fetchedAt: '2026-10-05T12:00:00Z', windowStart: '2026-09-28T12:00:00Z', articles: [], missingFields: [] }),
  buildNFLPlayerIntelligence: vi.fn().mockReturnValue([]),
}));
vi.mock('./sportsbook', () => ({ getNFLSportsbookEvents: vi.fn().mockResolvedValue([{ id: 'event', homeTeam: 'Kansas City Chiefs', awayTeam: 'Las Vegas Raiders', commenceTime: '2026-10-11T17:00:00Z' }]), retrieveNFLSportsbookGame: vi.fn(), inspectNFLSportsbookCoverage: vi.fn().mockResolvedValue({ state: 'CACHE_MISSING', missingMarkets: 11 }), classifyNFLProviderFailure: vi.fn().mockReturnValue('NETWORK') }));
vi.mock('../odds/client', () => ({
  beginOddsSpendTrackingAsync: vi.fn(), getActiveOddsSpendTracker: vi.fn().mockReturnValue(null),
  withAutomaticOddsRefresh: vi.fn((work: () => unknown) => work()),
  getOddsEventsForSport: vi.fn().mockResolvedValue([{ id: 'event', homeTeam: 'Kansas City Chiefs', awayTeam: 'Las Vegas Raiders', commenceTime: '2026-10-11T17:00:00Z' }]),
  getDiscoveredEventPlayerProps: vi.fn(), getLastOddsCreditInfo: vi.fn().mockReturnValue(null),
  inspectEventPlayerPropsCacheState: vi.fn(), isPaidRefreshAllowed: vi.fn().mockReturnValue(false),
  OddsBudgetGuardError: class extends Error {}, OddsRefreshNotAuthorizedError: class extends Error {},
}));

function games(count: number, season: number, teamId = 12): NFLGameLogEntry[] {
  return Array.from({ length: count }, (_, index) => ({ gameId: `${season}-${index}`, season, teamId, position: 'QB', week: index + 1,
    date: `${season}-09-${String(index + 1).padStart(2, '0')}`, opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W',
    stats: { passingAttempts: 35, passingYards: 300 + index * 2 },
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T15:00:00Z'));
  vi.clearAllMocks();
  vi.mocked(getNFLParticipationSnapshot).mockResolvedValue(null as never);
  vi.mocked(getNFLSchedule).mockResolvedValue([{ id: 'game', gameTime: '2026-10-11T17:00:00Z', completed: false,
    homeTeam: { id: 12, displayName: 'Kansas City Chiefs' }, awayTeam: { id: 13, displayName: 'Las Vegas Raiders' } } as never]);
  vi.mocked(getNFLSportsbookEvents).mockResolvedValue([{ id: 'event', homeTeam: 'Kansas City Chiefs', awayTeam: 'Las Vegas Raiders', commenceTime: '2026-10-11T17:00:00Z' }]);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network disabled in NFL Stage 2 tests')));
  vi.mocked(retrieveNFLSportsbookGame).mockResolvedValue({ complete: true, failure: null, fromCache: true, requestedMarkets: ['player_pass_yds'], returnedMarkets: ['player_pass_yds'], zeroMarkets: [], failedMarkets: [], retrievedAt: new Date().toISOString(), expiresAt: Date.now() + 300000,
    props: [{ player: 'Test QB', marketKey: 'player_pass_yds', line: 244.5, overOdds: -110, underOdds: null,
      sportsbookKey: 'fixture', sportsbookName: 'Fixture Book', eventId: 'event', lastUpdate: new Date().toISOString(), isAlternate: false, retrievedAt: new Date().toISOString() } as never] });
  vi.mocked(getPlayerGameLogs).mockImplementation(async (_player, season) => games(season === 2026 ? 4 : 17, season!));
  vi.mocked(getNFLInjurySnapshot).mockResolvedValue({ reports: [], complete: true, fetchedAt: new Date().toISOString(), sourceStatus: 'CURRENT' });
});

describe('Stage 3 complete NFL slate research', () => {
  it('runs deep news enrichment only for explicit Deep shortlisted candidates', async () => {
    const standard = await runNFLFinderDeepSearch('2026-10-11', { lowThreshold: true });
    expect(standard.nflCandidates[0].nflResearchProfile?.researchMode).toBe('STANDARD');
    expect(standard.nflCandidates[0].nflResearchProfile?.matchupModel).toMatchObject({ modelVersion: 'nfl_matchup_efficiency_v1', efficiencyAdjustment: 0 });
    expect(standard.nflCandidates[0].projection?.projection).toBe(standard.nflCandidates[0].nflResearchProfile?.matchupModel?.phase2Projection);
    expect(standard.nflCandidates[0].nflResearchProfile?.gameEnvironmentModel).toMatchObject({ modelVersion: 'nfl_game_environment_v1', researchMode: 'STANDARD', volumeAdjustment: 0, scenarios: [] });
    expect(getNFLNewsSnapshot).not.toHaveBeenCalled();
    const deep = await runNFLFinderDeepSearch('2026-10-11', { researchMode: 'DEEP', lowThreshold: true });
    expect(deep.nflCandidates[0].nflResearchProfile?.researchMode).toBe('DEEP');
    expect(deep.nflCandidates[0].nflResearchProfile?.gameEnvironmentModel?.scenarios).toHaveLength(3);
    expect(getNFLNewsSnapshot).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not enrich a low-threshold candidate that fails the relative line preference', async () => {
    const summary = await runNFLFinderDeepSearch('2026-10-11', { researchMode: 'DEEP', lowThreshold: true });
    const candidate = summary.nflCandidates[0];
    expect(candidate.projection).not.toBeNull();
    const retrieval = vi.mocked(retrieveNFLSportsbookGame).mock.results[0];
    const original: Awaited<ReturnType<typeof retrieveNFLSportsbookGame>> = await retrieval.value;
    vi.mocked(retrieveNFLSportsbookGame).mockResolvedValue({ ...original, props: original.props.map((prop) => ({ ...prop, line: 299.5 })) });
    vi.mocked(getNFLNewsSnapshot).mockClear();
    vi.mocked(getNFLOpponentDefenseGames).mockClear();
    await runNFLFinderDeepSearch('2026-10-11', { researchMode: 'DEEP', lowThreshold: true });
    expect(getNFLNewsSnapshot).not.toHaveBeenCalled();
    expect(getNFLOpponentDefenseGames).not.toHaveBeenCalled();
  });
  function slate() {
    const games = Array.from({ length: 14 }, (_, index) => ({ id: `game-${index}`, gameTime: '2026-10-11T17:00:00Z', completed: false,
      homeTeam: { id: 12, displayName: `Home ${String.fromCharCode(65 + index)}` }, awayTeam: { id: 13, displayName: `Away ${String.fromCharCode(65 + index)}` } }));
    vi.mocked(getNFLSchedule).mockResolvedValue(games as never);
    vi.mocked(getNFLSportsbookEvents).mockResolvedValue(games.map((game, index) => ({ id: `event-${index}`, homeTeam: game.homeTeam.displayName, awayTeam: game.awayTeam.displayName, commenceTime: game.gameTime })));
    return games;
  }

  it('retrieves and deeply researches every game in a complete 14-game pregame slate', async () => {
    slate();
    const summary = await runNFLFinderDeepSearch('2026-10-11');
    expect(retrieveNFLSportsbookGame).toHaveBeenCalledTimes(14);
    expect(summary.nflLedger).toMatchObject({ expectedGames: 14, eligiblePregame: 14, researchedGames: 14, failedGames: 0, researchComplete: true });
    expect(summary.nflCandidates).toHaveLength(14);
    expect(summary.nflCandidates.every((candidate) => candidate.history?.windows.rolling.games === 10 && candidate.eliteAnalysis != null)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('estimates one cold 14-game slate at no more than 154 credits without paid retrieval', async () => {
    slate();
    const summary = await runNFLFinderDeepSearch('2026-10-11', { preflight: true });
    expect(summary.validationPreflight).toMatchObject({ eligibleGames: 14, estimatedPaidSubRequests: 14, estimatedCreditCostHigh: 154 });
    expect(retrieveNFLSportsbookGame).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accounts for started and final games without retrieving their odds', async () => {
    const games = slate();
    games[0].completed = true; games[1].gameTime = '2020-10-11T17:00:00Z';
    const summary = await runNFLFinderDeepSearch('2026-10-11');
    expect(summary.nflLedger).toMatchObject({ expectedGames: 14, eligiblePregame: 12, started: 1, final: 1, researchedGames: 12, researchComplete: true });
    expect(retrieveNFLSportsbookGame).toHaveBeenCalledTimes(12);
  });

  it('retrieves only the explicitly requested game even if the rest are cached', async () => {
    slate();
    const summary = await runNFLFinderDeepSearch('2026-10-11', { validationGameIds: ['game-3'] });
    expect(retrieveNFLSportsbookGame).toHaveBeenCalledTimes(1);
    expect(retrieveNFLSportsbookGame).toHaveBeenCalledWith(expect.objectContaining({ gameId: 'game-3', eventId: 'event-3' }));
    expect(summary.nflLedger).toMatchObject({ expectedGames: 1, researchedGames: 1 });
  });

  it('an explicit empty game scope cannot expand into the full slate', async () => {
    slate();
    const summary = await runNFLFinderDeepSearch('2026-10-11', { validationGameIds: [] });
    expect(retrieveNFLSportsbookGame).not.toHaveBeenCalled();
    expect(summary.nflLedger?.expectedGames).toBe(0);
  });

  it('passes market family to retrieval and excludes other returned markets from research', async () => {
    slate();
    const summary = await runNFLFinderDeepSearch('2026-10-11', { marketKeys: ['player_receptions'] });
    expect(retrieveNFLSportsbookGame).toHaveBeenCalledWith(expect.objectContaining({ markets: ['player_receptions'] }));
    expect(summary.nflCandidates).toEqual([]);
  });

  it('respects resolved player identity and does not research unrelated players', async () => {
    const summary = await runNFLFinderDeepSearch('2026-10-11', { playerId: 999 });
    expect(summary.nflCandidates).toEqual([]);
    expect(getPlayerGameLogs).not.toHaveBeenCalled();
  });

  it('records one failed game without losing the complete requested universe', async () => {
    slate();
    const cached = await vi.mocked(retrieveNFLSportsbookGame)({ date: '2026-10-11', gameId: 'fixture', eventId: 'event', kickoff: '2026-10-11T17:00:00Z' });
    vi.mocked(retrieveNFLSportsbookGame).mockImplementation(async (input) => input.gameId === 'game-7'
      ? { ...cached, complete: false, props: [], failure: 'TIMEOUT', failedMarkets: ['player_pass_yds'] } : cached);
    vi.mocked(retrieveNFLSportsbookGame).mockClear();
    const summary = await runNFLFinderDeepSearch('2026-10-11');
    expect(summary.nflLedger).toMatchObject({ expectedGames: 14, researchedGames: 13, failedGames: 1, researchComplete: false });
    expect(summary.nflLedger?.games[7].failure).toBe('TIMEOUT');
    expect(summary.gamesAnalyzed).toBe(13);
  });

  it('records a partial event list as incomplete, not a smaller successful slate', async () => {
    const games = slate();
    vi.mocked(getNFLSportsbookEvents).mockResolvedValue(games.slice(0, 13).map((game, index) => ({ id: `event-${index}`, homeTeam: game.homeTeam.displayName, awayTeam: game.awayTeam.displayName, commenceTime: game.gameTime })));
    const summary = await runNFLFinderDeepSearch('2026-10-11');
    expect(summary.nflLedger).toMatchObject({ expectedGames: 14, researchedGames: 13, failedGames: 1, researchComplete: false });
    expect(summary.nflLedger?.games[13].failure).toBe('EVENT_UNAVAILABLE');
  });

  it('accounts for successful zero-market games separately from researched games', async () => {
    slate();
    vi.mocked(retrieveNFLSportsbookGame).mockResolvedValue({ complete: true, failure: null, fromCache: true, props: [], requestedMarkets: ['player_pass_yds'], returnedMarkets: [], zeroMarkets: ['player_pass_yds'], failedMarkets: [], retrievedAt: new Date().toISOString(), expiresAt: Date.now() + 120000 });
    const summary = await runNFLFinderDeepSearch('2026-10-11');
    expect(summary.nflLedger).toMatchObject({ expectedGames: 14, researchedGames: 0, zeroMarketGames: 14, researchComplete: false });
    expect(summary.nflCandidates).toEqual([]);
  });

  it('marks authentication failure across every required game without purchasing odds', async () => {
    slate();
    vi.mocked(getNFLSportsbookEvents).mockRejectedValue(new Error('fixture authentication'));
    const summary = await runNFLFinderDeepSearch('2026-10-11');
    expect(summary.nflLedger).toMatchObject({ expectedGames: 14, failedGames: 14, researchComplete: false });
    expect(retrieveNFLSportsbookGame).not.toHaveBeenCalled();
  });

  it('never accepts a matched player from a team outside the requested game', async () => {
    vi.mocked(searchNFLPlayers).mockResolvedValueOnce([{ id: 1, name: 'Test QB', position: 'QB', team: { id: 99, displayName: 'Wrong Team' } }] as never);
    const summary = await runNFLFinderDeepSearch('2026-10-11');
    expect(summary.nflCandidates).toEqual([]);
    expect(getPlayerGameLogs).not.toHaveBeenCalled();
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('NFL Stage 2 engine integration without network or sportsbook spending', () => {
  it('the real finder uses current participation evidence instead of stale individual Active entries', async () => {
    const now = new Date().toISOString();
    vi.mocked(getNFLParticipationSnapshot).mockResolvedValue({ gameId: 'game', kickoff: '2026-10-11T17:00:00Z', fetchedAt: now, expiresAt: Date.now() + 900000,
      gameVerified: true, teamIds: [12, 13], failures: [], gameInjuries: [{ teamId: 12, complete: true, reports: [] }],
      rosters: [{ teamId: 12, timestamp: now, complete: true, athletes: [{ id: '1', status: { name: 'Active' }, injuries: [] }] }],
      depthCharts: [{ teamId: 12, timestamp: now, complete: true, athletes: [{ id: '1', position: 'QB', order: 1, injuries: [] }] }],
    });
    vi.mocked(getNFLInjurySnapshot).mockResolvedValue({ complete: true, fetchedAt: now, sourceStatus: 'CURRENT', reports: [{
      playerId: 1, player: 'Test QB', teamId: 12, team: 'Kansas City Chiefs', injury: null, status: 'Active', availabilityDesignation: 'CONFIRMED_AVAILABLE',
      position: 'QB', evidence: null, updatedAt: '2026-09-01T12:00:00Z', sourceStatus: 'STALE',
    }] });
    const candidate = (await runNFLFinderDeepSearch('2026-10-11')).nflCandidates[0];
    expect(candidate.injuryContext?.player.availabilityDesignation).toBe('EXPECTED_AVAILABLE');
    expect(candidate.injuryContext?.participation?.gameId).toBe('game');
    expect(candidate.eliteAnalysis?.dataQuality).toBe(100);
    expect(candidate.eliteAnalysis?.eliteQualified).toBe(true);
    expect(getNFLParticipationSnapshot).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('can qualify a comparable early-season player with truthful rolling evidence', async () => {
    const summary = await runNFLFinderDeepSearch('2026-10-11');
    const candidate = summary.nflCandidates[0];
    expect(candidate.eliteAnalysis?.eliteQualified).toBe(true);
    expect(candidate.eliteAnalysis?.trapRisk).toBe(5);
    expect(candidate.history?.sample).toMatchObject({ currentSeasonGames: 4, previousSeasonGames: 6 });
    expect(candidate.history?.windows.season.games).toBe(4);
    expect(candidate.history?.windows.rolling.games).toBe(10);
    expect(candidate.projection?.method).toBe('nfl_rolling_history');
    expect(candidate.injuryContext?.player.availabilityDesignation).toBe('NO_CURRENT_INJURY_DESIGNATION');
    expect(getPlayerGameLogs).toHaveBeenCalledWith(1, 2026);
    expect(getPlayerGameLogs).toHaveBeenCalledWith(1, 2025);
    expect(fetch).not.toHaveBeenCalled();
    const saved = buildResearchSessionFromCandidates({ sport: 'nfl', date: '2026-10-11', queryIntent: '',
      candidates: [{ candidateId: candidate.id, player: candidate.playerName, team: candidate.team, opponent: candidate.opponent,
        marketLabel: candidate.marketLabel, marketKey: candidate.market, line: candidate.line, direction: candidate.side, book: candidate.book, odds: candidate.oddsAmerican,
        projection: candidate.projection!.projection, projectionUncertainty: candidate.projection!.uncertainty,
        l5Rate: candidate.history!.windows.l5.hitRate, l10Rate: candidate.history!.windows.l10.hitRate, l20Rate: null, seasonRate: candidate.history!.windows.season.hitRate,
        nflHistory: candidate.history, nflResearchProfile: candidate.nflResearchProfile ?? undefined, analysis: candidate.eliteAnalysis!, sport: 'nfl' }],
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1, cached: true, dataFreshnessSeconds: 0, budgetLimited: false },
    });
    expect(saved.candidates[0].nflHistory?.observations).toEqual(candidate.history!.observations);
    const serialized = JSON.parse(JSON.stringify(saved));
    expect(serialized.candidates[0].nflResearchProfile.projectionModel).toMatchObject({
      modelVersion: 'nfl_opportunity_v1', calibrationStatus: 'UNVALIDATED',
      finalProjection: candidate.projection!.projection, uncertainty: candidate.projection!.uncertainty,
    });
    expect(serialized.candidates[0].nflResearchProfile.projectionModel.opportunityInputs.length).toBeGreaterThan(0);
    expect(serialized.candidates[0].nflResearchProfile.matchupModel).toMatchObject({
      modelVersion: 'nfl_matchup_efficiency_v1', projectionModelVersion: 'nfl_opportunity_matchup_v1',
      opportunityModelVersion: 'nfl_opportunity_v1', probabilityModelVersion: 'shared_probability_model_v1',
      efficiencyAdjustment: 0, projectionAdjustment: 0, finalProjection: candidate.projection!.projection,
    });
    expect(serialized.candidates[0].nflResearchProfile.matchupModel.missingInputs).toContain('pressure rate');
    expect(serialized.candidates[0].nflResearchProfile.gameEnvironmentModel).toMatchObject({ modelVersion: 'nfl_game_environment_v1',
      volumeAdjustment: 0, finalProjection: candidate.projection!.projection, expectedTeamVolume: { plays: null, passAttempts: null, rushAttempts: null, possessions: null } });
    expect(saved.candidates[0].breakEvenProbability).toBe(52.4);
  });

  it('does not borrow a different team\'s previous-season games', async () => {
    vi.mocked(getPlayerGameLogs).mockImplementation(async (_player, season) => games(season === 2026 ? 4 : 17, season!, season === 2026 ? 12 : 15));
    const candidate = (await runNFLFinderDeepSearch('2026-10-11')).nflCandidates[0];
    expect(candidate.history?.sample.previousSeasonGames).toBe(0);
    expect(candidate.eliteAnalysis?.eliteQualified).toBe(false);
    expect(candidate.eliteAnalysis?.rejectedReasons).toContain('Insufficient sample size');
  });

  it('does not request the previous season once 10 current observations exist', async () => {
    vi.mocked(getPlayerGameLogs).mockResolvedValue(games(12, 2026));
    const candidate = (await runNFLFinderDeepSearch('2026-10-11')).nflCandidates[0];
    expect(getPlayerGameLogs).toHaveBeenCalledTimes(1);
    expect(candidate.history?.windows.season.games).toBe(12);
    expect(candidate.history?.sample.previousSeasonGames).toBe(0);
  });

  it('rejects a statistically strong candidate when injury retrieval actually fails', async () => {
    vi.mocked(getNFLInjurySnapshot).mockRejectedValue(new Error('fixture retrieval failure'));
    const candidate = (await runNFLFinderDeepSearch('2026-10-11')).nflCandidates[0];
    expect(candidate.injuryContext?.player.availabilityDesignation).toBe('UNKNOWN');
    expect(candidate.eliteAnalysis?.eliteQualified).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});