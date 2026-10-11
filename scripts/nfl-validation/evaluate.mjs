import { createHash } from 'node:crypto';
import { auditDataset, planChronologicalSplit } from './integrity.mjs';
import { grouped, mean, probabilityMetrics, projectionMetrics, summary } from './metrics.mjs';

const TIERS = ['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS'];
const MARKETS = ['player_pass_yds', 'player_pass_attempts', 'player_pass_completions', 'player_rush_yds', 'player_rush_attempts', 'player_reception_yds', 'player_receptions'];
const oddsBucket = (row) => row.odds > 0 ? 'PLUS_MONEY' : row.odds === -100 ? 'EVEN_MONEY'
  : row.odds >= -130 ? '-101_TO_-130' : row.odds >= -160 ? '-131_TO_-160' : row.odds >= -200 ? '-161_TO_-200'
    : row.odds >= -300 ? '-201_TO_-300' : row.odds >= -400 ? '-301_TO_-400' : '-401_OR_SHORTER';
const edgeBucket = (row) => !Number.isFinite(row.edgePP) ? 'UNAVAILABLE' : row.edgePP < 0 ? 'NEGATIVE'
  : row.edgePP < 3 ? '0_TO_3_PP' : row.edgePP < 5 ? '3_TO_5_PP' : row.edgePP < 10 ? '5_TO_10_PP'
    : row.edgePP < 15 ? '10_TO_15_PP' : row.edgePP < 20 ? '15_TO_20_PP' : '20_PLUS_PP';
const evBucket = (row) => !Number.isFinite(row.ev) ? 'UNAVAILABLE' : row.ev < 0 ? 'NEGATIVE' : row.ev < 0.05 ? '0_TO_5_PERCENT'
  : row.ev < 0.1 ? '5_TO_10_PERCENT' : row.ev < 0.2 ? '10_TO_20_PERCENT' : row.ev < 0.4 ? '20_TO_40_PERCENT' : '40_PLUS_PERCENT';

function clv(rows) {
  const usable = rows.filter((row) => row.closingQuote?.certifiedClosing === true && row.closingQuote.source
    && row.closingQuote.book === row.book && row.closingQuote.market === row.market && row.closingQuote.direction === row.direction
    && row.closingQuote.gameId === row.gameId && Number.isFinite(Date.parse(row.closingQuote.quoteAt))
    && Date.parse(row.closingQuote.quoteAt) > Date.parse(row.predictionAt) && Date.parse(row.closingQuote.quoteAt) <= Date.parse(row.kickoff)
    && Number.isFinite(row.closingQuote.line));
  return { status: usable.length ? 'PARTIAL' : 'UNAVAILABLE', n: usable.length,
    averageLineCLV: mean(usable.map((row) => (row.closingQuote.line - row.line) * (row.direction === 'over' ? 1 : -1))),
    beatingLineClose: usable.length ? usable.filter((row) => (row.closingQuote.line - row.line) * (row.direction === 'over' ? 1 : -1) > 0).length / usable.length : null,
    priceCLV: null, reason: 'Line CLV only with certified timestamped closing quotes; no substituted close. Price CLV requires paired same-line entry/closing market probability data and remains unavailable here.' };
}
function ranking(rows, manifest) {
  const eligible = rows.filter((row) => row.tier !== 'PASS' && row.completeSlate === true
    && row.rankingProvenance?.modelVersion === manifest.modelVersion && row.rankingProvenance?.snapshotHash === manifest.snapshotHash
    && row.rankingProvenance?.universeHash && row.underlyingPlayId);
  const modes = ['BEST', 'MOST_LIKELY', 'BEST_VALUE'];
  return { status: eligible.length ? 'RECORDED_RANK_DIAGNOSTIC' : 'UNAVAILABLE',
    requirement: 'Outcome-independent frozen production ranks, full-slate universe hash and underlying-play IDs. Selected-player replay rankings are not full-slate evidence.',
    modes: Object.fromEntries(modes.map((mode) => [mode, Object.fromEntries([1, 3, 5, 10].map((limit) => {
      const seen = new Set();
      const selected = eligible.filter((row) => Number.isInteger(row.ranks?.[mode]) && row.ranks[mode] >= 1 && row.ranks[mode] <= limit)
        .sort((first, second) => Date.parse(first.predictionAt) - Date.parse(second.predictionAt)).filter((row) => {
          const key = `${row.slateId}|${row.researchMode}|${row.underlyingPlayId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return [`TOP_${limit}`, { ...summary(selected), slates: new Set(selected.map((row) => row.slateId)).size }];
    }))])),
  };
}
export function performanceReport(rows, manifest) {
  const recommendations = rows.filter((row) => row.tier !== 'PASS');
  const components = ['historicalProjection', 'opportunityProjectionFinal', 'matchupProjectionFinal', 'environmentProjectionFinal', 'projection'];
  return {
    overall: summary(rows), recommendationDiagnostic: summary(recommendations),
    baselines: { rawSportsbook: probabilityMetrics(rows, 'rawImpliedProbability'), noVigSportsbook: probabilityMetrics(rows, 'noVigProbability'),
      simpleHistoricalHitRate: probabilityMetrics(rows, 'historicalHitProbability'),
      historicalProjectionProbability: probabilityMetrics(rows, 'historicalBaselineProbability'), fullModel: probabilityMetrics(rows) },
    components: Object.fromEntries(components.map((component) => [component, projectionMetrics(rows, component)])),
    pairedBaselineComparisons: Object.fromEntries(['rawImpliedProbability', 'noVigProbability', 'historicalHitProbability', 'historicalBaselineProbability'].map((key) => {
      const paired = rows.filter((row) => Number.isFinite(row[key]) && ['WIN', 'LOSS'].includes(row.settlement));
      return [key, { n: paired.length, full: probabilityMetrics(paired), baseline: probabilityMetrics(paired, key) }];
    })),
    tiers: grouped(rows, (row) => row.tier, TIERS), markets: grouped(rows, (row) => row.market, MARKETS),
    overUnder: grouped(rows, (row) => row.direction, ['over', 'under']), oddsBuckets: grouped(rows, oddsBucket,
      ['PLUS_MONEY', 'EVEN_MONEY', '-101_TO_-130', '-131_TO_-160', '-161_TO_-200', '-201_TO_-300', '-301_TO_-400', '-401_OR_SHORTER']),
    edgeBuckets: grouped(rows, edgeBucket, ['NEGATIVE', '0_TO_3_PP', '3_TO_5_PP', '5_TO_10_PP', '10_TO_15_PP', '15_TO_20_PP', '20_PLUS_PP']),
    evBuckets: grouped(rows, evBucket, ['NEGATIVE', '0_TO_5_PERCENT', '5_TO_10_PERCENT', '10_TO_20_PERCENT', '20_TO_40_PERCENT', '40_PLUS_PERCENT']),
    researchModes: grouped(rows, (row) => row.researchMode, ['STANDARD', 'DEEP']),
    seasonPhase: grouped(rows, (row) => row.seasonPhase ?? 'UNAVAILABLE', ['EARLY', 'MID', 'LATE_REGULAR_SEASON', 'PLAYOFFS']),
    position: grouped(rows, (row) => row.position ?? 'UNAVAILABLE'), homeAway: grouped(rows, (row) => row.homeAway ?? 'UNAVAILABLE'),
    favoriteUnderdog: grouped(rows, (row) => row.marketScript ?? 'UNAVAILABLE'),
    projectionModelType: grouped(rows, (row) => row.projectionModelType ?? 'UNAVAILABLE'),
    historySampleSize: grouped(rows, (row) => !Number.isFinite(row.historySampleSize) ? 'UNAVAILABLE' : row.historySampleSize < 5 ? 'UNDER_5' : row.historySampleSize < 10 ? '5_TO_9' : '10_PLUS'),
    roleUncertainty: grouped(rows, (row) => row.roleStatus ?? 'UNAVAILABLE'),
    injuryUncertainty: grouped(rows, (row) => row.injuryUncertainty ?? 'UNAVAILABLE'),
    starterReturnContext: grouped(rows, (row) => row.playerContext ?? 'UNAVAILABLE', ['NEW_STARTER', 'RETURNING_PLAYER', 'UNAVAILABLE']),
    evidenceCoverage: grouped(rows, (row) => row.evidenceCoverage ?? 'UNAVAILABLE'),
    earlyInjuryDiagnostic: grouped(rows, (row) => row.outcome.earlyInjury ?? 'UNKNOWN', ['NORMAL_OUTCOME', 'EARLY_INJURY', 'UNKNOWN']),
    sportsbooks: grouped(rows, (row) => row.book), clv: clv(rows), ranking: ranking(rows, manifest),
    nuke: { ...summary(rows.filter((row) => row.tier === 'NUKE')), status: 'NUKE_NOT_YET_VALIDATED',
      averageAmericanOdds: mean(rows.filter((row) => row.tier === 'NUKE').map((row) => row.odds)),
      composition: grouped(rows.filter((row) => row.tier === 'NUKE'), (row) => row.market) },
    statisticalCaution: 'Per-quote/mode diagnostics are correlated across same games, players, books and lines. Flat-unit pool is not a deployable strategy. Ranking slices deduplicate underlying plays. Report N and game/slate coverage; cluster-aware uncertainty is needed for inference.',
  };
}
export function evaluateDataset(rows, manifest, asOf) {
  const audit = auditDataset(rows, manifest, asOf);
  const split = planChronologicalSplit(audit.clean.filter((row) => ['WIN', 'LOSS', 'PUSH'].includes(row.settlement)));
  return { modelVersion: manifest.modelVersion, snapshotHash: manifest.snapshotHash, asOf, calibrationStatus: 'UNVALIDATED',
    decision: 'NFL VALIDATION FAILED — DO NOT TRUST PRODUCTION PROBABILITIES',
    reason: audit.clean.length ? 'Descriptive measurement only. No locked calibration protocol and untouched final test have been approved/executed.' : 'No clean settled held-out predictions. Predictive validity and calibration cannot be established.',
    datasetQuality: audit.quality, chronologicalSplit: split,
    cohortHash: createHash('sha256').update(JSON.stringify(audit.clean.map((row) => ({ id: row.id, gameId: row.gameId,
      playerId: row.playerId, market: row.market, direction: row.direction, book: row.book, line: row.line, odds: row.odds,
      predictionAt: row.predictionAt, quoteAt: row.quoteAt, researchMode: row.researchMode, outcome: row.outcome,
      settlement: row.settlement })).sort((first, second) => first.id.localeCompare(second.id)))).digest('hex'),
    includingQuestionableQuotes: performanceReport(audit.inclusive, manifest), excludingQuestionableQuotes: performanceReport(audit.clean, manifest),
    calibration: { status: 'NOT_FIT', chosenMethod: null, candidateMethods: ['identity', 'Platt', 'isotonic', 'beta'],
      reason: 'Require prelocked chronological boundaries, adequate development sample and validation-only method comparison before fitting. No parameters estimated.',
      productionChanged: false },
    finalTest: { status: 'NOT_OPENED', raw: null, calibrated: null, sportsbook: null, evaluationCount: 0,
      policy: 'One final evaluation only after immutable model, dataset hashes, chronological split and calibration choice are locked. No retuning after opening.' },
    exclusionLedger: audit.ledger.map((result) => ({ id: result.row.id, gameId: result.row.gameId, errors: result.errors, warnings: result.warnings, settlement: result.row.settlement })),
  };
}