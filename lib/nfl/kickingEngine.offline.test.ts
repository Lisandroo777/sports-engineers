import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNFLFinderDeepSearch, NFL_VALIDATION_COST_PER_EVENT } from '../finder/nflEngine';
import { buildResearchSessionFromCandidates } from '../ai/agent/session';
import { classifyPickTier } from '../ai/agent/pickTiers';
import { NFL_ELITE_MARKETS, type NFLAnalyzableMarketKey } from './oddsTypes';
import { normalizeNFLKickingStats } from './stats';
import { buildNFLRoleContext, assessNFLRoleStability } from './roleContext';
import { analyzeNFLCandidate, buildNFLEliteCandidate } from './research';
import { parseNFLKickoffForecast } from './weather';
import type { NFLGame, NFLGameLogEntry } from './types';
import type { NFLKickingOpportunityResult } from './kickingOpportunity';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(), events: vi.fn(), players: vi.fn(), logs: vi.fn(), retrieve: vi.fn(), coverage: vi.fn(),
  weather: vi.fn(), injuries: vi.fn(), opponent: vi.fn(), opportunity: vi.fn(), participation: vi.fn(),
}));

vi.mock('./schedule', () => ({ getNFLSchedule: mocks.schedule }));
vi.mock('./players', () => ({ searchNFLPlayers: mocks.players }));
vi.mock('./stats', async (original) => ({ ...await original<typeof import('./stats')>(), getPlayerGameLogs: mocks.logs }));
vi.mock('./sportsbook', async (original) => ({ ...await original<typeof import('./sportsbook')>(),
  getNFLSportsbookEvents: mocks.events,
  retrieveNFLSportsbookGame: mocks.retrieve, inspectNFLSportsbookCoverage: mocks.coverage,
}));
vi.mock('./weather', async (original) => ({ ...await original<typeof import('./weather')>(), getNFLWeatherContext: mocks.weather }));
vi.mock('./injuries', async (original) => ({ ...await original<typeof import('./injuries')>(), getNFLInjurySnapshot: mocks.injuries }));
vi.mock('./participation', async (original) => ({ ...await original<typeof import('./participation')>(), getNFLParticipationSnapshot: mocks.participation }));
vi.mock('./kickingOpportunity', () => ({ getNFLKickingOpportunity: mocks.opportunity }));
vi.mock('./opponentContext', async (original) => ({ ...await original<typeof import('./opponentContext')>(), getNFLOpponentDefenseGames: mocks.opponent }));
vi.mock('./research', async (original) => {
  const actual = await original<typeof import('./research')>();
  return { ...actual, analyzeNFLCandidate: vi.fn(actual.analyzeNFLCandidate) };
});
vi.mock('../odds/persistentCache', () => ({ readCreditStatus: async () => null }));

const now = '2026-10-17T12:00:00Z';
const team = (id: number, displayName: string) => ({ id, displayName, name: displayName, abbreviation: displayName, logoUrl: null, color: null });
const game: NFLGame = {
  id: 'game', season: 2026, week: 7, seasonType: 'REGULAR', gameTime: '2026-10-18T17:00:00Z',
  homeTeam: team(1, 'Home'), awayTeam: team(2, 'Away'), homeScore: null, awayScore: null, completed: false, status: 'Scheduled',
  venue: { id: 'venue', name: 'Fixture Stadium', indoor: false, city: 'City', state: 'ST', country: 'USA' },
  odds: [{ provider: 'Fixture Book', homeSpread: -3, openingHomeSpread: -3, total: 45, openingTotal: 45, retrievedAt: now }],
};

function log(attempts: number | undefined, index: number, season = 2026): NFLGameLogEntry {
  const made = attempts == null || attempts < 0 ? 1 : Math.max(0, attempts - (index % 3 === 0 ? 1 : 0));
  return { gameId: `${season}-${index}`, season, teamId: 1, position: 'K', week: index + 1,
    date: new Date(Date.UTC(season, 8, index + 1)).toISOString(), opponent: 'Away', opponentAbbreviation: 'AWY',
    homeAway: 'home', result: 'W 24-21', stats: { fieldGoalsMade: made, kickingPoints: made * 3 + 2,
      ...(attempts === undefined ? {} : { fieldGoalsAttempted: attempts }) } };
}

function prop(marketKey: NFLAnalyzableMarketKey) {
  return { player: marketKey === 'player_pass_yds' ? 'Fixture QB' : 'Fixture Kicker', marketKey,
    line: marketKey === 'player_kicking_points' ? 6.5 : marketKey === 'player_pass_yds' ? 200.5 : 1.5,
    overOdds: -110, underOdds: -110, sportsbookKey: 'book', sportsbookName: 'Fixture Book',
    isAlternate: false, lastUpdate: now, retrievedAt: now, sourceGameId: game.id };
}

function retrieval(markets: NFLAnalyzableMarketKey[] = ['player_field_goals', 'player_kicking_points']) {
  return { props: markets.map(prop), complete: true, fromCache: true, returnedMarkets: markets,
    zeroMarkets: [], failedMarkets: [], retrievedAt: now, expiresAt: Date.parse(game.gameTime), failure: null };
}

function opportunityFixture(): NFLKickingOpportunityResult {
  const source = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=fixture';
  const values = { teamDrives: 10, teamRedZoneTrips: 5, teamRedZoneTouchdowns: 2,
    opponentRedZoneTrips: 8, opponentRedZoneTouchdowns: 3, fourthDownAttempts: 2 };
  return { facts: Object.fromEntries(Object.entries(values).map(([field, value]) => [field,
    { value, source, sourceURL: source, sourceURLs: [source], retrievedAt: now, sampleId: 'observed-fixture' }])),
    evidence: [...Object.keys(values).map(field => ({ field, status: 'AVAILABLE' as const, sourceURL: source,
      retrievedAt: now, sampleId: 'observed-fixture', gameIds: ['fixture'], reason: null })),
      { field: 'fourthDownOpportunities', status: 'UNAVAILABLE', sourceURL: source, retrievedAt: now,
        sampleId: 'observed-fixture', gameIds: ['fixture'], reason: 'Complete fourth-down decisions unavailable.' }],
    missingFields: ['fourthDownOpportunities', 'expectedDrives', 'teamTotal'], gameIds: ['fixture'], sourceURLs: [source] };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden during offline validation'); }));
  vi.clearAllMocks();
  mocks.schedule.mockResolvedValue([game]);
  mocks.events.mockResolvedValue([{ id: 'event', homeTeam: 'Home', awayTeam: 'Away', commenceTime: game.gameTime }]);
  mocks.players.mockImplementation(async (name: string) => [{ id: name === 'Fixture QB' ? 20 : 10,
    name, position: name === 'Fixture QB' ? 'QB' : 'K', team: { id: 1, displayName: 'Home' } }]);
  mocks.logs.mockImplementation(async (_player: number, season: number) => Array.from({ length: 12 }, (_, index) => log(2 + index % 2, index, season)));
  mocks.retrieve.mockResolvedValue(retrieval());
  mocks.coverage.mockResolvedValue({ state: 'CACHE_FRESH', missingMarkets: 0 });
  mocks.injuries.mockResolvedValue({ reports: [], complete: true, sourceStatus: 'CURRENT', fetchedAt: now });
  mocks.participation.mockResolvedValue(null);
  mocks.opportunity.mockResolvedValue(opportunityFixture());
  mocks.opponent.mockResolvedValue([]);
  mocks.weather.mockResolvedValue(parseNFLKickoffForecast(game, { hourly: {
    time: ['2026-10-18T17:00'], temperature_2m: [54], wind_speed_10m: [19], wind_gusts_10m: [28], precipitation: [0.1], weather_code: [61],
  } }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('kicking opportunity roles from exact recorded counts', () => {
  it.each(['player_field_goals', 'player_kicking_points'] as const)('keeps actual ESPN-normalized attempts in both role and stability for %s', market => {
    const entries = [1, 2, 2, 1, 2, 2, 3, 3, 3].map((attempts, index) => ({
      ...log(attempts, index),
      stats: normalizeNFLKickingStats(['fieldGoalsMade-fieldGoalAttempts', 'extraPointsMade-extraPointAttempts'],
        [`${attempts}-${attempts}`, '2-2']),
    }));
    expect(buildNFLRoleContext(entries, market).opportunity.rolling?.games).toBe(9);
    expect(assessNFLRoleStability(entries, market)).toMatchObject({ games: 9, status: 'INCREASING' });
  });

  it.each(['player_field_goals', 'player_kicking_points'] as const)('%s retains OPTIONAL with meaningful observed roles', (market) => {
    const stable = buildNFLRoleContext([1, 2, 2, 1, 2, 2].map((value, index) => log(value, index)), market);
    expect(stable).toMatchObject({ requirement: 'OPTIONAL', status: 'STABLE', opportunity: { statKey: 'fieldGoalsAttempted', season: { games: 6, mean: 10 / 6 } } });
    expect(buildNFLRoleContext([0, 1, 4, 0, 5, 1].map((value, index) => log(value, index)), market).status).toBe('UNCERTAIN');
    const rising = [1, 2, 2, 1, 2, 2, 3, 3, 3].map((value, index) => log(value, index));
    expect(buildNFLRoleContext(rising, market).status).toBe('CHANGING');
    expect(assessNFLRoleStability(rising, market).status).toBe('INCREASING');
    expect(assessNFLRoleStability([3, 3, 3, 2, 1, 1].map((value, index) => log(value, index)), market).status).toBe('DECLINING');
  });

  it.each(['player_field_goals', 'player_kicking_points'] as const)('%s excludes missing, negative, fractional and unfinished attempts without a points proxy', (market) => {
    const entries = [log(undefined, 0), log(-1, 1), log(1.5, 2), log(0, 3), { ...log(2, 4), result: null }];
    const context = buildNFLRoleContext(entries, market);
    expect(context).toMatchObject({ status: 'UNAVAILABLE', opportunity: { available: false, season: { games: 1, mean: 0 } }, stability: { games: 1 } });
    expect(buildNFLRoleContext([0, 0, 0].map((value, index) => log(value, index)), market))
      .toMatchObject({ status: 'STABLE', opportunity: { available: true, season: { games: 3, mean: 0 } } });
  });
});

describe('NFL finder kicking integration, with actual research and mocked provider boundaries', () => {
  it.each(['TIMEOUT', 'RESEARCH_FAILED'] as const)('preserves actual own-game qualification when an unrelated first game has %s', async (failure) => {
    const markets: NFLAnalyzableMarketKey[] = ['player_field_goals', 'player_kicking_points'];
    const failedGame: NFLGame = { ...game, id: 'failed-game', gameTime: '2026-10-18T16:00:00Z',
      homeTeam: team(3, 'Other Home'), awayTeam: team(4, 'Other Away') };
    mocks.participation.mockImplementation(async (scheduled: NFLGame) => {
      const playerId = scheduled.id === game.id ? '10' : '30';
      const teamId = scheduled.homeTeam.id;
      return { gameId: scheduled.id, kickoff: scheduled.gameTime, fetchedAt: now,
        expiresAt: Date.parse(now) + 3600000, gameVerified: true,
        teamIds: [scheduled.homeTeam.id, scheduled.awayTeam.id], failures: [],
        rosters: [{ teamId, timestamp: now, complete: true,
          athletes: [{ id: playerId, status: { name: 'Active' }, injuries: [] }] }],
        depthCharts: [{ teamId, timestamp: now, complete: true,
          athletes: [{ id: playerId, position: 'K', order: 1, injuries: [] }] }],
        gameInjuries: [{ teamId, complete: true, reports: [] }],
      };
    });
    const prices = retrieval(markets);
    const goodPrices = { ...prices, props: prices.props.map(price => ({ ...price, line: 0.5 })) };
    mocks.retrieve.mockResolvedValue(goodPrices);
    const baseline = await runNFLFinderDeepSearch('2026-10-18', { marketKeys: markets });
    expect(baseline.nflLedger?.researchComplete).toBe(true);
    expect(baseline.nflCandidates).toHaveLength(4);
    for (const candidate of baseline.nflCandidates) {
      expect(candidate.eliteAnalysis).not.toBeNull();
      expect(typeof candidate.eliteAnalysis?.researchQualified).toBe('boolean');
    }

    vi.clearAllMocks();
    mocks.schedule.mockResolvedValue([failedGame, game]);
    mocks.events.mockResolvedValue([
      { id: 'failed-event', homeTeam: 'Other Home', awayTeam: 'Other Away', commenceTime: failedGame.gameTime },
      { id: 'event', homeTeam: 'Home', awayTeam: 'Away', commenceTime: game.gameTime },
    ]);
    mocks.players.mockImplementation(async (name: string) => [{ id: name === 'Other Kicker' ? 30 : 10,
      name, position: 'K', team: { id: name === 'Other Kicker' ? 3 : 1,
        displayName: name === 'Other Kicker' ? 'Other Home' : 'Home' } }]);
    mocks.logs.mockImplementation(async (playerId: number, season: number) => {
      if (playerId === 30) throw new Error('Fixture game logs unavailable');
      return Array.from({ length: 12 }, (_, index) => log(2 + index % 2, index, season));
    });
    mocks.retrieve.mockImplementation(async ({ gameId }: { gameId: string }) => {
      if (gameId === game.id) return goodPrices;
      if (failure === 'TIMEOUT') throw Object.assign(new Error('Fixture sportsbook request timeout'), { name: 'TimeoutError' });
      return { ...goodPrices, props: goodPrices.props.map(price => ({ ...price,
        player: 'Other Kicker', sourceGameId: failedGame.id })) };
    });
    const partial = await runNFLFinderDeepSearch('2026-10-18', { marketKeys: markets });
    expect(mocks.retrieve.mock.calls.map(([request]) => [request.gameId, request.eventId])).toEqual([
      [failedGame.id, 'failed-event'], [game.id, 'event'],
    ]);
    expect(partial.nflLedger).toMatchObject({ researchComplete: false, expectedGames: 2,
      eligiblePregame: 2, researchedGames: 1, failedGames: 1 });
    expect(partial.nflLedger?.games.find(row => row.gameId === failedGame.id))
      .toMatchObject({ state: 'FAILED', failure });
    expect(partial.nflLedger?.games.find(row => row.gameId === game.id)).toMatchObject({
      state: 'RESEARCHED', failure: null, eventId: 'event', returnedMarkets: markets,
      failedMarkets: [], retrievedAt: now, expiresAt: Date.parse(game.gameTime), propsEvaluated: 4,
    });
    const successful = partial.nflCandidates.filter(candidate => candidate.gameId === game.id);
    expect(successful).toHaveLength(4);
    for (const candidate of successful) {
      const isolated = baseline.nflCandidates.find(row => row.id === candidate.id)!;
      expect(candidate).toMatchObject({ playerId: 10, teamId: 1, playerMatch: 'MATCHED' });
      expect(candidate.injuryContext?.participation?.designation).toBe('EXPECTED_AVAILABLE');
      expect(candidate.eliteAnalysis?.researchQualified).toBe(isolated.eliteAnalysis?.researchQualified);
      expect(candidate.eliteAnalysis).toEqual(isolated.eliteAnalysis);
      expect(candidate.eliteAnalysis?.rejectedReasons.join(' ')).not.toMatch(/research is incomplete|slate.*incomplete/i);
      expect(candidate.roleContext).toEqual(isolated.roleContext);
      expect(candidate.nflResearchProfile).toEqual(isolated.nflResearchProfile);
    }
    const failedCandidates = partial.nflCandidates.filter(candidate => candidate.gameId === failedGame.id);
    expect(failedCandidates).toHaveLength(failure === 'RESEARCH_FAILED' ? 4 : 0);
    for (const candidate of failedCandidates) {
      expect(candidate.eliteAnalysis).toMatchObject({ eliteQualified: false, researchQualified: false, qualification: 'REJECT' });
      expect(candidate.eliteAnalysis?.rejectedReasons).toContain('This NFL game research is incomplete or the game is no longer pregame.');
    }
    expect(mocks.logs.mock.calls.filter(([playerId]) => playerId === 10)).toEqual([[10, 2026]]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('attaches both markets, fetches weather before first analysis and reuses one game/player acquisition', async () => {
    const summary = await runNFLFinderDeepSearch('2026-10-18');
    expect(summary.nflCandidates).toHaveLength(4);
    expect(mocks.weather).toHaveBeenCalledTimes(1);
    expect(mocks.logs).toHaveBeenCalledTimes(1);
    expect(mocks.opportunity).toHaveBeenCalledTimes(1);
    expect(mocks.opportunity).toHaveBeenCalledWith({ teamId: 1, opponentTeamId: 2, season: 2026, before: game.gameTime,
      currentLogs: expect.arrayContaining([expect.objectContaining({ position: 'K' })]) });
    expect(mocks.retrieve).toHaveBeenCalledWith(expect.objectContaining({ markets: NFL_ELITE_MARKETS }));
    expect(mocks.weather.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(analyzeNFLCandidate).mock.invocationCallOrder[0]);
    for (const [candidate] of vi.mocked(analyzeNFLCandidate).mock.calls) {
      expect(buildNFLEliteCandidate(candidate).gameContextAvailable).toBe(true);
      expect(candidate.weatherContext?.wind?.speed).toBe(19);
    }
    for (const candidate of summary.nflCandidates) {
      expect(candidate.nflKickingResearch).toMatchObject({ currentSeason: { games: 12, attempted: { total: 30, observedGames: 12 } },
        career: null, weatherContext: { wind: { speed: 19 }, gusts: { speed: 28 } }, injuryContext: { sourceStatus: { status: 'CURRENT' } },
        opportunity: { facts: { teamTotal: { value: 24, retrievedAt: now, sampleId: 'game:1' }, opponentRedZoneTrips: { value: 8 } },
          teamRedZoneTouchdownRate: { numerator: 2, denominator: 5, rate: 0.4 },
          opponentRedZoneTouchdownRate: { numerator: 3, denominator: 8, rate: 0.375 }, fourthDownAttemptRate: null } });
      expect(candidate.howItLoses.join(' ')).toContain('opportunity.coverage.fourthDownOpportunities');
      expect(candidate.howItLoses.join(' ')).toContain('countercase:');
      const evidence = candidate.nflResearchProfile!.evidence;
      expect(evidence.for.some(item => item.statement.includes('30 exact field-goal attempts'))).toBe(true);
      expect(evidence.for.some(item => item.statement.includes('derived market-implied team total'))).toBe(true);
      expect(evidence.for.find(item => item.statement.includes('teamRedZoneTouchdownRate: 2/5'))?.source)
        .toMatchObject({ sourceType: 'ESPN', retrievedAt: now, source: opportunityFixture().sourceURLs[0] });
      expect(evidence.for.some(item => item.statement.includes('opponentRedZoneTouchdownRate: 3/8'))).toBe(true);
      expect(evidence.for.find(item => item.statement.includes('30 exact field-goal attempts'))?.source?.sourceType).toBe('ESPN');
      expect(evidence.for.find(item => item.statement.startsWith('Market-implied team total'))?.source)
        .toMatchObject({ sourceType: 'SPORTSBOOK', retrievedAt: now });
      expect(evidence.for.find(item => item.statement.startsWith('Kicking weather:'))?.source)
        .toMatchObject({ source: 'Open-Meteo', sourceType: 'WEATHER', publishedAt: '2026-10-18T17:00Z' });
      expect(evidence.against.find(item => item.statement.startsWith('Field-goal sample countercase:'))?.source?.sourceType).toBe('ESPN');
      expect(evidence.against.some(item => item.statement.includes('opportunity.fourthDownAttemptRate'))).toBe(true);
      expect(candidate.nflResearchProfile!.score.components.weather.componentScore).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses only already-acquired prior logs and never calls that limited sample a full career', async () => {
    mocks.logs.mockImplementation(async (_player: number, season: number) => season === 2026
      ? [log(1, 0), log(2, 1), { ...log(2, 2), result: null }, { ...log(3, 3), date: '2026-10-19T00:00:00Z' }]
      : [log(1, 0, season), log(2, 1, season), { ...log(4, 2, season), result: null }]);
    const summary = await runNFLFinderDeepSearch('2026-10-18');
    expect(mocks.logs.mock.calls).toEqual([[10, 2026], [10, 2025]]);
    const research = summary.nflCandidates[0].nflKickingResearch!;
    expect(research.currentSeason.games).toBe(2);
    expect(research.career).toMatchObject({ games: 4, seasonCount: 2, attempted: { total: 6 } });
    expect(research.career!.label).toContain('not verified full career');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reuses opportunity across books and markets without altering projections', async () => {
    const prices = retrieval();
    mocks.retrieve.mockResolvedValue({ ...prices, props: [...prices.props, ...prices.props.map(price => ({ ...price,
      sportsbookKey: 'second-book', sportsbookName: 'Second Fixture Book' }))] });
    const sourced = await runNFLFinderDeepSearch('2026-10-18');
    expect(sourced.nflCandidates).toHaveLength(8);
    expect(mocks.opportunity).toHaveBeenCalledTimes(1);
    mocks.opportunity.mockResolvedValue({ facts: {}, evidence: [], missingFields: [], gameIds: [], sourceURLs: [] });
    const missing = await runNFLFinderDeepSearch('2026-10-18');
    expect(mocks.opportunity).toHaveBeenCalledTimes(2);
    expect(sourced.nflCandidates.map(candidate => candidate.projection)).toEqual(missing.nflCandidates.map(candidate => candidate.projection));
  });

  it('keeps research alive on opportunity failure and preserves the sourced team total', async () => {
    mocks.opportunity.mockRejectedValue(new Error('Fixture provider unavailable'));
    const summary = await runNFLFinderDeepSearch('2026-10-18');
    expect(mocks.opportunity).toHaveBeenCalledTimes(1);
    expect(summary.nflLedger?.researchComplete).toBe(true);
    expect(summary.nflCandidates).toHaveLength(4);
    for (const candidate of summary.nflCandidates) {
      expect(candidate.nflKickingResearch?.opportunity.facts.teamTotal).toMatchObject({ value: 24, retrievedAt: now });
      expect(candidate.nflKickingResearch?.opportunity.facts.teamRedZoneTrips).toBeNull();
      expect(candidate.nflKickingResearch?.unavailableEvidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'opportunity.coverage.loader', status: 'UNAVAILABLE' }),
      ]));
      expect(candidate.howItLoses.join(' ')).toContain('Kicking opportunity acquisition unavailable');
    }
  });

  it('withholds coaching attempt rates when decision coverage is partial', async () => {
    const partial = opportunityFixture();
    partial.facts.fourthDownOpportunities = { ...partial.facts.fourthDownAttempts!, value: 4 };
    partial.evidence = partial.evidence.map(entry => entry.field === 'fourthDownOpportunities'
      ? { ...entry, status: 'PARTIAL', reason: 'Only some decisions identified.' } : entry);
    mocks.opportunity.mockResolvedValue(partial);
    const summary = await runNFLFinderDeepSearch('2026-10-18');
    const candidate = summary.nflCandidates[0];
    expect(candidate.nflKickingResearch?.opportunity.fourthDownAttemptRate).toBeNull();
    expect(candidate.nflKickingResearch?.unavailableEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'opportunity.coverage.fourthDownOpportunities', reason: 'PARTIAL: Only some decisions identified.' }),
    ]));
    expect(candidate.nflResearchProfile?.evidence.against.find(item => item.statement.includes('Only some decisions identified.'))?.source)
      .toMatchObject({ sourceType: 'ESPN', source: partial.sourceURLs[0], retrievedAt: now });
  });

  it('can recommend a kicker with verified current participation and a favorable current line', async () => {
    mocks.participation.mockResolvedValue({ gameId: game.id, kickoff: game.gameTime, fetchedAt: now,
      expiresAt: Date.parse(now) + 3600000, gameVerified: true, teamIds: [1, 2], failures: [],
      rosters: [{ teamId: 1, timestamp: now, complete: true,
        athletes: [{ id: '10', status: { name: 'Active' }, injuries: [] }] }],
      depthCharts: [{ teamId: 1, timestamp: now, complete: true,
        athletes: [{ id: '10', position: 'K', order: 1, injuries: [] }] }],
      gameInjuries: [{ teamId: 1, complete: true, reports: [] }],
    });
    const prices = retrieval(['player_field_goals']);
    mocks.retrieve.mockResolvedValue({ ...prices, props: prices.props.map(price => ({ ...price, line: 0.5 })) });
    const summary = await runNFLFinderDeepSearch('2026-10-18', { marketKeys: ['player_field_goals'] });
    const over = summary.nflCandidates.find(candidate => candidate.side === 'over')!;
    expect(over.injuryContext?.participation?.designation).toBe('EXPECTED_AVAILABLE');
    const analysis = over.eliteAnalysis!;
    const session = buildResearchSessionFromCandidates({ sport: 'nfl', date: '2026-10-18', queryIntent: 'Best NFL props',
      candidates: [{ candidateId: over.id, playerId: over.playerId!, player: over.playerName, position: over.position,
        teamId: over.teamId, team: over.team, opponent: over.opponent, gameId: over.gameId, marketLabel: over.marketLabel,
        marketKey: over.market, line: over.line, direction: over.side, book: over.book, odds: over.oddsAmerican,
        projection: over.projection?.projection ?? null, projectionUncertainty: over.projection?.uncertainty ?? null,
        l5Rate: over.history?.windows.l5.hitRate ?? null, l10Rate: over.history?.windows.l10.hitRate ?? null, l20Rate: null,
        seasonRate: over.history?.windows.season.hitRate ?? null, analysis, sport: 'nfl', sampleSize: over.history?.gamesUsed,
        injuryContext: over.injuryContext, weatherContext: over.weatherContext, nflHistory: over.history,
        projectionReliability: over.projection?.reliability, nflResearchProfile: over.nflResearchProfile ?? undefined }],
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1,
        cached: true, dataFreshnessSeconds: 0, budgetLimited: false } });
    const tier = classifyPickTier(session.candidates[0], 'nfl');
    expect(tier.pickTier, JSON.stringify(tier.tierRequirementsFailed)).not.toBe('PASS');
    expect(analysis.eliteQualified).toBe(false);
    expect(over.nflKickingResearch?.opportunity.teamRedZoneTouchdownRate?.rate).toBe(0.4);
    expect(over.nflResearchProfile?.evidence.for.some(item => item.statement.includes('Neutral historical context'))).toBe(true);
  });

  it('reports missing attempts/weather without fabricating zero, favorable weather, or ratings', async () => {
    mocks.logs.mockImplementation(async (_player: number, season: number) => Array.from({ length: 6 }, (_, index) => log(undefined, index, season)));
    mocks.weather.mockResolvedValue(parseNFLKickoffForecast(game, null));
    const summary = await runNFLFinderDeepSearch('2026-10-18');
    const candidate = summary.nflCandidates[0];
    expect(candidate.roleContext.status).toBe('UNAVAILABLE');
    expect(candidate.nflKickingResearch!.currentSeason.attempted).toEqual({ total: null, perGame: null, observedGames: 0 });
    expect(candidate.nflKickingResearch!.unavailableEvidence.map(item => item.id)).toContain('weather.wind');
    expect(candidate.howItLoses.join(' ')).toContain('currentSeason.attempted');
    expect(candidate.eliteAnalysis?.eliteQualified).toBe(false);
    expect(buildNFLEliteCandidate(vi.mocked(analyzeNFLCandidate).mock.calls[0][0]).gameContextAvailable).toBe(false);
  });

  it('leaves nonkicker analysis on the original lazy-weather path with no kicking payload', async () => {
    mocks.retrieve.mockResolvedValue(retrieval(['player_pass_yds']));
    mocks.logs.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({ ...log(2, index), position: 'QB', stats: { passingYards: 250 + index, passingAttempts: 32 + index % 3 } })));
    const summary = await runNFLFinderDeepSearch('2026-10-18');
    expect(summary.nflCandidates).toHaveLength(2);
    expect(vi.mocked(analyzeNFLCandidate).mock.calls[0][0].weatherContext).toBeNull();
    expect(summary.nflCandidates.every(candidate => !('nflKickingResearch' in candidate))).toBe(true);
    expect(summary.nflCandidates[0].roleContext.opportunity.statKey).toBe('passingAttempts');
    expect(mocks.opportunity).not.toHaveBeenCalled();
  });

  it('retains both new defaults in cost estimates and stops below the unchanged per-game hard cap', async () => {
    expect(NFL_ELITE_MARKETS).toHaveLength(13);
    expect(NFL_ELITE_MARKETS).toEqual(expect.arrayContaining(['player_field_goals', 'player_kicking_points']));
    expect(NFL_VALIDATION_COST_PER_EVENT).toEqual({ low: 0, expected: 13, high: 13 });
    const summary = await runNFLFinderDeepSearch('2026-10-18', { validationMaxCredits: 12 });
    expect(summary.blockReason).toBe('VALIDATION_CREDIT_CAP');
    expect(summary.estimatedNextGameCost).toBe(13);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.weather).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const allowed = await runNFLFinderDeepSearch('2026-10-18', { validationMaxCredits: 13 });
    expect(allowed.budgetLimited).toBe(false);
    expect(mocks.retrieve).toHaveBeenCalledTimes(1);
  });

  it('reports the full 13-market cache miss cost in preflight without retrieving any markets', async () => {
    mocks.coverage.mockResolvedValue({ state: 'CACHE_MISS', missingMarkets: 13 });
    const summary = await runNFLFinderDeepSearch('2026-10-18', { preflight: true });
    expect(summary.validationPreflight).toMatchObject({ estimatedCreditCostExpected: 13, estimatedCreditCostHigh: 13 });
    expect(mocks.coverage).toHaveBeenCalledWith(expect.objectContaining({ markets: NFL_ELITE_MARKETS }));
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.logs).not.toHaveBeenCalled();
    expect(mocks.weather).not.toHaveBeenCalled();
  });
});