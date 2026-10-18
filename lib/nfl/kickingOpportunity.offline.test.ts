import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNFLKickingOpportunity, parseNFLKickingOpportunity, type NFLKickingOpportunitySummary } from './kickingOpportunity';
import { getNFLKickingResearch } from './kickingResearch';
import { withNFLResearchSnapshot } from './researchSnapshot';
import type { NFLGameLogEntry } from './types';

const { siteFetch } = vi.hoisted(() => ({ siteFetch: vi.fn() }));
vi.mock('./client', () => ({ espnSiteFetch: siteFetch }));

function summary(id = '401772957'): NFLKickingOpportunitySummary {
  return { header: { id }, boxscore: { teams: [
    { team: { id: '1' }, statistics: [
      { name: 'fourthDownEff', displayValue: '1-1', value: 1 },
      { name: 'totalDrives', displayValue: '15', value: 15 },
      { name: 'redZoneAttempts', label: 'Red Zone (Made-Att)', displayValue: '0-2', value: 0 },
    ] },
    { team: { id: '2' }, statistics: [
      { name: 'totalDrives', displayValue: '12', value: 12 },
      { name: 'redZoneAttempts', displayValue: '3/4', value: 3 },
    ] },
  ] } };
}

function event(id: string, date = '2026-10-01T12:00:00Z', completed = true) {
  return { id, date, season: { year: 2026 }, competitions: [{ status: { type: { completed } },
    competitors: [{ team: { id: '1' } }, { team: { id: '2' } }] }] };
}
function log(id: string, date = '2026-10-01T12:00:00Z', extra: Partial<NFLGameLogEntry> = {}): NFLGameLogEntry {
  return { gameId: id, date, season: 2026, teamId: 1, result: 'W', week: 1, opponent: 'Other', opponentAbbreviation: 'OTH',
    homeAway: 'home', stats: {}, ...extra };
}
const input = { teamId: 1, opponentTeamId: 2, season: 2026, before: '2026-10-17T12:00:00Z' };

describe('offline ESPN kicking opportunity', () => {
  const network = vi.fn(() => { throw new Error('Actual network forbidden'); });
  beforeEach(() => { vi.stubGlobal('fetch', network); siteFetch.mockReset(); });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('reads captured ESPN stat shapes as exact counts, not scalar pair values', () => {
    const result = parseNFLKickingOpportunity(summary(), 1);
    expect(result.facts.teamDrives?.value).toBe(15);
    expect(result.facts.teamRedZoneTrips?.value).toBe(2);
    expect(result.facts.teamRedZoneTouchdowns?.value).toBe(0);
    expect(result.facts.fourthDownAttempts?.value).toBe(1);
    expect(result.fourthDownConversions?.rate).toBe(1);
    expect(result.facts.fourthDownOpportunities).toBeUndefined();
    expect(result.offensiveScoringEfficiency).toBeUndefined();
    expect(result.facts.teamDrives?.source).toContain('summary?event=401772957');
    expect(result.facts.teamDrives?.sourceURL).toContain('summary?event=401772957');
    const research = getNFLKickingResearch({ logs: [], season: 2026, opportunity: result.facts });
    expect(research.opportunity.teamRedZoneTripsPerDrive?.rate).toBe(2 / 15);
    expect(research.opportunity.teamRedZoneTouchdownRate?.rate).toBe(0);
    expect(research.opportunity.fourthDownAttemptRate).toBeNull();
  });

  it('selects the offense facing the target defense, never the defense own offense', () => {
    const result = parseNFLKickingOpportunity(summary(), 1, 2, { mode: 'defense' });
    expect(result.facts.opponentRedZoneTrips?.value).toBe(2);
    expect(result.facts.opponentRedZoneTouchdowns?.value).toBe(0);
    expect(parseNFLKickingOpportunity(summary(), 1, undefined, { mode: 'defense' }).facts.opponentRedZoneTrips?.value).toBe(4);
    expect(parseNFLKickingOpportunity(summary(), 99).facts).toEqual({});
  });

  it('accepts both pair delimiters and genuine zero pairs only for explicit stat names', () => {
    for (const displayValue of ['0-0', '0/0', ' 0 / 0 ']) {
      const raw = summary();
      raw.boxscore!.teams![0].statistics = [
        { name: 'redZoneAttempts', displayValue }, { name: 'fourthDownEff', displayValue }, { name: 'totalDrives', value: 0 },
      ];
      const result = parseNFLKickingOpportunity(raw, 1);
      expect(result.facts.teamRedZoneTrips?.value).toBe(0);
      expect(result.facts.teamRedZoneTouchdowns?.value).toBe(0);
      expect(result.fourthDownConversions?.rate).toBeNull();
    }
    const raw = summary();
    raw.boxscore!.teams![0].statistics = [{ label: 'Red Zone (Made-Att)', displayValue: '1-2' }];
    expect(parseNFLKickingOpportunity(raw, 1).facts).toEqual({});
  });

  it('withholds malformed pairs, absent fields, and ambiguous identities instead of filling zeros', () => {
    for (const displayValue of [undefined, '', '2', '3-2', '-1/2', '1/2/3']) {
      const raw = summary();
      raw.boxscore!.teams![0].statistics = [{ name: 'redZoneAttempts', displayValue, value: 0 }];
      expect(parseNFLKickingOpportunity(raw, 1).facts).toEqual({});
    }
    const raw = summary();
    raw.boxscore!.teams![1].team!.id = '1';
    expect(parseNFLKickingOpportunity(raw, 1).facts).toEqual({});
    expect(parseNFLKickingOpportunity({}, 1).facts).toEqual({});
    expect(parseNFLKickingOpportunity(summary(), 1, undefined, { retrievedAt: 'invalid' }).facts).toEqual({});
  });

  it('counts TD/FG scoring drives only with exact complete identified drive coverage', () => {
    const raw = summary();
    raw.boxscore!.teams![0].statistics![1] = { name: 'totalDrives', displayValue: '3', value: 3 };
    raw.drives = { previous: ['TD', 'FG', 'PUNT'].map((result, index) => ({ id: String(index), team: '1', result, end: { period: 4 } })) };
    expect(parseNFLKickingOpportunity(raw, 1).offensiveScoringEfficiency?.rate).toBe(2 / 3);
    raw.drives.previous![2].result = 'UNKNOWN';
    expect(parseNFLKickingOpportunity(raw, 1).offensiveScoringEfficiency).toBeUndefined();
    raw.drives.previous!.pop();
    expect(parseNFLKickingOpportunity(raw, 1).offensiveScoringEfficiency).toBeUndefined();
    expect(parseNFLKickingOpportunity(raw, 1).facts.fourthDownOpportunities).toBeUndefined();
  });

  it('uses logs and opponent schedule strictly before kickoff and shares one event fetch', async () => {
    siteFetch.mockImplementation(async (path: string, params: Record<string, string>) => path === 'summary' ? summary(params.event)
      : { events: [event('101'), event('102', input.before), event('103', '2026-10-18T12:00:00Z'), event('104', undefined, false)] });
    const result = await getNFLKickingOpportunity({ ...input, currentLogs: [log('101'), log('101'), log('102', input.before),
      log('103', '2026-10-18T12:00:00Z'), log('104', undefined, { result: null }), log('105', undefined, { teamId: 2 }),
      log('106', undefined, { season: 2025 })] });
    expect(result.gameIds).toEqual(['101']);
    expect(siteFetch.mock.calls.filter(([path]) => path === 'summary')).toHaveLength(1);
    expect(siteFetch.mock.calls.filter(([path]) => path !== 'summary').map(([path]) => path)).toEqual(['teams/2/schedule']);
    expect(result.facts.opponentRedZoneTrips?.value).toBe(2);
    expect(result.facts.teamRedZoneTrips?.sampleId).toBe(result.facts.teamDrives?.sampleId);
    expect(result.facts.teamRedZoneTrips?.retrievedAt).toBe(result.facts.teamDrives?.retrievedAt);
    expect(result.facts.expectedDrives).toBeUndefined();
    expect(result.evidence.find((entry) => entry.field === 'offense.game.101.teamDrives')).toMatchObject({
      rawCount: 15, sourceURL: expect.stringContaining('event=101'),
    });
  });

  it('validates unknown log team identity against the summary and excludes explicit other-team logs', async () => {
    siteFetch.mockImplementation(async (path: string, params: Record<string, string>) => path === 'summary' ? summary(params.event) : { events: [] });
    const result = await getNFLKickingOpportunity({ ...input, currentLogs: [log('1', undefined, { teamId: null }), log('2', undefined, { teamId: 99 })] });
    expect(result.gameIds).toEqual(['1']);
    expect(result.facts.teamDrives?.value).toBe(15);
    siteFetch.mockImplementation(async (path: string, params: Record<string, string>) => {
      if (path !== 'summary') return { events: [] };
      const raw = summary(params.event);
      raw.boxscore!.teams![0].team!.id = '99';
      return raw;
    });
    expect((await getNFLKickingOpportunity({ ...input, currentLogs: [log('1', undefined, { teamId: null })] })).facts.teamDrives).toBeUndefined();
  });

  it('caps each schedule at five recent games and memoizes summaries across concurrent requests', async () => {
    siteFetch.mockImplementation(async (path: string, params: Record<string, string>) => path === 'summary' ? summary(params.event)
      : { events: Array.from({ length: 8 }, (_, index) => event(String(index + 1), `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z`)) });
    const [result] = await withNFLResearchSnapshot(() => Promise.all([getNFLKickingOpportunity(input), getNFLKickingOpportunity(input)]));
    expect(result.gameIds).toEqual(['4', '5', '6', '7', '8']);
    expect(siteFetch.mock.calls.filter(([path]) => path === 'summary')).toHaveLength(5);
    expect(result.facts.teamDrives?.value).toBe(75);
    expect(getNFLKickingResearch({ logs: [], season: 2026, opportunity: result.facts }).opportunity.teamRedZoneTripsPerDrive?.rate).toBe(2 / 15);
  });

  it('reports partial fetch coverage and withholds incompatible aggregates', async () => {
    siteFetch.mockImplementation(async (path: string, params: Record<string, string>) => {
      if (path !== 'summary') return { events: [event('1'), event('2')] };
      if (params.event === '2') throw new Error('Unavailable');
      return summary(params.event);
    });
    const partial = await getNFLKickingOpportunity(input);
    expect(partial.facts.teamDrives?.value).toBe(15);
    expect(partial.evidence.find((entry) => entry.field === 'teamDrives')?.status).toBe('PARTIAL');
    expect(partial.missingFields).toContain('offense.summary.2');
    expect(partial.sourceURLs.some((url) => url.endsWith('event=2'))).toBe(true);
    siteFetch.mockImplementation(async (path: string, params: Record<string, string>) => {
      if (path !== 'summary') return { events: [event('1'), event('2')] };
      const raw = summary(params.event);
      if (params.event === '2') raw.boxscore!.teams![0].statistics = [{ name: 'totalDrives', value: 12 }];
      return raw;
    });
    const missing = await getNFLKickingOpportunity(input);
    expect(missing.facts.teamDrives?.value).toBe(27);
    expect(missing.facts.teamRedZoneTrips).toBeUndefined();
    expect(missing.facts.teamRedZoneTouchdowns).toBeUndefined();
    expect(getNFLKickingResearch({ logs: [], season: 2026, opportunity: missing.facts }).opportunity.teamRedZoneTripsPerDrive).toBeNull();
  });

  it('rejects invalid cutoffs and exposes failed schedules without false zero facts', async () => {
    await expect(getNFLKickingOpportunity({ ...input, before: 'invalid' })).rejects.toThrow('before kickoff');
    expect(siteFetch).not.toHaveBeenCalled();
    siteFetch.mockRejectedValue(new Error('Schedule unavailable'));
    const result = await getNFLKickingOpportunity(input);
    expect(result.facts).toEqual({});
    expect(result.missingFields).toContain('offense.schedule');
    expect(result.missingFields).toContain('defense.schedule');
  });

  it('rejects conflicting or unfinished summary headers even when schedule says completed', async () => {
    siteFetch.mockImplementation(async (path: string) => path === 'summary'
      ? { ...summary('1'), header: { id: '1', competitions: [{ date: input.before, status: { type: { completed: true } } }] } }
      : { events: [event('1')] });
    expect((await getNFLKickingOpportunity(input)).facts).toEqual({});
    siteFetch.mockImplementation(async (path: string) => path === 'summary' ? summary('999') : { events: [event('1')] });
    expect((await getNFLKickingOpportunity(input)).facts).toEqual({});
  });
});