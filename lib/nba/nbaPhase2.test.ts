import { describe, it, expect } from 'vitest';
import { getNBAMarketMetadata, isNBAHistoricalMarketSupported } from './oddsTypes';
import { classifyNBAInjuryTier } from './injuries';
import { buildNBAEliteCandidate, type NBAResearchCandidate } from './research';
import { projectNBAMarket } from './projection';
import type { NBAGameLogEntry } from './types';

describe('NBA sportsbook market normalization', () => {
  it('maps real Odds API NBA market keys to supported internal markets', () => {
    expect(getNBAMarketMetadata('player_points')?.canonicalMarketKey).toBe('points');
    expect(getNBAMarketMetadata('player_rebounds')?.canonicalMarketKey).toBe('rebounds');
    expect(getNBAMarketMetadata('player_assists')?.canonicalMarketKey).toBe('assists');
    expect(getNBAMarketMetadata('player_threes')?.canonicalMarketKey).toBe('3pm');
    expect(getNBAMarketMetadata('player_blocks')?.canonicalMarketKey).toBe('blocks');
    expect(getNBAMarketMetadata('player_steals')?.canonicalMarketKey).toBe('steals');
    expect(getNBAMarketMetadata('player_turnovers')?.canonicalMarketKey).toBe('turnovers');
    expect(getNBAMarketMetadata('player_points_rebounds_assists')?.canonicalMarketKey).toBe('pra');
    expect(getNBAMarketMetadata('player_points_rebounds')?.canonicalMarketKey).toBe('pr');
    expect(getNBAMarketMetadata('player_points_assists')?.canonicalMarketKey).toBe('pa');
    expect(getNBAMarketMetadata('player_rebounds_assists')?.canonicalMarketKey).toBe('ra');
  });

  it('parses alternate suffixes without inventing a different market', () => {
    const meta = getNBAMarketMetadata('player_points_alternate');
    expect(meta?.canonicalMarketKey).toBe('points');
    expect(meta?.isAlternate).toBe(true);
  });

  it('never guesses a market key it does not recognize', () => {
    expect(getNBAMarketMetadata('player_double_double')).toBeNull();
    expect(getNBAMarketMetadata('player_fantasy_points')).toBeNull();
    expect(getNBAMarketMetadata('player_minutes')).toBeNull();
    expect(isNBAHistoricalMarketSupported('player_field_goals')).toBe(false);
  });
});

describe('NBA injury tier classification', () => {
  it('classifies OUT statuses deterministically', () => {
    expect(classifyNBAInjuryTier('Out')).toBe('OUT');
    expect(classifyNBAInjuryTier('Out For The Season')).toBe('OUT');
  });
  it('classifies doubtful/questionable statuses', () => {
    expect(classifyNBAInjuryTier('Doubtful')).toBe('DOUBTFUL');
    expect(classifyNBAInjuryTier('Questionable')).toBe('QUESTIONABLE');
    expect(classifyNBAInjuryTier('Day-To-Day')).toBe('QUESTIONABLE');
  });
  it('never guesses ACTIVE for unparseable text', () => {
    expect(classifyNBAInjuryTier('Some New Status ESPN Invented')).toBe('UNKNOWN');
    expect(classifyNBAInjuryTier(null)).toBe('UNKNOWN');
  });
});

function gameLog(points: number, minutes: number, resultTag = 'W'): NBAGameLogEntry {
  return { gameId: 'g', date: '2024-01-01', opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: resultTag, stats: { points, totalRebounds: 5, assists: 3, minutes } };
}

describe('NBA projection fails closed for OUT players', () => {
  it('never returns a usable projection when injuryTier is OUT, regardless of history', () => {
    const logs = Array.from({ length: 20 }, () => gameLog(25, 34));
    const projection = projectNBAMarket({ logs, market: 'points', injuryTier: 'OUT' });
    expect(projection.status).toBe('UNAVAILABLE');
    expect(projection.reliabilityReasons).toContain('INJURY_LISTED');
  });
});

describe('NBA Elite candidate adapter', () => {
  it('declares projectionAgreement and opponentPersonnel unsupported, never penalized as risk', () => {
    const candidate: NBAResearchCandidate = {
      candidateId: 'c1', playerId: 1, player: 'Test Player', market: 'points', line: 20, direction: 'over',
      projection: 25, projectionUncertainty: 4, logs: [],
      matchupAvailable: true, injuryTier: 'ACTIVE', oddsAmerican: -110, lastUpdatedAt: new Date().toISOString(),
      isAlternate: false, marketSupport: 'full',
    };
    const input = buildNBAEliteCandidate(candidate);
    expect(input.unsupportedSignals).toContain('projectionAgreement');
    expect(input.unsupportedSignals).toContain('opponentPersonnel');
    expect(input.marketSupport).toBe('SUPPORTED');
  });
});
