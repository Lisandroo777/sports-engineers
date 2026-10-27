import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { NBA_DEMO_MARKET_IDS } from '../../../../../lib/nba/prediction/historicalDemo';
import { NBA_RESEARCH_MARKETS } from '../../../../../lib/nba/researchMarkets';

afterEach(() => vi.unstubAllGlobals());

describe('isolated NBA synthetic demo API', () => {
  it('serves explicitly labeled unpriced fixtures for selected supported markets without any network/storage dependency', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Any network request is forbidden for the synthetic demo.'); }));
    const response = await GET(new Request('http://localhost/api/ai/demo/nba?market=player_points_q1&market=alternate_spreads&side=under'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const result = await response.json();
    expect(result).toMatchObject({ demo: true, label: 'TEST DATA · SYNTHETIC NBA FIXTURES' });
    expect(result.presentation.picks.map((pick: { subject: { market: { key: string; side?: string } } }) => pick.subject.market))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'player_points_q1', side: 'under' }),
        expect.objectContaining({ key: 'alternate_spreads' }),
      ]));
    for (const pick of result.presentation.picks) expect(pick).toMatchObject({
      disposition: 'RESEARCH_ONLY', tierDecision: null, pricing: { state: 'UNPRICED', sportsbook: null, americanOdds: null },
      metrics: { trueProbability: null, evPercent: null, researchScore: null },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('covers exactly the 26 verified connection identities while preserving all 41 filter choices elsewhere', async () => {
    expect(NBA_DEMO_MARKET_IDS).toHaveLength(26);
    expect(new Set(NBA_DEMO_MARKET_IDS).size).toBe(26);
    expect(NBA_RESEARCH_MARKETS).toHaveLength(41);
    const result = await (await GET(new Request('http://localhost/api/ai/demo/nba'))).json();
    expect(new Set(result.presentation.picks.map((pick: { subject: { market: { key: string } } }) => pick.subject.market.key)).size).toBe(26);
    expect(result.notice).toContain('No external API or storage access');
  });
  it('rejects unsupported selections by returning no substitute fixture', async () => {
    const result = await (await GET(new Request('http://localhost/api/ai/demo/nba?market=dunks'))).json();
    expect(result.presentation.picks).toEqual([]);
    expect(result.notice).toContain('Not a saved sportsbook receipt');
  });
});