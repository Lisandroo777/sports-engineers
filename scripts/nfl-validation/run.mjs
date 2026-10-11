import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, verifyFreeze } from './freeze.mjs';
import { evaluateDataset } from './evaluate.mjs';
import { compareModelReports } from './regressionGate.mjs';
import { renderDashboard } from './dashboard.mjs';

const DEFAULT_AS_OF = '2026-10-05T23:59:59.999Z';
const OUTPUT = resolve(ROOT, 'reports/nfl-validation');
const hash = (value) => createHash('sha256').update(value).digest('hex');
function parse(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
}
function legacyRow(record, source, index, predictionAt, defaults = {}) {
  const original = record.record ?? record;
  const parts = (original.candidateId ?? record.id ?? '').split('|');
  const market = record.market ?? original.marketKey ?? record.history?.market ?? parts[2];
  const projection = record.finalProjection ?? record.projection?.projection ?? original.projection;
  const probability = record.probability ?? record.analysis?.trueProbability ?? original.trueProbability;
  return { id: `${source}#${index}`, sourceArtifact: source, sport: 'nfl',
    gameId: original.gameId ?? parts[0] ?? defaults.gameId, slateId: defaults.slateId ?? 'LEGACY_UNRESOLVED_SLATE',
    playerId: original.playerId ?? null, player: record.player ?? original.player ?? parts[1], market,
    direction: original.direction ?? record.direction ?? parts[4] ?? 'over',
    line: original.line ?? record.line ?? (parts[3] !== undefined && Number.isFinite(Number(parts[3])) ? Number(parts[3]) : null),
    book: original.book ?? parts[5] ?? null, odds: original.odds ?? record.odds ?? null,
    predictionAt: predictionAt ?? null, kickoff: defaults.kickoff ?? null,
    quoteAt: original.nflResearchProfile?.market?.provenance?.[0]?.publishedAt ?? null,
    quoteKind: 'ENTRY', projection: typeof projection === 'number' ? projection : null,
    probability: typeof probability === 'number' ? probability / 100 : null,
    edgePP: record.edge ?? record.priceEdge ?? original.priceEdgePercent ?? null,
    ev: typeof (record.ev ?? original.evPercent) === 'number' ? (record.ev ?? original.evPercent) / 100 : null,
    tier: record.tier ?? original.pickTier ?? 'PASS', researchMode: record.researchMode ?? original.nflResearchProfile?.researchMode ?? 'STANDARD',
    modelVersion: 'LEGACY_UNVERSIONED', snapshotHash: null,
    provenanceComplete: false, contextCoverageComplete: false, inputEvidence: [], outcome: null,
    selectedReplay: source.includes('phase3') || source.includes('phase4'),
    reason: 'Archived/recomputed pre-freeze records lack complete as-of input receipts and target settlements; historical input logs are not outcomes.' };
}
export function inventoryLocalArtifacts() {
  const sources = [
    { path: '.cache/nfl-readiness-fixes/final-run-3.json', key: 'candidates', label: 'Earlier incomplete candidate audit; not an NFL_MODEL_V1 prediction ledger' },
    { path: '.cache/nfl-phase3/recovered-paired-replay.json', key: 'outputs', label: 'Selected seven-market paired input replay, no settled target outcomes' },
    { path: '.cache/nfl-phase4/game-environment-replay.json', key: 'outputs', label: 'Same selected seven plays in both research modes, not 14 independent outcomes' },
  ];
  const artifacts = [];
  const rows = [];
  for (const source of sources) {
    if (!existsSync(resolve(ROOT, source.path))) { artifacts.push({ path: source.path, status: 'ABSENT', rawRows: 0 }); continue; }
    const content = readFileSync(resolve(ROOT, source.path), 'utf8');
    const data = JSON.parse(content);
    const records = data[source.key] ?? [];
    const predictionAt = data.snapshotTime ?? data.generatedAt ?? data.result?.meta?.generatedAt ?? null;
    artifacts.push({ path: source.path, sourceHash: hash(content), status: 'AVAILABLE_ARCHIVE_ONLY', rawRows: records.length,
      predictionAt, settledTargetOutcomes: 0, representativeUniverse: false, note: source.label });
    rows.push(...records.map((record, index) => legacyRow(record, source.path, index, predictionAt)));
  }
  const candidateUniverse = rows.filter((row) => !row.selectedReplay);
  const selected = rows.filter((row) => row.selectedReplay);
  return { artifacts, rows, audit: {
    classification: { gameDateTeamsHomeAwaySeasonWeek: 'PARTIAL', playerInputGameStats: 'AVAILABLE',
      pregamePropBookLinePrice: 'PARTIAL', quoteTimestamp: 'PARTIAL', genuineOpeningLine: 'UNAVAILABLE', genuineClosingLine: 'UNAVAILABLE',
      prePredictionInjuryAndPractice: 'PARTIAL', prePredictionForecast: 'PARTIAL', spreadTotalTeamTotals: 'PARTIAL',
      matchupRoleHistory: 'RECONSTRUCTABLE_WITHOUT_LEAKAGE_ONLY_WITH_FINALIZATION_RECEIPTS', timestampedNews: 'PARTIAL',
      targetFinalPlayerStat: 'UNAVAILABLE', hitPushMissSettlement: 'UNAVAILABLE', participationDNPVoid: 'UNAVAILABLE',
      meaningfulEarlyInjuryOutcome: 'UNAVAILABLE' },
    rawArtifactRows: rows.length, archivedCandidateUniverseRows: candidateUniverse.length,
    replayCopies: selected.length, uniqueSelectedPlayerMarkets: new Set(selected.map((row) => `${row.player}|${row.market}|${row.line}|${row.direction}`)).size,
    statisticalTrials: 0, leakageWarning: 'Past input logs and their hit-rate outcomes are not held-out predictions. Mode/layer copies and selected player examples are not independent slates.',
    targetOutcomePeriod: null, archivePredictionPeriod: selected.length ? {
      first: selected.map((row) => row.predictionAt).filter(Boolean).sort()[0] ?? null,
      last: selected.map((row) => row.predictionAt).filter(Boolean).sort().at(-1) ?? null } : null,
  } };
}
export function runValidation() {
  const manifest = verifyFreeze();
  const argument = process.argv.find((entry) => entry.startsWith('--dataset='));
  const local = inventoryLocalArtifacts();
  const dataset = argument ? parse(argument.slice('--dataset='.length)) : { rows: local.rows, representativeUniverse: false };
  if (!Array.isArray(dataset.rows)) throw new Error('Dataset must contain rows[]');
  if (argument && dataset.representativeUniverse !== true) throw new Error('Evaluation input must document a complete representative sampling universe');
  if (argument && dataset.rows.length > 0) throw new Error('Historical data measurement is locked pending approved split/protocol; no external outcome metrics or test performance were inspected');
  const asOf = process.argv.find((entry) => entry.startsWith('--as-of='))?.slice('--as-of='.length) ?? DEFAULT_AS_OF;
  const result = evaluateDataset(dataset.rows, manifest, asOf);
  const audit = { ...local.audit, artifacts: local.artifacts, modelVersion: manifest.modelVersion,
    modelFrozenAt: manifest.frozenAt, snapshotHash: manifest.snapshotHash, asOf,
    datasetHash: hash(JSON.stringify(dataset)), fullSamplingUniverse: dataset.representativeUniverse === true };
  const modelCard = { modelVersion: manifest.modelVersion, frozenSourceHash: manifest.snapshotHash,
    datasetPeriod: audit.targetOutcomePeriod, archivedPredictionPeriod: audit.archivePredictionPeriod,
    trainingPeriod: null, validationPeriod: null, testPeriod: null, splitStatus: result.chronologicalSplit.status,
    marketsEvaluated: [], sampleSize: result.datasetQuality.finalClean, projectionMAE: null, brierScore: null, logLoss: null,
    calibrationError: null, sportsbookBaseline: 'UNAVAILABLE: no clean paired settlements',
    tierPerformance: Object.fromEntries(['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN'].map((tier) => [tier, { n: 0, hitRate: null, roi: null }])),
    calibrationStatus: 'UNVALIDATED', lastValidatedDate: null, lastAuditDate: asOf.slice(0, 10),
    knownWeaknesses: ['No settled held-out complete-universe ledger', 'Selected same-game replays cannot establish generalization',
      'Historical context availability/revisions not fully reconstructed', 'No chronological development/untouched-test data',
      'No genuine closing-price history', 'No model calibration or tier ordering evidence'],
    approvalStatus: 'NOT_APPROVED_FOR_PREDICTIVE_USE', liveBetting: 'NOT_BUILT', productionChanged: false };
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(resolve(OUTPUT, 'dataset-audit.json'), JSON.stringify(audit, null, 2));
  writeFileSync(resolve(OUTPUT, 'evaluation.json'), JSON.stringify(result, null, 2));
  writeFileSync(resolve(OUTPUT, 'exclusion-ledger.json'), JSON.stringify(result.exclusionLedger, null, 2));
  writeFileSync(resolve(OUTPUT, 'model-card.json'), JSON.stringify(modelCard, null, 2));
  writeFileSync(resolve(OUTPUT, 'regression-gate.json'), JSON.stringify(compareModelReports(null, result), null, 2));
  writeFileSync(resolve(OUTPUT, 'dashboard.html'), renderDashboard(result, audit));
  console.log(JSON.stringify({ modelVersion: manifest.modelVersion, rawArtifactRows: audit.rawArtifactRows,
    uniqueSelectedPlayerMarkets: audit.uniqueSelectedPlayerMarkets, finalClean: result.datasetQuality.finalClean,
    calibrationStatus: result.calibrationStatus, split: result.chronologicalSplit.status,
    finalTest: result.finalTest.status, decision: result.decision, networkRequests: 0 }));
  return { result, audit, modelCard };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runValidation();