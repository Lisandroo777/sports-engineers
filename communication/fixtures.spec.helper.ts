import type { ResearchCandidateRecord } from '../lib/ai/agent/session';
import type { NFLInjuryContext } from '../lib/nfl/injuries';
import type { NFLHardGates, NFLResearchLayer, NFLResearchProfile } from '../lib/nfl/researchModel';

const snapshotTime = '2026-10-05T12:00:00Z';
const syntheticReason = 'Synthetic-only supplied record for communication contract tests; not performance evidence.';
const definitions = [
  { player: 'Chris Olave', playerId: 900001, marketKey: 'player_reception_yds', market: 'Receiving Yards', position: 'WR', line: 39.5 },
  { player: 'Chris Olave', playerId: 900001, marketKey: 'player_receptions', market: 'Receptions', position: 'WR', line: 3.5 },
  { player: 'Juwan Johnson', playerId: 900002, marketKey: 'player_reception_yds', market: 'Receiving Yards', position: 'TE', line: 24.5 },
  { player: 'Tyler Shough', playerId: 900003, marketKey: 'player_pass_yds', market: 'Passing Yards', position: 'QB', line: 199.5 },
  { player: 'Bijan Robinson', playerId: 900004, marketKey: 'player_rush_yds', market: 'Rushing Yards', position: 'RB', line: 49.5 },
  { player: 'Drake London', playerId: 900005, marketKey: 'player_reception_yds', market: 'Receiving Yards', position: 'WR', line: 39.5 },
  { player: 'Kyle Pitts', playerId: 900006, marketKey: 'player_reception_yds', market: 'Receiving Yards', position: 'TE', line: 24.5 },
];

function makeRecord(definition: typeof definitions[number], index: number, researchMode: 'STANDARD' | 'DEEP'): ResearchCandidateRecord {
  const team = index < 4 ? 'New Orleans Saints' : 'Atlanta Falcons';
  const opponent = index < 4 ? 'Atlanta Falcons' : 'New Orleans Saints';
  const teamId = index < 4 ? 900018 : 900001;
  const provenance = { source: 'SYNTHETIC_COMMUNICATION_FIXTURE', sourceType: 'UNKNOWN' as const,
    publishedAt: snapshotTime, retrievedAt: snapshotTime, affectedPlayer: definition.player, affectedTeam: team };
  const unavailable = <Value>(): NFLResearchLayer<Value> => ({ status: 'UNAVAILABLE', value: null,
    provenance: [], missingFields: [syntheticReason] });
  const hardGates: NFLHardGates = {
    currentPrice: { passed: true, reason: syntheticReason },
    majorInjuryResolved: { passed: true, reason: syntheticReason },
    roleClear: { passed: true, reason: syntheticReason },
    requiredDataPresent: { passed: true, reason: syntheticReason },
    currentLineReEvaluated: { passed: true, reason: syntheticReason },
    footballThesisExplained: { passed: true, reason: syntheticReason },
    sourceConflictsResolved: { passed: true, reason: syntheticReason },
    projectionAdvantage: { passed: true, reason: syntheticReason },
    priceValueRemains: { passed: true, reason: syntheticReason },
    evidenceQuality: { passed: true, reason: syntheticReason },
  };
  const usage = { lastGame: null, l3: null, l5: null, season: null };
  const profile: NFLResearchProfile = {
    researchMode, sportFilter: 'NFL_FILTER', sportFilterVersion: '1.0.0',
    market: { status: 'AVAILABLE', provenance: [provenance], missingFields: [], value: {
      market: definition.marketKey, direction: 'over', line: definition.line, sportsbook: 'SYNTHETIC_BOOK',
      currentPrice: -110, alternatePrices: [], impliedProbability: 52.38, trueProbability: 72 - index,
      priceEdge: 19 - index, priceFreshness: 'CURRENT',
    } },
    role: { status: 'AVAILABLE', provenance: [provenance], missingFields: [], value: {
      position: definition.position, roleStatus: 'STABLE', roleTrend: 'STABLE', roleStability: 'STABLE',
      roleStabilityEvidence: [syntheticReason], roleEvidence: [syntheticReason], roleConfidence: 'HIGH',
      snapShare: null, routeParticipation: null, targetShare: null, airYardShare: null, carryShare: null,
      redZoneUsage: null, goalLineUsage: null, thirdDownUsage: null, twoMinuteUsage: null,
      dropbacks: null, designedRushes: null, scrambles: null, teamPassVolume: null,
      comparisons: { lastGame: null, last3: null, last5: null, season: null },
      positionUsage: { passAttempts: { ...usage }, rushingAttempts: { ...usage }, targets: { ...usage },
        receptions: { ...usage }, touchdowns: { ...usage }, touches: { ...usage } },
    } },
    gameScript: unavailable(), schemeMatchup: unavailable(), trench: unavailable(),
    intelligence: unavailable(), newsImpactSignals: [], injuryNetwork: unavailable(),
    practice: unavailable(), weather: unavailable(), marketIntelligence: unavailable(), seasonContext: unavailable(),
    projectionModel: null,
    evidence: {
      for: [{ statement: `Synthetic supporting quote: ${syntheticReason}`, source: provenance, reliability: 'MODEL_EVIDENCE', impact: 'HIGH' }],
      against: [{ statement: `Synthetic counter-case quote: ${syntheticReason}`, source: provenance, reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM' }],
      counterCaseReviewed: true, conflictStatus: 'NONE', conflicts: [], resolutionReason: syntheticReason,
      highestAuthorityEvidence: syntheticReason, verdict: 'PLAY', unresolvedRisks: [],
    },
    score: { score: 94 - index, classification: 'ELITE', scoreIsOfficialQualification: false,
      productionEliteBoundary: 85, scoreEliteBoundary: 90, boundaryConflict: true,
      components: {
        roleOpportunity: { weight: 20, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        matchupScheme: { weight: 15, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        expectedGameScript: { weight: 15, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        projectionVsLine: { weight: 15, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        injuryLineupImpact: { weight: 10, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        recentUnderlyingPerformance: { weight: 8, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        intelligence: { weight: 7, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        marketMovementPrice: { weight: 5, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        weather: { weight: 3, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
        historicalContext: { weight: 2, componentScore: null, points: null, evidenceCoverage: null, confidence: null },
      } },
    hardGates, verdict: 'PLAY', productionEliteQualified: true,
  };
  const injuryContext: NFLInjuryContext = {
    player: { player: definition.player, playerId: definition.playerId, teamId, team, position: definition.position,
      injury: null, status: 'Active', availabilityDesignation: 'CONFIRMED_AVAILABLE', updatedAt: snapshotTime,
      sourceStatus: 'CURRENT', evidence: syntheticReason, affectedRole: 'PLAYER', missingFields: [] },
    team, teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' },
    lastUpdated: snapshotTime, missingFields: [],
  };
  const candidateId = `SYNTHETIC_COMMUNICATION_${definition.playerId}_${definition.marketKey}`;
  return {
    recommendationType: 'PLAYER_PROP', candidateId, underlyingPlayId: candidateId,
    gameId: 'SYNTHETIC_COMMUNICATION_SAINTS_FALCONS', eventId: 'SYNTHETIC_COMMUNICATION_EVENT',
    retrievedAt: snapshotTime, rank: index + 1, playerId: definition.playerId, teamId, player: definition.player,
    team, opponent, market: definition.market, marketKey: definition.marketKey, position: definition.position,
    line: definition.line, direction: 'over', book: 'SYNTHETIC_BOOK', odds: -110, availableBooks: 1,
    projection: definition.line + 10, projectionUncertainty: 5, edge: 10,
    l5Rate: 80, l10Rate: 80, l20Rate: null, seasonRate: 80,
    researchScore: 94 - index, signalAgreement: 5, signalsAvailable: 5, evidenceCoverage: 95,
    priceFreshness: 'FRESH', trueProbability: 72 - index, evPercent: 30 - index,
    isAlternate: false, dataQuality: 95, trapRisk: 10, qualification: syntheticReason,
    eliteQualified: true, rejectionReasons: [], grade: 'A', priceGrade: 'A',
    playerEdgePercent: 20, priceEdgePercent: 19 - index, breakEvenProbability: 52.38,
    projectedRange: null, bestAlternateLine: null, howItLoses: [syntheticReason], evidenceBoard: [],
    outlierDependencePercent: null, modelProbability: 72 - index, historicalHitRate: 80,
    sampleSize: 10, projectionReliability: null, priceCurrent: true, valueQualified: true,
    crossBookThreshold: null, marketMovement: null, outlierAnalysis: null,
    roleContext: { requirement: 'IMPORTANT', status: 'STABLE', confidence: 'HIGH', workloadTrend: 'STABLE',
      reasons: [syntheticReason], evidence: [syntheticReason], unavailableEvidence: [] },
    opponentContext: null, injuryContext, weatherContext: null, nflResearchProfile: profile,
  };
}

export const source: {
  snapshotTime: string;
  outputs: Array<{ researchMode: 'STANDARD' | 'DEEP'; record: ResearchCandidateRecord }>;
} = {
  snapshotTime,
  outputs: (['STANDARD', 'DEEP'] as const).flatMap((researchMode) => definitions.map((definition, index) => ({
    researchMode, record: makeRecord(definition, index, researchMode),
  }))),
};