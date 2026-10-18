import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinderResult } from '../finder/engine';
import type { MLBContextEvidence, MLBResearchContext } from '../mlb/researchContext';
import { analyzePickCandidate, finderResultToEliteCandidate } from './eliteResearchFilter';

const now = '2026-10-16T12:00:00.000Z';
const fetchMock = vi.fn(() => { throw new Error('Network is forbidden in MLB evidence qualification tests'); });

function available<Value>(value: Value): MLBContextEvidence<Value> {
  return { status: 'AVAILABLE', value, source: 'offline MLB fixture', retrievedAt: now,
    sourceTimestamp: now, dataQualityNote: 'Explicit fixture evidence' };
}

function unavailable<Value>(): MLBContextEvidence<Value> {
  return { status: 'UNAVAILABLE', value: null, source: null, retrievedAt: now,
    sourceTimestamp: null, dataQualityNote: 'Evidence not supplied' };
}

function context(overrides: Partial<MLBResearchContext> = {}): MLBResearchContext {
  return {
    gameId: 'game-1', retrievedAt: now, sourceTimestamp: now, sources: ['offline MLB fixture'],
    dataQualityNote: 'Offline fixture; missing facts remain unavailable',
    gameStatus: unavailable(), probablePitchers: { home: unavailable(), away: unavailable() },
    confirmedLineups: { home: unavailable(), away: unavailable() },
    weather: unavailable(), venue: unavailable(), playerInjuries: unavailable(), bullpenWorkload: unavailable(),
    ...overrides,
  };
}

function lineup(firstPlayerId: number): MLBResearchContext['confirmedLineups']['home'] {
  return available(Array.from({ length: 9 }, (_, index) => ({
    id: firstPlayerId + index, fullName: `Fixture Batter ${index + 1}`, battingOrder: index + 1,
  })));
}

function result(overrides: Partial<FinderResult> & { matchupEvidenceAvailable?: boolean } = {}): FinderResult {
  return {
    sport: 'mlb', id: 'mlb-evidence', player: 'Fixture Player', playerId: 100,
    teamId: 147, teamName: 'New York Yankees', opponentTeamId: 111, opponentName: 'Boston Red Sox',
    homeAway: 'home', gameTimeIso: '2026-10-16T19:00:00Z', gameId: 'game-1', eventId: 'event-1',
    marketLabel: 'Hits', marketKey: 'batter_hits', line: 0.5, side: 'over', isAlternate: false,
    bestBook: { sportsbookName: 'Fixture Book', odds: -110 }, availableBooks: 3,
    evPercent: 30, projection: 1.8, projectionUncertainty: 0.6, finderScore: 95, grade: null,
    historical: { l5: '5/5', l10: '9/10', l20: '18/20', l40: '36/40', season: '27/30',
      l5Rate: 100, l10Rate: 90, l20Rate: 90, seasonRate: 90 },
    signals: [], concerns: [], marketUpdatedAt: now,
    marketMovement: { available: false, direction: 'unavailable', openingOdds: null, currentOdds: null,
      observedOverMinutes: null, pointCount: 0, label: null },
    outlierDependency: { available: true, sampleGames: 20, raw: { games: 20, total: 160, mean: 8 },
      withoutTopGame: { games: 19, total: 150, mean: 7.89 }, withoutTop2Games: { games: 18, total: 140, mean: 7.78 },
      explosiveDependencePercent: 6.25, median: 8, standardDeviation: 1.5 },
    volumeEfficiency: { available: true, basis: 'plate_appearances', estimatedVolume: 4,
      requiredRatePerUnit: 0.125, actualRatePerUnit: 0.45, meetsRequiredRate: true },
    alternateLineOptimizer: { available: false, side: 'over', options: [], recommended: null },
    crossBookThreshold: { available: true, standardLines: [{ line: 0.5, books: ['Fixture Book'] }],
      discrepancy: false, spread: 0 },
    howItLoses: [], sources: ['offline MLB fixture'],
    ...overrides,
  };
}

function expectSourceRejection(finderResult: FinderResult, reason: string) {
  const candidate = finderResultToEliteCandidate(finderResult);
  expect(candidate.requiredMarketSupported).toBe(true);
  expect(candidate.marketSupport).toBe('SUPPORTED');
  expect(candidate.sourceRejectionReasons).toContain(reason);
  const analysis = analyzePickCandidate(candidate);
  expect(analysis.rejectedReasons).toContain(reason);
  expect(analysis.qualification).toBe('REJECT');
  expect(analysis.researchQualified).toBe(false);
  expect(analysis.eliteQualified).toBe(false);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MLB factual evidence qualification (offline)', () => {
  it('does not treat player/opponent identities as role, status, or matchup evidence', () => {
    const candidate = finderResultToEliteCandidate(result());
    expect(candidate).toMatchObject({ roleKnown: false, statusKnown: false, matchupAvailable: false,
      gameContextAvailable: true, sourceRejectionReasons: [] });
    const analysis = analyzePickCandidate(candidate);
    expect(analysis.signals.find(signal => signal.key === 'expectedRole')?.availability).toBe('MISSING');
    expect(analysis.signals.find(signal => signal.key === 'opponentMatchup')?.availability).toBe('MISSING');
  });

  it.each([undefined, false, true])('uses only the real matchup flag (%s), not opponent identity', (flag) => {
    expect(finderResultToEliteCandidate(result({ matchupEvidenceAvailable: flag })).matchupAvailable).toBe(flag === true);
    expect(finderResultToEliteCandidate(result({ matchupEvidenceAvailable: flag,
      opponentName: null, opponentTeamId: null })).matchupAvailable).toBe(flag === true);
  });

  it('keeps missing lineup and missing weather unknown without an eligibility rejection', () => {
    const candidate = finderResultToEliteCandidate(result({ mlbContext: context() }));
    expect(candidate).toMatchObject({ roleKnown: false, statusKnown: false, gameContextAvailable: true,
      sourceRejectionReasons: [] });
    expect(finderResultToEliteCandidate(result({ mlbContext: context(), gameTimeIso: null })).gameContextAvailable).toBe(false);
  });

  it.each(['home', 'away'] as const)('requires membership in the player team confirmed %s batting order', (homeAway) => {
    const candidate = finderResultToEliteCandidate(result({ homeAway, mlbContext: context({
      confirmedLineups: { home: unavailable(), away: unavailable(), [homeAway]: lineup(100) },
    }) }));
    expect(candidate.roleKnown).toBe(true);
    expect(candidate.statusKnown).toBe(false);
    expect(candidate.sourceRejectionReasons).toEqual([]);
  });

  it('rejects a batter excluded from the confirmed team order', () => {
    expectSourceRejection(result({ mlbContext: context({
      confirmedLineups: { home: lineup(200), away: lineup(100) },
    }) }), 'MLB player absent from confirmed batting order');
  });

  it('does not infer exclusion from only the opposing order or an unknown team side', () => {
    for (const homeAway of ['home', null] as const) {
      const candidate = finderResultToEliteCandidate(result({ homeAway, mlbContext: context({
        confirmedLineups: { home: unavailable(), away: lineup(200) },
      }) }));
      expect(candidate.roleKnown).toBe(false);
      expect(candidate.sourceRejectionReasons).toEqual([]);
    }
  });

  it('checks only explicit status evidence for the candidate player', () => {
    const otherStatus = { playerId: 200, name: 'Other Player', code: 'A', description: 'Active', explicitlyInjured: false };
    expect(finderResultToEliteCandidate(result({ mlbContext: context({
      playerInjuries: available([otherStatus]),
    }) })).statusKnown).toBe(false);
    expect(finderResultToEliteCandidate(result({ mlbContext: context({
      playerInjuries: available([{ ...otherStatus, playerId: 100 }]),
    }) })).statusKnown).toBe(true);
    expect(finderResultToEliteCandidate(result({ mlbContext: context({
      playerInjuries: available([{ playerId: 100, name: 'Fixture Player', code: null,
        description: null, explicitlyInjured: null }]),
    }) })).statusKnown).toBe(false);
  });

  it('rejects explicit injury even when role and status are known', () => {
    const finderResult = result({ mlbContext: context({
      confirmedLineups: { home: lineup(100), away: unavailable() },
      playerInjuries: available([{ playerId: 100, name: 'Fixture Player', code: 'D10',
        description: '10-Day Injured List', explicitlyInjured: true }]),
    }) });
    expect(finderResultToEliteCandidate(finderResult)).toMatchObject({ roleKnown: true, statusKnown: true });
    expectSourceRejection(finderResult, 'MLB player explicitly injured');
  });

  it.each(['home', 'away'] as const)('recognizes a listed %s probable starter, including alternate markets', (side) => {
    const candidate = finderResultToEliteCandidate(result({ marketKey: 'pitcher_strikeouts_alternate', mlbContext: context({
      probablePitchers: { home: unavailable(), away: unavailable(), [side]: available({ id: 100, fullName: 'Starter' }) },
      confirmedLineups: { home: lineup(200), away: unavailable() },
    }) }));
    expect(candidate.roleKnown).toBe(true);
    expect(candidate.statusKnown).toBe(false);
    expect(candidate.sourceRejectionReasons).toEqual([]);
  });

  it('does not mark a nonmatching pitcher known or reject a possible reliever', () => {
    const candidate = finderResultToEliteCandidate(result({ marketKey: 'pitcher_strikeouts', mlbContext: context({
      probablePitchers: { home: available({ id: 200, fullName: 'Home Starter' }), away: available({ id: 300, fullName: 'Away Starter' }) },
      player: { teamMembership: unavailable(), scheduledStarter: available({ playerId: 100, isListedProbableStarter: false }) },
    }) }));
    expect(candidate.roleKnown).toBe(false);
    expect(candidate.sourceRejectionReasons).toEqual([]);
  });

  it.each([100, 200])('requires resolved starter evidence to match the player (%s)', (playerId) => {
    const candidate = finderResultToEliteCandidate(result({ marketKey: 'pitcher_outs', mlbContext: context({
      player: { teamMembership: unavailable(), scheduledStarter: available({ playerId, isListedProbableStarter: true }) },
    }) }));
    expect(candidate.roleKnown).toBe(playerId === 100);
  });

  it('does not use pitcher evidence to establish a batter role or vice versa', () => {
    expect(finderResultToEliteCandidate(result({ mlbContext: context({
      probablePitchers: { home: available({ id: 100, fullName: 'Starter' }), away: unavailable() },
    }) })).roleKnown).toBe(false);
    expect(finderResultToEliteCandidate(result({ marketKey: 'pitcher_strikeouts', mlbContext: context({
      confirmedLineups: { home: lineup(100), away: unavailable() },
    }) })).roleKnown).toBe(false);
  });

  it('rejects explicit team mismatch without changing market support', () => {
    expectSourceRejection(result({ mlbContext: context({ player: {
      teamMembership: available({ currentTeamId: 999, scheduledTeamIds: [147, 111], matchesScheduledTeam: false }),
      scheduledStarter: unavailable(),
    } }) }), 'MLB player team mismatch');
  });

  it('leaves NFL mapper behavior unchanged even if MLB context is attached', () => {
    const candidate = finderResultToEliteCandidate(result({ sport: 'nfl', matchupEvidenceAvailable: false,
      mlbContext: context({ playerInjuries: available([{ playerId: 100, name: 'Fixture Player',
        code: 'D10', description: 'Injured', explicitlyInjured: true }]) }),
    }));
    expect(candidate).toMatchObject({ sport: 'nfl', roleKnown: true, statusKnown: true, matchupAvailable: true });
    expect(candidate.sourceRejectionReasons).toBeUndefined();
  });
});