import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNFLSchedule, getNFLUpcomingGameDate } from './schedule';
import { espnSiteFetch } from './client';

vi.mock('./client', () => ({ espnSiteFetch: vi.fn() }));

afterEach(() => vi.resetAllMocks());

function event(date: string, teams: number[], completed = false) {
  return { date, competitions: [{ status: { type: { completed } }, competitors: teams.map((id) => ({ team: { id: String(id) } })) }] };
}

describe('upcoming NFL scope dates', () => {
  it('skips started and final games and preserves Sunday night in Eastern time', async () => {
    vi.mocked(espnSiteFetch).mockResolvedValue({ events: [
      event('2026-10-04T17:00:00Z', [12, 13]), event('2026-10-05T00:20:00Z', [12, 13]),
      event('2026-10-03T17:00:00Z', [12, 13], true),
    ] });
    expect(await getNFLUpcomingGameDate([12, 13], new Date('2026-10-04T20:00:00Z'))).toBe('2026-10-04');
  });

  it('requires every requested team in the same game', async () => {
    vi.mocked(espnSiteFetch).mockResolvedValue({ events: [event('2026-10-05T00:20:00Z', [12, 15])] });
    expect(await getNFLUpcomingGameDate([12, 13], new Date('2026-10-04T20:00:00Z'))).toBeNull();
  });
});

describe('ESPN scoreboard game market lines', () => {
  it('normalizes provider-tagged current and opening spread/total without inventing absent values', async () => {
    vi.mocked(espnSiteFetch).mockResolvedValue({ events: [{ id: 'game', date: '2026-10-11T17:00:00Z', competitions: [{
      competitors: [
        { id: '1', homeAway: 'home', team: { id: '1', displayName: 'Home', abbreviation: 'H' } },
        { id: '2', homeAway: 'away', team: { id: '2', displayName: 'Away', abbreviation: 'A' } },
      ],
      odds: [{ provider: { displayName: 'DraftKings' }, spread: -3.5, overUnder: 47.5,
        pointSpread: { home: { open: { line: '-2.5' }, close: { line: '-3.5' } } },
        total: { over: { open: { line: 'o45.5' }, close: { line: 'o47.5' } } } }],
    }] }] });
    const [game] = await getNFLSchedule({ date: '2026-10-11' });
    expect(game.odds?.[0]).toMatchObject({ provider: 'DraftKings', homeSpread: -3.5, openingHomeSpread: -2.5, total: 47.5, openingTotal: 45.5 });
  });

  it('preserves ESPN season type, week, and explicitly labeled playoff round', async () => {
    vi.mocked(espnSiteFetch).mockResolvedValue({ events: [{ id: 'postseason-game', date: '2027-01-10T18:00:00Z',
      season: { year: 2026, type: 3, name: 'Postseason' }, week: { number: 19, text: 'Wild Card' }, competitions: [{
        competitors: [
          { id: '1', homeAway: 'home', team: { id: '1', displayName: 'Home', abbreviation: 'H' } },
          { id: '2', homeAway: 'away', team: { id: '2', displayName: 'Away', abbreviation: 'A' } },
        ],
      }] }] });
    const [game] = await getNFLSchedule({ date: '2027-01-10' });
    expect(game).toMatchObject({ season: 2026, week: 19, seasonType: 'POSTSEASON', playoffRound: 'WILD_CARD' });
  });
});