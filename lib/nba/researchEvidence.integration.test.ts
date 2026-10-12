import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/ai/chat/route';
import { nbaFinderCandidateToGeneric } from '../ai/agent/tools';
import { buildResearchSessionFromCandidates, type ResearchSession } from '../ai/agent/session';
import { runNBAFinderDeepSearch } from '../finder/nbaEngine';
import { getNBAPlayer, searchNBAPlayers } from './players';
import { getNBASchedule } from './schedule';
import { getNBAPlayerGameLogs } from './stats';
import { getNBATeamStats } from './teamStats';
import { getNBAInjuryStatuses } from './injuries';
import { buildNBAIntelligence } from './intelligence/engine';
import { getDiscoveredEventPlayerProps, getOddsEventsForSport } from '../odds/client';
import { availabilityEvent, availabilityFixture, availabilityGame, availabilityTime } from './prediction/gameLines/availability.fixtures';
import { loadNBAGameIntelligence } from './prediction/gameLines/intelligenceArchive';
import { buildNBAResearchPresentation } from './prediction/gameLines/presentationBridge';

const guards = vi.hoisted(() => ({ loadSnapshot: vi.fn(), getSession: vi.fn(), saveSession: vi.fn(),
  paidRefresh: vi.fn(() => { throw new Error('Paid refresh forbidden'); }),
  nflCapture: vi.fn(() => { throw new Error('NFL capture forbidden'); }) }));

vi.mock('./context/provider', () => ({ createNBAContextProvider: vi.fn(() => ({ loadSnapshot: guards.loadSnapshot, requestsUsed: () => 0 })) }));
vi.mock('./schedule', () => ({ getNBASchedule: vi.fn() }));
vi.mock('./players', () => ({ searchNBAPlayers: vi.fn(), getNBAPlayer: vi.fn() }));
vi.mock('./stats', () => ({ getNBAPlayerGameLogs: vi.fn() }));
vi.mock('./teamStats', () => ({ getNBATeamStats: vi.fn() }));
vi.mock('./injuries', async importOriginal => ({ ...await importOriginal<typeof import('./injuries')>(), getNBAInjuryStatuses: vi.fn() }));
vi.mock('../odds/client', async importOriginal => ({ ...await importOriginal<typeof import('../odds/client')>(),
  beginOddsSpendTrackingAsync: vi.fn().mockResolvedValue(undefined), getActiveOddsSpendTracker: vi.fn(() => null),
  getLastOddsCreditInfo: vi.fn(() => null), getOddsEventsForSport: vi.fn(), getDiscoveredEventPlayerProps: vi.fn(),
  withOneRunPaidRefresh: guards.paidRefresh }));
vi.mock('./prediction/gameLines/intelligenceArchive', () => ({ loadNBAGameIntelligence: vi.fn() }));
vi.mock('../ai/agent/sessionStore', () => ({ getResearchSession: guards.getSession, saveResearchSession: guards.saveSession, deleteResearchSession: vi.fn() }));
vi.mock('../nfl/predictionLedger/capture', () => ({ issueNFLPresentationReceipt: guards.nflCapture }));

const query = 'Best NBA player props and moneylines';
const toolMeta = { gamesFound: 1, gamesScheduled: 1, propsFound: 2, booksFound: 1, candidatesFound: 2,
  cached: true, dataFreshnessSeconds: 0, budgetLimited: false };
let fixture: ReturnType<typeof availabilityFixture>;
let blockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  blockedFetch = vi.fn(() => { throw new Error('Network forbidden'); });
  vi.stubGlobal('fetch', blockedFetch);
  fixture = availabilityFixture();
  const tipoff = '2026-01-21T18:30:00Z';
  fixture.snapshot.target.startsAt = tipoff;
  fixture.rawInput.target.startsAt = tipoff;
  fixture.intelligence = buildNBAIntelligence(fixture.rawInput);
  for (const [index, game] of fixture.snapshot.games.entries()) {
    game.homeTeamId = index % 2 ? 2 : 1;
    game.awayTeamId = index % 2 ? 1 : 2;
    game.teams[0].players[0].stats.points = index % 2 ? 22 : 28;
  }
  guards.loadSnapshot.mockResolvedValue(fixture.snapshot);
  vi.mocked(loadNBAGameIntelligence).mockResolvedValue(fixture.intelligence);
  vi.mocked(getNBASchedule).mockResolvedValue([{ ...availabilityGame(), gameTime: tipoff }]);
  vi.mocked(getOddsEventsForSport).mockResolvedValue([{ ...availabilityEvent(), commenceTime: tipoff }]);
  const player = { id: 101, name: 'Fixture Player 101', position: 'G', team: availabilityGame().homeTeam, jersey: null, headshotUrl: null };
  vi.mocked(searchNBAPlayers).mockResolvedValue([player]);
  vi.mocked(getNBAPlayer).mockResolvedValue(player);
  vi.mocked(getNBAPlayerGameLogs).mockResolvedValue([]);
  vi.mocked(getNBATeamStats).mockResolvedValue([]);
  vi.mocked(getNBAInjuryStatuses).mockResolvedValue([]);
  vi.mocked(getDiscoveredEventPlayerProps).mockResolvedValue([{ sport: 'nba', player: player.name, playerId: player.id,
    marketKey: 'player_points', sourceMarketKey: 'player_points', isAlternate: false, historicalAnalysisAvailable: true,
    marketLabel: 'Points', line: 18.5, overOdds: -110, underOdds: -110, sportsbookKey: 'fixture', sportsbookName: 'Fixture Book',
    eventId: 'odds-1', lastUpdate: availabilityTime }]);
});

afterEach(() => {
  try {
    expect(blockedFetch).not.toHaveBeenCalled();
    expect(guards.paidRefresh).not.toHaveBeenCalled();
    expect(guards.nflCapture).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

async function sessions() {
  const summary = await runNBAFinderDeepSearch('2026-01-21');
  expect(summary.nbaCandidates).toHaveLength(2);
  expect(summary.playerMatching).toEqual({ matched: 2, ambiguous: 0, unmatched: 0 });
  const generics = summary.nbaCandidates.map(nbaFinderCandidateToGeneric);
  const build = (candidates: typeof generics): ResearchSession => ({ ...buildResearchSessionFromCandidates({ sport: 'nba',
    date: '2026-01-21', queryIntent: query, candidates, toolMeta }), gameCandidates: [], modeledGames: [], nbaPresentationResearch: [] });
  return { summary, generics, enriched: build(generics), bare: build(generics.map(candidate => ({ ...candidate,
    nbaHistory: null, nbaResearchEvidence: null, average: null, median: null, homeHitRate: null, awayHitRate: null }))) };
}

function numericalRecord(record: ResearchSession['candidates'][number]) {
  return { candidateId: record.candidateId, rank: record.rank, projection: record.projection, sampleSize: record.sampleSize,
    researchScore: record.researchScore, trueProbability: record.trueProbability, evPercent: record.evPercent,
    priceEdgePercent: record.priceEdgePercent, trapRisk: record.trapRisk, pickTier: record.pickTier, nbaPrediction: record.nbaPrediction };
}

describe('real NBA Finder descriptive evidence through reused chat POST', () => {
  it('preserves exact history, sourced context and model/classifier numbers through generic mapping and presentation', async () => {
    const { summary, generics, enriched, bare } = await sessions();
    expect(enriched.candidates.map(numericalRecord)).toEqual(bare.candidates.map(numericalRecord));
    for (const [index, candidate] of summary.nbaCandidates.entries()) {
      expect(candidate.nbaPrediction).toMatchObject({ modelVersion: 'NBA_MODEL_V1', sampleSize: 20 });
      expect(candidate.nbaPrediction?.expectedStat).not.toBeNull();
      expect(candidate.nbaPrediction?.probabilities).not.toBeNull();
      expect(candidate.nbaPrediction?.fairAmericanOdds).not.toBeNull();
      expect(candidate.nbaPrediction?.expectedValuePercent).not.toBeNull();
      expect(candidate.nbaPrediction?.directionalEdge).not.toBeNull();
      expect(candidate.nbaPrediction?.reliability).toMatch(/^(HIGH|MEDIUM|LOW|UNRELIABLE)$/);
      expect(generics[index].nbaPrediction).toEqual(candidate.nbaPrediction);
      expect(generics[index].sampleSize).toBe(candidate.nbaPrediction?.sampleSize);
      expect(generics[index].average).toBe(25);
      expect(generics[index].median).toBe(25);
      expect(generics[index].nbaHistory?.windows).toMatchObject({ l5: { total: 5, mean: 24.4, median: 22 },
        l10: { total: 10, mean: 25, median: 25 }, l20: { total: 20, mean: 25, median: 25 }, season: { total: 20, mean: 25, median: 25 } });
      expect(generics[index].nbaHistory?.splits).toMatchObject({ home: { total: 10, mean: 28, median: 28 },
        away: { total: 10, mean: 22, median: 22 } });
      const evidence = generics[index].nbaResearchEvidence!;
      expect(evidence.context.asOf).toBe(new Date(fixture.snapshot.asOf).toISOString());
      expect(evidence.context.rotation?.playedGames).toBeGreaterThan(0);
      expect(evidence.context.availability?.status).not.toBe('AVAILABLE');
      expect(evidence.context.evidence).toEqual(expect.arrayContaining(['schedule.rest', 'opponent.allowed.points', 'rotation.starts'].map(id =>
        expect.objectContaining({ id, sourceRefs: expect.arrayContaining([expect.objectContaining({ provider: 'ESPN',
          url: expect.stringContaining('https://'), fetchedAt: expect.any(String) })]) }))));
      expect(evidence.context.injuryNetwork).toEqual(candidate.researchContext?.sections.injuryNetwork);
      expect(evidence.context.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'injuryNetwork.coverage',
        state: 'UNKNOWN', value: null })]));
      expect(evidence.intelligence.asOf).toBe(fixture.intelligence.asOf);
      expect(evidence.intelligence.reports).toEqual(expect.arrayContaining([expect.objectContaining({ topic: 'INJURY',
        value: 'AVAILABLE', verification: 'OFFICIAL', state: 'CURRENT', source: expect.objectContaining({
          url: expect.stringContaining('https://ak-static.cms.nba.com/'), fetchedAt: expect.any(String), publishedAt: expect.any(String) }) })]));
    }
    const presentation = buildNBAResearchPresentation(enriched, query, []);
    const serialized = JSON.stringify(presentation);
    expect(serialized).toContain('home split: n=10; mean=28; median=28');
    expect(serialized).toContain('away split: n=10; mean=22; median=22');
    expect(serialized).toContain('nba.context.schedule.rest');
    expect(serialized).toContain('nba.context.opponent.allowed.points');
    expect(serialized).toContain('nba.context.rotation.starts');
    expect(serialized).toContain('OFFICIAL/CURRENT/');
    expect(serialized).toContain('https://ak-static.cms.nba.com/');
    expect(presentation.picks.map(pick => pick.candidateId)).toEqual(buildNBAResearchPresentation(bare, query, []).picks.map(pick => pick.candidateId));
    const numericalPicks = (session: ResearchSession) => buildNBAResearchPresentation(session, query, []).picks
      .map(pick => Object.fromEntries(Object.entries(pick).filter(([key]) => !['researchEvidence', 'missing'].includes(key))));
    expect(numericalPicks(enriched)).toEqual(numericalPicks(bare));
  });

  it('does not use descriptive history sample counts or averages as model/qualification fallbacks', async () => {
    const { summary } = await sessions();
    const candidate = summary.nbaCandidates[0];
    const generic = nbaFinderCandidateToGeneric({ ...candidate, nbaPrediction: null });
    expect(generic.sampleSize).toBe(0);
    expect(generic.projection).toBeNull();
    expect(generic.projectionReliability).toBe('UNRELIABLE');
    expect(generic.average).toBe(25);
    const build = (average: number | null) => buildResearchSessionFromCandidates({ sport: 'nba', date: '2026-01-21',
      queryIntent: query, candidates: [{ ...generic, average }], toolMeta });
    expect(build(100000).candidates.map(numericalRecord)).toEqual(build(null).candidates.map(numericalRecord));
    expect(build(100000).candidates[0].pickTier).toBe('PASS');
  });

  it('uses the actual POST and real runner with the exact stored mixed query and no additional provider calls', async () => {
    const { enriched, bare } = await sessions();
    const providerCounts = [guards.loadSnapshot, getNBASchedule, getOddsEventsForSport, getDiscoveredEventPlayerProps, loadNBAGameIntelligence]
      .map(provider => vi.mocked(provider).mock.calls.length);
    const post = async (session: ResearchSession) => {
      guards.getSession.mockResolvedValue(session);
      const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ researchSessionId: 'seeded-nba', messages: [{ role: 'user', content: query }],
          context: { sport: 'nba', date: session.date } }) }));
      expect(response.status).toBe(200);
      return response.json();
    };
    const richResponse = await post(enriched);
    const bareResponse = await post(bare);
    expect(guards.getSession).toHaveBeenCalledWith('seeded-nba');
    expect(guards.saveSession).not.toHaveBeenCalled();
    expect([guards.loadSnapshot, getNBASchedule, getOddsEventsForSport, getDiscoveredEventPlayerProps, loadNBAGameIntelligence]
      .map(provider => vi.mocked(provider).mock.calls.length)).toEqual(providerCounts);
    expect(richResponse).toMatchObject({ researchSessionId: 'seeded-nba', ledgerReceipt: null, meta: { sport: 'nba', date: enriched.date } });
    expect(richResponse.nbaPresentation).toEqual(JSON.parse(JSON.stringify(buildNBAResearchPresentation(enriched, query,
      richResponse.results.map((record: { candidateId: string }) => record.candidateId)))));
    expect(richResponse.nbaPresentation.picks).toHaveLength(2);
    expect(JSON.stringify(richResponse.nbaPresentation)).toContain('home split: n=10; mean=28');
    expect(JSON.stringify(richResponse.nbaPresentation)).toContain('nba.context.schedule.rest');
    expect(richResponse.results.map(numericalRecord)).toEqual(bareResponse.results.map(numericalRecord));
    expect(richResponse.nbaPresentation.picks.map((pick: { candidateId: string }) => pick.candidateId))
      .toEqual(bareResponse.nbaPresentation.picks.map((pick: { candidateId: string }) => pick.candidateId));
  });
});