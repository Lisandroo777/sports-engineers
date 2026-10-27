import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireNBAResearchReceipt } from './researchAcquisition';
import { withOneRunPaidRefresh, withBoundedOddsRequest } from '../../odds/client';
import { loadNBAResearchReceipt, storeNBAResearchReceipt, NBA_VERIFIED_RESEARCH_MARKETS, type NBAResearchReceipt } from './researchReceipt';

vi.mock('../../odds/client', () => ({
  isPaidRefreshAllowed: () => true,
  OddsRefreshNotAuthorizedError: class extends Error {},
  withOneRunPaidRefresh: vi.fn(async operation => operation()),
  withBoundedOddsRequest: vi.fn(async (_path, _params, operation) => (await operation()).data),
}));
vi.mock('./researchReceipt', async original => ({ ...await original<typeof import('./researchReceipt')>(),
  loadNBAResearchReceipt: vi.fn(async () => null), storeNBAResearchReceipt: vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('selected NBA acquisition contract with mocked provider only', () => {
  it('plans all 26 selected markets without truncation and reuses a fresh full receipt for later subset searches', async () => {
    vi.stubEnv('THE_ODDS_API_KEY', 'offline-fixture');
    const event = { id: '0123456789abcdef0123456789abcdef', commenceTime: '2099-01-01T23:00:00Z', homeTeam: 'Home', awayTeam: 'Away' };
    const data: NBAResearchReceipt['data'] = { id: event.id, sport_key: 'basketball_nba', commence_time: event.commenceTime,
      home_team: 'Home', away_team: 'Away', bookmakers: [{ key: 'fixture', title: 'Fixture', markets: [
        { key: 'player_points', last_update: new Date().toISOString(), outcomes: [{ name: 'Over', description: 'Fixture Player', point: 20.5, price: -110 }] },
      ] }] };
    const network = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () => new Response(JSON.stringify(data), { headers: {
      'content-type': 'application/json', 'x-requests-last': '52', 'x-requests-remaining': '10000',
    } }));
    vi.stubGlobal('fetch', network);
    await acquireNBAResearchReceipt(event, NBA_VERIFIED_RESEARCH_MARKETS);
    expect(withOneRunPaidRefresh).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ maxRequests: 1, maxCredits: 52 }));
    const request = new URL(String(network.mock.calls[0][0]));
    expect(request.searchParams.get('markets')?.split(',')).toEqual(NBA_VERIFIED_RESEARCH_MARKETS);
    expect(request.searchParams.get('regions')).toBe('us,us2');
    vi.mocked(loadNBAResearchReceipt).mockResolvedValueOnce({ observedAt: new Date().toISOString(), regions: ['us', 'us2'],
      requestedMarkets: NBA_VERIFIED_RESEARCH_MARKETS, data });
    await acquireNBAResearchReceipt(event, ['player_points']);
    expect(network).toHaveBeenCalledTimes(1);
    expect(storeNBAResearchReceipt).toHaveBeenCalledTimes(1);
  });
  it('retains existing one-run guards and fetches only selected verified contracts across both regions', async () => {
    vi.stubEnv('THE_ODDS_API_KEY', 'offline-fixture');
    const data = { id: '0123456789abcdef0123456789abcdef', sport_key: 'basketball_nba' };
    const network = vi.fn(async () => new Response(JSON.stringify(data), { headers: {
      'content-type': 'application/json', 'x-requests-last': '4', 'x-requests-remaining': '10000',
    } }));
    vi.stubGlobal('fetch', network);
    await acquireNBAResearchReceipt({ id: data.id, commenceTime: '2099-01-01T23:00:00Z', homeTeam: 'Home', awayTeam: 'Away' },
      ['player_assists_q1', 'alternate_spreads', 'dunks']);
    expect(withOneRunPaidRefresh).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ maxRequests: 1, maxCredits: 4 }));
    expect(withBoundedOddsRequest).toHaveBeenCalledWith(`/sports/basketball_nba/events/${data.id}/odds`, {
      regions: 'us,us2', markets: 'alternate_spreads,player_assists_q1', oddsFormat: 'american',
    }, expect.any(Function), expect.objectContaining({ read: expect.any(Function), waitForShared: true }));
    expect(network).toHaveBeenCalledTimes(1);
    expect(storeNBAResearchReceipt).toHaveBeenCalledWith(expect.objectContaining({ regions: ['us', 'us2'],
      requestedMarkets: ['alternate_spreads', 'player_assists_q1'], data }));
  });
});