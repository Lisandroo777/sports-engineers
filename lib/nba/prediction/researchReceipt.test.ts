import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NBA_VERIFIED_RESEARCH_MARKETS, nbaResearchSlateDate, normalizeNBAResearchReceipt, type NBAResearchReceipt } from './researchReceipt';

const saved = resolve('data/nba-v3/live-market-verification/2026-10-24T00-13-19.899Z');
describe('exact US/US2 research receipts', () => {
  it('requests precisely the 26 verified market identities without replacing the 41 filter choices', () => {
    expect(NBA_VERIFIED_RESEARCH_MARKETS).toHaveLength(26);
    expect(NBA_VERIFIED_RESEARCH_MARKETS).toContain('player_assists_q1');
    expect(NBA_VERIFIED_RESEARCH_MARKETS).toContain('alternate_team_totals');
    expect(NBA_VERIFIED_RESEARCH_MARKETS).not.toContain('player_fantasy_points');
  });
  it.skipIf(!existsSync(`${saved}/quotes.json`))('replays the real receipt while excluding two Q1 outcomes beyond the strict freshness window', () => {
    const quoteFile = JSON.parse(readFileSync(`${saved}/quotes.json`, 'utf8'));
    const report = JSON.parse(readFileSync(`${saved}/report.json`, 'utf8'));
    const receipt: NBAResearchReceipt = { ...quoteFile, regions: ['us', 'us2'], requestedMarkets: report.requestedMarkets };
    const expected = { id: receipt.data.id, tipoff: receipt.data.commence_time, homeTeam: receipt.data.home_team, awayTeam: receipt.data.away_team };
    const now = Date.parse(receipt.observedAt);
    expect(nbaResearchSlateDate(receipt.data.commence_time)).toBe('2026-10-23');
    const quotes = normalizeNBAResearchReceipt(receipt, expected, undefined, now);
    expect(quotes).toHaveLength(5989);
    expect(new Set(quotes.map(quote => quote.sourceMarket)).size).toBe(26);
    const q1 = normalizeNBAResearchReceipt(receipt, expected, { marketIds: ['player_rebounds_q1'], sides: ['under'], ranking: 'BEST' }, now);
    expect(q1.length).toBeGreaterThan(0);
    expect(q1.every(quote => quote.period === 'Q1' && quote.selection === 'Under' && quote.regions.join(',') === 'us,us2')).toBe(true);
    expect(normalizeNBAResearchReceipt(receipt, { ...expected, homeTeam: 'Wrong' }, undefined, now)).toEqual([]);
    expect(normalizeNBAResearchReceipt(receipt, expected, undefined, now + 3600001)).toEqual([]);
  });
});