import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./persistentCache', () => ({
  readPersistentCache: async () => null, readStalePersistentCache: async () => null,
  writePersistentCache: async () => {}, writeCreditStatus: async () => {},
  readCreditStatus: async () => ({ remaining: '20000', used: '0' }),
}));
import { getEventMarkets, getEventPlayerProps, withOneRunPaidRefresh, OddsRefreshNotAuthorizedError, getAuthorizedNBAActivationOdds } from './client';

beforeEach(() => {
  vi.stubEnv('THE_ODDS_API_KEY', 'fixture-key');
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'false');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'fixture', bookmakers: [] },
    { headers: { 'x-requests-last': '1', 'x-requests-remaining': '19999' } })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('hard bounded explicit paid request safety', () => {
  it('binds the approved entrypoint to exactly seven NBA markets in one region', async () => {
    const event = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', homeTeam: 'Home', awayTeam: 'Away', commenceTime: new Date(Date.now() + 86400000).toISOString() };
    await getAuthorizedNBAActivationOdds(event);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.pathname).toBe(`/v4/sports/basketball_nba/events/${event.id}/odds`);
    expect(url.searchParams.get('regions')).toBe('us');
    expect(url.searchParams.get('markets')).toBe('player_points,player_rebounds,player_assists,h2h,spreads,totals,team_totals');
  });
  it('rejects work continuing from a completed authorization scope', async () => {
    let resume: () => void = () => {};
    let delayed: Promise<unknown>;
    await withOneRunPaidRefresh(async () => {
      delayed = new Promise<void>(resolve => { resume = resolve; }).then(() => getEventMarkets('after-scope', 'basketball_nba'));
    });
    resume();
    await expect(delayed!).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks ordinary calls even when a global flag is set without request approval', async () => {
    await expect(getEventMarkets('no-scope-1', 'basketball_nba')).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'true');
    await expect(getEventMarkets('no-scope-2', 'basketball_nba')).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent identical requests and blocks a different second paid call', async () => {
    await withOneRunPaidRefresh(async () => {
      await Promise.all([getEventMarkets('concurrent-safety', 'basketball_nba'), getEventMarkets('concurrent-safety', 'basketball_nba')]);
      await expect(getEventMarkets('second-safety', 'basketball_nba')).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    }, { maxRequests: 1, maxCredits: 7 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reserves estimated credit cost before sending and rejects out-of-scope keys', async () => {
    await withOneRunPaidRefresh(async () => {
      await expect(getEventPlayerProps('over-budget', ['player_points', 'player_rebounds'], undefined, 'basketball_nba')).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    }, { maxRequests: 1, maxCredits: 1 });
    await withOneRunPaidRefresh(async () => {
      await expect(getEventMarkets('wrong-key', 'basketball_nba')).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    }, { allowedRequestKeys: ['https://api.the-odds-api.com/v4/sports/basketball_nba/events/approved/markets?regions=us'] });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not refund a failed request or expand approval through nesting', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fixture network failure'));
    await withOneRunPaidRefresh(async () => {
      await expect(getEventMarkets('failed-safety', 'basketball_nba')).rejects.toThrow('fixture network failure');
      await withOneRunPaidRefresh(async () => {
        await expect(getEventMarkets('retry-safety', 'basketball_nba')).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
      }, { maxRequests: 100, maxCredits: 100 });
    }, { maxRequests: 1, maxCredits: 7 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not retry HTTP errors or expose provider error bodies', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('sensitive provider payload', { status: 429 }));
    await withOneRunPaidRefresh(async () => {
      await expect(getEventMarkets('http-error-safety', 'basketball_nba')).rejects.toThrow('Odds API request failed (429)');
      await expect(getEventMarkets('http-error-safety', 'basketball_nba')).rejects.toBeInstanceOf(OddsRefreshNotAuthorizedError);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
});