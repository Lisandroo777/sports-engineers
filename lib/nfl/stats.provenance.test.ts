import { afterEach, describe, expect, it, vi } from 'vitest';
import { espnWebFetch } from './client';
import { getPlayerGameLogs } from './stats';

vi.mock('./client', () => ({ espnWebFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe('NFL historical log provenance', () => {
  it('records the requested season and per-game team rather than today\'s roster team', async () => {
    vi.mocked(espnWebFetch).mockResolvedValue({
      names: ['passingAttempts', 'passingYards'],
      events: { old: { gameDate: '2025-09-10', gameResult: 'W', team: { id: '13' }, starter: true, position: { abbreviation: 'QB' } } },
      seasonTypes: [{ displayName: '2025 Regular Season', categories: [{ type: 'event', events: [{ eventId: 'old', stats: ['35', '280'] }] }] }],
    });
    const logs = await getPlayerGameLogs(1, 2025);
    expect(logs[0]).toMatchObject({ season: 2025, teamId: 13, position: 'QB', started: true, roleEvidence: ['PASSING'] });
    expect(espnWebFetch).toHaveBeenCalledWith(expect.any(String), { season: '2025' }, 0);
  });

  it('keeps unavailable metadata unknown and blank stats missing', async () => {
    vi.mocked(espnWebFetch).mockResolvedValue({
      names: ['passingAttempts', 'passingYards', 'rushingYards'],
      events: { old: { gameDate: '2025-09-10', gameResult: 'W' } },
      seasonTypes: [{ displayName: '2025 Regular Season', categories: [{ type: 'event', events: [{ eventId: 'old', stats: ['35', '', '-'] }] }] }],
    });
    const logs = await getPlayerGameLogs(1, 2025);
    expect(logs[0]).toMatchObject({ teamId: null, position: null, started: null, stats: { passingAttempts: 35 } });
    expect(logs[0].stats.passingYards).toBeUndefined();
  });

  it('does not relabel a mismatched provider season or include preseason', async () => {
    vi.mocked(espnWebFetch).mockResolvedValue({
      names: ['passingYards'], events: { old: { gameDate: '2024-09-10', gameResult: 'W' } },
      seasonTypes: ['2024 Regular Season', '2025 Preseason'].map((displayName) => ({ displayName, categories: [{ type: 'event', events: [{ eventId: 'old', stats: ['280'] }] }] })),
    });
    expect(await getPlayerGameLogs(1, 2025)).toEqual([]);
  });
});