import { describe, expect, it } from 'vitest';
import { buildNFLEvidenceConflict, buildNFLResearchProfile, buildNFLRolePositionUsage, buildNFLWeatherCandidateImpacts, classifyNFLPracticeTrend, evaluateNFLHardGates, makeNFLResearchLayer, NFL_SCORE_WEIGHTS, reviewNFLSourceConflicts, routeNFLNewsImpact, scoreNFLResearch, type NFLHardGates, type NFLPracticeEvidence, type NFLScoreDimension, type NFLScoreRating, type NFLResearchProfileInput, type NFLIntelligenceItem } from './researchModel';
import type { NFLWeatherContext } from './weather';

const allPassingGates = Object.fromEntries([
  'currentPrice', 'majorInjuryResolved', 'roleClear', 'requiredDataPresent', 'currentLineReEvaluated',
  'footballThesisExplained', 'sourceConflictsResolved', 'projectionAdvantage', 'priceValueRemains', 'evidenceQuality',
].map((key) => [key, { passed: true, reason: null }])) as NFLHardGates;

function healthyPlayerProfileInput(): NFLResearchProfileInput {
  const now = '2026-10-05T15:00:00Z';
  const gameScript = { thesis: 'Market-favored, not certain to lead.', expectedGameEnvironment: 'MARKET_TOTAL_AVAILABLE', expectedLeader: 'Team',
    expectedMarginRange: { low: null, high: null, marketSpread: 3 }, expectedPassPressure: 'HIGHER_IF_TRAILING', expectedRushOpportunity: 'HIGHER_IF_LEADING',
    expectedPossessions: null, spread: -3, total: 45, homeTeamTotal: 24, awayTeamTotal: 21, homeAway: 'HOME', offensivePace: null,
    neutralPassRate: null, neutralRushRate: null, noHuddleRate: null, situationalTendencies: {}, projectionImpact: 'Scenario only.', confidence: 'LOW', evidence: ['ESPN game odds'] };
  const healthyInjury = { player: { playerId: 1, player: 'Player', teamId: 2, team: 'Team', position: 'WR', injury: null, status: 'Active',
    availabilityDesignation: 'CONFIRMED_AVAILABLE', evidence: null, updatedAt: now, sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] },
    teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: now };
  return {
    player: 'Player', position: 'WR', team: 'Team', market: 'player_receptions', direction: 'over', line: 4.5, sportsbook: 'Book', oddsAmerican: -110,
    priceTimestamp: now, retrievedAt: now, priceCurrent: true, priceFreshness: 'FRESH', trueProbability: 61, priceEdge: 8.6, valueQualified: true,
    existingEliteQualified: true, dataQuality: 95, rawEdge: 1.5,
    roleContext: { status: 'STABLE', confidence: 'MEDIUM', workloadTrend: 'STABLE', evidence: ['Recorded target opportunity'], unavailableEvidence: ['routes'],
      opportunity: { statKey: 'receivingTargets', available: true, trend: 'WORKLOAD_STABLE', l3: { games: 3, mean: 6 }, l5: { games: 5, mean: 5 }, season: { games: 10, mean: 5 }, rolling: { games: 10, mean: 5 } } } as never,
    roleLogs: [], opponentContext: { status: 'PARTIAL', evidence: ['Opponent passing context'], missingFields: ['coverage'], opponentTeamId: 3, metrics: [] } as never,
    injuryContext: healthyInjury as never, weatherContext: null, marketSupport: 'full', historyGames: 10, projectionAvailable: true, availabilityEligible: true,
    alternatePrices: [], supportingReasons: ['Current-line projection clears the required threshold.'], counterReasons: ['Route participation is unavailable.'],
    intelligenceStatus: 'AVAILABLE', intelligenceItems: [],
    layerOverrides: { gameScript: makeNFLResearchLayer('PARTIAL_DATA', gameScript as never, ['possessions']) },
  };
}

describe('NFL-specific research model contract', () => {
  it('scores the requested weighted framework without changing official qualification', () => {
    const ratings = Object.fromEntries(Object.keys(NFL_SCORE_WEIGHTS).map((key) => [key, 100])) as Record<NFLScoreDimension, number>;
    const result = scoreNFLResearch(ratings);
    expect(result.score).toBe(100);
    expect(result.classification).toBe('ELITE');
    expect(Object.values(result.components).reduce((sum, component) => sum + component.weight, 0)).toBe(100);
    expect(result.scoreIsOfficialQualification).toBe(false);
    expect(result.productionEliteBoundary).toBe(85);
    expect(result.scoreEliteBoundary).toBe(90);
  });

  it('does not manufacture a total score from missing layer ratings', () => {
    const result = scoreNFLResearch({ roleOpportunity: 90, expectedGameScript: null });
    expect(result.score).toBeNull();
    expect(result.classification).toBe('UNAVAILABLE');
    expect(result.components.intelligence).toMatchObject({ componentScore: null, points: null, evidenceCoverage: null });
  });

  it('keeps a weighted score incomplete when a component evidence coverage is below 70%', () => {
    const ratings = Object.fromEntries(Object.keys(NFL_SCORE_WEIGHTS).map((key) => [key, { rating: 80, evidenceCoverage: 100, confidence: 'HIGH' }])) as Partial<Record<NFLScoreDimension, NFLScoreRating>>;
    ratings.intelligence = { rating: 80, evidenceCoverage: 20, confidence: 'LOW' };
    const score = scoreNFLResearch(ratings);
    expect(score.score).toBeNull();
    expect(score.components.intelligence).toMatchObject({ componentScore: 80, evidenceCoverage: 20, confidence: 'LOW' });
  });

  it('hard gates override score and require both sides of the evidence conflict', () => {
    const support = [{ statement: 'Projection clears current line.', source: null, reliability: 'MODEL_EVIDENCE' as const, impact: 'HIGH' as const }];
    const counter = [{ statement: 'Role trend is uncertain.', source: null, reliability: 'MODEL_EVIDENCE' as const, impact: 'HIGH' as const }];
    expect(buildNFLEvidenceConflict(support, counter, allPassingGates).verdict).toBe('PLAY');
    const blocked = { ...allPassingGates, roleClear: { passed: false, reason: 'Role is unclear.' } };
    expect(evaluateNFLHardGates(blocked)).toMatchObject({ passed: false, failed: ['roleClear'] });
    expect(buildNFLEvidenceConflict(support, counter, blocked)).toMatchObject({ verdict: 'PASS', counterCaseReviewed: true });
    expect(buildNFLEvidenceConflict(support, [], allPassingGates)).toMatchObject({ verdict: 'PASS', counterCaseReviewed: false });
  });

  it('retains explicit missing data without filling layer values', () => {
    expect(makeNFLResearchLayer('PARTIAL_DATA', null, ['coverage rates'])).toEqual({
      status: 'PARTIAL_DATA', value: null, provenance: [], missingFields: ['coverage rates'],
    });
  });

  it('builds a fail-closed profile from missing source layers without changing legacy Elite status', () => {
    const input = {
      player: 'Test Player', team: 'Test Team', market: 'player_receptions', direction: 'over', line: 4.5,
      sportsbook: 'Book', oddsAmerican: -110, priceTimestamp: '2026-10-05T12:00:00Z', retrievedAt: '2026-10-05T12:00:01Z',
      priceCurrent: true, priceFreshness: 'FRESH', trueProbability: 61, priceEdge: 8.6, valueQualified: true,
      existingEliteQualified: true, dataQuality: 95, rawEdge: 1.5, roleContext: { status: 'STABLE', confidence: 'MEDIUM', workloadTrend: 'STABLE', evidence: ['Targets recorded in game logs'], unavailableEvidence: ['routes'], opportunity: { l3: { games: 3, mean: 6 }, l5: { games: 5, mean: 5 }, season: { games: 10, mean: 5 } } },
      opponentContext: { status: 'PARTIAL', evidence: ['Passing yards allowed'], missingFields: ['coverage rates'], opponentTeamId: 2 },
      injuryContext: null, weatherContext: null, marketSupport: 'full', historyGames: 10, projectionAvailable: true,
      availabilityEligible: false, alternatePrices: [{ sportsbook: 'Other Book', price: 105, line: 4.5 }],
      supportingReasons: ['Projection clears the current line.'], counterReasons: ['Role metrics omit routes.'],
    } as unknown as NFLResearchProfileInput;
    const profile = buildNFLResearchProfile(input);
    expect(profile.sportFilter).toBe('NFL_FILTER');
    expect(profile.market.value).toMatchObject({ impliedProbability: 52.4, trueProbability: 61, priceEdge: 8.6 });
    expect(profile.gameScript.status).toBe('UNAVAILABLE');
    expect(profile.schemeMatchup.status).toBe('PARTIAL_DATA');
    expect(profile.intelligence.status).toBe('UNAVAILABLE');
    expect(profile.score.score).toBeNull();
    expect(profile.productionEliteQualified).toBe(false);
    expect(profile.verdict).toBe('PASS');
    expect(profile.hardGates.majorInjuryResolved.passed).toBe(false);
    expect(profile.hardGates.sourceConflictsResolved.passed).toBe(true);
  });

  it('routes sourced news impact only to affected player and market candidates', () => {
    const signal = { signal: 'Starting RB limited', affectedPlayers: ['RB One', 'RB Two'], affectedMarkets: ['player_rush_attempts'], affectedCandidateIds: [],
      source: { source: 'Team report', sourceType: 'OFFICIAL' as const, publishedAt: '2026-10-05T12:00:00Z', retrievedAt: '2026-10-05T12:01:00Z', affectedPlayer: 'RB One', affectedTeam: 'Team' },
      projectionImpact: 'Re-evaluate both backfield projections.', direction: 'MIXED' as const,
      reEvaluationRequired: true, reEvaluatedAt: null, reEvaluationResult: 'PENDING' as const };
    expect(routeNFLNewsImpact(signal, [
      { candidateId: 'a', player: 'RB One', market: 'player_rush_attempts', projection: 15 },
      { candidateId: 'b', player: 'RB Two', market: 'player_rush_attempts', projection: 8 },
      { candidateId: 'c', player: 'RB One', market: 'player_receptions', projection: 2 },
    ])).toMatchObject([{ candidateId: 'a', status: 'PENDING' }, { candidateId: 'b', status: 'PENDING' }]);
  });

  it('does not call missing optional news a source conflict for a healthy player', () => {
    expect(reviewNFLSourceConflicts({ intelligence: [], injuryContext: null }).status).toBe('NONE');
    expect(buildNFLEvidenceConflict([{ statement: 'Current-price projection thesis', source: null, reliability: 'MODEL_EVIDENCE', impact: 'HIGH' }],
      [{ statement: 'Role metrics omit snap share', source: null, reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM' }], allPassingGates).conflictStatus).toBe('NONE');
    const profile = buildNFLResearchProfile(healthyPlayerProfileInput());
    expect(profile.intelligence).toMatchObject({ status: 'AVAILABLE', value: [] });
    expect(profile.evidence.conflictStatus).toBe('NONE');
    expect(profile.hardGates.sourceConflictsResolved.passed).toBe(true);
    expect(profile.productionEliteQualified).toBe(true);
  });

  it('requires season context in the research profile without applying an unsupported numerical adjustment', () => {
    const input = { ...healthyPlayerProfileInput(), gameSeason: 2026, gameWeek: 3, gameSeasonType: 'REGULAR' as const,
      roleLogs: [1, 2, 3].map((week) => ({ gameId: `g${week}`, season: 2026, week, date: `2026-09-0${week}`, teamId: 2, position: 'WR',
        opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home' as const, result: 'W', stats: { receivingYards: 55 + week } })) };
    const profile = buildNFLResearchProfile(input);
    expect(profile.seasonContext).toMatchObject({ status: 'PARTIAL_DATA', value: {
      season: 2026, week: 3, gameNumber: 4, phase: 'EARLY_REGULAR_SEASON', impact: 'UNCERTAINTY', projectionAdjustment: null,
    } });
    expect(profile.seasonContext.value?.notes.join(' ')).toContain('only 3 current-season games');
    expect(profile.evidence.against.some((item) => item.statement.includes('Early-season uncertainty'))).toBe(true);
    expect(profile.productionEliteQualified).toBe(true);
  });

  it('adds observed midseason role change to the counter-case without changing projection or score', () => {
    const base = healthyPlayerProfileInput();
    const input = { ...base, gameSeason: 2026, gameWeek: 9, gameSeasonType: 'REGULAR' as const,
      roleContext: { ...base.roleContext, status: 'CHANGING', workloadTrend: 'WORKLOAD_INCREASE' } as never };
    const profile = buildNFLResearchProfile(input);
    expect(profile.seasonContext.value).toMatchObject({ phase: 'MID_REGULAR_SEASON', impact: 'UNCERTAINTY', projectionAdjustment: null });
    expect(profile.evidence.against.some((item) => item.statement.includes('Current role is CHANGING'))).toBe(true);
    expect(profile.productionEliteQualified).toBe(true);
  });

  it('tests every hard gate independently at the NFL publication boundary', () => {
    const unresolved = { status: 'UNRESOLVED' as const, conflicts: [{ topic: 'role', evidence: ['A', 'B'], status: 'UNRESOLVED' as const, resolutionReason: 'Opposing reports.' }],
      resolutionReason: null, highestAuthorityEvidence: null };
    const cases: Array<[keyof NFLHardGates, Partial<NFLResearchProfileInput>]> = [
      ['currentPrice', { priceCurrent: false }],
      ['majorInjuryResolved', { availabilityEligible: false }],
      ['roleClear', { roleContext: { ...healthyPlayerProfileInput().roleContext, status: 'UNCERTAIN' } as never }],
      ['requiredDataPresent', { layerOverrides: { gameScript: makeNFLResearchLayer<import('./researchModel').NFLGameScriptResearch>('UNAVAILABLE', null) }, opponentContext: null }],
      ['currentLineReEvaluated', { lineReevaluated: false }],
      ['footballThesisExplained', { roleContext: { ...healthyPlayerProfileInput().roleContext, evidence: [] } as never }],
      ['sourceConflictsResolved', { sourceConflictReview: unresolved }],
      ['projectionAdvantage', { rawEdge: 0.1 }],
      ['priceValueRemains', { priceValueRemains: false }],
      ['evidenceQuality', { dataQuality: 70 }],
    ];
    const baseline = buildNFLResearchProfile(healthyPlayerProfileInput());
    for (const key of Object.keys(baseline.hardGates) as Array<keyof NFLHardGates>) {
      expect(baseline.hardGates[key].passed, `${key} baseline should pass`).toBe(true);
    }
    for (const [key, override] of cases) {
      const profile = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), ...override });
      expect(profile.hardGates[key].passed, `${key} should pass this fixture`).toBe(false);
      expect(profile.productionEliteQualified, `${key} must block official publication`).toBe(false);
    }
  });

  it('keeps the weighted NFL score distinct from production qualification', () => {
    const completeRatings = Object.fromEntries(Object.keys(NFL_SCORE_WEIGHTS).map((key) => [key,
      { rating: 95, evidenceCoverage: 100, confidence: 'HIGH' }])) as Partial<Record<NFLScoreDimension, NFLScoreRating>>;
    const scoreOnly = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), scoreRatings: completeRatings });
    expect(scoreOnly.score).toMatchObject({ score: 95, classification: 'ELITE' });
    expect(scoreOnly.productionEliteQualified).toBe(true);

    const incomplete = buildNFLResearchProfile(healthyPlayerProfileInput());
    expect(incomplete.score.score).toBeNull();
    expect(incomplete.productionEliteQualified).toBe(true);

    const blockedProduction = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), scoreRatings: completeRatings, existingEliteQualified: false });
    expect(blockedProduction.score.classification).toBe('ELITE');
    expect(blockedProduction.productionEliteQualified).toBe(false);
  });

  it('moves game-script evidence between FOR and counter-case while retaining the same numeric thesis', () => {
    const favoriteScript = healthyPlayerProfileInput().layerOverrides!.gameScript!;
    const underdogScript = { ...favoriteScript, value: { ...favoriteScript.value!, expectedLeader: 'Opponent',
      candidateEvidence: { direction: 'NEGATIVE' as const, statement: 'Market underdog may trail; pass volume is conditional.' } } };
    const favorite = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), position: 'RB', market: 'player_rush_yds',
      layerOverrides: { gameScript: { ...favoriteScript, value: { ...favoriteScript.value!, candidateEvidence: { direction: 'POSITIVE', statement: 'Favorite may lead; rush volume is conditional.' } } } as never } });
    const underdog = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), position: 'RB', market: 'player_rush_yds', layerOverrides: { gameScript: underdogScript as never } });
    expect(favorite.evidence.for.some((item) => item.statement.includes('Favorite may lead'))).toBe(true);
    expect(underdog.evidence.against.some((item) => item.statement.includes('Market underdog'))).toBe(true);
    expect(favorite.score.score).toBe(underdog.score.score);
  });

  it('lets severe pass-market wind, a missing starting QB, or missing QB protection veto a strong baseline', () => {
    const outdoorWind = { sourceStatus: 'AVAILABLE', environment: 'OUTDOOR', wind: { speed: 23, unit: 'mph' }, gusts: null, precipitation: null,
      venue: null, kickoff: '2026-10-11T17:00:00Z', temperature: null, conditions: 'Windy', severeConditions: [], forecastTimestamp: '2026-10-05T12:00:00Z',
      sources: { venue: 'ESPN', geocode: null, forecast: 'Open-Meteo' }, missingFields: [] } as NFLWeatherContext;
    const weatherBlocked = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), market: 'player_pass_yds', weatherContext: outdoorWind });
    expect(weatherBlocked.hardGates.projectionAdvantage).toMatchObject({ passed: false, reason: expect.stringContaining('Severe wind') });

    const qbAbsence = { player: { playerId: 1, player: 'Player', teamId: 2, team: 'Team', position: 'WR', injury: null, status: 'Active', availabilityDesignation: 'CONFIRMED_AVAILABLE',
      evidence: null, updatedAt: '2026-10-05T15:00:00Z', sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] },
      teammateAbsences: [{ playerId: 2, player: 'Starting QB', teamId: 2, team: 'Team', position: 'QB', injury: null, status: 'Out', availabilityDesignation: 'OUT',
        evidence: null, updatedAt: '2026-10-05T15:00:00Z', sourceStatus: 'CURRENT', affectedRole: 'QUARTERBACK', missingFields: [] }],
      opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: '2026-10-05T15:00:00Z' } as never;
    const receiverBlocked = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), injuryContext: qbAbsence, market: 'player_reception_yds' });
    expect(receiverBlocked.hardGates.projectionAdvantage.passed).toBe(false);

    const ltAbsence = { player: { playerId: 1, player: 'Player', teamId: 2, team: 'Team', position: 'QB', injury: null, status: 'Active',
      availabilityDesignation: 'CONFIRMED_AVAILABLE', evidence: null, updatedAt: '2026-10-05T15:00:00Z', sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] },
      teammateAbsences: [{ playerId: 3, player: 'Starting LT', teamId: 2, team: 'Team', position: 'LT', injury: null, status: 'Out', availabilityDesignation: 'OUT',
        evidence: null, updatedAt: '2026-10-05T15:00:00Z', sourceStatus: 'CURRENT', affectedRole: 'OFFENSIVE_LINE', missingFields: [] }], opponentAbsences: [],
      sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: '2026-10-05T15:00:00Z' } as never;
    const qbBlocked = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), position: 'QB', market: 'player_pass_yds', injuryContext: ltAbsence });
    expect(qbBlocked.hardGates.projectionAdvantage).toMatchObject({ passed: false, reason: expect.stringContaining('offensive-line') });
  });

  it('strengthens supported replacement-role evidence for a missing competitor without forcing qualification', () => {
    const rbOut = { playerId: 3, player: 'Competing RB', teamId: 2, team: 'Team', position: 'RB', injury: null, status: 'Out',
      availabilityDesignation: 'OUT', evidence: null, updatedAt: '2026-10-05T15:00:00Z', sourceStatus: 'CURRENT', affectedRole: 'BACKFIELD', missingFields: [] };
    const injuries = { player: { playerId: 1, player: 'Player', teamId: 2, team: 'Team', position: 'RB', injury: null, status: 'Active',
      availabilityDesignation: 'CONFIRMED_AVAILABLE', evidence: null, updatedAt: rbOut.updatedAt, sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] },
      teammateAbsences: [rbOut], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: rbOut.updatedAt } as never;
    const profile = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), position: 'RB', market: 'player_rush_yds', injuryContext: injuries });
    expect(profile.evidence.for.some((item) => item.statement.includes('Competing backfield player'))).toBe(true);
    expect(profile.productionEliteQualified).toBe(true);
  });

  it('records receiving-competition and opposing-front injury effects as thesis evidence, not automatic picks', () => {
    const receiverCompetitor = { playerId: 4, player: 'WR1', teamId: 2, team: 'Team', position: 'WR', injury: null, status: 'Out',
      availabilityDesignation: 'OUT', evidence: null, updatedAt: '2026-10-05T15:00:00Z', sourceStatus: 'CURRENT', affectedRole: 'RECEIVING_OPTION', missingFields: [] };
    const receiverInjury = { player: { playerId: 1, player: 'Player', teamId: 2, team: 'Team', position: 'WR', injury: null, status: 'Active',
      availabilityDesignation: 'CONFIRMED_AVAILABLE', evidence: null, updatedAt: receiverCompetitor.updatedAt, sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] },
      teammateAbsences: [receiverCompetitor], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: receiverCompetitor.updatedAt } as never;
    const receiver = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), position: 'WR', injuryContext: receiverInjury });
    expect(receiver.evidence.for.some((item) => item.statement.includes('Competing receiving option WR1'))).toBe(true);

    const defensiveFront = { playerId: 5, player: 'DT1', teamId: 3, team: 'Opponent', position: 'DT', injury: null, status: 'Out',
      availabilityDesignation: 'OUT', evidence: null, updatedAt: receiverCompetitor.updatedAt, sourceStatus: 'CURRENT', affectedRole: 'OPPONENT_DEFENDER', missingFields: [] };
    const rbInjury = { player: { playerId: 1, player: 'Player', teamId: 2, team: 'Team', position: 'RB', injury: null, status: 'Active',
      availabilityDesignation: 'CONFIRMED_AVAILABLE', evidence: null, updatedAt: receiverCompetitor.updatedAt, sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] },
      teammateAbsences: [], opponentAbsences: [defensiveFront], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: receiverCompetitor.updatedAt } as never;
    const rb = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), position: 'RB', market: 'player_rush_yds', injuryContext: rbInjury });
    expect(rb.evidence.for.some((item) => item.statement.includes('Opponent front-seven player DT1'))).toBe(true);
  });

  it('blocks a materially limited player report without numeric projection fabrication', () => {
    const limitation: NFLIntelligenceItem = { source: 'ESPN · Reporter', sourceType: 'NATIONAL', publishedAt: '2026-10-05T14:00:00Z', retrievedAt: '2026-10-05T15:00:00Z',
      affectedPlayer: 'Player', affectedTeam: 'Team', articleUrl: null, quoteOrSummary: 'Player workload will be limited', marketImpact: 'Negative',
      affectedMarkets: ['player_receptions'], actionability: 'HIGH', reliability: 'STRONG_SIGNAL', direction: 'NEGATIVE', confidence: null };
    const profile = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), intelligenceItems: [limitation] });
    expect(profile.evidence.against.some((item) => item.statement.includes('workload will be limited'))).toBe(true);
    expect(profile.hardGates.projectionAdvantage.passed).toBe(false);
    expect(profile.market.value?.trueProbability).toBe(61);
  });

  it('re-evaluates the current moved player line and can conclude value disappeared', () => {
    const profile = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), line: 68.5, oddsAmerican: -115, valueQualified: false, rawEdge: -2,
      marketIntelligence: { openingLine: null, firstObservedLine: 61.5, previousLine: 61.5, currentLine: 68.5, openingPrice: null,
        previousPrice: -110, currentPrice: -115, lineMovement: 7, priceMovement: -5, movementTimestamp: '2026-10-05T15:00:00Z',
        movementReason: 'UNKNOWN', valueRemains: false, reEvaluatedAtCurrentLine: true } });
    expect(profile.market.value).toMatchObject({ line: 68.5, currentPrice: -115 });
    expect(profile.marketIntelligence.value).toMatchObject({ firstObservedLine: 61.5, currentLine: 68.5, lineMovement: 7, movementReason: 'UNKNOWN', valueRemains: false });
    expect(profile.hardGates.priceValueRemains.passed).toBe(false);
    expect(profile.verdict).toBe('PASS');
  });

  it('marks recent same-authority opposing reports unresolved', () => {
    const item = (id: string, direction: 'POSITIVE' | 'NEGATIVE'): NFLIntelligenceItem => ({
      source: `ESPN · ${id}`, sourceType: 'NATIONAL', publishedAt: '2026-10-05T14:00:00Z', retrievedAt: '2026-10-05T15:00:00Z',
      affectedPlayer: 'Player', affectedTeam: 'Team', articleUrl: null, quoteOrSummary: id, marketImpact: id,
      affectedMarkets: ['player_receptions'], actionability: 'MEDIUM', reliability: 'STRONG_SIGNAL', direction, confidence: null,
    });
    const review = reviewNFLSourceConflicts({ intelligence: [item('role expands', 'POSITIVE'), item('role reduced', 'NEGATIVE')], injuryContext: null, now: new Date('2026-10-05T16:00:00Z') });
    expect(review.status).toBe('UNRESOLVED');
    expect(review.conflicts).toHaveLength(1);
  });

  it('lets a current official OUT designation resolve a secondary availability expectation', () => {
    const item: NFLIntelligenceItem = { source: 'ESPN · Reporter', sourceType: 'NATIONAL', publishedAt: '2026-10-05T14:00:00Z', retrievedAt: '2026-10-05T15:00:00Z',
      affectedPlayer: 'Player', affectedTeam: 'Team', articleUrl: null, quoteOrSummary: 'Player expected to play', marketImpact: 'Positive',
      affectedMarkets: ['player_receptions'], actionability: 'MEDIUM', reliability: 'STRONG_SIGNAL', direction: 'POSITIVE', confidence: null };
    const entry = { playerId: 1, player: 'Player', teamId: 2, team: 'Team', position: 'WR', injury: 'hamstring', status: 'Out',
      availabilityDesignation: 'OUT', evidence: null, updatedAt: '2026-10-05T15:30:00Z', sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] };
    const injury = { player: entry, teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: entry.updatedAt } as never;
    const review = reviewNFLSourceConflicts({ intelligence: [item], injuryContext: injury, now: new Date('2026-10-05T16:00:00Z') });
    expect(review.status).toBe('RESOLVED');
    expect(review.highestAuthorityEvidence).toContain('highest-authority connected availability evidence');
  });

  it('applies unresolved source conflicts as an official-pick veto', () => {
    const item = (direction: 'POSITIVE' | 'NEGATIVE', text: string): NFLIntelligenceItem => ({ source: `ESPN · ${text}`, sourceType: 'NATIONAL',
      publishedAt: '2026-10-05T14:00:00Z', retrievedAt: '2026-10-05T15:00:00Z', affectedPlayer: 'Player', affectedTeam: 'Team', articleUrl: null,
      quoteOrSummary: text, marketImpact: text, affectedMarkets: ['player_receptions'], actionability: 'HIGH', reliability: 'STRONG_SIGNAL', direction, confidence: null });
    const intelligenceItems = [item('POSITIVE', 'Expanded role expected.'), item('NEGATIVE', 'Role reduced.')];
    const review = reviewNFLSourceConflicts({ intelligence: intelligenceItems, injuryContext: null, now: new Date('2026-10-05T16:00:00Z') });
    const profile = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), intelligenceItems, sourceConflictReview: review });
    expect(profile.evidence.conflictStatus).toBe('UNRESOLVED');
    expect(profile.hardGates.sourceConflictsResolved.passed).toBe(false);
    expect(profile.productionEliteQualified).toBe(false);
  });

  it('keeps an official current OUT above secondary expectations and still applies the availability rejection', () => {
    const positiveReport: NFLIntelligenceItem = { source: 'ESPN · Reporter', sourceType: 'NATIONAL', publishedAt: '2026-10-05T14:00:00Z', retrievedAt: '2026-10-05T15:00:00Z',
      affectedPlayer: 'Player', affectedTeam: 'Team', articleUrl: null, quoteOrSummary: 'Player expected to play', marketImpact: 'Positive',
      affectedMarkets: ['player_receptions'], actionability: 'MEDIUM', reliability: 'STRONG_SIGNAL', direction: 'POSITIVE', confidence: null };
    const outEntry = { playerId: 1, player: 'Player', teamId: 2, team: 'Team', position: 'WR', injury: 'hamstring', status: 'Out',
      availabilityDesignation: 'OUT', evidence: null, updatedAt: '2026-10-05T15:30:00Z', sourceStatus: 'CURRENT', affectedRole: 'PLAYER', missingFields: [] };
    const injury = { player: outEntry, teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: outEntry.updatedAt } as never;
    const review = reviewNFLSourceConflicts({ intelligence: [positiveReport], injuryContext: injury, now: new Date('2026-10-05T16:00:00Z') });
    const profile = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), intelligenceItems: [positiveReport], injuryContext: injury, availabilityEligible: false, sourceConflictReview: review });
    expect(profile.evidence.conflictStatus).toBe('RESOLVED');
    expect(profile.hardGates.sourceConflictsResolved.passed).toBe(true);
    expect(profile.hardGates.majorInjuryResolved.passed).toBe(false);
    expect(profile.productionEliteQualified).toBe(false);
  });

  it('does not fail a healthy candidate because unrelated teammates/opponents are questionable', () => {
    const healthy = healthyPlayerProfileInput();
    const questionable = (player: string, teamId: number, team: string, position: string, affectedRole: string) => ({ playerId: teamId + 100,
      player, teamId, team, position, injury: 'listed questionable', status: 'Questionable', availabilityDesignation: 'QUESTIONABLE', evidence: null,
      updatedAt: '2026-10-05T15:00:00Z', sourceStatus: 'CURRENT', affectedRole, missingFields: [] });
    const profile = buildNFLResearchProfile({ ...healthy, injuryContext: { player: healthyPlayerProfileInput().injuryContext!.player,
      teammateAbsences: [questionable('Other Receiver', 2, 'Team', 'WR', 'RECEIVING_OPTION')],
      opponentAbsences: [questionable('Opposing Linebacker', 3, 'Opponent', 'LB', 'OPPONENT_DEFENDER')],
      sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: '2026-10-05T15:00:00Z' } as never });
    expect(profile.hardGates.majorInjuryResolved.passed).toBe(true);
  });

  it('blocks a passing candidate while the starting quarterback dependency is questionable', () => {
    const healthy = healthyPlayerProfileInput();
    const quarterback = { playerId: 9, player: 'Starting QB', teamId: 2, team: 'Team', position: 'QB', injury: 'shoulder', status: 'Questionable',
      availabilityDesignation: 'QUESTIONABLE', evidence: null, updatedAt: '2026-10-05T15:00:00Z', sourceStatus: 'CURRENT',
      affectedRole: 'QUARTERBACK', missingFields: [] };
    const profile = buildNFLResearchProfile({ ...healthy, injuryContext: { ...healthy.injuryContext!, teammateAbsences: [quarterback] } as never });
    expect(profile.hardGates.majorInjuryResolved.passed).toBe(false);
  });

  it('creates an unresolved conflict between coach reassurance and dated limited practice', () => {
    const item: NFLIntelligenceItem = { source: 'ESPN · Reporter', sourceType: 'NATIONAL', publishedAt: '2026-10-03T20:00:00Z', retrievedAt: '2026-10-03T21:00:00Z',
      affectedPlayer: 'Player', affectedTeam: 'Team', articleUrl: null, quoteOrSummary: 'Coach says there is no limitation', marketImpact: 'Positive',
      affectedMarkets: ['player_receptions'], actionability: 'MEDIUM', reliability: 'COACH_SPEAK_UNCERTAIN', direction: 'POSITIVE', confidence: null };
    const practice: NFLPracticeEvidence = { player: 'Player', team: 'Team', practiceDate: '2026-10-03', participation: 'LIMITED', designation: null,
      source: { source: 'Official practice report', sourceType: 'OFFICIAL', publishedAt: '2026-10-03T18:00:00Z', retrievedAt: '2026-10-03T18:05:00Z', affectedPlayer: 'Player', affectedTeam: 'Team' } };
    expect(reviewNFLSourceConflicts({ intelligence: [item], injuryContext: null, practiceEvidence: [practice], now: new Date('2026-10-05T16:00:00Z') }).status).toBe('UNRESOLVED');
  });

  it('lets a later full practice resolve an older limitation before a coach comment', () => {
    const coach: NFLIntelligenceItem = { source: 'ESPN · Reporter', sourceType: 'NATIONAL', publishedAt: '2026-10-03T20:00:00Z', retrievedAt: '2026-10-03T21:00:00Z',
      affectedPlayer: 'Player', affectedTeam: 'Team', articleUrl: null, quoteOrSummary: 'Coach says there are no limitations.', marketImpact: 'Positive',
      affectedMarkets: ['player_receptions'], actionability: 'MEDIUM', reliability: 'COACH_SPEAK_UNCERTAIN', direction: 'POSITIVE', confidence: null };
    const practice = (date: string, participation: 'LIMITED' | 'FULL', time: string): NFLPracticeEvidence => ({ player: 'Player', team: 'Team', practiceDate: date,
      participation, designation: null, source: { source: 'Official practice report', sourceType: 'OFFICIAL', publishedAt: `${date}T${time}:00Z`,
        retrievedAt: `${date}T${time}:05Z`, affectedPlayer: 'Player', affectedTeam: 'Team' } });
    const review = reviewNFLSourceConflicts({ intelligence: [coach], injuryContext: null,
      practiceEvidence: [practice('2026-10-01', 'LIMITED', '18:00'), practice('2026-10-03', 'FULL', '18:00')], now: new Date('2026-10-05T16:00:00Z') });
    expect(review.status).toBe('NONE');
  });

  it('corroborated same-direction intelligence is not a conflict', () => {
    const item = (source: string): NFLIntelligenceItem => ({ source, sourceType: 'NATIONAL', publishedAt: '2026-10-05T14:00:00Z', retrievedAt: '2026-10-05T15:00:00Z',
      affectedPlayer: 'Player', affectedTeam: 'Team', articleUrl: null, quoteOrSummary: 'Observed first-team work increased', marketImpact: 'Positive',
      affectedMarkets: ['player_receptions'], actionability: 'HIGH', reliability: 'STRONG_SIGNAL', direction: 'POSITIVE', confidence: null });
    expect(reviewNFLSourceConflicts({ intelligence: [item('Report A'), item('Report B')], injuryContext: null,
      now: new Date('2026-10-05T16:00:00Z') }).status).toBe('NONE');
  });

  it('does not turn team-tagged stories into candidate-specific conflicts without a player tag', () => {
    const item = (direction: 'POSITIVE' | 'NEGATIVE', summary: string): NFLIntelligenceItem => ({ source: 'ESPN', sourceType: 'NATIONAL',
      publishedAt: '2026-10-05T14:00:00Z', retrievedAt: '2026-10-05T15:00:00Z', affectedPlayer: null, affectedTeam: 'Team', articleUrl: null,
      quoteOrSummary: summary, marketImpact: summary, affectedMarkets: ['player_receptions'], actionability: 'MEDIUM', reliability: 'STRONG_SIGNAL', direction, confidence: null });
    const teamItems = [item('POSITIVE', 'Team role change expected'), item('NEGATIVE', 'Team role reduced')];
    const review = reviewNFLSourceConflicts({ intelligence: teamItems,
      injuryContext: null, candidatePlayer: 'Player', candidateTeam: 'Team', now: new Date('2026-10-05T16:00:00Z') });
    expect(review.status).toBe('NONE');
    expect(teamItems[0].affectedPlayer).toBeNull();
  });

  it('uses only documented QB/RB/WR/TE box-score opportunities and keeps role shares unavailable', () => {
    const logs = [{ date: '2026-10-01', result: 'W', historySource: 'CURRENT_SEASON', stats: { passingAttempts: 30, rushingAttempts: 2,
      receivingTargets: 7, receptions: 5, passingTouchdowns: 2, rushingTouchdowns: 0, receivingTouchdowns: 1 } },
    { date: '2026-10-04', result: 'W', historySource: 'CURRENT_SEASON', stats: { passingAttempts: 34, rushingAttempts: 4,
      receivingTargets: 8, receptions: 6, passingTouchdowns: 1, rushingTouchdowns: 0, receivingTouchdowns: 0 } }] as never;
    const qb = buildNFLRolePositionUsage(logs, 'QB');
    const rb = buildNFLRolePositionUsage(logs, 'RB');
    const receiver = buildNFLRolePositionUsage(logs, 'WR');
    const tightEnd = buildNFLRolePositionUsage(logs, 'TE');
    expect(qb.passAttempts).toMatchObject({ lastGame: 34, l3: 32, season: 32 });
    expect(qb.targets.l3).toBeNull();
    expect(rb.touches).toMatchObject({ lastGame: 10, season: 8.5 });
    expect(receiver.targets.l3).toBe(7.5);
    expect(tightEnd.receptions.l3).toBe(5.5);
  });

  it('serializes distinct QB/RB/WR/TE candidate profiles with only their supported usage populated', () => {
    const logs = [{ date: '2026-10-01', result: 'W', stats: { passingAttempts: 30, rushingAttempts: 2, receivingTargets: 7, receptions: 5, passingTouchdowns: 2, rushingTouchdowns: 0, receivingTouchdowns: 1 } },
      { date: '2026-10-04', result: 'W', stats: { passingAttempts: 34, rushingAttempts: 4, receivingTargets: 8, receptions: 6, passingTouchdowns: 1, rushingTouchdowns: 0, receivingTouchdowns: 0 } }] as never;
    const cases = [
      ['QB', 'player_pass_yds', 'passAttempts'], ['RB', 'player_rush_yds', 'rushingAttempts'],
      ['WR', 'player_reception_yds', 'targets'], ['TE', 'player_receptions', 'receptions'],
    ] as const;
    for (const [position, market, key] of cases) {
      const profile = buildNFLResearchProfile({ ...healthyPlayerProfileInput(), position, market, roleLogs: logs });
      expect(profile.role.value?.position).toBe(position);
      expect(profile.role.value?.positionUsage[key].lastGame).not.toBeNull();
      expect(profile.role.value?.routeParticipation).toBeNull();
      expect(profile.role.value?.airYardShare).toBeNull();
      if (position === 'QB') expect(profile.role.value?.positionUsage.targets.lastGame).toBeNull();
    }
  });

  it('applies market-specific wind evidence and leaves indoor weather not applicable', () => {
    const weather = { sourceStatus: 'AVAILABLE', environment: 'OUTDOOR', wind: { speed: 22, unit: 'mph' }, gusts: null, precipitation: null } as unknown as NFLWeatherContext;
    expect(buildNFLWeatherCandidateImpacts(weather, 'player_pass_yds', 'over')[0]).toMatchObject({ direction: 'NEGATIVE', projectionAdjustment: null });
    expect(buildNFLWeatherCandidateImpacts(weather, 'player_pass_yds', 'under')[0]).toMatchObject({ direction: 'POSITIVE', projectionAdjustment: null });
    expect(buildNFLWeatherCandidateImpacts(weather, 'player_reception_yds', 'over')[0]).toMatchObject({ direction: 'NEGATIVE', projectionAdjustment: null });
    expect(buildNFLWeatherCandidateImpacts(weather, 'player_receptions', 'over')).toEqual([]);
    expect(buildNFLWeatherCandidateImpacts(weather, 'player_rush_attempts', 'over')[0]).toMatchObject({ direction: 'POSITIVE', projectionAdjustment: null });
    expect(buildNFLWeatherCandidateImpacts({ ...weather, environment: 'INDOOR' }, 'player_pass_yds', 'over')).toEqual([]);
    expect(buildNFLWeatherCandidateImpacts({ ...weather, wind: null, precipitation: { amount: 0.02, unit: 'in' }, conditions: 'Light rain' } as unknown as NFLWeatherContext, 'player_pass_yds', 'under')).toEqual([]);
    expect(buildNFLWeatherCandidateImpacts({ ...weather, wind: null, precipitation: { amount: 0.3, unit: 'in' }, conditions: 'Heavy rain' } as unknown as NFLWeatherContext, 'player_pass_yds', 'under')[0]).toMatchObject({ direction: 'MIXED' });
  });

  it.each([
    [[['2026-10-07', 'DNP'], ['2026-10-08', 'LIMITED'], ['2026-10-09', 'FULL']], 'IMPROVING'],
    [[['2026-10-07', 'LIMITED'], ['2026-10-08', 'DNP'], ['2026-10-09', 'DNP']], 'DETERIORATING'],
    [[['2026-10-07', 'FULL'], ['2026-10-08', 'FULL']], 'STABLE'],
    [[['2026-10-07', 'DNP']], 'UNKNOWN'],
  ] as const)('classifies dated practice progression', (rows, expected) => {
    const evidence = rows.map(([practiceDate, participation]) => ({ player: 'Player', team: 'Team', practiceDate,
      participation, designation: null, source: { source: 'Official practice report', sourceType: 'OFFICIAL' as const,
        publishedAt: practiceDate, retrievedAt: `${practiceDate}T20:00:00Z`, affectedPlayer: 'Player', affectedTeam: 'Team' } })) as NFLPracticeEvidence[];
    expect(classifyNFLPracticeTrend(evidence)).toBe(expected);
  });
});