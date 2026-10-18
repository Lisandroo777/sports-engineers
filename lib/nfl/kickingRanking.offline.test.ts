import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrateProbability, getMarketFamily, modelProbability } from '../ai/probabilityModel';
import { historicalHitRate } from '../ai/eliteResearchFilter';
import { classifyPickTier, PICK_TIERS } from '../ai/agent/pickTiers';
import { buildResearchSessionFromCandidates, type GenericResearchCandidate } from '../ai/agent/session';
import { selectRankedCandidates } from '../ai/agent/tools';
import { parseNFLRequestScope } from '../ai/agent/nflRequestScope';
import { buildNFLHistory } from './history';
import { projectNFLMarket } from './projection';
import { analyzeNFLCandidate, buildNFLEliteCandidate } from './research';
import { buildNFLRoleContext } from './roleContext';
import { getNFLMarketMetadata, NFL_MARKET_LABELS, type NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLResearchProfile } from './researchModel';
import type { NFLInjuryContext } from './injuries';
import type { NFLWeatherContext } from './weather';
import type { NFLGameLogEntry } from './types';

const now = '2026-10-17T12:00:00Z';
const fetchMock = vi.fn(() => { throw new Error('Network forbidden in kicking ranking contracts'); });
const made = [1, 2, 3, 2, 3, 2, 1, 3, 2, 2, 3, 2];
const invalidFGStats: Record<string, number>[] = [
  { extraPointsMade: 4 }, { fieldGoalsAttempted: 4 }, {},
  ...[-1, 1.5, NaN, Infinity].map(fieldGoalsMade => ({ fieldGoalsMade })),
];
const modes = [
  ['Best', 'balanced'], ['Most likely', 'safety'], ['Best value', 'value'],
] as const;
const profileFixture = Object.freeze({
  hardGates: Object.freeze(Object.fromEntries([
    'currentPrice', 'majorInjuryResolved', 'roleClear', 'requiredDataPresent', 'currentLineReEvaluated',
    'footballThesisExplained', 'sourceConflictsResolved', 'projectionAdvantage', 'priceValueRemains', 'evidenceQuality',
  ].map(key => [key, Object.freeze({ passed: true, reason: null })]))),
  evidence: Object.freeze({ verdict: 'PLAY', counterCaseReviewed: true, conflictStatus: 'NONE',
    for: Object.freeze([{ statement: 'Exact completed-game kicking production and attempts reviewed.' }]),
    against: Object.freeze([{ statement: 'Touchdowns, missed kicks, and fourth-down decisions can suppress field goals.' }]),
    unresolvedRisks: Object.freeze([]) }),
  role: Object.freeze({ value: Object.freeze({ roleStatus: 'STABLE' }) }),
});

function logsFor(stats: (index: number) => Record<string, number>, position = 'K'): NFLGameLogEntry[] {
  return made.map((_, index) => ({ gameId: `game-${index}`, season: 2026, teamId: 12, position,
    week: index + 1, date: `2026-09-${String(index + 1).padStart(2, '0')}T17:00:00Z`,
    opponent: 'Las Vegas Raiders', opponentAbbreviation: 'LV', homeAway: 'home', result: 'W 24-21', stats: stats(index) }));
}

const kickerLogs = logsFor(index => ({ fieldGoalsMade: made[index], fieldGoalsAttempted: 3,
  extraPointsMade: 2, kickingPoints: 3 * made[index] + 2 }));
const qbLogs = logsFor(index => ({ passingAttempts: 35, passingYards: 280 + index % 3 * 10 }), 'QB');

function research(market: NFLAnalyzableMarketKey, line: number, direction: 'over' | 'under' = 'over',
  logs = kickerLogs, odds = -110) {
  const kicker = market !== 'player_pass_yds';
  const playerId = kicker ? 2330 : 3139477;
  const player = kicker ? 'Harrison Butker' : 'Patrick Mahomes';
  const position = kicker ? 'K' : 'QB';
  const injuryContext: NFLInjuryContext = {
    player: { player, playerId, teamId: 12, team: 'Kansas City Chiefs', position, injury: null, status: 'Active',
      availabilityDesignation: 'CONFIRMED_AVAILABLE', sourceStatus: 'CURRENT', updatedAt: now,
      evidence: null, affectedRole: 'PLAYER', missingFields: [] },
    team: 'Kansas City Chiefs', teammateAbsences: [], opponentAbsences: [],
    sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: now, missingFields: [],
  };
  const roleContext = buildNFLRoleContext(logs, market);
  const projection = projectNFLMarket({ logs, market, roleContext, position, injuryContext });
  const history = buildNFLHistory(logs, market, line, direction);
  const input = { candidateId: `${market}:${line}:${direction}`, playerId, player, market, line, direction,
    projection: projection.projection, projectionUncertainty: projection.uncertainty, logs,
    matchupAvailable: true, oddsAmerican: odds, lastUpdatedAt: now, isAlternate: false,
    marketSupport: getNFLMarketMetadata(market)!.historicalSupport, roleContext, injuryContext,
    weatherContext: { sourceStatus: 'NOT_APPLICABLE' } as NFLWeatherContext };
  const analysis = analyzeNFLCandidate(input);
  const candidate: GenericResearchCandidate = {
    candidateId: input.candidateId, playerId, player, position, teamId: 12,
    team: 'Kansas City Chiefs', opponent: 'Las Vegas Raiders', gameId: 'chiefs-raiders',
    marketLabel: NFL_MARKET_LABELS[market], marketKey: market, line, direction,
    book: 'Offline Book', odds, projection: projection.projection, projectionUncertainty: projection.uncertainty,
    l5Rate: history.windows.l5.hitRate, l10Rate: history.windows.l10.hitRate, l20Rate: null,
    seasonRate: history.windows.season.hitRate, analysis, sport: 'nfl', sampleSize: history.gamesUsed,
    injuryContext, weatherContext: input.weatherContext, nflHistory: history,
    projectionReliability: projection.reliability,
    nflResearchProfile: { ...profileFixture, productionEliteQualified: analysis.eliteQualified } as unknown as NFLResearchProfile,
  };
  return { input, analysis, candidate, projection, history };
}

function records(candidates: GenericResearchCandidate[]) {
  return buildResearchSessionFromCandidates({ sport: 'nfl', date: '2026-10-18', queryIntent: 'Best NFL props', candidates,
    toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: candidates.length, booksFound: 1,
      candidatesFound: candidates.length, cached: true, dataFreshnessSeconds: 0, budgetLimited: false } }).candidates;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  try { expect(fetchMock).not.toHaveBeenCalled(); }
  finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

describe('kicking exact-line numeric contract (offline)', () => {
  it.each(['player_field_goals', 'player_kicking_points'] as const)('%s uses existing COUNT behavior at every supplied line', market => {
    expect(getMarketFamily(market)).toBe('COUNT');
    let previousOver = 1;
    for (const line of [0.5, 1.5, 2.5, 4.5]) {
      const over = research(market, line);
      const under = research(market, line, 'under');
      const model = (side: typeof over) => modelProbability({ marketKey: market, line, direction: side.input.direction,
        projection: side.projection.projection, projectionUncertainty: side.projection.uncertainty,
        sampleSize: buildNFLEliteCandidate(side.input).sampleSize })!;
      const overModel = model(over);
      const underModel = model(under);
      expect(overModel.family).toBe('COUNT');
      expect(['poisson', 'negative_binomial']).toContain(overModel.distribution);
      expect(overModel.probability + underModel.probability).toBeCloseTo(1, 12);
      expect(overModel.probability).toBeLessThanOrEqual(previousOver);
      previousOver = overModel.probability;
      for (const side of [over, under]) {
        expect(side.history.line).toBe(line);
        expect(side.history.windows.rolling.pushes).toBe(0);
        expect(side.history.windows.rolling.decisions).toBe(kickerLogs.length);
        for (const value of [side.analysis.modelProbability, side.analysis.trueProbability, side.analysis.evPercent]) {
          expect(value).not.toBeNull();
          expect(Number.isFinite(value)).toBe(true);
        }
      }
      expect(over.analysis.modelProbability! + under.analysis.modelProbability!).toBeCloseTo(100, 8);
      expect(over.analysis.trueProbability! + under.analysis.trueProbability!).toBeCloseTo(100, 8);
    }
  });

  it.each([-200, -110, 120])('computes exact current EV at %s from unrounded calibrated model rates', odds => {
    for (const line of [0.5, 1.5, 2.5, 4.5]) {
      for (const direction of ['over', 'under'] as const) {
        const { input, analysis, projection } = research('player_field_goals', line, direction, kickerLogs, odds);
        const elite = buildNFLEliteCandidate(input);
        const model = modelProbability({ marketKey: input.market, line, direction, projection: projection.projection,
          projectionUncertainty: projection.uncertainty, sampleSize: elite.sampleSize })!;
        const calibrated = calibrateProbability({ modelProbability: model.probability,
          historicalHitRate: historicalHitRate(elite), sampleSize: elite.sampleSize });
        const decimal = odds < 0 ? 1 + 100 / -odds : 1 + odds / 100;
        expect(analysis.modelProbability).toBe(Number((model.probability * 100).toFixed(1)));
        expect(analysis.trueProbability).toBe(Number((calibrated.calibratedProbability * 100).toFixed(1)));
        expect(analysis.evPercent).toBe(Number(((calibrated.calibratedProbability * decimal - 1) * 100).toFixed(1)));
        expect(analysis.breakEvenProbability).toBe(Number((100 / decimal).toFixed(1)));
        expect(analysis.priceEdgePercent).toBe(Number(((calibrated.calibratedProbability - 1 / decimal) * 100).toFixed(1)));
      }
    }
  });

  it('excludes exact integer pushes from both history decision denominators', () => {
    const over = research('player_field_goals', 2);
    const under = research('player_field_goals', 2, 'under');
    const pushes = made.filter(value => value === 2).length;
    for (const side of [over, under]) {
      expect(side.history.windows.rolling.pushes).toBe(pushes);
      expect(side.history.windows.rolling.decisions).toBe(made.length - pushes);
      expect(buildNFLEliteCandidate(side.input).sampleSize).toBe(made.length - pushes);
    }
    expect(over.history.windows.rolling.hits + under.history.windows.rolling.hits).toBe(made.length - pushes);
    expect(over.history.hitRate! + under.history.hitRate!).toBeCloseTo(100, 8);
  });

  it('uses observed variance for compound kicking points without adding a new formula', () => {
    const dispersed = logsFor(index => ({ fieldGoalsMade: index % 2 ? 4 : 0, fieldGoalsAttempted: 4,
      extraPointsMade: 2, kickingPoints: index % 2 ? 14 : 2 }));
    const { input, projection } = research('player_kicking_points', 4.5, 'over', dispersed);
    expect(modelProbability({ marketKey: input.market, line: input.line, direction: input.direction,
      projection: projection.projection, projectionUncertainty: projection.uncertainty, sampleSize: dispersed.length }))
      .toMatchObject({ family: 'COUNT', distribution: 'negative_binomial' });
  });

  it.each([
    ['player_pass_yds', 'VOLUME', 'normal'], ['player_receptions', 'COUNT', 'negative_binomial'],
    ['player_sacks', 'RARE_COUNT', 'poisson'], ['batter_hits', 'COUNT', 'negative_binomial'],
  ] as const)('leaves nonkicker %s family and distribution unchanged', (marketKey, family, distribution) => {
    expect(getMarketFamily(marketKey)).toBe(family);
    expect(modelProbability({ marketKey, line: 1.5, direction: 'over', projection: 2,
      projectionUncertainty: 2, sampleSize: 12 })).toMatchObject({ family, distribution });
  });
});

describe('kicker and quarterback generic NFL ranking contract (offline)', () => {
  it.each(modes)('%s includes both kickers and QB in NFL-wide and game scopes without changing tiers', (prefix, sort) => {
    const pool = records([research('player_field_goals', 0.5).candidate,
      research('player_kicking_points', 4.5).candidate,
      research('player_pass_yds', 220.5, 'over', qbLogs).candidate]);
    const original = structuredClone(pool);
    const qb = pool.find(row => row.position === 'QB')!;
    const qbTier = classifyPickTier(qb, 'nfl');
    expect(PICK_TIERS).toEqual(['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS']);
    expect(pool.every(row => row.pickTier !== 'PASS')).toBe(true);
    for (const query of [`${prefix} NFL props`, `${prefix} Chiefs vs Raiders props`]) {
      const ranked = selectRankedCandidates(pool, query, { sport: 'nfl' });
      expect(ranked.constraints.sort).toBe(sort);
      expect(new Set(ranked.selected.map(row => row.candidateId))).toEqual(new Set(pool.map(row => row.candidateId)));
      expect(ranked.selected.filter(row => row.position === 'K').map(row => row.playerId)).toEqual([2330, 2330]);
      expect(ranked.selected.find(row => row.playerId === qb.playerId)?.pickTier).toBe(qbTier.pickTier);
      for (const row of ranked.selected) {
        const source = pool.find(item => item.candidateId === row.candidateId)!;
        expect(row.pickTier).toBe(source.pickTier);
        expect(row.trueProbability).toBe(source.trueProbability);
        expect(row.evPercent).toBe(source.evPercent);
      }
    }
    expect(selectRankedCandidates([qb], `${prefix} NFL props`, { sport: 'nfl' }).selected[0]?.pickTier).toBe(qbTier.pickTier);
    expect(selectRankedCandidates(pool, `${prefix} Chiefs vs Dolphins props`, { sport: 'nfl' }).selected).toEqual([]);
    expect(pool).toEqual(original);
  });

  it.each(invalidFGStats)('fails closed for absent or invalid FG production: %j', stats => {
    const { history, projection, analysis, candidate } = research('player_field_goals', 0.5, 'over', logsFor(() => stats));
    expect(history).toMatchObject({ available: false, gamesUsed: 0, mean: null, hitRate: null });
    expect(projection).toMatchObject({ status: 'UNAVAILABLE', projection: null });
    expect(analysis.modelProbability).toBeNull();
    expect(analysis.trueProbability).toBeNull();
    expect(analysis.evPercent).toBeNull();
    expect(analysis.eliteQualified).toBe(false);
    for (const [prefix] of modes) expect(selectRankedCandidates(records([candidate]), `${prefix} NFL props`, { sport: 'nfl' }).selected).toEqual([]);
  });

  it.each(['NFL field goal attempts', 'NFL longest field goal props', 'NFL team field goals'])('does not rank unsupported request %s', query => {
    const pool = records([research('player_field_goals', 0.5).candidate]);
    for (const [prefix] of modes) {
      const request = `${prefix} ${query}`;
      const nflScope = parseNFLRequestScope(request);
      expect(nflScope.clarification).not.toBeNull();
      expect(nflScope.marketKeys).toEqual([]);
      expect(selectRankedCandidates(pool, request, { sport: 'nfl', nflScope }).selected).toEqual([]);
    }
  });

  it('never lets attractive kicker numbers override a failed profile gate', () => {
    const official = records([research('player_field_goals', 0.5).candidate])[0];
    for (const gate of ['requiredDataPresent', 'roleClear', 'majorInjuryResolved', 'currentPrice'] as const) {
      const blocked = { ...official, nflResearchProfile: { ...official.nflResearchProfile!, productionEliteQualified: false,
        hardGates: { ...official.nflResearchProfile!.hardGates, [gate]: { passed: false, reason: `${gate} failed.` } } } };
      expect(classifyPickTier(blocked, 'nfl').pickTier).toBe('PASS');
      for (const [prefix] of modes) expect(selectRankedCandidates([blocked], `${prefix} NFL props`, { sport: 'nfl' }).selected).toEqual([]);
    }
  });
});