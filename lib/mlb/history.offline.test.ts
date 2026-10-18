import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MLBDataUnavailableError, mlbFetch } from './client';
import { getMLBPlayer } from './players';
import { getMLBResearchGameLogs, getPlayerGameLogs, mapRawGameLogSplit } from './stats';

vi.mock('./client', async (importOriginal) => ({
  ...await importOriginal<typeof import('./client')>(),
  mlbFetch: vi.fn(),
}));
vi.mock('./players', () => ({ getMLBPlayer: vi.fn() }));

const fetchMock = vi.mocked(mlbFetch);
const playerMock = vi.mocked(getMLBPlayer);

function split(date: string, gamePk?: number, gameType?: string, stat: Record<string, unknown> = { hits: 1 }) {
  return { date, game: { gamePk, gameType }, opponent: { name: 'Padres' }, homeAway: 'home', stat };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in history tests.'); }));
  playerMock.mockResolvedValue({ id: 660271, name: 'Shohei Ohtani', position: 'P' });
  fetchMock.mockResolvedValue({ stats: [] });
});

afterEach(() => vi.unstubAllGlobals());

describe('MLB history requests (offline)', () => {
  it('preserves the legacy position-based request and regular-only default, with chronological sorting', async () => {
    fetchMock.mockResolvedValue({ stats: [{ splits: [split('2025-09-02', 2), split('2025-09-01', 1)] }] });
    const logs = await getPlayerGameLogs(660271, 2025);
    expect(playerMock).toHaveBeenCalledWith(660271);
    expect(fetchMock).toHaveBeenCalledWith('/people/660271/stats?stats=gameLog&group=pitching&season=2025', { revalidate: 3600 });
    expect(logs.map((log) => [log.date, log.gameType])).toEqual([['2025-09-01', 'R'], ['2025-09-02', 'R']]);
  });

  it('explicitly requests each postseason type once and reads every stats block', async () => {
    fetchMock.mockImplementation(async (path) => {
      const type = new URL(path, 'https://offline.test').searchParams.get('gameType')!;
      const gamePk = ['F', 'D', 'L', 'W'].indexOf(type) * 2 + 1;
      return { stats: [{ splits: [split('2025-10-01', gamePk, type)] }, { splits: [split('2025-10-02', gamePk + 1, type)] }] };
    });
    const logs = await getPlayerGameLogs(660271, 2025, { group: 'hitting', gameTypes: ['F', 'D', 'L', 'W', 'W'] });
    expect(fetchMock.mock.calls.map(([path]) => new URL(path, 'https://offline.test').searchParams.get('gameType'))).toEqual(['F', 'D', 'L', 'W']);
    expect(logs.map((log) => log.gameType)).toEqual(['F', 'D', 'L', 'W', 'F', 'D', 'L', 'W']);
    expect(playerMock).not.toHaveBeenCalled();
  });

  it('labels omitted game types from the explicit request without adding postseason to the default', async () => {
    fetchMock.mockResolvedValue({ stats: [{ splits: [split('2025-10-01', 1)] }] });
    const explicit = await getPlayerGameLogs(660271, 2025, { group: 'hitting', gameTypes: ['D'] });
    expect(explicit[0].gameType).toBe('D');
    fetchMock.mockResolvedValue({ stats: [{ splits: [split('2025-09-01', 2, 'R'), split('2025-10-01', 1, 'D')] }] });
    const baseline = await getPlayerGameLogs(660271, 2025, { group: 'hitting' });
    expect(baseline.map((log) => log.gamePk)).toEqual([2]);
  });

  it('allows both groups for a two-way player without consulting primary position', async () => {
    fetchMock.mockImplementation(async (path) => ({ stats: [{ splits: [split('2025-09-01', 1, 'R', path.includes('group=pitching') ? { strikeOuts: 8 } : { hits: 3 })] }] }));
    const hitting = await getPlayerGameLogs(660271, 2025, { group: 'hitting' });
    const pitching = await getPlayerGameLogs(660271, 2025, { group: 'pitching' });
    expect(hitting[0].hits).toBe(3);
    expect(hitting[0].inningsPitched).toBeUndefined();
    expect(pitching[0].strikeouts).toBe(8);
    expect(pitching[0].hits).toBeUndefined();
    expect(playerMock).not.toHaveBeenCalled();
  });

  it('deduplicates by ID, retains same-date doubleheaders, and deduplicates ID-less rows by date and opponent', async () => {
    fetchMock.mockResolvedValue({ stats: [{ splits: [
      split('2025-09-02', 20), split('2025-09-01', 10), split('2025-09-01', 11),
      split('2025-09-01', 10), split('2025-09-03', 20),
      split('2025-08-01'), split('2025-08-01'), split('2025-08-02'),
    ] }] });
    const logs = await getPlayerGameLogs(660271, 2025, { group: 'hitting', gameTypes: ['R', 'R'] });
    expect(logs.map((log) => [log.date, log.gamePk])).toEqual([
      ['2025-08-01', undefined], ['2025-08-02', undefined],
      ['2025-09-01', 10], ['2025-09-01', 11], ['2025-09-02', 20],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not invent zero stats from absent, blank, invalid, or boolean fields', () => {
    const log = mapRawGameLogSplit(split('2025-09-01', 1, 'R', { hits: 0, rbi: '', runs: ' ', strikeOuts: 'invalid', baseOnBalls: false }), 'hitting');
    expect(log).toMatchObject({ gamePk: 1, gameType: 'R', hits: 0, rbi: null, runs: null, strikeouts: null, walks: null, atBats: null });
  });

  it('does not fetch when game types are explicitly empty or player ID is missing', async () => {
    expect(await getPlayerGameLogs(660271, 2025, { gameTypes: [] })).toEqual([]);
    expect(await getPlayerGameLogs('', 2025)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(playerMock).not.toHaveBeenCalled();
  });
});

describe('separate slate-aware research history (offline)', () => {
  it('uses the slate year and market group, excludes same-day/future/other-year games, and separates postseason', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    try {
      fetchMock.mockImplementation(async (path) => {
        const type = new URL(path, 'https://offline.test').searchParams.get('gameType')!;
        const splits = type === 'R'
          ? [split('2025-09-29', 2, 'R'), split('2025-09-28', 1, 'R'), split('2024-09-01', 8, 'R'),
            split('2025-10-05', 9, 'R'), split('2025-10-06', 10, 'R'), split('', 11, 'R'), split('2025-02-30', 12, 'R')]
          : type === 'D' ? [split('2025-10-06', 4, 'D'), split('2025-10-04', 3, 'D'), split('2025-10-05', 5, 'D'), split('2025-10-04', 3, 'D')]
            : [];
        return { stats: [{ splits }] };
      });
      const result = await getMLBResearchGameLogs(660271, '2025-10-05', 'batter_hits_alternate');
      expect(result).toMatchObject({ season: 2025, group: 'hitting', slateDate: '2025-10-05', qualityNotes: [] });
      expect(result.regularSeason.map((log) => log.gamePk)).toEqual([1, 2]);
      expect(result.postseason.map((log) => log.gamePk)).toEqual([3]);
      expect(fetchMock.mock.calls).toHaveLength(5);
      for (const [path] of fetchMock.mock.calls) {
        expect(path).toContain('season=2025');
        expect(path).toContain('group=hitting');
      }
      expect(playerMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses pitching for pitcher markets and does not accept leaked postseason rows as baseline', async () => {
    fetchMock.mockImplementation(async (path) => ({ stats: [{ splits: path.endsWith('gameType=R') ? [split('2025-09-01', 1, 'D')] : [] }] }));
    const result = await getMLBResearchGameLogs(660271, '2025-10-05', 'pitcher_strikeouts');
    expect(result.group).toBe('pitching');
    expect(result.regularSeason).toEqual([]);
    expect(result.postseason).toEqual([]);
    expect(result.qualityNotes).toHaveLength(2);
    expect(fetchMock.mock.calls.every(([path]) => path.includes('group=pitching'))).toBe(true);
  });

  it('retains available history and reports unavailable coverage and missing game IDs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fetchMock.mockImplementation(async (path) => {
        if (path.endsWith('gameType=D')) throw new MLBDataUnavailableError();
        return { stats: [{ splits: path.endsWith('gameType=R') ? [split('2025-09-01')] : [] }] };
      });
      const result = await getMLBResearchGameLogs(660271, '2025-10-05', 'batter_hits');
      expect(result.regularSeason).toHaveLength(1);
      expect(result.postseason).toEqual([]);
      expect(result.qualityNotes).toEqual(expect.arrayContaining([
        expect.stringContaining('Game type D history unavailable'),
        expect.stringContaining('No postseason context'),
        expect.stringContaining('game IDs are missing'),
      ]));
    } finally {
      vi.mocked(console.error).mockRestore();
    }
  });

  it('rejects invalid dates and non-player markets before fetching', async () => {
    await expect(getMLBResearchGameLogs(660271, '2025-02-30', 'batter_hits')).rejects.toThrow('slate date');
    await expect(getMLBResearchGameLogs(660271, '2025-10-05T12:00:00Z', 'batter_hits')).rejects.toThrow('slate date');
    await expect(getMLBResearchGameLogs(660271, '2025-10-05', 'totals')).rejects.toThrow('market key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});