import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStalePersistentCache } from '../odds/persistentCache';
import { getNFLSportsbookEvents, retrieveNFLSportsbookGame, withNFLRecordedSportsbook } from './sportsbook';

vi.mock('../odds/persistentCache', () => ({ readStalePersistentCache: vi.fn() }));
const event = { id: 'recorded', homeTeam: 'Saints', awayTeam: 'Falcons', commenceTime: '2026-10-06T00:15:00Z' };
beforeEach(() => vi.mocked(readStalePersistentCache).mockResolvedValue({ key: 'fixture', cachedAt: 1, expiresAt: 1, data: {
  version: 1, sport: 'nfl', date: '2026-10-05', gameId: 'game', eventId: 'recorded', kickoff: event.commenceTime,
  markets: { player_pass_yds: { status: 'RETURNED', retrievedAt: '2026-10-05T04:49:54Z', expiresAt: 1, props: [] } },
} }));

describe('read-only recorded NFL research', () => {
  it('preserves expiry rather than claiming historical prices are fresh', async () => {
    await withNFLRecordedSportsbook({ date: '2026-10-05', gameId: 'game', event }, async () => {
      expect(await getNFLSportsbookEvents()).toEqual([event]);
      const result = await retrieveNFLSportsbookGame({ date: '2026-10-05', gameId: 'game', eventId: event.id, kickoff: event.commenceTime, markets: ['player_pass_yds'] });
      expect(result.expiresAt).toBe(1); expect(result.fromCache).toBe(true); expect(result.retrievedAt).toBe('2026-10-05T04:49:54Z');
      await expect(retrieveNFLSportsbookGame({ date: '2026-10-05', gameId: 'other', eventId: event.id, kickoff: event.commenceTime, markets: ['player_pass_yds'] })).rejects.toThrow('cannot expand');
    });
  });
  it('cannot fabricate absent market coverage or another game snapshot', async () => {
    await expect(withNFLRecordedSportsbook({ date: '2026-10-05', gameId: 'wrong', event }, async () => null)).rejects.toThrow('does not match');
    await withNFLRecordedSportsbook({ date: '2026-10-05', gameId: 'game', event }, async () => {
      await expect(retrieveNFLSportsbookGame({ date: '2026-10-05', gameId: 'game', eventId: event.id, kickoff: event.commenceTime, markets: ['player_receptions'] })).rejects.toThrow('coverage is incomplete');
    });
  });
});