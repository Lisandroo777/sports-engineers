import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNBAFinderDeepSearch } from '../../../finder/nbaEngine';
import { createNBAContextProvider } from '../../context/provider';
import { getNBAInjuryStatuses } from '../../injuries';
import { getNBAPlayer, searchNBAPlayers } from '../../players';
import { getNBASchedule } from '../../schedule';
import { getNBAPlayerGameLogs } from '../../stats';
import { getNBATeamStats } from '../../teamStats';
import { getAuthorizedNBAActivationOdds, getDiscoveredEventPlayerProps, getOddsEventsForSport, isPaidRefreshAllowed } from '../../../odds/client';
import type { NormalizedProp } from '../../../odds/types';
import { adaptNBAAgent2Context, NBA_AGENT2_ADAPTER_VERSION } from '../contextAdapter';
import { availabilityEvent, availabilityFixture, availabilityGame, availabilityTime } from './availability.fixtures';
import { loadNBAGameIntelligence } from './intelligenceArchive';

const { loadSnapshot } = vi.hoisted(() => ({ loadSnapshot: vi.fn() }));

vi.mock('../../context/provider', () => ({ createNBAContextProvider: vi.fn(() => ({ loadSnapshot, requestsUsed: () => 0 })) }));
vi.mock('../../schedule', () => ({ getNBASchedule: vi.fn() }));
vi.mock('../../players', () => ({ searchNBAPlayers: vi.fn(), getNBAPlayer: vi.fn() }));
vi.mock('../../stats', () => ({ getNBAPlayerGameLogs: vi.fn() }));
vi.mock('../../teamStats', () => ({ getNBATeamStats: vi.fn() }));
vi.mock('../../injuries', async importOriginal => ({
  ...await importOriginal<typeof import('../../injuries')>(), getNBAInjuryStatuses: vi.fn(),
}));
vi.mock('../../../odds/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../../odds/client')>(),
  beginOddsSpendTrackingAsync: vi.fn().mockResolvedValue(undefined),
  getActiveOddsSpendTracker: vi.fn(() => null),
  getLastOddsCreditInfo: vi.fn(() => null),
  getOddsEventsForSport: vi.fn(),
  getDiscoveredEventPlayerProps: vi.fn(),
  getAuthorizedNBAActivationOdds: vi.fn().mockResolvedValue({}),
  isPaidRefreshAllowed: vi.fn(() => false),
}));
vi.mock('./intelligenceArchive', () => ({ loadNBAGameIntelligence: vi.fn() }));

let fixture: ReturnType<typeof availabilityFixture>;
let blockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPaidRefreshAllowed).mockReturnValue(false);
  vi.mocked(loadNBAGameIntelligence).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  blockedFetch = vi.fn(() => { throw new Error('Unexpected network request in prop archive Finder test.'); });
  vi.stubGlobal('fetch', blockedFetch);
  fixture = availabilityFixture();
  const game = availabilityGame();
  loadSnapshot.mockResolvedValue(fixture.snapshot);
  vi.mocked(getNBASchedule).mockResolvedValue([game]);
  vi.mocked(getOddsEventsForSport).mockResolvedValue([availabilityEvent()]);
  vi.mocked(searchNBAPlayers).mockResolvedValue([{ id: 101, name: 'Fixture Player 101', position: 'G',
    team: game.homeTeam, jersey: null, headshotUrl: null }]);
  vi.mocked(getNBAPlayer).mockResolvedValue({ id: 101, name: 'Fixture Player 101', position: 'G',
    team: game.homeTeam, jersey: null, headshotUrl: null });
  vi.mocked(getNBAPlayerGameLogs).mockResolvedValue([]);
  vi.mocked(getNBAInjuryStatuses).mockResolvedValue([]);
  vi.mocked(getNBATeamStats).mockResolvedValue([]);
  const prop: NormalizedProp = { sport: 'nba', player: 'Fixture Player 101', playerId: 101,
    marketKey: 'player_points', sourceMarketKey: 'player_points', isAlternate: false,
    historicalAnalysisAvailable: true, marketLabel: 'Points', line: 18.5, overOdds: -110, underOdds: -110,
    sportsbookKey: 'fixture', sportsbookName: 'Fixture Book', eventId: 'odds-1', lastUpdate: availabilityTime };
  vi.mocked(getDiscoveredEventPlayerProps).mockResolvedValue([prop]);
});

afterEach(() => {
  try { expect(blockedFetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); }
});

async function runFixtureFinder() {
  const summary = await runNBAFinderDeepSearch('2026-01-21');
  expect(summary.nbaCandidates).toHaveLength(2);
  expect(summary.playerMatching).toEqual({ matched: 2, ambiguous: 0, unmatched: 0 });
  expect(summary).toMatchObject({ gamesAnalyzed: 1, eventsMatched: 1, propsAnalyzed: 2, rawPropsTotal: 1, fromCache: true });
  expect(createNBAContextProvider).toHaveBeenCalledExactlyOnceWith({ maxRequests: 100, maxGamesPerTeam: 8 });
  expect(loadSnapshot).toHaveBeenCalledExactlyOnceWith({ gameId: 'target', teamId: 1 });
  expect(loadNBAGameIntelligence).toHaveBeenCalledExactlyOnceWith(fixture.snapshot);
  expect(getOddsEventsForSport).toHaveBeenCalledExactlyOnceWith('basketball_nba');
  expect(getDiscoveredEventPlayerProps).toHaveBeenCalledExactlyOnceWith('odds-1', undefined, 'basketball_nba',
    expect.arrayContaining(['player_points']));
  expect(summary.nbaCandidates.map(candidate => candidate.side)).toEqual(['over', 'under']);
  for (const candidate of summary.nbaCandidates) {
    expect(candidate).toMatchObject({ playerId: 101, playerName: 'Fixture Player 101', playerMatch: 'MATCHED',
      gameId: 'target', eventId: 'odds-1', team: 'Home', market: 'points' });
    expect(candidate.researchContext).toMatchObject({ schemaVersion: '1', playerId: 101, teamId: 1, gameId: 'target' });
    expect(candidate.nbaPrediction).toMatchObject({ modelVersion: 'NBA_MODEL_V1', validationStatus: 'UNVALIDATED',
      playerId: 101, targetSeason: 2026, targetPhase: 'REGULAR', researchContextVersion: '1', sampleSize: 20 });
    expect(candidate.nbaPrediction!.expectedStat).not.toBeNull();
    expect(candidate.nbaPrediction!.probabilities).not.toBeNull();
    expect(candidate.nbaPrediction!.contextEvidence.length).toBeGreaterThan(0);
  }
  expect(summary.nbaCandidates[0].intelligenceSnapshot).toBe(summary.nbaCandidates[1].intelligenceSnapshot);
  return summary.nbaCandidates;
}

describe('real NBA prop Finder reviewed intelligence archive integration', () => {
  it('evaluates cached props whose marketKey is canonical and sourceMarketKey is the provider key', async () => {
    vi.mocked(loadNBAGameIntelligence).mockResolvedValue(fixture.intelligence);
    const [prop] = await getDiscoveredEventPlayerProps('odds-1');
    vi.mocked(getDiscoveredEventPlayerProps).mockClear();
    vi.mocked(getDiscoveredEventPlayerProps).mockResolvedValue([{ ...prop, marketKey: 'points' as NormalizedProp['marketKey'] }]);
    await runFixtureFinder();
  });
  it('loads missing regular-season all-market quotes cache-first using the requested slate', async () => {
    vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
    vi.mocked(isPaidRefreshAllowed).mockReturnValue(true);
    vi.mocked(loadNBAGameIntelligence).mockResolvedValue(null);
    const game = availabilityGame();
    vi.mocked(getNBASchedule).mockResolvedValue([{ ...game, phase: 'REGULAR' }]);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([], { headers: { 'x-requests-remaining': '20000' } })));
    await runNBAFinderDeepSearch('2026-01-21', { gameLines: true });
    expect(getNBASchedule).toHaveBeenCalledWith('2026-01-21');
    expect(getAuthorizedNBAActivationOdds).toHaveBeenCalledWith(availabilityEvent());
  });
  it('retains verified Agent #2 archive identity and evidence through the versioned adapter and real prediction', async () => {
    vi.mocked(loadNBAGameIntelligence).mockResolvedValue(fixture.intelligence);
    expect(fixture.intelligence.claims).toEqual(expect.arrayContaining([expect.objectContaining({
      state: 'CURRENT', verification: 'OFFICIAL', claim: expect.objectContaining({
        gameId: 'target', teamId: 1, playerIds: [101], topic: 'INJURY', value: 'AVAILABLE',
      }),
    })]));
    for (const candidate of await runFixtureFinder()) {
      expect(candidate.intelligenceSnapshot).toBe(fixture.intelligence);
      expect(candidate.intelligenceSnapshot!.snapshotId).toBe(fixture.intelligence.snapshotId);
      const adapted = adaptNBAAgent2Context({ researchContext: candidate.researchContext,
        intelligenceSnapshot: candidate.intelligenceSnapshot, playerId: 101, teamId: 1, gameId: 'target',
        targetTipoff: fixture.snapshot.target.startsAt, targetSeason: 2026, targetPhase: 'REGULAR', market: 'points' });
      expect(adapted).toMatchObject({ adapterVersion: NBA_AGENT2_ADAPTER_VERSION, contextSchemaVersion: '1',
        intelligenceSchemaVersion: '1', intelligenceSnapshotId: fixture.intelligence.snapshotId, injury: 'REPORTED_AVAILABLE' });
      expect(adapted!.intelligenceEvidence.length).toBeGreaterThan(0);
      expect(candidate.nbaPrediction!.intelligenceSnapshotId).toBe(fixture.intelligence.snapshotId);
      expect(candidate.nbaPrediction!.intelligenceEvidence).toEqual(adapted!.intelligenceEvidence);
      expect(candidate.nbaPrediction!.contextEvidence).toEqual(adapted!.contextEvidence);
      expect(candidate.nbaPrediction!.contextMissing).toEqual(adapted!.missing);
    }
  });

  it.each(['no archive configured', 'archive load failure'] as const)('%s uses an empty safe fallback without fabricated verification', async scenario => {
    if (scenario === 'no archive configured') vi.mocked(loadNBAGameIntelligence).mockResolvedValue(null);
    else vi.mocked(loadNBAGameIntelligence).mockRejectedValue(new Error('Reviewed archive unavailable.'));
    for (const candidate of await runFixtureFinder()) {
      const fallback = candidate.intelligenceSnapshot!;
      expect(fallback).not.toBeNull();
      expect(fallback).not.toBe(fixture.intelligence);
      expect(fallback.snapshotId).not.toBe(fixture.intelligence.snapshotId);
      expect(fallback).toMatchObject({ schemaVersion: '1', sport: 'nba',
        target: { gameId: 'target', homeTeamId: 1, awayTeamId: 2 }, claims: [], coaching: [], evidence: [] });
      expect(fallback.coverage.sourceIds).toEqual([]);
      expect(fallback.coverage.missing).toContain('No authorized reviewed NBA intelligence archive or dated identity directory is configured; no news/coaching claims were inferred.');
      expect(candidate.nbaPrediction!.intelligenceSnapshotId).toBe(fallback.snapshotId);
      expect(candidate.nbaPrediction!.intelligenceEvidence).toEqual([]);
      expect(candidate.nbaPrediction!.contextMissing).toContain('No verified applicable intelligence reports. Missing coverage does not imply availability.');
      expect(candidate.nbaPrediction!.contextMissing).toEqual(expect.arrayContaining(fallback.coverage.missing));
      expect(candidate.researchContext!.sections.availability.status).not.toBe('AVAILABLE');
      expect(candidate.injuryEvidence).not.toBe('REPORTED_AVAILABLE');
    }
  });
});