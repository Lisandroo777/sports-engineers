import { describe, expect, it } from 'vitest';
import { createNFLSlateLedger, finishNFLSlateLedger } from './slateLedger';
import type { NFLGame } from './types';

const now = Date.parse('2026-10-11T12:00:00Z');
function games(count: number): NFLGame[] { return Array.from({ length: count }, (_, index) => ({ id: String(index), gameTime: '2026-10-11T17:00:00Z', completed: false,
  homeTeam: { displayName: 'Home' }, awayTeam: { displayName: 'Away' } } as NFLGame)); }

describe('complete requested NFL slate ledger', () => {
  it('accounts for all 14 games without marking selected games researched prematurely', () => {
    const ledger = createNFLSlateLedger(games(14), '2026-10-11', ['player_pass_yds'], now);
    expect(ledger.expectedGames).toBe(14); expect(ledger.eligiblePregame).toBe(14);
    expect(ledger.notFetchedGames).toBe(14); expect(ledger.researchedGames).toBe(0); expect(ledger.researchComplete).toBe(false);
  });
  it('keeps zero markets distinct from successful research and failure', () => {
    const ledger = createNFLSlateLedger(games(14), '2026-10-11', ['player_pass_yds'], now);
    ledger.games.forEach((game) => { game.state = 'RESEARCHED'; });
    ledger.games[0].state = 'ZERO_MARKETS'; ledger.games[1].state = 'FAILED';
    const result = finishNFLSlateLedger(ledger);
    expect(result.researchedGames).toBe(12); expect(result.zeroMarketGames).toBe(1); expect(result.failedGames).toBe(1); expect(result.researchComplete).toBe(false);
  });
  it.each([1, 13])('does not claim research complete when %i games have no supported markets', (emptyGames) => {
    const ledger = createNFLSlateLedger(games(13), '2026-10-11', ['player_pass_yds'], now);
    ledger.games.forEach((game, index) => {
      game.state = index < emptyGames ? 'ZERO_MARKETS' : 'RESEARCHED';
      game.retrievedAt = '2026-10-05T06:32:02Z';
    });
    const result = finishNFLSlateLedger(ledger);
    expect(result.retrievedGames).toBe(13);
    expect(result.zeroMarketGames).toBe(emptyGames);
    expect(result.researchedGames).toBe(13 - emptyGames);
    expect(result.failedGames).toBe(0);
    expect(result.researchComplete).toBe(false);
  });
  it('permits completion only when every eligible game has been researched', () => {
    const ledger = createNFLSlateLedger(games(13), '2026-10-11', ['player_pass_yds'], now);
    ledger.games.forEach((game) => { game.state = 'RESEARCHED'; });
    expect(finishNFLSlateLedger(ledger).researchComplete).toBe(true);
  });
  it('excludes started, final, and postponed games for legitimate reasons', () => {
    const slate = games(4); slate[0].completed = true; slate[1].gameTime = '2026-10-11T11:00:00Z'; slate[2].status = 'STATUS_POSTPONED';
    const ledger = createNFLSlateLedger(slate, '2026-10-11', ['player_pass_yds'], now);
    expect(ledger.expectedGames).toBe(4); expect(ledger.eligiblePregame).toBe(1); expect(ledger.started).toBe(1); expect(ledger.final).toBe(1); expect(ledger.excluded).toBe(1);
  });
});