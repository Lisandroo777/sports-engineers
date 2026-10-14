import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchNFLPlayers } from './players';
import { espnWebFetch } from './client';

vi.mock('./client', () => ({ espnWebFetch: vi.fn() }));
vi.mock('./teams', () => ({ getNFLTeam: vi.fn(async () => ({ id: 1, displayName: 'Verified Team' })) }));
afterEach(() => vi.resetAllMocks());

describe('NFL player search availability', () => {
  it('does not hydrate unrelated broad search results', async () => {
    vi.mocked(espnWebFetch).mockResolvedValueOnce({ results: [{ type: 'player', contents: [
      { displayName: 'Patrick Mahomes', link: { web: '/id/3139477/player' } },
      { displayName: 'Unrelated Athlete', link: { web: '/id/42164/player' } },
    ] }] }).mockResolvedValueOnce({ athlete: { id: '3139477', fullName: 'Patrick Mahomes', position: { abbreviation: 'QB' } } });
    expect(await searchNFLPlayers('Patrick Mahomes')).toMatchObject([{ id: 3139477, name: 'Patrick Mahomes' }]);
    expect(espnWebFetch).toHaveBeenCalledTimes(2);
    expect(espnWebFetch).not.toHaveBeenCalledWith(expect.stringContaining('42164'), expect.anything(), expect.anything());
  });

  it('preserves surname ambiguity while omitting unavailable profiles without fabricated stats', async () => {
    vi.mocked(espnWebFetch).mockResolvedValueOnce({ results: [{ type: 'player', contents: [
      { displayName: 'Josh Allen', link: { web: '/id/1/player' } },
      { displayName: 'Kyle Allen', link: { web: '/id/2/player' } },
      { displayName: 'Allen Unavailable', link: { web: '/id/3/player' } },
    ] }] }).mockResolvedValueOnce({ athlete: { id: '1', fullName: 'Josh Allen' } })
      .mockResolvedValueOnce({ athlete: { id: '2', fullName: 'Kyle Allen' } }).mockRejectedValueOnce(new Error('NFL request failed (404)'));
    const results = await searchNFLPlayers('Allen');
    expect(results.map(player => player.name)).toEqual(['Josh Allen', 'Kyle Allen']);
    expect(results.every(player => player.position === 'N/A' && player.team === null && player.age === null)).toBe(true);
  });

  it('returns no player when the only matching profile is unavailable', async () => {
    vi.mocked(espnWebFetch).mockResolvedValueOnce({ results: [{ type: 'player', contents: [
      { displayName: 'Missing Player', link: { web: '/id/3/player' } },
    ] }] }).mockRejectedValueOnce(new Error('NFL request failed (404)'));
    expect(await searchNFLPlayers('Missing Player')).toEqual([]);
  });
});