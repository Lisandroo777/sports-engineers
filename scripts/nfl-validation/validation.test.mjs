import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditDataset, auditRow, planChronologicalSplit, settle } from './integrity.mjs';
import { bankroll, implied, probabilityMetrics, projectionMetrics, sampleLabel } from './metrics.mjs';
import { evaluateDataset } from './evaluate.mjs';
import { compareModelReports } from './regressionGate.mjs';
import { assertApprovedSecuritySources, assertFrozenInventory, isReviewedMLBCacheTransport, verifyHardenedFreeze, verifyV1ParentArchive } from './freeze.mjs';

const manifest = { modelVersion: 'SYNTHETIC_MODEL', snapshotHash: 'synthetic-test-only' };
const asOf = '2025-10-01T00:00:00Z';
function fixture(update = {}) {
  return { sport: 'nfl', id: 'synthetic', gameId: 'target', slateId: 'slate', playerId: 'player', market: 'player_receptions',
    modelVersion: manifest.modelVersion, snapshotHash: manifest.snapshotHash, predictionAt: '2025-09-10T12:00:00Z', kickoff: '2025-09-10T20:00:00Z',
    quoteKind: 'ENTRY', quoteAt: '2025-09-10T11:59:00Z', book: 'Test Book', odds: -110, line: 5.5, direction: 'over',
    probability: 0.8, projection: 6, tier: 'ELITE', researchMode: 'STANDARD', provenanceComplete: true, contextCoverageComplete: true,
    inputEvidence: [{ kind: 'PLAYER_GAME', source: 'Synthetic only', availableAt: '2025-09-02T00:00:00Z', occurredAt: '2025-09-01T20:00:00Z', eventId: 'previous' }],
    outcome: { source: 'Synthetic outcome', gameId: 'target', finalizedAt: '2025-09-10T23:00:00Z', actual: 7, participated: true,
      adjudication: 'NORMAL', bookRuleSource: 'Synthetic rule', settlementSource: 'Synthetic settlement', earlyInjury: 'UNKNOWN' }, ...update };
}
describe('Validation infrastructure, synthetic fixtures are NOT model performance evidence', () => {
  it('rejects any unreviewed mutation or omission in protected refresh/security infrastructure', () => {
    const paths = ['lib/odds/client.ts', 'lib/odds/autoRefreshLedger.ts', 'lib/storage/kv.ts'];
    const current = Object.fromEntries(paths.map(path => [path, readFileSync(resolve(path), 'utf8')]));
    expect(() => assertApprovedSecuritySources(current)).not.toThrow();
    for (const path of paths) {
      expect(() => assertApprovedSecuritySources({ ...current, [path]: `${current[path]}\n` })).toThrow('security infrastructure source mismatch');
      expect(() => assertApprovedSecuritySources({ ...current, [path]: undefined })).toThrow('security infrastructure source mismatch');
    }
  });
  it('accepts only the exact reviewed MLB cache transport against its immutable archived parent', () => {
    const archive = JSON.parse(readFileSync(resolve('reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const original = archive['lib/finder/engine.ts'];
    const current = readFileSync(resolve('lib/finder/engine.ts'), 'utf8');
    expect(isReviewedMLBCacheTransport('lib/finder/engine.ts', original, current)).toBe(true);
    expect(isReviewedMLBCacheTransport('lib/finder/engine.ts', original, `${current}\n`)).toBe(false);
    expect(isReviewedMLBCacheTransport('lib/finder/engine.ts', `${original}\n`, current)).toBe(false);
    expect(isReviewedMLBCacheTransport('lib/finder/nflEngine.ts', original, current)).toBe(false);
  });
  it('permits only NBA-owned or ledger infrastructure additions without relaxing archived-file identity checks', () => {
    const archive = { 'lib/ai/agent/tools.ts': 'frozen', 'lib/finder/nflEngine.ts': 'frozen' };
    expect(assertFrozenInventory({ ...archive, 'lib/nba/prediction/engine.ts': 'new', 'lib/nba/context/context.ts': 'external',
      'lib/nfl/predictionLedger/store.ts': 'tracking' }, archive, 'fixture')).toHaveLength(3);
    expect(() => assertFrozenInventory({ ...archive, 'lib/nba/projection.ts': 'unrelated unscoped change' }, archive, 'fixture')).toThrow(/inventory drift/i);
    expect(() => assertFrozenInventory({ 'lib/finder/nflEngine.ts': 'frozen' }, archive, 'fixture')).toThrow(/omitted archived source/i);
  });
  it('accepts fully timestamped synthetic provenance', () => {
    expect(auditRow(fixture(), manifest, asOf).errors).toEqual([]);
  });
  it.each(['PLAYER_GAME', 'OPPONENT_GAME', 'ROLE_GAME', 'TEAM_TENDENCY_GAME', 'INJURY_REPORT', 'PRACTICE', 'FORECAST', 'NEWS'])('rejects future %s inputs', (kind) => {
    const row = fixture({ inputEvidence: [{ kind, source: 'Test', availableAt: '2025-09-10T13:00:00Z', occurredAt: '2025-09-10T12:30:00Z', eventId: 'future' }] });
    expect(auditRow(row, manifest, asOf).errors).toContain('FUTURE_OR_UNTIMESTAMPED_INPUT');
  });
  it.each(['OBSERVED_GAME_WEATHER', 'FINAL_INACTIVE_STATUS', 'SEASON_END_AGGREGATE', 'CLOSING_LINE'])('rejects unreconstructable %s context', (kind) => {
    const row = fixture({ inputEvidence: [{ kind, source: 'Test', availableAt: '2025-09-09T12:00:00Z' }] });
    expect(auditRow(row, manifest, asOf).errors).toContain('UNSUPPORTED_HISTORICAL_CONTEXT');
  });
  it('rejects target outcomes as projection inputs even with forged old timestamp', () => {
    const row = fixture();
    row.inputEvidence[0].eventId = row.gameId;
    expect(auditRow(row, manifest, asOf).errors).toContain('TARGET_GAME_USED_AS_INPUT');
  });
  it('never silently substitutes a later or closing price for entry', () => {
    expect(auditRow(fixture({ quoteKind: 'CLOSING' }), manifest, asOf).errors).toContain('NON_ENTRY_OR_FUTURE_QUOTE');
    expect(auditRow(fixture({ quoteAt: '2025-09-10T15:00:00Z' }), manifest, asOf).errors).toContain('NON_ENTRY_OR_FUTURE_QUOTE');
  });
  it('does not claim unknown quote/input timestamps are clean', () => {
    expect(auditRow(fixture({ quoteAt: null }), manifest, asOf).errors).toContain('NON_ENTRY_OR_FUTURE_QUOTE');
    expect(auditRow(fixture({ provenanceComplete: false }), manifest, asOf).errors).toContain('INCOMPLETE_INPUT_PROVENANCE');
  });
  it('only computes proportional no-vig from exactly paired entry quotes', () => {
    const row = fixture({ oppositeQuote: { book: 'Test Book', market: 'player_receptions', line: 5.5, direction: 'under', odds: -110, quoteAt: '2025-09-10T11:59:00Z' } });
    expect(auditRow(row, manifest, asOf).row.noVigProbability).toBe(0.5);
    row.oppositeQuote.quoteAt = '2025-09-10T15:00:00Z';
    expect(auditRow(row, manifest, asOf).row.noVigProbability).toBeNull();
  });
  it('flags stale quotes rather than dropping favorable or losing outcomes silently', () => {
    const row = fixture({ quoteAt: '2025-09-09T12:00:00Z' });
    const audit = auditDataset([row], manifest, asOf);
    expect(audit.inclusive).toHaveLength(1);
    expect(audit.clean).toHaveLength(0);
    expect(audit.quality.warnings.STALE_QUOTE).toBe(1);
  });
  it('detects contemporaneous cross-book probability outliers', () => {
    const row = fixture({ odds: -900, consensus: ['Peer1', 'Peer2'].map((book) => ({ book, market: 'player_receptions', line: 5.5,
      direction: 'over', odds: -110, quoteAt: '2025-09-10T11:59:00Z' })) });
    expect(auditRow(row, manifest, asOf).warnings).toContain('CROSS_BOOK_PROBABILITY_OUTLIER');
  });
  it('retains losing predictions and marks exact duplicates', () => {
    const loss = fixture();
    loss.outcome.actual = 1;
    const audit = auditDataset([loss, loss], manifest, asOf);
    expect(audit.clean).toHaveLength(1);
    expect(audit.clean[0].settlement).toBe('LOSS');
    expect(audit.ledger[1].errors).toContain('DUPLICATE_OBSERVATION');
  });
  it('separates push, void, DNP and unresolved settlements', () => {
    const row = fixture({ line: 7 });
    expect(settle(row)).toBe('PUSH');
    expect(settle({ ...row, outcome: { ...row.outcome, adjudication: 'VOID' } })).toBe('VOID');
    expect(settle({ ...row, outcome: { ...row.outcome, participated: false, adjudication: 'DNP' } })).toBe('DNP');
    expect(settle({ ...row, outcome: { ...row.outcome, participated: false } })).toBe('UNRESOLVED');
  });
  it('does not erase an early-injury loss or guess a book injury refund', () => {
    const row = fixture();
    row.outcome.actual = 1;
    row.outcome.earlyInjury = 'EARLY_INJURY';
    expect(settle(row)).toBe('UNRESOLVED');
    row.outcome.injurySettlementConfirmed = true;
    expect(settle(row)).toBe('LOSS');
  });
  it('excludes future or missing target outcomes', () => {
    expect(auditRow(fixture({ outcome: null }), manifest, asOf).errors).toContain('MISSING_OUTCOME');
    expect(auditRow(fixture(), manifest, '2025-09-10T21:00:00Z').errors).toContain('INVALID_OR_FUTURE_OUTCOME');
  });
  it('fails closed on mismatched frozen source identity', () => {
    expect(auditRow(fixture({ snapshotHash: 'different' }), manifest, asOf).errors).toContain('MODEL_VERSION_OR_HASH_MISMATCH');
  });
  it('computes calibration and projection error rather than training hit rate', () => {
    const rows = [fixture(), fixture({ id: 'loss' })].map((row, index) => ({ ...row, settlement: index ? 'LOSS' : 'WIN', outcome: { ...row.outcome, actual: index ? 3 : 7 } }));
    expect(probabilityMetrics(rows).brier).toBeCloseTo(0.34);
    expect(probabilityMetrics(rows).ece).toBeCloseTo(0.3);
    expect(probabilityMetrics(rows).logLoss).toBeCloseTo(-Math.log(0.8 * 0.2) / 2);
    expect(projectionMetrics(rows)).toMatchObject({ n: 2, mae: 2, biasActualMinusProjection: -1 });
    expect(bankroll(rows).units).toBeCloseTo(100 / 110 - 1);
  });
  it('does not count pushes/voids as wins or calibrate them as losses', () => {
    expect(probabilityMetrics([{ probability: 0.8, settlement: 'PUSH' }]).n).toBe(0);
    expect(bankroll([{ id: 'p', predictionAt: '2025-01-01', odds: -110, settlement: 'PUSH' }])).toMatchObject({ wins: 0, units: 0, roi: null });
  });
  it('reports empty metrics as unavailable and tiny samples honestly', () => {
    expect(probabilityMetrics([])).toMatchObject({ n: 0, brier: null, logLoss: null, ece: null });
    expect(sampleLabel(10)).toBe('VERY_SMALL_SAMPLE');
    expect(implied(-400)).toBe(0.8);
  });
  it('does not create chronological splits from a single selected game', () => {
    expect(planChronologicalSplit([fixture()]).status).toBe('BLOCKED_INSUFFICIENT_DATA');
  });
  it('keeps all correlated slate observations in one chronological partition', () => {
    const rows = Array.from({ length: 100 }, (_, slate) => Array.from({ length: 10 }, (_, index) => ({
      gameId: `game${slate}`, slateId: `slate${slate}`, id: `${slate}-${index}`, predictionAt: new Date(Date.UTC(2024, 0, slate + 1)).toISOString() }))).flat();
    const plan = planChronologicalSplit(rows);
    expect(plan.train.slateIds).toHaveLength(60);
    expect(plan.validation.slateIds).toHaveLength(20);
    expect(plan.test.slateIds).toHaveLength(20);
    expect(Date.parse(plan.train.last)).toBeLessThan(Date.parse(plan.validation.first));
    expect(plan.test.slateIds.some((id) => plan.train.slateIds.includes(id))).toBe(false);
  });
  it('does not accept a game assigned to different chronological slates', () => {
    expect(planChronologicalSplit([fixture(), fixture({ slateId: 'other-slate' })]).status).toBe('BLOCKED_GAME_SPANS_SLATES');
  });
  it('does not count identity-missing rows as evidence of identical predictions', () => {
    const audit = auditDataset([fixture({ playerId: null }), fixture({ playerId: null })], manifest, asOf);
    expect(audit.quality.exclusions.DUPLICATE_OBSERVATION).toBeUndefined();
    expect(audit.quality.exclusions.MISSING_IDENTITY).toBe(2);
  });
  it('allows a genuine pregame inactive receipt but rejects later status', () => {
    const evidence = { kind: 'FINAL_INACTIVE_STATUS', source: 'Synthetic official inactive release', availableAt: '2025-09-10T11:00:00Z', asOfReceipt: 'synthetic-receipt' };
    expect(auditRow(fixture({ inputEvidence: [evidence] }), manifest, asOf).errors).toEqual([]);
    expect(auditRow(fixture({ inputEvidence: [{ ...evidence, availableAt: '2025-09-10T19:00:00Z' }] }), manifest, asOf).errors).toContain('FUTURE_OR_UNTIMESTAMPED_INPUT');
  });
  it('never fits calibration or opens the final test from empty data', () => {
    const result = evaluateDataset([], manifest, asOf);
    expect(result.finalTest).toMatchObject({ status: 'NOT_OPENED', evaluationCount: 0 });
    expect(result.calibration).toMatchObject({ status: 'NOT_FIT', chosenMethod: null, productionChanged: false });
    expect(result.excludingQuestionableQuotes.tiers.ELITE.n).toBe(0);
    expect(result.excludingQuestionableQuotes.nuke.status).toBe('NUKE_NOT_YET_VALIDATED');
    expect(compareModelReports(null, result).decision).toBe('BLOCKED');
  });
  it('does not automatically accept a future model for one improved metric', () => {
    const ranking = { modes: Object.fromEntries(['BEST', 'MOST_LIKELY', 'BEST_VALUE'].map((mode) => [mode, { TOP_3: {
      probability: { n: 200, brier: 0.2 }, hitRate: 0.65, bankroll: { roi: 0.02 } } }])) };
    const report = { cohortHash: 'same', datasetQuality: { finalClean: 600 }, excludingQuestionableQuotes: { overall: {
      projection: { mae: 10 }, probability: { n: 600, brier: 0.2, logLoss: 0.6, ece: 0.03 } }, ranking } };
    const candidate = structuredClone(report);
    candidate.excludingQuestionableQuotes.overall.probability.brier = 0.19;
    candidate.excludingQuestionableQuotes.overall.probability.logLoss = 0.7;
    expect(compareModelReports(report, candidate).reasons).toContain('Regression in probability.logLoss');
    expect(compareModelReports(report, report).decision).toBe('REQUIRES_REVIEW');
  });
  it('verifies the hardened immutable child and its unchanged V1 parent identity', () => {
    const original = verifyV1ParentArchive();
    const hardened = verifyHardenedFreeze();
    expect(hardened).toMatchObject({ modelVersion: 'NFL_MODEL_V1_1_HARDENED', parentModelVersion: 'NFL_MODEL_V1',
      parentSnapshotHash: original.snapshotHash });
  });
  it('keeps frozen tier requirements and shared NFL probability source byte-identical', () => {
    const archive = JSON.parse(readFileSync(resolve('reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    for (const path of ['lib/ai/agent/pickTiers.ts', 'lib/ai/probabilityModel.ts']) {
      expect(readFileSync(resolve(path), 'utf8'), path).toBe(archive[path]);
    }
  });
});