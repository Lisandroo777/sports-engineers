import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { auditDataset, auditRow, planChronologicalSplit, settle } from './integrity.mjs';
import { bankroll, implied, probabilityMetrics, projectionMetrics, sampleLabel } from './metrics.mjs';
import { evaluateDataset } from './evaluate.mjs';
import { compareModelReports } from './regressionGate.mjs';
import { assertApprovedMLBSources, assertApprovedSecuritySources, assertFrozenInventory, HARDENED_MODEL_VERSION, isReviewedMLBCacheTransport, isReviewedMLBEngineRevision, isReviewedMLBSource, MLB_SOURCE_APPROVED_HASHES, REVIEWED_MLB_ENGINE_VERSION, ROOT, verifyHardenedFreeze, verifyV1ParentArchive } from './freeze.mjs';
import { assertInheritedProductionRouting, INHERITED_PRODUCTION_ROUTING_HASHES, INHERITED_ROUTING_BASELINE, isInheritedProductionRouting } from './freeze.mjs';
import { assertApprovedNFLKickingSources, isReviewedNFLKickingSource, NFL_KICKING_SOURCE_APPROVED_HASHES, NFL_KICKING_VERSION } from './freeze.mjs';
import { assertApprovedNFLPartialCoverageSources, isReviewedNFLPartialCoverageSource, NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES, NFL_PARTIAL_COVERAGE_VERSION } from './freeze.mjs';
import { assertApprovedReliabilitySources, isReviewedReliabilitySource, RELIABILITY_BASELINE, RELIABILITY_SOURCE_APPROVED_HASHES, RELIABILITY_VERSION } from './freeze.mjs';

const manifest = { modelVersion: 'SYNTHETIC_MODEL', snapshotHash: 'synthetic-test-only' };
const asOf = '2025-10-01T00:00:00Z';
const digest = content => createHash('sha256').update(content).digest('hex');
const historicalSource = (commit, path) => execFileSync('git', ['-C', ROOT, 'show', `${commit}:${path}`], { encoding: 'utf8' });
const reliability = {
  version: RELIABILITY_VERSION,
  baselineHEAD: RELIABILITY_BASELINE,
  baseline: Object.fromEntries(Object.entries(RELIABILITY_SOURCE_APPROVED_HASHES).filter(([, approval]) => approval.baseline !== null)
    .map(([path]) => [path, historicalSource(RELIABILITY_BASELINE, path)])),
};
function extractedBlocks(path, text, names) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true });
  const result = {};
  const visit = node => {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && names.includes(node.name.getText(source))) {
      const name = node.name.getText(source);
      expect(Object.hasOwn(result, name), `${path}:${name} duplicated`).toBe(false);
      result[name] = printer.printNode(ts.EmitHint.Unspecified, ts.isVariableDeclaration(node) ? node.initializer : node, source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(Object.keys(result).sort(), path).toEqual([...names].sort());
  return result;
}
function withoutKickingCountMappings(text) {
  const source = ts.createSourceFile('probabilityModel.ts', text, ts.ScriptTarget.Latest, true);
  const keys = ['player_field_goals', 'player_kicking_points'];
  const found = [];
  const transformed = ts.transform(source, [context => {
    const visit = node => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'MARKET_FAMILY') {
        expect(ts.isObjectLiteralExpression(node.initializer)).toBe(true);
        const properties = node.initializer.properties.filter(property => {
          if (!property.name || !keys.includes(property.name.getText(source))) return true;
          expect(ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)).toBe(true);
          expect(property.initializer.text).toBe('COUNT');
          found.push(property.name.getText(source));
          return false;
        });
        return context.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          context.factory.updateObjectLiteralExpression(node.initializer, properties));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
  const printed = ts.createPrinter({ removeComments: true }).printFile(transformed.transformed[0]);
  transformed.dispose();
  return { printed, found };
}
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
  it('requires exact RELIABILITY_V1 paths, child hashes, immutable parents and c297 baseline identity', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const current = Object.fromEntries(Object.keys(RELIABILITY_SOURCE_APPROVED_HASHES).map(path => [path, readFileSync(resolve(ROOT, path), 'utf8')]));
    const approved = (path, parent, child, parentVersion = HARDENED_MODEL_VERSION, version = RELIABILITY_VERSION,
      baseline = reliability.baseline[path], baselineHEAD = RELIABILITY_BASELINE) =>
      isReviewedReliabilitySource(path, parent, child, parentVersion, version, baseline, baselineHEAD);
    const check = (sources, parents = archive, baseline = reliability.baseline, parentVersion = HARDENED_MODEL_VERSION,
      version = RELIABILITY_VERSION, baselineHEAD = RELIABILITY_BASELINE) =>
      assertApprovedReliabilitySources(sources, parents, baseline, parentVersion, version, baselineHEAD);
    expect(RELIABILITY_VERSION).toBe('RELIABILITY_V1');
    expect(RELIABILITY_BASELINE).toBe('c2975fe2d27d550809dc885803ad7a13b194cefb');
    expect(Object.keys(current).sort()).toEqual(['lib/storage/kv.ts', 'lib/odds/client.ts', 'lib/nfl/sportsbook.ts',
      'lib/nfl/client.ts', 'lib/mlb/client.ts', 'lib/nba/client.ts', 'lib/ai/agent/sessionStore.ts',
      'lib/finder/engine.ts', 'lib/odds/eventProps.ts', 'lib/finder/nbaEngine.ts',
      'lib/reliability/retry.ts', 'lib/reliability/monitor.ts'].sort());
    expect(Object.isFrozen(RELIABILITY_SOURCE_APPROVED_HASHES)).toBe(true);
    expect(() => check(current)).not.toThrow();
    for (const [path, approval] of Object.entries(RELIABILITY_SOURCE_APPROVED_HASHES)) {
      expect(Object.isFrozen(approval), path).toBe(true);
      expect(digest(current[path]), path).toBe(approval.integrated);
      expect(approved(path, archive[path], current[path]), path).toBe(true);
      expect(isReviewedReliabilitySource(path, archive[path], current[path], HARDENED_MODEL_VERSION), path).toBe(false);
      for (const version of [undefined, null, 'unreviewed', REVIEWED_MLB_ENGINE_VERSION]) {
        expect(() => check(current, archive, reliability.baseline, HARDENED_MODEL_VERSION, version === undefined ? null : version)).toThrow();
        expect(isReviewedReliabilitySource(path, archive[path], current[path], HARDENED_MODEL_VERSION, version,
          reliability.baseline[path], RELIABILITY_BASELINE), path).toBe(false);
      }
      for (const baselineHEAD of ['HEAD', 'c2975fe', 'unreviewed', null]) {
        expect(approved(path, archive[path], current[path], HARDENED_MODEL_VERSION, RELIABILITY_VERSION,
          reliability.baseline[path], baselineHEAD), path).toBe(false);
        expect(() => check(current, archive, reliability.baseline, HARDENED_MODEL_VERSION, RELIABILITY_VERSION, baselineHEAD)).toThrow();
      }
      expect(approved(path, archive[path], current[path], 'NFL_MODEL_V1'), path).toBe(false);
      expect(() => check(current, archive, reliability.baseline, 'NFL_MODEL_V1')).toThrow();
      for (const mutation of [`${current[path]}\n`, '', 'unreviewed', null, undefined]) {
        expect(approved(path, archive[path], mutation), path).toBe(false);
        expect(() => check({ ...current, [path]: mutation })).toThrow(path);
      }
      const omitted = { ...current };
      delete omitted[path];
      expect(() => check(omitted)).toThrow(path);
      expect(() => check(Object.assign(Object.create({ [path]: current[path] }), omitted))).toThrow(path);
      for (const parent of [null, '', current[path], `${archive[path]}\n`]) {
        expect(approved(path, parent, current[path]), path).toBe(false);
        expect(() => check(current, { ...archive, [path]: parent })).toThrow(path);
        expect(() => check(current, archive, { ...reliability.baseline, [path]: parent })).toThrow(path);
      }
      for (const unknown of [`./${path}`, `${path}.unreviewed`, path.replace('.ts', 'V2.ts'), 'toString', '__proto__']) {
        expect(approved(unknown, archive[path], current[path]), unknown).toBe(false);
        expect(() => check({ ...omitted, [unknown]: current[path] })).toThrow(path);
      }
      if (approval.archived === null) {
        expect(approval.baseline).toBeNull();
        expect(Object.hasOwn(archive, path), path).toBe(false);
        expect(execFileSync('git', ['-C', ROOT, 'ls-tree', RELIABILITY_BASELINE, '--', path], { encoding: 'utf8' }), path).toBe('');
        expect(() => check(current, { ...archive, [path]: undefined })).toThrow(path);
        expect(() => check(current, archive, { ...reliability.baseline, [path]: undefined })).toThrow(path);
      } else {
        expect(digest(archive[path]), path).toBe(approval.archived);
        expect(digest(historicalSource(RELIABILITY_BASELINE, path)), path).toBe(approval.baseline);
        const missingArchive = { ...archive };
        delete missingArchive[path];
        const missingBaseline = { ...reliability.baseline };
        delete missingBaseline[path];
        expect(() => check(current, missingArchive)).toThrow(path);
        expect(() => check(current, archive, missingBaseline)).toThrow(path);
      }
    }
  });
  it('permits only the two exact reliability helper additions, never a reliability directory prefix', () => {
    const additions = Object.entries(RELIABILITY_SOURCE_APPROVED_HASHES).filter(([, approval]) => approval.archived === null).map(([path]) => path);
    expect(additions.sort()).toEqual(['lib/reliability/monitor.ts', 'lib/reliability/retry.ts']);
    for (const path of additions) {
      const content = readFileSync(resolve(ROOT, path), 'utf8');
      const check = (sources, archive = {}, options = { reliability }) => assertFrozenInventory(sources, archive, 'reliability fixture', options);
      expect(check({ [path]: content })).toEqual([path]);
      expect(() => check({ [path]: content }, {}, {})).toThrow(/inventory drift/i);
      for (const mutation of [`${content}\n`, '', null, undefined]) expect(() => check({ [path]: mutation })).toThrow(/inventory drift/i);
      for (const unknown of [`./${path}`, `${path}.unreviewed`, 'lib/reliability/unknown.ts', 'lib/reliability/nested/retry.ts']) {
        expect(() => check({ [unknown]: content })).toThrow(/inventory drift/i);
      }
      for (const options of [{ parentModelVersion: 'NFL_MODEL_V1', reliability },
        { reliability: { ...reliability, version: 'unreviewed' } }, { reliability: { ...reliability, baselineHEAD: 'HEAD' } },
        { reliability: { ...reliability, baseline: { [path]: content } } }]) {
        expect(() => check({ [path]: content }, {}, options)).toThrow(/inventory drift/i);
      }
      expect(() => check({}, { [path]: content })).toThrow(/omitted archived source/i);
    }
  });
  it('keeps earlier MLB child pins distinct from exact reliability children', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    for (const [path, previousHash] of Object.entries({
      'lib/finder/engine.ts': '3186d29aefd76b412682419adb9ae90a3242518d183efc64b677a333d8bb5101',
      'lib/odds/eventProps.ts': '4975e93cbd0dcfaecd5da730b61471d1ad649c3fea0df44a9e4107382cfb31cc',
    })) {
      const content = readFileSync(resolve(ROOT, path), 'utf8');
      expect(MLB_SOURCE_APPROVED_HASHES[path].integrated).toBe(previousHash);
      expect(digest(content)).not.toBe(previousHash);
      expect(isReviewedMLBSource(path, archive[path], content, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION)).toBe(false);
      expect(isReviewedMLBSource(path, archive[path], content, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION, reliability)).toBe(true);
      expect(isReviewedMLBSource(path, archive[path], content, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION,
        NFL_KICKING_VERSION, { ...reliability, version: 'unreviewed' })).toBe(false);
    }
  });
  it('preserves the complete NBA candidate model loop and all numeric literals against c297', () => {
    const path = 'lib/finder/nbaEngine.ts';
    const blocks = text => {
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const printer = ts.createPrinter({ removeComments: true });
      const numeric = [];
      const candidates = [];
      const visit = node => {
        if (ts.isNumericLiteral(node)) numeric.push(node.text);
        if (ts.isForOfStatement(node) && node.expression.getText(source) === 'props') candidates.push(printer.printNode(ts.EmitHint.Unspecified, node, source));
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(candidates).toHaveLength(1);
      expect(numeric.length).toBeGreaterThan(0);
      return { numeric, candidates };
    };
    expect(blocks(readFileSync(resolve(ROOT, path), 'utf8'))).toEqual(blocks(historicalSource(RELIABILITY_BASELINE, path)));
  });
  it('permits an exact additive kicker extension while preserving original NFL models, elite weights and thresholds', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    for (const path of ['lib/nfl/projection.ts',
      'lib/nfl/opportunityProjection.ts', 'lib/nfl/opportunityReplay.ts', 'lib/nfl/matchupEfficiency.ts',
      'lib/nfl/gameEnvironment.ts', 'lib/nfl/researchMode.ts', 'lib/nfl/researchModel.ts', 'lib/nfl/seasonContext.ts', 'lib/nfl/injuries.ts']) {
      expect(readFileSync(resolve(ROOT, path), 'utf8'), path).toBe(archive[path]);
    }
    for (const path of ['lib/ai/probabilityModel.ts', 'lib/finder/nflEngine.ts', 'lib/nfl/stats.ts', 'lib/nfl/oddsTypes.ts', 'lib/nfl/roleContext.ts']) {
      const content = readFileSync(resolve(ROOT, path), 'utf8');
      expect(isReviewedNFLKickingSource(path, archive[path], content, HARDENED_MODEL_VERSION, NFL_KICKING_VERSION)
        || isReviewedNFLPartialCoverageSource(path, archive[path], content, HARDENED_MODEL_VERSION, NFL_PARTIAL_COVERAGE_VERSION), path).toBe(true);
    }
    const path = 'lib/ai/eliteResearchFilter.ts';
    const printer = ts.createPrinter({ removeComments: true });
    const constants = text => {
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      return Object.fromEntries(source.statements.filter(ts.isVariableStatement)
        .flatMap(statement => statement.declarationList.declarations)
        .filter(declaration => ['ELITE_RESEARCH_WEIGHTS', 'ELITE_THRESHOLDS'].includes(declaration.name.getText(source)))
        .map(declaration => [declaration.name.getText(source), printer.printNode(ts.EmitHint.Unspecified, declaration.initializer, source)]));
    };
    const original = constants(archive[path]);
    expect(Object.keys(original).sort()).toEqual(['ELITE_RESEARCH_WEIGHTS', 'ELITE_THRESHOLDS']);
    expect(constants(readFileSync(resolve(ROOT, path), 'utf8'))).toEqual(original);
  });
  it('preserves both immutable NFL archive identities and every archived file hash independently of live MLB revisions', () => {
    const parent = verifyV1ParentArchive();
    const directory = resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED');
    const hardened = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
    const archive = JSON.parse(readFileSync(resolve(directory, 'sources.json'), 'utf8'));
    const digest = content => createHash('sha256').update(content).digest('hex');
    expect(parent.snapshotHash).toBe('1274299e208b4bd7cb8fb6572bff1c588f49f0c53b805ad5f2465870151a52c3');
    expect(hardened.snapshotHash).toBe('746b2389e75594f8ceaed94dc3afe936d864d41e7167097f0603081196b0cf16');
    expect(hardened.modelVersion).toBe(HARDENED_MODEL_VERSION);
    expect(hardened.parentModelVersion).toBe(parent.modelVersion);
    expect(hardened.parentSnapshotHash).toBe(parent.snapshotHash);
    expect(digest(JSON.stringify(archive))).toBe(hardened.snapshotHash);
    expect(Object.keys(archive).sort()).toEqual(Object.keys(hardened.files).sort());
    for (const [path, content] of Object.entries(archive)) expect(digest(content), path).toBe(hardened.files[path]);
  });
  it('requires exact versioned MLB source hashes, paths, and immutable archived parents', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const current = Object.fromEntries(Object.keys(MLB_SOURCE_APPROVED_HASHES).map(path => [path, readFileSync(resolve(ROOT, path), 'utf8')]));
    const approved = (path, parent, child, parentVersion = HARDENED_MODEL_VERSION, version = REVIEWED_MLB_ENGINE_VERSION) =>
      isReviewedMLBSource(path, parent, child, parentVersion, version, NFL_KICKING_VERSION, reliability);
    expect(() => assertApprovedMLBSources(current, archive, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION, reliability)).not.toThrow();
    for (const [path, approval] of Object.entries(MLB_SOURCE_APPROVED_HASHES)) {
      expect(approval.integrated).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.isFrozen(approval)).toBe(true);
      expect(approved(path, archive[path], current[path]), path).toBe(true);
      expect(approved(path, archive[path], `${current[path]}\n`), path).toBe(false);
      expect(approved(path, archive[path], undefined), path).toBe(false);
      expect(approved(`${path}.unreviewed`, archive[path], current[path]), path).toBe(false);
      expect(approved(`./${path}`, archive[path], current[path]), path).toBe(false);
      expect(approved(path, archive[path], current[path], 'NFL_MODEL_V1'), path).toBe(false);
      expect(approved(path, archive[path], current[path], HARDENED_MODEL_VERSION, 'unreviewed'), path).toBe(false);
      expect(isReviewedMLBSource(path, archive[path], current[path], HARDENED_MODEL_VERSION), path).toBe(false);
      expect(approved(path, `${archive[path] ?? ''}\n`, current[path]), path).toBe(false);
      if (approval.archived !== null) {
        expect(approval.archived).toMatch(/^[a-f0-9]{64}$/);
        expect(approved(path, undefined, current[path]), path).toBe(false);
      }
      const omitted = { ...current };
      delete omitted[path];
      expect(() => assertApprovedMLBSources(omitted, archive, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION, reliability)).toThrow(path);
      expect(() => assertApprovedMLBSources({ ...current, [path]: `${current[path]}\n` }, archive, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION, reliability)).toThrow(path);
    }
    expect(Object.isFrozen(MLB_SOURCE_APPROVED_HASHES)).toBe(true);
    for (const path of ['lib/ai/probabilityModel.ts', 'lib/nfl/projection.ts', 'lib/mlb/unreviewed.ts', 'toString']) {
      expect(Object.hasOwn(MLB_SOURCE_APPROVED_HASHES, path)).toBe(false);
      expect(approved(path, undefined, current['lib/mlb/gameMarkets.ts'])).toBe(false);
    }
  });
  it('allows only the exact listed MLB additions and rejects changed, missing, or renamed modules', () => {
    const additions = Object.entries(MLB_SOURCE_APPROVED_HASHES).filter(([, approval]) => approval.archived === null).map(([path]) => path);
    expect(additions).toEqual(['lib/mlb/gameMarkets.ts', 'lib/mlb/researchContext.ts']);
    for (const path of additions) {
      const content = readFileSync(resolve(ROOT, path), 'utf8');
      expect(assertFrozenInventory({ [path]: content }, {}, 'fixture')).toEqual([path]);
      expect(() => assertFrozenInventory({ [path]: `${content}\n` }, {}, 'fixture')).toThrow(/inventory drift/i);
      expect(() => assertFrozenInventory({ [`${path}.unreviewed`]: content }, {}, 'fixture')).toThrow(/inventory drift/i);
      expect(() => assertFrozenInventory({}, { [path]: content }, 'fixture')).toThrow(/omitted archived source/i);
    }
  });
  it('rejects any unreviewed mutation or omission in protected refresh/security infrastructure', () => {
    const paths = ['lib/odds/client.ts', 'lib/odds/autoRefreshLedger.ts', 'lib/storage/kv.ts'];
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const current = Object.fromEntries(paths.map(path => [path, readFileSync(resolve(ROOT, path), 'utf8')]));
    const check = sources => assertApprovedSecuritySources(sources, archive, HARDENED_MODEL_VERSION, reliability);
    expect(() => check(current)).not.toThrow();
    expect(() => assertApprovedSecuritySources(current)).toThrow('security infrastructure source mismatch');
    expect(() => assertApprovedSecuritySources(current, archive, HARDENED_MODEL_VERSION, { ...reliability, version: 'unreviewed' })).toThrow();
    for (const path of paths) {
      expect(() => check({ ...current, [path]: `${current[path]}\n` })).toThrow('security infrastructure source mismatch');
      expect(() => check({ ...current, [path]: undefined })).toThrow('security infrastructure source mismatch');
      const omitted = { ...current };
      delete omitted[path];
      expect(() => check(omitted)).toThrow('security infrastructure source mismatch');
    }
  });
  it('accepts only the exact reviewed MLB cache transport against its immutable archived parent', () => {
    const archive = JSON.parse(readFileSync(resolve('reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const original = archive['lib/finder/engine.ts'];
    const cacheTransport = execFileSync('git', ['-C', ROOT, 'show', '066f62ff30771a9a01d6b835fda5cd40cca407c4:lib/finder/engine.ts'], { encoding: 'utf8' });
    expect(isReviewedMLBCacheTransport('lib/finder/engine.ts', original, cacheTransport)).toBe(true);
    expect(isReviewedMLBCacheTransport('lib/finder/engine.ts', original, `${cacheTransport}\n`)).toBe(false);
    expect(isReviewedMLBCacheTransport('lib/finder/engine.ts', `${original}\n`, cacheTransport)).toBe(false);
    expect(isReviewedMLBCacheTransport('lib/finder/nflEngine.ts', original, cacheTransport)).toBe(false);
    expect(isReviewedMLBCacheTransport('lib/finder/engine.ts', original, undefined)).toBe(false);
  });
  it('preserves the earlier MLB engine pin and requires a separate exact reliability override for its current child', () => {
    const archive = JSON.parse(readFileSync(resolve('reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const original = archive['lib/finder/engine.ts'];
    const current = readFileSync(resolve('lib/finder/engine.ts'), 'utf8');
    const cacheTransport = execFileSync('git', ['-C', ROOT, 'show', '066f62ff30771a9a01d6b835fda5cd40cca407c4:lib/finder/engine.ts'], { encoding: 'utf8' });
    const approved = (path, parent, child, parentVersion = HARDENED_MODEL_VERSION, version = REVIEWED_MLB_ENGINE_VERSION) =>
      isReviewedMLBEngineRevision(path, parent, child, parentVersion, version);
    expect(MLB_SOURCE_APPROVED_HASHES['lib/finder/engine.ts'].integrated).toBe('3186d29aefd76b412682419adb9ae90a3242518d183efc64b677a333d8bb5101');
    expect(approved('lib/finder/engine.ts', original, current)).toBe(false);
    expect(isReviewedReliabilitySource('lib/finder/engine.ts', original, current, HARDENED_MODEL_VERSION,
      reliability.version, reliability.baseline['lib/finder/engine.ts'], reliability.baselineHEAD)).toBe(true);
    expect(approved('lib/finder/engine.ts', original, cacheTransport)).toBe(false);
    expect(isReviewedMLBCacheTransport('lib/finder/engine.ts', original, current)).toBe(false);
    expect(approved('lib/finder/engine.ts', original, `${current}\n`)).toBe(false);
    expect(approved('lib/finder/engine.ts', `${original}\n`, current)).toBe(false);
    expect(approved('lib/finder/nflEngine.ts', original, current)).toBe(false);
    expect(approved('lib/finder/engine.ts', original, undefined)).toBe(false);
    expect(approved('lib/finder/engine.ts', undefined, current)).toBe(false);
    expect(approved('lib/finder/engine.ts', original, original)).toBe(false);
    expect(approved('lib/finder/engine.ts', original, 'arbitrary replacement')).toBe(false);
    expect(approved('lib/finder/engine.ts', original, current, 'NFL_MODEL_V1')).toBe(false);
    expect(approved('lib/finder/engine.ts', original, current, HARDENED_MODEL_VERSION, 'unreviewed')).toBe(false);
    expect(isReviewedMLBEngineRevision('lib/finder/engine.ts', original, current, HARDENED_MODEL_VERSION)).toBe(false);
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
  it('allows only two additive COUNT mappings and keeps the entire original probability model and frozen common and NUKE tiers unchanged', () => {
    const archive = JSON.parse(readFileSync(resolve('reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const currentProbability = withoutKickingCountMappings(readFileSync(resolve(ROOT, 'lib/ai/probabilityModel.ts'), 'utf8'));
    const originalProbability = withoutKickingCountMappings(archive['lib/ai/probabilityModel.ts']);
    expect(originalProbability.found).toEqual([]);
    expect(currentProbability.found.sort()).toEqual(['player_field_goals', 'player_kicking_points']);
    expect(currentProbability.printed).toBe(originalProbability.printed);
    const path = 'lib/ai/agent/pickTiers.ts';
    const requirements = text => {
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const printer = ts.createPrinter({ removeComments: true });
      const result = {};
      const visit = node => {
        if (ts.isVariableDeclaration(node) && ['requirements', 'nukeRequirements'].includes(node.name.getText(source))) {
          expect(ts.isArrayLiteralExpression(node.initializer)).toBe(true);
          result[node.name.getText(source)] = node.initializer.elements.filter(element => !ts.isSpreadElement(element))
            .map(element => printer.printNode(ts.EmitHint.Unspecified, element, source));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return result;
    };
    const original = requirements(archive[path]);
    expect(Object.keys(original).sort()).toEqual(['nukeRequirements', 'requirements']);
    expect(requirements(readFileSync(resolve(ROOT, path), 'utf8'))).toEqual(original);
  });
  it('pins inherited production routing, not NFL model changes, to exact pre-existing baseline history', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const git = args => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
    const current = Object.fromEntries(Object.keys(INHERITED_PRODUCTION_ROUTING_HASHES).map(path => [path, historicalSource(INHERITED_ROUTING_BASELINE, path)]));
    const approved = (path, parent, child, parentVersion = HARDENED_MODEL_VERSION, baseline = INHERITED_ROUTING_BASELINE) =>
      isInheritedProductionRouting(path, parent, child, parentVersion, baseline);
    expect(Object.isFrozen(INHERITED_PRODUCTION_ROUTING_HASHES)).toBe(true);
    expect(Object.keys(current)).toEqual(['lib/ai/agent/nflRequestScope.ts', 'lib/nfl/players.ts']);
    expect(() => assertInheritedProductionRouting(current, archive, HARDENED_MODEL_VERSION, INHERITED_ROUTING_BASELINE)).not.toThrow();
    for (const [path, approval] of Object.entries(INHERITED_PRODUCTION_ROUTING_HASHES)) {
      expect(Object.isFrozen(approval)).toBe(true);
      expect(digest(current[path]), path).toBe(approval.inherited);
      expect(git(['show', `${INHERITED_ROUTING_BASELINE}:${path}`]), path).toBe(current[path]);
      expect(git(['show', `${approval.sourceCommit}:${path}`]), path).toBe(current[path]);
      expect(git(['merge-base', '--is-ancestor', approval.sourceCommit, INHERITED_ROUTING_BASELINE])).toBe('');
      expect(git(['log', '-1', '--format=%H', INHERITED_ROUTING_BASELINE, '--', path]).trim()).toBe(approval.sourceCommit);
      expect(current[path], path).not.toBe(archive[path]);
      expect(approved(path, archive[path], current[path])).toBe(true);
      expect(approved(path, `${archive[path]}\n`, current[path])).toBe(false);
      expect(approved(path, undefined, current[path])).toBe(false);
      expect(approved(path, archive[path], `${current[path]}\n`)).toBe(false);
      expect(approved(path, archive[path], undefined)).toBe(false);
      expect(approved(`./${path}`, archive[path], current[path])).toBe(false);
      expect(approved(`${path}.unreviewed`, archive[path], current[path])).toBe(false);
      expect(approved(path, archive[path], current[path], 'NFL_MODEL_V1')).toBe(false);
      expect(approved(path, archive[path], current[path], HARDENED_MODEL_VERSION, 'HEAD')).toBe(false);
      expect(isInheritedProductionRouting(path, archive[path], current[path], HARDENED_MODEL_VERSION)).toBe(false);
      const omitted = { ...current };
      delete omitted[path];
      expect(() => assertInheritedProductionRouting(omitted, archive, HARDENED_MODEL_VERSION, INHERITED_ROUTING_BASELINE)).toThrow(path);
      expect(() => assertInheritedProductionRouting({ ...current, [path]: `${current[path]}\n` }, archive, HARDENED_MODEL_VERSION, INHERITED_ROUTING_BASELINE)).toThrow(path);
    }
    for (const path of ['lib/nfl/projection.ts', 'lib/nfl/injuries.ts', 'lib/ai/probabilityModel.ts', 'toString']) {
      expect(approved(path, archive[path], current['lib/nfl/players.ts'])).toBe(false);
    }
  });
  it('requires exact NFL_KICKING_V1 revisions, immutable archived parents and historical baseline hashes', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const current = Object.fromEntries(Object.keys(NFL_KICKING_SOURCE_APPROVED_HASHES).map(path => [path, readFileSync(resolve(ROOT, path), 'utf8')]));
    const approved = (path, parent, child, parentVersion = HARDENED_MODEL_VERSION, version = NFL_KICKING_VERSION) =>
      isReviewedNFLKickingSource(path, parent, child, parentVersion, version);
    expect(Object.isFrozen(NFL_KICKING_SOURCE_APPROVED_HASHES)).toBe(true);
    expect(Object.keys(current).sort()).toEqual(['communication/intent.ts', 'lib/ai/agent/nflRequestScope.ts',
      'lib/ai/probabilityModel.ts', 'lib/ai/sportResearchAdapters.ts', 'lib/finder/nflEngine.ts',
      'lib/nfl/kickingOpportunity.ts', 'lib/nfl/kickingResearch.ts',
      'lib/nfl/oddsTypes.ts', 'lib/nfl/roleContext.ts', 'lib/nfl/stats.ts']);
    expect(() => assertApprovedNFLKickingSources(current, archive, HARDENED_MODEL_VERSION, NFL_KICKING_VERSION)).toThrow('lib/finder/nflEngine.ts');
    expect(() => assertApprovedNFLKickingSources(current, archive, HARDENED_MODEL_VERSION, NFL_KICKING_VERSION, NFL_PARTIAL_COVERAGE_VERSION)).not.toThrow();
    for (const [path, approval] of Object.entries(NFL_KICKING_SOURCE_APPROVED_HASHES)) {
      expect(Object.isFrozen(approval)).toBe(true);
      expect(approval.integrated).toMatch(/^[a-f0-9]{64}$/);
      if (approval.archived === null) {
        expect(approval.baseline).toBeNull();
        expect(Object.hasOwn(archive, path), path).toBe(false);
        expect(execFileSync('git', ['-C', ROOT, 'ls-tree', INHERITED_ROUTING_BASELINE, '--', path], { encoding: 'utf8' }), path).toBe('');
        for (const parent of [null, '', current[path]]) expect(approved(path, parent, current[path]), path).toBe(false);
        expect(() => assertApprovedNFLKickingSources(current, { ...archive, [path]: undefined }, HARDENED_MODEL_VERSION, NFL_KICKING_VERSION, NFL_PARTIAL_COVERAGE_VERSION)).toThrow(path);
      } else {
        expect(approval.archived).toMatch(/^[a-f0-9]{64}$/);
        expect(approval.baseline).toMatch(/^[a-f0-9]{64}$/);
        expect(digest(archive[path]), path).toBe(approval.archived);
        expect(digest(historicalSource(INHERITED_ROUTING_BASELINE, path)), path).toBe(approval.baseline);
        expect(approved(path, undefined, current[path]), path).toBe(false);
      }
      const partialOverride = path === 'lib/finder/nflEngine.ts';
      expect(digest(current[path]), path).toBe(partialOverride ? NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES[path].integrated : approval.integrated);
      expect(approved(path, archive[path], current[path]), path).toBe(!partialOverride);
      if (partialOverride) expect(approval.integrated).toBe('263d9e026e290ef3fbbc5b13c74598c4e32da7c9742fb81c6a983c3a999344cd');
      expect(approved(path, `${archive[path]}\n`, current[path]), path).toBe(false);
      expect(approved(path, archive[path], `${current[path]}\n`), path).toBe(false);
      expect(approved(path, archive[path], undefined), path).toBe(false);
      expect(approved(path, archive[path], current[path], 'NFL_MODEL_V1'), path).toBe(false);
      expect(approved(path, archive[path], current[path], HARDENED_MODEL_VERSION, 'unreviewed'), path).toBe(false);
      expect(isReviewedNFLKickingSource(path, archive[path], current[path], HARDENED_MODEL_VERSION), path).toBe(false);
      for (const unknown of [`./${path}`, `${path}.unreviewed`, 'toString']) expect(approved(unknown, archive[path], current[path])).toBe(false);
      const omitted = { ...current };
      delete omitted[path];
      expect(() => assertApprovedNFLKickingSources(omitted, archive, HARDENED_MODEL_VERSION, NFL_KICKING_VERSION, NFL_PARTIAL_COVERAGE_VERSION)).toThrow(path);
      const inherited = Object.assign(Object.create({ [path]: current[path] }), omitted);
      expect(() => assertApprovedNFLKickingSources(inherited, archive, HARDENED_MODEL_VERSION, NFL_KICKING_VERSION, NFL_PARTIAL_COVERAGE_VERSION)).toThrow(path);
      expect(() => assertApprovedNFLKickingSources({ ...current, [path]: `${current[path]}\n` }, archive, HARDENED_MODEL_VERSION, NFL_KICKING_VERSION, NFL_PARTIAL_COVERAGE_VERSION)).toThrow(path);
      expect(() => assertApprovedNFLKickingSources(current, { ...archive, [path]: `${archive[path]}\n` }, HARDENED_MODEL_VERSION, NFL_KICKING_VERSION, NFL_PARTIAL_COVERAGE_VERSION)).toThrow(path);
    }
  });
  it('requires exact NFL_PARTIAL_COVERAGE_V1 paths, versions, sources and immutable parents', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const baseline = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1/sources.json'), 'utf8'));
    const current = Object.fromEntries(Object.keys(NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES).map(path => [path, readFileSync(resolve(ROOT, path), 'utf8')]));
    const approved = (path, parent, child, parentVersion = HARDENED_MODEL_VERSION, version = NFL_PARTIAL_COVERAGE_VERSION) =>
      isReviewedNFLPartialCoverageSource(path, parent, child, parentVersion, version);
    const check = (sources, parents = archive, originals = baseline, parentVersion = HARDENED_MODEL_VERSION, version = NFL_PARTIAL_COVERAGE_VERSION) =>
      assertApprovedNFLPartialCoverageSources(sources, parents, originals, parentVersion, version);
    expect(NFL_PARTIAL_COVERAGE_VERSION).toBe('NFL_PARTIAL_COVERAGE_V1');
    expect(Object.keys(current).sort()).toEqual(['lib/finder/nflEngine.ts', 'lib/nfl/partialCoverage.ts']);
    expect(Object.isFrozen(NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES)).toBe(true);
    expect(() => check(current)).not.toThrow();
    for (const [path, approval] of Object.entries(NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES)) {
      expect(Object.isFrozen(approval)).toBe(true);
      expect(digest(current[path]), path).toBe(approval.integrated);
      expect(approved(path, archive[path], current[path]), path).toBe(true);
      expect(isReviewedNFLPartialCoverageSource(path, archive[path], current[path], HARDENED_MODEL_VERSION), path).toBe(false);
      expect(approved(path, archive[path], current[path], 'NFL_MODEL_V1'), path).toBe(false);
      for (const version of ['unreviewed', NFL_KICKING_VERSION, null]) {
        expect(approved(path, archive[path], current[path], HARDENED_MODEL_VERSION, version), path).toBe(false);
        expect(() => check(current, archive, baseline, HARDENED_MODEL_VERSION, version)).toThrow();
      }
      for (const mutation of [`${current[path]}\n`, '', 'unfinished', null, undefined]) {
        expect(approved(path, archive[path], mutation), path).toBe(false);
        expect(() => check({ ...current, [path]: mutation })).toThrow(path);
      }
      const omitted = { ...current };
      delete omitted[path];
      expect(() => check(omitted)).toThrow(path);
      expect(() => check(Object.assign(Object.create({ [path]: current[path] }), omitted))).toThrow(path);
      for (const parent of [null, '', current[path], `${archive[path]}\n`]) {
        expect(approved(path, parent, current[path]), path).toBe(false);
        expect(() => check(current, { ...archive, [path]: parent })).toThrow(path);
        expect(() => check(current, archive, { ...baseline, [path]: parent })).toThrow(path);
      }
      if (approval.archived === null) {
        expect(approval.baseline).toBeNull();
        expect(Object.hasOwn(archive, path)).toBe(false);
        expect(Object.hasOwn(baseline, path)).toBe(false);
        expect(execFileSync('git', ['-C', ROOT, 'ls-tree', INHERITED_ROUTING_BASELINE, '--', path], { encoding: 'utf8' })).toBe('');
        expect(() => check(current, { ...archive, [path]: undefined })).toThrow(path);
        expect(() => check(current, archive, { ...baseline, [path]: undefined })).toThrow(path);
        expect(assertFrozenInventory({ [path]: current[path] }, {}, 'partial fixture')).toEqual([path]);
        for (const mutation of [`${current[path]}\n`, '', null, undefined]) {
          expect(() => assertFrozenInventory({ [path]: mutation }, {}, 'partial fixture')).toThrow(/inventory drift/i);
        }
        for (const options of [{ parentModelVersion: 'NFL_MODEL_V1' }, { partialCoverageVersion: 'unreviewed' }, { partialCoverageVersion: null }]) {
          expect(() => assertFrozenInventory({ [path]: current[path] }, {}, 'partial fixture', options)).toThrow(/inventory drift/i);
        }
        expect(() => assertFrozenInventory({}, { [path]: current[path] }, 'partial fixture')).toThrow(/omitted archived source/i);
      } else {
        expect(digest(archive[path])).toBe(approval.archived);
        expect(digest(baseline[path])).toBe(approval.baseline);
        expect(digest(historicalSource(INHERITED_ROUTING_BASELINE, path))).toBe(approval.baseline);
        expect(approved(path, undefined, current[path])).toBe(false);
        const missingParent = { ...baseline };
        delete missingParent[path];
        expect(() => check(current, archive, missingParent)).toThrow(path);
      }
      for (const unknown of [`./${path}`, `${path}.unreviewed`, path.replace('.ts', 'V2.ts'), 'lib/nfl/unreviewed.ts', 'toString', '__proto__']) {
        expect(approved(unknown, archive[path], current[path]), unknown).toBe(false);
        expect(() => check({ ...omitted, [unknown]: current[path] })).toThrow(path);
        expect(() => assertFrozenInventory({ [unknown]: current[path] }, {}, 'partial fixture')).toThrow(/inventory drift/i);
      }
    }
  });
  it('keeps original MLB pins and inherited routing separate from explicitly versioned additive FG overrides', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    const routing = Object.fromEntries(Object.keys(INHERITED_PRODUCTION_ROUTING_HASHES).map(path => [path, readFileSync(resolve(ROOT, path), 'utf8')]));
    expect(() => assertInheritedProductionRouting(routing, archive, HARDENED_MODEL_VERSION, INHERITED_ROUTING_BASELINE, NFL_KICKING_VERSION)).not.toThrow();
    expect(() => assertInheritedProductionRouting(routing, archive, HARDENED_MODEL_VERSION, INHERITED_ROUTING_BASELINE)).toThrow('nflRequestScope.ts');
    expect(() => assertInheritedProductionRouting(routing, archive, HARDENED_MODEL_VERSION, 'HEAD', NFL_KICKING_VERSION)).toThrow('nflRequestScope.ts');
    for (const path of Object.keys(routing)) {
      const omitted = { ...routing };
      delete omitted[path];
      expect(() => assertInheritedProductionRouting(omitted, archive, HARDENED_MODEL_VERSION, INHERITED_ROUTING_BASELINE, NFL_KICKING_VERSION)).toThrow(path);
      expect(() => assertInheritedProductionRouting({ ...routing, [path]: `${routing[path]}\n` }, archive, HARDENED_MODEL_VERSION, INHERITED_ROUTING_BASELINE, NFL_KICKING_VERSION)).toThrow(path);
    }
    expect(Object.keys(NFL_KICKING_SOURCE_APPROVED_HASHES).filter(path => Object.hasOwn(MLB_SOURCE_APPROVED_HASHES, path)).sort())
      .toEqual(['communication/intent.ts', 'lib/ai/sportResearchAdapters.ts']);
    for (const [path, integrated] of Object.entries({
      'communication/intent.ts': 'ef9524370bfef1971f1d2b525df6915a4fef8b6fb1391710a1957083804dbdba',
      'lib/ai/sportResearchAdapters.ts': '2fd244350af9ea8256979224be412a52f4f01f22bfb2e8ffaee118239e9137a8',
    })) {
      const content = readFileSync(resolve(ROOT, path), 'utf8');
      expect(MLB_SOURCE_APPROVED_HASHES[path].integrated).toBe(integrated);
      expect(isReviewedMLBSource(path, archive[path], content, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION)).toBe(false);
      expect(isReviewedMLBSource(path, archive[path], content, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION, 'unreviewed')).toBe(false);
      expect(isReviewedMLBSource(path, archive[path], content, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION)).toBe(true);
      expect(isReviewedMLBSource(path, archive[path], `${content}\n`, HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION)).toBe(false);
      expect(isReviewedMLBSource(path, archive[path], content, HARDENED_MODEL_VERSION, undefined, NFL_KICKING_VERSION)).toBe(false);
    }
  });
  it('preserves extracted original numeric thresholds, weights, tiers and ranking blocks against historical sources', () => {
    const archive = JSON.parse(readFileSync(resolve(ROOT, 'reports/nfl-validation/NFL_MODEL_V1_1_HARDENED/sources.json'), 'utf8'));
    for (const [path, names] of [
      ['lib/ai/eliteResearchFilter.ts', ['ELITE_RESEARCH_WEIGHTS', 'ELITE_THRESHOLDS']],
      ['lib/ai/agent/pickTiers.ts', ['PICK_TIERS', 'TIER_ORDER', 'sufficientHistory', 'tierScore']],
      ['lib/ai/probabilityModel.ts', ['MIN_SAMPLE_BY_FAMILY', 'modelProbability', 'calibrateProbability']],
      ['lib/finder/nflEngine.ts', ['rankNFLResearchPriority', 'NFL_VALIDATION_COST_PER_EVENT', 'NFL_FALLBACK_MARKETS']],
    ]) {
      const original = extractedBlocks(path, archive[path], names);
      expect(extractedBlocks(path, readFileSync(resolve(ROOT, path), 'utf8'), names), path).toEqual(original);
    }
    const path = 'lib/ai/agent/tools.ts';
    const names = ['MAX_RESULTS_CEILING', 'MIN_OFFICIAL_ODDS', 'TARGET_ODDS_TOLERANCE', 'BALANCED_RANK_METRICS', 'rankBalancedFrontier', 'selectRankedCandidates'];
    const original = extractedBlocks(path, historicalSource(INHERITED_ROUTING_BASELINE, path), names);
    expect(extractedBlocks(path, readFileSync(resolve(ROOT, path), 'utf8'), names)).toEqual(original);
  });
  it('approves only two exact new kicking modules with absent archived and baseline parents', () => {
    const additions = Object.entries(NFL_KICKING_SOURCE_APPROVED_HASHES).filter(([, approval]) => approval.archived === null).map(([path]) => path);
    expect(additions.sort()).toEqual(['lib/nfl/kickingOpportunity.ts', 'lib/nfl/kickingResearch.ts']);
    for (const path of additions) {
      const content = readFileSync(resolve(ROOT, path), 'utf8');
      expect(assertFrozenInventory({ [path]: content }, {}, 'fixture')).toEqual([path]);
      for (const mutation of [`${content}\n`, '', 'unfinished', undefined, null]) {
        expect(() => assertFrozenInventory({ [path]: mutation }, {}, 'fixture')).toThrow(/inventory drift/i);
      }
      for (const renamed of [`./${path}`, `${path}.unreviewed`, path.replace('.ts', 'V2.ts')]) {
        expect(() => assertFrozenInventory({ [renamed]: content }, {}, 'fixture')).toThrow(/inventory drift/i);
      }
      expect(() => assertFrozenInventory({}, { [path]: content }, 'fixture')).toThrow(/omitted archived source/i);
      expect(() => assertFrozenInventory(Object.create({ [path]: content }), { [path]: content }, 'fixture')).toThrow(/omitted archived source/i);
      for (const options of [{ parentModelVersion: 'NFL_MODEL_V1' }, { parentModelVersion: undefined, kickingVersion: 'unreviewed' }, { kickingVersion: null }]) {
        expect(() => assertFrozenInventory({ [path]: content }, {}, 'fixture', options)).toThrow(/inventory drift/i);
      }
    }
    for (const path of ['lib/nfl/unreviewed.ts', 'lib/nfl/kickingUnknown.ts', 'lib/nfl/projection.ts', 'toString', '__proto__']) {
      expect(Object.hasOwn(NFL_KICKING_SOURCE_APPROVED_HASHES, path)).toBe(false);
      expect(isReviewedNFLKickingSource(path, undefined, 'unfinished', HARDENED_MODEL_VERSION, NFL_KICKING_VERSION)).toBe(false);
      expect(() => assertFrozenInventory({ [path]: 'unfinished' }, {}, 'fixture')).toThrow(/inventory drift/i);
    }
  });
});