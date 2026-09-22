import { describe, expect, it } from 'vitest';
import { parseNFLKickoffForecast } from './weather';
import type { NFLGame } from './types';

function game(indoor: boolean | null, venue = 'Soldier Field'): NFLGame {
  return {
    id: 'g1', week: 2, gameTime: '2026-09-20T17:00:00Z', homeTeam: {} as NFLGame['homeTeam'], awayTeam: {} as NFLGame['awayTeam'],
    homeScore: null, awayScore: null, completed: false,
    venue: { id: '3933', name: venue, indoor, city: 'Chicago', state: 'IL', country: 'USA' },
  };
}

describe('NFL weather and game environment', () => {
  it('returns venue-bound kickoff weather for an outdoor game without betting heuristics', () => {
    const context = parseNFLKickoffForecast(game(false), { hourly: {
      time: ['2026-09-20T16:00', '2026-09-20T17:00', '2026-09-20T18:00'],
      temperature_2m: [65, 64, 63], wind_speed_10m: [12, 10, 8], wind_gusts_10m: [21, 19, 15],
      precipitation: [0.01, 0.02, 0.1], weather_code: [51, 63, 65],
    } });
    expect(context).toMatchObject({ environment: 'OUTDOOR', sourceStatus: 'AVAILABLE', forecastTimestamp: '2026-09-20T17:00Z' });
    expect(context.temperature).toEqual({ value: 64, unit: 'F' });
    expect(context.wind).toEqual({ speed: 10, unit: 'mph' });
    expect(context.conditions).toBe('Rain');
    expect(context).not.toHaveProperty('bettingPenalty');
  });

  it('marks an ESPN-confirmed indoor venue not materially applicable without fetching outdoor weather', () => {
    const context = parseNFLKickoffForecast(game(true, 'Mercedes-Benz Stadium'), null);
    expect(context).toMatchObject({ environment: 'INDOOR', sourceStatus: 'NOT_APPLICABLE', temperature: null, wind: null, precipitation: null });
    expect(context.missingFields).toContain('roof open/closed status');
  });

  it('fails closed when outdoor kickoff weather is unavailable', () => {
    const context = parseNFLKickoffForecast(game(false), null);
    expect(context.sourceStatus).toBe('UNKNOWN');
    expect(context.temperature).toBeNull();
    expect(context.missingFields).toContain('kickoff-hour forecast');
  });

  it('reports provider-coded severe conditions without inventing an impact score', () => {
    const context = parseNFLKickoffForecast(game(false), { hourly: {
      time: ['2026-09-20T17:00'], temperature_2m: [70], wind_speed_10m: [15], wind_gusts_10m: [25], precipitation: [0.2], weather_code: [95],
    } });
    expect(context.severeConditions).toEqual(['Thunderstorm']);
  });
});