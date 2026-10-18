import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMLBResearchContext, withMLBPlayerContext, type MLBResearchFeed } from './researchContext';

afterEach(() => vi.unstubAllGlobals());

function fixture(overrides: MLBResearchFeed = {}): MLBResearchFeed {
  return {
    gamePk: 123,
    metaData: { timeStamp: '20261016_190000' },
    gameData: {
      game: { type: 'L' },
      status: { detailedState: 'Pre-Game', abstractGameState: 'Preview' },
      probablePitchers: { home: { id: 10, fullName: 'Home Starter' }, away: { id: 20, fullName: 'Away Starter' } },
      weather: { temp: '63', condition: 'Clear', wind: '8 mph, Out To CF' },
      venue: { id: 1, name: 'Ballpark', fieldInfo: { roofType: 'Retractable' }, location: { defaultCoordinates: { latitude: 0, longitude: -80 } } },
      players: { ID40: { id: 40, fullName: 'Injured Player', status: { code: 'D10', description: '10-Day Injured List' } }, ID41: { id: 41, fullName: 'Roster Player' } },
    },
    liveData: { boxscore: { teams: { home: { battingOrder: Array.from({ length: 9 }, (_, index) => index + 100), players: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`ID${index + 100}`, { person: { id: index + 100, fullName: `Batter ${index + 1}` } }])) } } } },
    ...overrides,
  };
}

function mockFeed(feed: MLBResearchFeed) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => feed });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('MLB factual research context (offline)', () => {
  it('uses the free versioned live feed once and preserves postseason facts with provenance', async () => {
    const fetch = mockFeed(fixture());
    const context = await getMLBResearchContext('123');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://statsapi.mlb.com/api/v1.1/game/123/feed/live');
    expect(context.gameStatus.value).toMatchObject({ gameType: 'L', detailedState: 'Pre-Game' });
    expect(context.probablePitchers.home.value).toEqual({ id: 10, fullName: 'Home Starter' });
    expect(context.sources).toEqual([fetch.mock.calls[0][0]]);
    expect(context.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(context.gameStatus.sourceTimestamp).toBe('20261016_190000');
    expect(context.confirmedLineups.home.value).toHaveLength(9);
    expect(context.confirmedLineups.home.value?.[0]).toMatchObject({ id: 100, battingOrder: 1 });
    expect(context.venue.value).toMatchObject({ roofType: 'Retractable', latitude: 0, longitude: -80 });
  });

  it('labels recorded weather observed, never forecast', async () => {
    mockFeed(fixture());
    const context = await getMLBResearchContext('123');
    expect(context.weather.value).toEqual({ kind: 'OBSERVED', condition: 'Clear', temperatureF: '63', wind: '8 mph, Out To CF' });
    expect(context.weather.dataQualityNote).toContain('not a forecast');
    expect(context.bullpenWorkload.status).toBe('UNAVAILABLE');
  });

  it('reports explicit injury status without inferring status for roster-only players', async () => {
    mockFeed(fixture());
    const context = await getMLBResearchContext('123');
    expect(context.playerInjuries.value).toEqual([{ playerId: 40, name: 'Injured Player', code: 'D10', description: '10-Day Injured List', explicitlyInjured: true }]);
  });

  it('does not infer lineups, weather, health, roof, or starters from missing fields', async () => {
    mockFeed(fixture({ gameData: { players: { ID41: { id: 41, fullName: 'Roster Only' } } }, liveData: {} }));
    const context = await getMLBResearchContext('123');
    for (const item of [context.gameStatus, context.confirmedLineups.home, context.confirmedLineups.away, context.probablePitchers.home, context.weather, context.venue, context.playerInjuries, context.bullpenWorkload]) {
      expect(item.status).toBe('UNAVAILABLE');
      expect(item.value).toBeNull();
      expect(item.dataQualityNote).toBeTruthy();
    }
  });

  it('rejects incomplete or unresolvable batting orders', async () => {
    mockFeed(fixture({ liveData: { boxscore: { teams: { home: { battingOrder: [100] }, away: { battingOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9] } } } } }));
    const context = await getMLBResearchContext('123');
    expect(context.confirmedLineups.home.status).toBe('UNAVAILABLE');
    expect(context.confirmedLineups.away.status).toBe('UNAVAILABLE');
  });

  it('catches a failed feed and reports unavailable evidence without successful source claims', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const context = await getMLBResearchContext('123');
    expect(context.sources).toEqual([]);
    expect(context.gameStatus.status).toBe('UNAVAILABLE');
    expect(context.weather.source).toBeNull();
    expect(context.playerInjuries.status).toBe('UNAVAILABLE');
    expect(context.dataQualityNote).toContain('unavailable');
  });

  it('does not attach facts from a different game', async () => {
    mockFeed(fixture({ gamePk: 999 }));
    expect((await getMLBResearchContext('123')).sources).toEqual([]);
  });

  it('checks team identity and records starter nonmatches without suppressing relievers or refetching', async () => {
    const fetch = mockFeed(fixture());
    const context = await getMLBResearchContext('123');
    const game = { homeTeam: { id: 1, name: 'Home', abbreviation: 'H' }, awayTeam: { id: 2, name: 'Away', abbreviation: 'A' } };
    const starter = withMLBPlayerContext(context, game, 10, 1, true);
    const reliever = withMLBPlayerContext(context, game, 30, 2, true);
    const wrongTeam = withMLBPlayerContext(context, game, 40, 3, false);
    expect(starter.player?.scheduledStarter.value?.isListedProbableStarter).toBe(true);
    expect(reliever.player?.scheduledStarter.value?.isListedProbableStarter).toBe(false);
    expect(reliever.player?.scheduledStarter.dataQualityNote).toContain('does not exclude a reliever');
    expect(wrongTeam.player?.teamMembership.value?.matchesScheduledTeam).toBe(false);
    expect(wrongTeam.player?.scheduledStarter.status).toBe('UNAVAILABLE');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});