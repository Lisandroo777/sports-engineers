import { describe, expect, it } from 'vitest';
import { interpretBettingIntent } from '../../../communication/intent';
import { getNFLMarketHistoricalValue, getNFLMarketMetadata, NFL_ELITE_MARKETS } from '../../nfl/oddsTypes';
import { SPORT_RESEARCH_ADAPTERS } from '../sportResearchAdapters';
import { parseNFLRequestScope } from './nflRequestScope';

describe('NFL kicking registry and scoped requests (offline)', () => {
  it.each([
    ['player_field_goals', 'fieldGoalsMade'],
    ['player_kicking_points', 'kickingPoints'],
  ] as const)('extracts only exact integer %s history', (market, stat) => {
    expect(getNFLMarketMetadata(market)).toMatchObject({ historicalSupport: 'full', gameLogStatKey: stat });
    expect(getNFLMarketMetadata(`${market}_alternate`)).toMatchObject({ historicalSupport: 'full', canonicalMarketKey: market });
    for (const value of [0, 1, 2, 12]) expect(getNFLMarketHistoricalValue(market, { [stat]: value })).toBe(value);
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity]) expect(getNFLMarketHistoricalValue(market, { [stat]: value })).toBeNull();
    expect(getNFLMarketHistoricalValue(market, { extraPointsMade: 4, fieldGoalsAttempted: 3 })).toBeNull();
    expect(getNFLMarketHistoricalValue(market, {})).toBeNull();
  });

  it('includes both supported kicking markets in the NFL-wide default', () => {
    expect(parseNFLRequestScope('Best NFL picks today')).toMatchObject({ marketKeys: null, playerQuery: null, clarification: null });
    expect(NFL_ELITE_MARKETS).toEqual(expect.arrayContaining(['player_field_goals', 'player_kicking_points']));
    expect(SPORT_RESEARCH_ADAPTERS.nfl.marketSupport).toEqual(expect.arrayContaining(['field goals made', 'kicking points']));
    expect(SPORT_RESEARCH_ADAPTERS.nfl.unavailableMarkets).toEqual(['field goals attempted', 'longest field goal', 'team field goals']);
  });

  it.each([
    ['Best NFL FG props', ['player_field_goals']],
    ['Best NFL field goals made props', ['player_field_goals']],
    ['Best NFL fieldgoals props', ['player_field_goals']],
    ['Best NFL kickingpoints props', ['player_kicking_points']],
    ['Best NFL kicking points props', ['player_kicking_points']],
    ['Best NFL kicker props', ['player_kicking_points', 'player_field_goals']],
  ])('routes %s without a phantom player', (query, markets) => {
    expect(parseNFLRequestScope(query)).toMatchObject({ marketKeys: markets, playerQuery: null, marketFamily: null, clarification: null });
    expect(interpretBettingIntent(query)).toMatchObject({ sport: 'nfl', markets, players: [], unsupportedMarket: null, action: 'PICKS' });
  });

  it.each(['0.5', '1.5', '2.5', '3.5', '+0.5', '-0.5'])('strips the complete %s field-goal line without changing player scope', (line) => {
    const queries = [
      [`Best NFL field goals over ${line} props`, null],
      [`NFL FG props for Justin Tucker over ${line}`, 'Justin Tucker'],
    ] as const;
    for (const [query, player] of queries) {
      expect(parseNFLRequestScope(query)).toMatchObject({ playerQuery: player, marketKeys: ['player_field_goals'], clarification: null });
      expect(interpretBettingIntent(query)).toMatchObject({ sport: 'nfl', players: player ? [player] : [], markets: ['player_field_goals'], clarification: null });
    }
  });

  it('preserves signed odds handling before stripping numeric line tokens', () => {
    const query = 'NFL FG props for Justin Tucker over -200';
    expect(parseNFLRequestScope(query)).toMatchObject({ playerQuery: 'Justin Tucker', marketKeys: ['player_field_goals'], clarification: null });
    expect(interpretBettingIntent(query)).toMatchObject({ players: ['Justin Tucker'], action: 'CLARIFY', oddsConstraints: { min: null, max: null } });
    const floorQuery = 'NFL FG props for Justin Tucker -200 or better';
    expect(parseNFLRequestScope(floorQuery).playerQuery).toBe('Justin Tucker');
    expect(interpretBettingIntent(floorQuery)).toMatchObject({ players: ['Justin Tucker'], oddsConstraints: { min: -200, max: null } });
  });

  it.each([
    ['NFL FG attempted props', 'field goals attempted'],
    ['NFL field goal attempts', 'field goals attempted'],
    ['NFL attempted fieldgoals', 'field goals attempted'],
    ['NFL longest FG', 'longest field goal'],
    ['NFL longest field goal props', 'longest field goal'],
    ['NFL team field goals', 'team field goals'],
    ['NFL fieldgoals by team', 'team field goals'],
  ])('clarifies unsupported %s in both entry paths', (query, unsupportedMarket) => {
    const scope = parseNFLRequestScope(query);
    expect(scope.marketKeys).toEqual([]);
    expect(scope.clarification).toContain(unsupportedMarket);
    expect(interpretBettingIntent(query)).toMatchObject({ action: 'CLARIFY', markets: [], unsupportedMarket, clarification: scope.clarification });
  });

  it('does not match FG inside unrelated words or replace rushing scope', () => {
    const scope = parseNFLRequestScope('Best NFL rushing props at Springfield');
    expect(scope.marketFamily).toBe('rushing');
    expect(scope.marketKeys).not.toContain('player_field_goals');
    expect(scope.marketKeys).toContain('player_rush_yds');
    expect(parseNFLRequestScope('NFL field goals made and rushing attempts').clarification).toBeNull();
    expect(parseNFLRequestScope('NFL field goals made and longest rush').clarification).toBeNull();
  });

  it('does not apply NFL kicking routing to MLB', () => {
    expect(interpretBettingIntent('Best MLB longest field goal props')).toMatchObject({ sport: 'mlb', markets: [], unsupportedMarket: null });
    expect(interpretBettingIntent('Best MLB kicking points props')).toMatchObject({ sport: 'mlb', markets: [] });
  });

  it.each(['Best FG props', 'Best field goals made props', 'Best kicking points props', 'Best kicker props'])('uses the NFL hint for %s without inventing a player', (query) => {
    expect(interpretBettingIntent(query, [], null, 'nfl')).toMatchObject({ sport: 'nfl', players: [], action: 'PICKS', clarification: null });
  });

  it('keeps explicit player and team restrictions on kicking requests', () => {
    const query = 'Best Justin Tucker field goals made props for Ravens';
    expect(parseNFLRequestScope(query)).toMatchObject({ playerQuery: 'Justin Tucker', teams: ['Baltimore Ravens'], marketKeys: ['player_field_goals'] });
    expect(interpretBettingIntent(query)).toMatchObject({ players: ['Justin Tucker'], teams: ['Baltimore Ravens'], markets: ['player_field_goals'] });
  });
});