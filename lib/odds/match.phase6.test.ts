import { describe, expect, it } from 'vitest';
import { matchOddsEvent, normalizeMLBTeamName, oddsEventSlateDate } from './match';

const game = (away: string, home: string) => ({
  id: 'g1', date: '2026-09-14', gameTime: '2026-09-14T22:40:00Z', status: 'Scheduled',
  awayTeam: { id: 1, name: away, abbreviation: 'UNK', record: { wins: 0, losses: 0, pct: '0' } },
  homeTeam: { id: 2, name: home, abbreviation: 'UNK', record: { wins: 0, losses: 0, pct: '0' } },
  venue: { id: '1', stadiumName: 'Test', city: 'Test', state: 'Test', timezone: 'America/New_York' },
  venueId: '1', awayProbableStarter: null, homeProbableStarter: null,
});

describe('deterministic MLB team aliases', () => {
  it('normalizes documented aliases without fuzzy matching', () => {
    expect(normalizeMLBTeamName('Athletics')).toBe(normalizeMLBTeamName('Oakland Athletics'));
    expect(normalizeMLBTeamName("A's")).toBe(normalizeMLBTeamName('Athletics'));
    expect(normalizeMLBTeamName('Chicago White Sox')).toBe(normalizeMLBTeamName('White Sox'));
    expect(normalizeMLBTeamName('Arizona Diamondbacks')).toBe(normalizeMLBTeamName('D-backs'));
    expect(normalizeMLBTeamName('Cleveland Guardians')).toBe(normalizeMLBTeamName('Guardians'));
  });

  it('matches home and away in the correct orientation', () => {
    const result = matchOddsEvent(game('Arizona Diamondbacks', 'Miami Marlins') as never, [{
      id: 'e1', awayTeam: 'Marlins', homeTeam: 'D-backs', commenceTime: '2026-09-14T23:40:00Z',
    }]);
    expect(result).toBeNull();
    const matched = matchOddsEvent(game('Miami Marlins', 'Arizona Diamondbacks') as never, [{
      id: 'e2', awayTeam: 'Marlins', homeTeam: 'D-backs', commenceTime: '2026-09-14T23:40:00Z',
    }]);
    expect(matched?.id).toBe('e2');
  });
});

describe('MLB Odds date boundary', () => {
  it('keeps a 01:40Z game on the previous Eastern MLB slate date', () => {
    expect(oddsEventSlateDate({ id: 'e', awayTeam: 'A', homeTeam: 'B', commenceTime: '2026-09-15T01:40:00Z' })).toBe('2026-09-14');
  });

  it('keeps a daytime UTC game on its Eastern calendar date', () => {
    expect(oddsEventSlateDate({ id: 'e', awayTeam: 'A', homeTeam: 'B', commenceTime: '2026-09-14T22:40:00Z' })).toBe('2026-09-14');
  });
});