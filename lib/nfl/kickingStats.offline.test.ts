import { afterEach, describe, expect, it, vi } from 'vitest';
import { espnWebFetch } from './client';
import { getNFLKickingResearch } from './kickingResearch';
import { getPlayerGameLogs, NFL_STAT_KEYS, normalizeNFLKickingStats } from './stats';

vi.mock('./client', () => ({ espnWebFetch: vi.fn() }));

const capturedPublicResponse = {
  label: 'Actual public ESPN response: captured names and event stats',
  sourceUrl: 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3055899/gamelog?season=2025',
  eventId: '401772957',
  names: [
    'fieldGoalsMade1_19-fieldGoalAttempts1_19',
    'fieldGoalsMade20_29-fieldGoalAttempts20_29',
    'fieldGoalsMade30_39-fieldGoalAttempts30_39',
    'fieldGoalsMade40_49-fieldGoalAttempts40_49',
    'fieldGoalsMade50-fieldGoalAttempts50',
    'longFieldGoalMade', 'fieldGoalPct', 'fieldGoalsMade-fieldGoalAttempts',
    'fieldGoalsMadeYardsAverage', 'extraPointsMade-extraPointAttempts', 'totalKickingPoints',
  ],
  stats: ['0-0', '0-0', '1-1', '3-3', '0-0', '47', '100.0', '4-4', '41', '0-0', '12'],
};

function normalize(raw: Record<string, string>) {
  return normalizeNFLKickingStats(Object.keys(raw), Object.values(raw));
}

afterEach(() => vi.clearAllMocks());

describe('offline NFL kicking normalization', () => {
  it.each(['2/3', '2-3', ' 2 / 3 '])('parses exact FG pair %s', (value) => {
    expect(normalize({ fieldGoalsMade: value })).toEqual({ fieldGoalsMade: 2, fieldGoalAttempts: 3 });
  });

  it.each(['fieldGoalAttempts', 'fieldGoalsAttempted'])('accepts explicit attempts alias %s', (alias) => {
    expect(normalize({ fieldGoalsMade: '2', [alias]: '3' })).toEqual({ fieldGoalsMade: 2, fieldGoalAttempts: 3 });
  });

  it('keeps XP separate and only derives points from both known made counts', () => {
    expect(normalize({ extraPointsMade: '4', extraPointsAttempted: '4' })).toEqual({ extraPointsMade: 4, extraPointAttempts: 4 });
    expect(normalize({ fieldGoalsMade: '2', extraPointsMade: '4' })).toEqual({ fieldGoalsMade: 2, extraPointsMade: 4, kickingPoints: 10 });
    expect(normalize({ fieldGoalsMade: '2' })).not.toHaveProperty('kickingPoints');
    expect(normalize({ totalKickingPoints: '7' })).toEqual({ kickingPoints: 7 });
  });

  it.each(['2/3 trailing', '66.7%', '2.5', '-1', '2/3/4', '', '--', 'Infinity', '9007199254740992'])('rejects invalid counts %s', (value) => {
    expect(normalize({ fieldGoalsMade: value })).toEqual({});
  });

  it('rejects impossible or conflicting made/attempt counts and explicit points', () => {
    expect(normalize({ fieldGoalsMade: '4/3' })).toEqual({});
    expect(normalize({ fieldGoalsMade: '2/3', fieldGoalAttempts: '4' })).toEqual({});
    expect(normalize({ fieldGoalsMade: '2', fieldGoalAttempts: '3', fieldGoalsAttempted: '4' })).toEqual({});
    expect(normalize({ extraPointsMade: '4', extraPointAttempts: '3' })).toEqual({});
    expect(normalize({ fieldGoalsMade: '2', extraPointsMade: '1', kickingPoints: '8' })).not.toHaveProperty('kickingPoints');
    expect(normalize({ fieldGoalsMade: '2', extraPointsMade: '1', kickingPoints: '-' })).not.toHaveProperty('kickingPoints');
    expect(normalize({ fieldGoalsMade: '2', kickingPoints: '5' })).not.toHaveProperty('kickingPoints');
    expect(normalize({ extraPointsMade: '4', kickingPoints: '3' })).not.toHaveProperty('kickingPoints');
    expect(normalize({ fieldGoalsMade: String(Number.MAX_SAFE_INTEGER), extraPointsMade: '1' })).not.toHaveProperty('kickingPoints');
  });

  it('preserves explicit zeros and remaining explicit aliases without filling missing fields', () => {
    expect(normalize({ fieldGoalsMade: '0', fieldGoalsAttempted: '0', extraPointsMade: '0', extraPointsAttempted: '0' })).toEqual({
      fieldGoalsMade: 0, fieldGoalAttempts: 0, extraPointsMade: 0, extraPointAttempts: 0, kickingPoints: 0,
    });
    expect(normalize({ fieldGoalAttempts: '3' })).toEqual({ fieldGoalAttempts: 3 });
    expect(normalize({ longestFieldGoal: '49', fieldGoalsMade1_19: '0', fieldGoalsMade20_29: '0', fieldGoalsMade30_39: '1', fieldGoalsMade50Plus: '0' })).toEqual({
      longestFieldGoal: 49, fieldGoalsMadeUnder40: 1, fieldGoalsMade50Plus: 0,
    });
    expect(normalize({ fieldGoalsMade40_49: '1' })).toEqual({ fieldGoalsMade40_49: 1 });
  });

  it('requires complete short buckets and never infers distance counts from total makes', () => {
    expect(normalize({ fieldGoalsMade: '3' })).not.toHaveProperty('fieldGoalsMadeUnder40');
    expect(normalize({ fieldGoalsMade20_29: '1', fieldGoalsMade30_39: '1' })).toEqual({});
    expect(normalize({ fieldGoalsMade0_19: '0', fieldGoalsMade20_29: '1', fieldGoalsMade30_39: '1', fieldGoalsMade40_49: '0', fieldGoalsMade50: '1' })).toEqual({
      fieldGoalsMadeUnder40: 2, fieldGoalsMade40_49: 0, fieldGoalsMade50Plus: 1,
    });
    expect(normalize({ fieldGoalsMade: '1', fieldGoalsMade40_49: '2' })).toEqual({ fieldGoalsMade: 1 });
    expect(normalize({ fieldGoalsMade: '2', fieldGoalsMade0_19: '0', fieldGoalsMade20_29: '0', fieldGoalsMade30_39: '0', fieldGoalsMade40_49: '0', fieldGoalsMade50: '1' })).toEqual({ fieldGoalsMade: 2 });
  });

  it('sums short made and attempt counts only when all three are observed', () => {
    const short = {
      'fieldGoalsMade1_19-fieldGoalAttempts1_19': '0-0',
      'fieldGoalsMade20_29-fieldGoalAttempts20_29': '1-2',
      'fieldGoalsMade30_39-fieldGoalAttempts30_39': '2-3',
    };
    expect(normalize(short)).toEqual({ fieldGoalsMadeUnder40: 3, fieldGoalAttemptsUnder40: 5 });
    expect(normalize({ ...short, 'fieldGoalsMade1_19-fieldGoalAttempts1_19': '' })).toEqual({});
    expect(normalize({ 'fieldGoalsMade20_29-fieldGoalAttempts20_29': '1-2', 'fieldGoalsMade30_39-fieldGoalAttempts30_39': '2-3' })).toEqual({});
    expect(normalize({ fieldGoalsMade1_19: '0', fieldGoalsMade20_29: '1', fieldGoalsMade30_39: '2',
      fieldGoalAttempts20_29: '2', fieldGoalAttempts30_39: '3' })).toEqual({ fieldGoalsMadeUnder40: 3 });
  });

  it('keeps verified XP compounds disjoint from FG counts and rejects contradictory aliases', () => {
    expect(normalize({ 'extraPointsMade-extraPointAttempts': '3-4' })).toEqual({ extraPointsMade: 3, extraPointAttempts: 4 });
    expect(normalize({ 'extraPointsMade-extraPointAttempts': '3-4', extraPointAttempts: '5' })).toEqual({});
    expect(normalize({ 'fieldGoalsMade-fieldGoalAttempts': '4-4', fieldGoalsMade: '3' })).toEqual({});
    expect(normalize({ 'fieldGoalsMade-fieldGoalAttempts': '4-4', fieldGoalAttempts: '5' })).toEqual({});
    expect(normalize({ longFieldGoalMade: '47', longestFieldGoal: '48' })).toEqual({});
  });

  it.each(['4-3', '3-3 trailing', '3/3/3', '-1-3', '3.5-4', '9007199254740992-9007199254740992'])('fails closed for invalid compound bucket %s', (value) => {
    expect(normalize({ 'fieldGoalsMade40_49-fieldGoalAttempts40_49': value })).toEqual({});
  });

  it('rejects contradictory bucket aliases or attempt totals without losing valid overall counts', () => {
    expect(normalize({ 'fieldGoalsMade40_49-fieldGoalAttempts40_49': '3-3', fieldGoalAttempts40_49: '4' })).toEqual({});
    expect(normalize({ 'fieldGoalsMade40_49-fieldGoalAttempts40_49': '3-3', fieldGoalsMade40_49: '2' })).toEqual({});
    expect(normalize({ 'fieldGoalsMade-fieldGoalAttempts': '1-2', 'fieldGoalsMade40_49-fieldGoalAttempts40_49': '1-3' })).toEqual({
      fieldGoalsMade: 1, fieldGoalAttempts: 2,
    });
    expect(normalize({ 'fieldGoalsMade-fieldGoalAttempts': '4-5',
      'fieldGoalsMade1_19-fieldGoalAttempts1_19': '0-0', 'fieldGoalsMade20_29-fieldGoalAttempts20_29': '0-0',
      'fieldGoalsMade30_39-fieldGoalAttempts30_39': '1-1', 'fieldGoalsMade40_49-fieldGoalAttempts40_49': '3-3',
      'fieldGoalsMade50-fieldGoalAttempts50': '0-0' })).toEqual({ fieldGoalsMade: 4, fieldGoalAttempts: 5 });
  });

  it('does not infer longest FG from attempts, percentage, XP, or a missing field', () => {
    expect(normalize({ fieldGoalAttempts: '0' })).toEqual({ fieldGoalAttempts: 0 });
    expect(normalize({ longFieldGoal: '0', fieldGoalAttempts: '0' })).not.toHaveProperty('longestFieldGoal');
    expect(normalize({ longFieldGoal: '52' })).toEqual({ longestFieldGoal: 52 });
    expect(normalize({ longFieldGoal: '52/60', fieldGoalPct: '100', extraPointsMade: '3' })).toEqual({ extraPointsMade: 3 });
    expect(normalize({ 'fieldGoalsMade-fieldGoalAttempts': '2-3' })).toEqual({ fieldGoalsMade: 2, fieldGoalAttempts: 3 });
    expect(normalize({ 'fieldGoalsMade/fieldGoalAttempts': '2/3', FG: '2/3' })).toEqual({});
    expect(normalize({})).toEqual({});
  });

  it('integrates raw names/values and leaves unrelated passing parsing unchanged', async () => {
    vi.mocked(espnWebFetch).mockResolvedValue({
      names: ['fieldGoalsMade', 'extraPointsMade', 'extraPointAttempts', 'passingYards', 'passingAttempts', 'completionPct', 'longFieldGoal', 'fieldGoalsMade40_49', 'fieldGoalsMadeUnder40'],
      events: { game: { id: 'game', gameDate: '2026-10-11T17:00:00Z', gameResult: 'W' } },
      seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ type: 'event', events: [{ eventId: 'game', stats: ['2/3', '1', '1', '1,234', '20', '65.5', '52', '-1', '7'] }] }] }],
    });
    const [entry] = await getPlayerGameLogs('offline-kicker', 2026);
    expect(entry.stats).toEqual({ fieldGoalsMade: 2, fieldGoalAttempts: 3, extraPointsMade: 1, extraPointAttempts: 1,
      kickingPoints: 7, longestFieldGoal: 52, passingYards: 1234, passingAttempts: 20, completionPct: 65.5 });
    expect(NFL_STAT_KEYS.fieldGoalAttempts).toBe('fieldGoalAttempts');
    expect(espnWebFetch).toHaveBeenCalledTimes(1);
  });

  it('loads the actual public response capture through the mocked endpoint into kicking research', async () => {
    const fixture = capturedPublicResponse;
    const source = new URL(fixture.sourceUrl);
    vi.mocked(espnWebFetch).mockImplementation(async (path, params, revalidate) => {
      expect(path).toBe(source.pathname.replace('/apis/', ''));
      expect(params).toEqual({ season: source.searchParams.get('season') });
      expect(revalidate).toBe(0);
      return {
        names: fixture.names,
        events: { [fixture.eventId]: { id: fixture.eventId, gameDate: '2025-09-01T00:00:00Z', gameResult: 'Offline metadata scaffold' } },
        seasonTypes: [{ displayName: '2025 Regular Season', categories: [{ type: 'event',
          events: [{ eventId: fixture.eventId, stats: fixture.stats }] }] }],
      };
    });
    const logs = await getPlayerGameLogs('3055899', 2025);
    expect(logs).toHaveLength(1);
    expect(logs[0].gameId).toBe(fixture.eventId);
    expect(logs[0].stats).toEqual({
      fieldGoalsMade: 4, fieldGoalAttempts: 4, extraPointsMade: 0, extraPointAttempts: 0, kickingPoints: 12,
      longestFieldGoal: 47, fieldGoalsMadeUnder40: 1, fieldGoalAttemptsUnder40: 1,
      fieldGoalsMade40_49: 3, fieldGoalAttempts40_49: 3, fieldGoalsMade50Plus: 0, fieldGoalAttempts50Plus: 0,
      fieldGoalPct: 100, fieldGoalsMadeYardsAverage: 41,
    });
    const sample = getNFLKickingResearch({ logs, season: 2025 }).currentSeason;
    expect(sample.made.total).toBe(4);
    expect(sample.kickingPoints.total).toBe(12);
    expect(sample.longestFieldGoal).toBe(47);
    expect(sample.accuracy).toEqual({ numerator: 4, denominator: 4, rate: 1, observedGames: 1 });
    for (const [band, made, attempted, rate] of [
      ['under40', 1, 1, 1], ['from40To49', 3, 3, 1], ['from50Plus', 0, 0, null],
    ] as const) {
      expect(sample.distance[band].made.total).toBe(made);
      expect(sample.distance[band].attempted.total).toBe(attempted);
      expect(sample.distance[band].accuracy).toEqual({ numerator: made, denominator: attempted, rate, observedGames: 1 });
    }
    for (const key of ['fieldGoalAttempts', 'longestFieldGoal', 'fieldGoalAttemptsUnder40', 'fieldGoalAttempts40_49', 'fieldGoalAttempts50Plus'] as const) {
      expect(NFL_STAT_KEYS[key]).toBe(key);
    }
    expect(espnWebFetch).toHaveBeenCalledTimes(1);
  });
});