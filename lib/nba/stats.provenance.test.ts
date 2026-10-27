import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchLogs } = vi.hoisted(() => ({ fetchLogs: vi.fn() }));
vi.mock('./client', () => ({ espnNBAWebFetch: fetchLogs }));

import { getNBAPlayerGameLogs } from './stats';

afterEach(() => vi.clearAllMocks());

describe('NBA ESPN game-log phase provenance', () => {
  it('preserves explicit made and attempted shooting counts without changing legacy made values', async () => {
    fetchLogs.mockResolvedValue({ names: ['fieldGoalsMade-fieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted'],
      events: { game: { id: 'game', gameDate: '2026-01-01T18:00:00Z', season: { year: 2026, type: 2 } } },
      seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ type: 'event', events: [
        { eventId: 'game', stats: ['8-19', '4-6'] },
      ] }] }],
    });
    expect((await getNBAPlayerGameLogs(10))[0].stats).toEqual({
      'fieldGoalsMade-fieldGoalsAttempted': 8, fieldGoalsMade: 8, fieldGoalsAttempted: 19,
      'freeThrowsMade-freeThrowsAttempted': 4, freeThrowsMade: 4, freeThrowsAttempted: 6,
    });
  });
  it('retains source season and official regular/postseason/play-in metadata without mixing phases', async () => {
    fetchLogs.mockResolvedValue({
      names: ['points', 'minutes'],
      events: {
        regular: { id: 'regular', gameDate: '2026-01-01T18:00:00Z', gameResult: 'W', season: { year: 2026, type: 2, name: '2026 Regular Season' } },
        playin: { id: 'playin', gameDate: '2026-04-15T18:00:00Z', gameResult: 'W', season: { year: 2026, type: 3, name: '2026 Postseason' }, week: { text: 'Play-In' } },
        playoff: { id: 'playoff', gameDate: '2026-04-20T18:00:00Z', gameResult: 'W', season: { year: 2026, type: 3, name: '2026 Postseason' }, week: { text: 'First Round' } },
      },
      seasonTypes: [
        { displayName: '2026 Regular Season', categories: [{ type: 'event', events: [{ eventId: 'regular', stats: ['20', '30:00'] }] }] },
        { displayName: '2026 Postseason Play-In', categories: [{ type: 'event', events: [{ eventId: 'playin', stats: ['18', '28:00'] }] }] },
        { displayName: '2026 Postseason', categories: [{ type: 'event', events: [{ eventId: 'playoff', stats: ['25', '35:00'] }] }] },
        { displayName: '2026 Preseason', categories: [{ type: 'event', events: [{ eventId: 'pre', stats: ['99', '40:00'] }] }] },
      ],
    });
    const logs = await getNBAPlayerGameLogs(10);
    expect(logs.map(({ gameId, season, phase, round }) => ({ gameId, season, phase, round }))).toEqual([
      { gameId: 'regular', season: 2026, phase: 'REGULAR', round: null },
      { gameId: 'playin', season: 2026, phase: 'PLAY_IN', round: 'Play-In' },
      { gameId: 'playoff', season: 2026, phase: 'POSTSEASON', round: 'First Round' },
    ]);
  });
});