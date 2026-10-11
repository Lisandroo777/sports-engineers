import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyPickTier } from '../../../ai/agent/pickTiers';
import type { ResearchCandidateRecord, ResearchSession } from '../../../ai/agent/session';
import type { NBACandidate } from '../../../finder/nbaEngine';
import { buildPickPresentation, type AuthoritativeTierDecision, type PickPresentationInput } from '../../presentation';
import { availabilityDependencies, availabilityEvent, availabilityFixture, availabilityGame, availabilityTime } from './availability.fixtures';
import { binding, quote } from './fixtures';
import { assessGameMarket } from './markets';
import { projectNBAGame } from './model';
import { researchNBAGameLines } from './pipeline';
import { buildNBAResearchPresentation, unclassifiedNBAPropResearch } from './presentationBridge';
import { classifyGameRecommendation } from './recommendations';

function prop(overrides: Partial<ResearchCandidateRecord> = {}): ResearchCandidateRecord {
  return {
    candidateId: 'prop', rank: 1, playerId: 101, teamId: 1, player: 'Fixture Player 101', team: 'Home', opponent: 'Away',
    gameId: 'target', market: 'Points', marketKey: 'player_points', line: 24.5, direction: 'over', book: 'Fixture Book', odds: -110,
    availableBooks: 1, projection: 28, projectionUncertainty: 3, edge: 3.5, l5Rate: 60, l10Rate: 60, l20Rate: 60, seasonRate: 60,
    researchScore: 75, signalAgreement: 4, signalsAvailable: 6, evidenceCoverage: 95, priceFreshness: 'FRESH', priceCurrent: true,
    trueProbability: 60, evPercent: 14.545454545454541, priceEdgePercent: 7.619047619047613,
    playerEdgePercent: 14, breakEvenProbability: 52.38095238095239, isAlternate: false, dataQuality: 95, trapRisk: 10,
    qualification: 'WATCH', eliteQualified: false, rejectionReasons: [], grade: 'A', priceGrade: 'A', projectedRange: null,
    bestAlternateLine: null, howItLoses: ['Minutes could fall.'], evidenceBoard: [], outlierDependencePercent: null,
    position: 'G', modelProbability: 62, historicalHitRate: 60, sampleSize: 10, projectionReliability: 'HIGH', valueQualified: true,
    crossBookThreshold: null, marketMovement: null, outlierAnalysis: null,
    roleContext: { requirement: 'Stable role', status: 'STABLE', confidence: 'HIGH', workloadTrend: 'STABLE', reasons: [] },
    opponentContext: null, injuryContext: { status: 'AVAILABLE' }, weatherContext: null, retrievedAt: availabilityTime,
    pickTier: 'NUKE', tierScore: 100, tierReason: 'Untrusted stored tier', tierRequirementsPassed: ['Stored label only'],
    tierRequirementsFailed: [], ...overrides,
  };
}

function session(overrides: Partial<ResearchSession> = {}): ResearchSession {
  return { sport: 'nba', date: '2026-01-21', queryIntent: 'NBA props and moneylines', generatedAt: availabilityTime,
    candidates: [], gameCandidates: [], modeledGames: [],
    toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 0, booksFound: 1, candidatesFound: 0,
      eliteFound: 0, cached: true, dataFreshnessSeconds: 0, budgetLimited: false }, ...overrides };
}

async function gameResearch(scenario: Parameters<typeof availabilityFixture>[0] = 'healthy', missingQuotes = false) {
  const fixture = availabilityFixture(scenario);
  const actualQuote = quote({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null });
  const dependencies = availabilityDependencies(fixture, actualQuote);
  if (missingQuotes) dependencies.loadQuotes = async () => ({ status: 'UNSUPPORTED_QUOTE', quotes: [], reason: 'Offline cache empty' });
  const research = await researchNBAGameLines([availabilityGame()], [availabilityEvent()], dependencies);
  return { fixture, actualQuote, research, stored: session({ gameCandidates: research.recommendations, modeledGames: research.modeledGames }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network and paid calls forbidden in presentation bridge tests'); }));
});

afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

describe('standalone transferred presentation contract', () => {
  it.each(['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS'] as const)('preserves authoritative %s without classifying or inflating metrics', tier => {
    const decision: AuthoritativeTierDecision = { pickTier: tier, tierScore: 74, tierReason: 'Authoritative offline decision',
      tierRequirementsPassed: ['Supplied gate'], tierRequirementsFailed: ['Supplied caveat'] };
    const input: PickPresentationInput = { candidateId: tier, subject: { kind: 'PLAYER_PROP', gameId: 'target',
      player: { id: 101, name: 'Fixture Player 101', team: 'Home' },
      market: { key: 'player_points', label: 'Points', line: 24.5, side: 'over' } },
      tierDecision: decision, sportsbook: 'Fixture Book', americanOdds: -110, quoteStatus: 'CURRENT',
      trueProbability: 60, modelProbability: 62, evPercent: 14.545454545454541, researchScore: 74,
      seasonPhase: 'REGULAR', researchEvidence: [{ id: 'offline', category: 'RISK', source: null,
        detail: 'Minutes could fall.', observedAt: availabilityTime, stance: 'COUNTER' }] };
    const snapshot = structuredClone(input);
    const result = buildPickPresentation({ picks: [input], requestedSort: 'BEST', includePasses: true });
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0].tierDecision).toEqual(decision);
    expect(result.picks[0].metrics).toEqual({ trueProbability: 60, modelProbability: 62,
      evPercent: 14.545454545454541, researchScore: 74, tierScore: 74 });
    expect(result.picks[0].disposition).toBe(tier === 'PASS' ? 'PASS' : tier === 'LEAN' ? 'LEAN' : 'RECOMMENDED');
    expect(input).toEqual(snapshot);
  });
});

describe('NBA research presentation bridge with actual gates', () => {
  it.each(['healthy', 'questionable'] as const)('presents actual %s pipeline gates and unchanged model math', async scenario => {
    const { fixture, actualQuote, research, stored } = await gameResearch(scenario);
    expect(research.recommendations).toHaveLength(1);
    const record = research.recommendations[0];
    const baseline = assessGameMarket(projectNBAGame({ snapshot: fixture.snapshot, predictionAt: availabilityTime,
      intelligence: fixture.intelligence }), actualQuote, binding);
    expect(record.assessment).toEqual(baseline);
    const expectedTier = scenario === 'healthy' ? 'EDGE' : 'PASS';
    expect(classifyGameRecommendation(record).pickTier).toBe(expectedTier);
    const snapshot = structuredClone(stored);
    const result = buildNBAResearchPresentation(stored, 'Best NBA moneylines', scenario === 'healthy' ? [record.candidateId] : []);
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]).toMatchObject({ subject: { kind: 'GAME_LINE' }, disposition: scenario === 'healthy' ? 'RECOMMENDED' : 'PASS',
      pricing: { state: 'PRICED', sportsbook: actualQuote.sportsbook, americanOdds: actualQuote.americanOdds, quoteStatus: 'CURRENT' } });
    expect(result.picks[0].tierDecision).toEqual(classifyGameRecommendation(record));
    expect(result.picks[0].metrics).toEqual({ trueProbability: baseline.conditionalWinProbability! * 100,
      modelProbability: baseline.conditionalWinProbability! * 100, evPercent: baseline.evPercent, researchScore: record.researchScore,
      tierScore: record.researchScore });
    expect(result.recommendations.map(pick => pick.candidateId)).toEqual(scenario === 'healthy' ? [record.candidateId] : []);
    expect(result.researchedCandidates.map(pick => pick.candidateId)).toEqual(scenario === 'healthy' ? [] : [record.candidateId]);
    expect(stored).toEqual(snapshot);
  });

  it('preserves a valid LEAN game gate with unchanged pipeline quote, probability and EV', async () => {
    const { stored, research } = await gameResearch();
    const record = stored.gameCandidates![0];
    const baseline = structuredClone(research.recommendations[0]);
    record.researchScore = 74;
    const decision = classifyGameRecommendation(record);
    expect(decision.pickTier).toBe('LEAN');
    expect(decision.tierScore).toBe(74);
    expect(record.quote).toEqual(baseline.quote);
    expect(record.assessment).toEqual(baseline.assessment);
    const result = buildNBAResearchPresentation(stored, 'NBA moneylines', [record.candidateId]);
    expect(result.picks[0]).toMatchObject({ disposition: 'LEAN', tierDecision: decision,
      pricing: { americanOdds: baseline.quote.americanOdds }, metrics: { trueProbability: baseline.trueProbability,
        modelProbability: baseline.trueProbability, evPercent: baseline.evPercent, researchScore: 74, tierScore: 74 } });
    expect(result.recommendations).toEqual(result.picks);
    expect(result.researchedCandidates).toEqual([]);
  });

  it.each([
    ['NUKE', { researchScore: 100, trueProbability: 80, odds: -400, eliteQualified: true }],
    ['ELITE', { researchScore: 99, trueProbability: 80, odds: -400, eliteQualified: true }],
    ['ELITE', { researchScore: 100, trueProbability: 79.99, eliteQualified: true }],
    ['ELITE', { researchScore: 100, trueProbability: 80, odds: -401, eliteQualified: true }],
    ['SHARP', { researchScore: 85 }], ['EDGE', { researchScore: 84 }], ['EDGE', { researchScore: 75 }],
    ['LEAN', { researchScore: 74 }], ['PASS', { sampleSize: 4 }], ['PASS', { dataQuality: 69 }],
    ['PASS', { evPercent: 0 }], ['PASS', { priceEdgePercent: 0 }], ['PASS', { edge: 0 }],
    ['PASS', { odds: -901 }], ['PASS', { trapRisk: 31 }],
  ] satisfies Array<[AuthoritativeTierDecision['pickTier'], Partial<ResearchCandidateRecord>]>)('reclassifies supplied stored tiers as %s for %j', (tier, overrides) => {
    const record = prop(overrides);
    const stored = session({ candidates: [record] });
    const snapshot = structuredClone(stored);
    const result = buildNBAResearchPresentation(stored, 'NBA props', tier === 'PASS' ? [] : [record.candidateId]);
    expect(result.picks[0].tierDecision?.pickTier).toBe(tier);
    expect(result.picks[0].tierDecision).toEqual(classifyPickTier(record, 'nba'));
    expect(result.picks[0].metrics).toEqual({ trueProbability: record.trueProbability, modelProbability: record.modelProbability,
      evPercent: record.evPercent, researchScore: record.researchScore, tierScore: record.researchScore });
    expect(result.picks[0].pricing.americanOdds).toBe(record.odds);
    expect(result.recommendations).toHaveLength(tier === 'PASS' ? 0 : 1);
    expect(result.researchedCandidates).toHaveLength(tier === 'PASS' ? 1 : 0);
    expect(stored).toEqual(snapshot);
  });

  it('keeps actual model research without quotes unpriced with no invented betting metrics', async () => {
    const { stored, research } = await gameResearch('healthy', true);
    expect(research.recommendations).toEqual([]);
    expect(research.modeledGames[0]).toMatchObject({ status: 'MODELED_NOT_BETTABLE', projection: { status: 'AVAILABLE' }, quotes: [] });
    const result = buildNBAResearchPresentation(stored, 'NBA moneylines', []);
    expect(result.outcome).toBe('RESEARCH_ONLY');
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]).toMatchObject({ disposition: 'RESEARCH_ONLY', tierDecision: null,
      pricing: { state: 'UNPRICED', americanOdds: null, sportsbook: null },
      metrics: { trueProbability: null, modelProbability: null, evPercent: null, researchScore: null, tierScore: null } });
    expect(result.researchedCandidates).toEqual(result.picks);
    expect(result.recommendations).toEqual([]);
  });

  it('strips stale stored prop and game quotes at use time and never labels them live', async () => {
    const { stored } = await gameResearch();
    stored.candidates = [prop()];
    const snapshot = structuredClone(stored);
    vi.setSystemTime(new Date('2026-01-21T20:00:00Z'));
    const result = buildNBAResearchPresentation(stored, 'NBA props and moneylines', []);
    expect(result.picks).toHaveLength(2);
    for (const pick of result.picks) {
      expect(pick.tierDecision?.pickTier).toBe('PASS');
      expect(pick.pricing).toMatchObject({ state: 'UNPRICED', sportsbook: null, americanOdds: null });
      expect(pick.pricing.quoteStatus).toBe(pick.subject.kind === 'GAME_LINE' ? 'STALE' : 'UNAVAILABLE');
      expect(pick.metrics).toMatchObject({ trueProbability: null, modelProbability: null, evPercent: null, researchScore: null });
    }
    expect(result.recommendations).toEqual([]);
    expect(stored).toEqual(snapshot);
  });

  it.each([
    ['Best NBA props', 'BEST', ['quality', 'probability', 'value']],
    ['Most likely NBA props', 'MOST_LIKELY', ['probability', 'quality', 'value']],
    ['Best value NBA props', 'BEST_VALUE', ['value', 'quality', 'probability']],
  ] as const)('orders %s using supplied metrics without changing tiers', (query, sort, ids) => {
    const candidates = [prop({ candidateId: 'value', researchScore: 74, trueProbability: 55, evPercent: 30 }),
      prop({ candidateId: 'probability', researchScore: 84, trueProbability: 80, evPercent: 5 }),
      prop({ candidateId: 'quality', researchScore: 85, trueProbability: 65, evPercent: 10 })];
    const result = buildNBAResearchPresentation(session({ candidates }), query, candidates.map(record => record.candidateId));
    expect(result).toMatchObject({ requestedSort: sort, sortStatus: 'UPSTREAM_ORDER' });
    expect(result.picks.map(pick => pick.candidateId)).toEqual(ids);
    expect(Object.fromEntries(result.picks.map(pick => [pick.candidateId, pick.tierDecision?.pickTier])))
      .toEqual({ quality: 'SHARP', probability: 'EDGE', value: 'LEAN' });
    for (const pick of result.picks) {
      const source = candidates.find(record => record.candidateId === pick.candidateId)!;
      expect(pick.metrics).toMatchObject({ trueProbability: source.trueProbability, evPercent: source.evPercent, researchScore: source.researchScore });
    }
  });

  it('keeps unmatched or unsupported raw props research-only with missing model metrics', () => {
    const raw: NBACandidate = { sport: 'nba', id: 'raw', eventId: 'odds-1', gameId: 'target', playerId: null,
      playerName: 'Unknown Player', team: 'Home', opponent: 'Away', market: 'points', marketLabel: 'Points',
      historicalSupport: 'unsupported', line: 20.5, side: 'over', book: 'Fixture Book', oddsAmerican: -110,
      isAlternate: false, priceTimestamp: availabilityTime, priceFreshness: 'FRESH', playerMatch: 'UNMATCHED',
      history: null, projection: null, injuryTier: null, injuryEvidence: 'FEED_UNAVAILABLE', nbaPrediction: null,
      researchContext: null, intelligenceSnapshot: null, outlierDependency: null, alternateLines: null,
      crossBookThreshold: null, marketMovement: { available: false, direction: 'unavailable', openingOdds: null,
        currentOdds: null, observedOverMinutes: null, pointCount: 0, label: null },
      howItLoses: [], position: null, opponentContext: null, eliteAnalysis: null };
    const inputs = unclassifiedNBAPropResearch([raw, { ...raw, id: 'matched-no-model', playerMatch: 'MATCHED' }]);
    const result = buildNBAResearchPresentation(session({ nbaPresentationResearch: inputs }), 'NBA props', []);
    expect(result.picks).toHaveLength(2);
    expect(result.outcome).toBe('RESEARCH_ONLY');
    for (const pick of result.picks) {
      expect(pick).toMatchObject({ disposition: 'RESEARCH_ONLY', tierDecision: null, subject: { kind: 'PLAYER_PROP' },
        metrics: { trueProbability: null, modelProbability: null, evPercent: null, researchScore: null, tierScore: null } });
      expect(pick.missing).toContain('Verified player/model evidence incomplete');
    }
    expect(result.recommendations).toEqual([]);
  });

  it.each([true, false])('retains unsupported preseason as research-only with missingQuotes=%s', async missingQuotes => {
    const fixture = availabilityFixture();
    fixture.snapshot.target.phase = 'PRESEASON';
    const dependencies = availabilityDependencies(fixture);
    if (missingQuotes) dependencies.loadQuotes = async () => ({ status: 'UNSUPPORTED_QUOTE', quotes: [], reason: 'Offline cache empty' });
    const research = await researchNBAGameLines([availabilityGame()], [availabilityEvent()], dependencies);
    expect(research.recommendations).toEqual([]);
    expect(research.modeledGames[0].projection).toMatchObject({ phase: 'PRESEASON', status: 'UNSUPPORTED_PHASE' });
    const result = buildNBAResearchPresentation(session({ modeledGames: research.modeledGames }), 'NBA moneylines', []);
    expect(result).toMatchObject({ outcome: 'RESEARCH_ONLY', recommendations: [], recommendedCandidateIds: [] });
    expect(result.picks[0]).toMatchObject({ disposition: 'RESEARCH_ONLY', tierDecision: null, season: { phase: 'PRESEASON' } });
    expect(result.picks[0].pricing).toMatchObject({ state: missingQuotes ? 'UNPRICED' : 'PRICED',
      americanOdds: missingQuotes ? null : quote().americanOdds });
    expect(result.picks[0].metrics).toEqual({ trueProbability: null, modelProbability: null,
      evPercent: null, researchScore: null, tierScore: null });
  });
});