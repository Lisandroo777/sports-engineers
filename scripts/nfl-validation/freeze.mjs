import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_VERSION = 'NFL_MODEL_V1';
export const HARDENED_MODEL_VERSION = 'NFL_MODEL_V1_1_HARDENED';
export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SNAPSHOT_DIR = resolve(ROOT, 'reports/nfl-validation', MODEL_VERSION);
export const HARDENED_SNAPSHOT_DIR = resolve(ROOT, 'reports/nfl-validation', HARDENED_MODEL_VERSION);
export const HARDENED_ALLOWED_DELTAS = [
  'lib/ai/agent/runner.ts', 'lib/ai/agent/session.ts',
  'lib/ai/agent/tools.ts', 'lib/ai/eliteResearchFilter.ts', 'lib/ai/probabilityModel.ts',
  'lib/nfl/injuries.ts', 'lib/nfl/opportunityProjection.ts', 'lib/nfl/opportunityReplay.ts',
  'lib/nfl/oddsTypes.ts', 'lib/nfl/roleContext.ts', 'lib/nfl/projection.ts',
];
export const NON_MODEL_ADDITION_PREFIXES = ['lib/nba/prediction/', 'lib/nba/context/', 'lib/nba/intelligence/', 'lib/nfl/predictionLedger/'];
const NBA_PRESENTATION_ADDITIONS = ['lib/nba/presentation/adapter.ts', 'lib/nba/presentation/index.ts', 'lib/nba/presentation/types.ts'];
const NBA_DESCRIPTIVE_EVIDENCE_HASHES = {
  'lib/nba/researchEvidence.ts': 'fc78d6cc1081e1e112d9f847c0c895d7aeddd48038e228dc5188ec6a7c629dcc',
  'lib/nba/history.ts': 'f9e9a2e9cc9faa7dfdd3d3e3d973c212c9e8be00f2992f6b3bba56b90fa871fa',
};
const APPROVED_INFRASTRUCTURE_HASHES = {
  'lib/odds/client.ts': '5659ff28cc660e5368a94086a790069adfd4a5233683202b5f23c3956fc18b08',
  'lib/nba/presentation/adapter.ts': 'd2eae1386510dd097b22415f012b8372fde9e25a9e23402153f9363062b0a34d',
  'lib/nba/presentation/index.ts': 'e806cb023e1ffed32d01b276c89fbc04ffacc3452bd36bddf27d995c975c6fdc',
  'lib/nba/presentation/types.ts': 'd0bf5562cbbdb7bebf4f9be21fc726a744f14995b9b86a46e1d1db7c0017cc7f',
};
export const NBA_INTEGRATION_ALLOWED_DELTAS = [
  'lib/finder/nbaEngine.ts', 'lib/ai/agent/tools.ts', 'lib/ai/agent/session.ts',
  'lib/ai/agent/runner.ts', 'lib/ai/eliteResearchFilter.ts', 'lib/nba/schedule.ts', 'lib/nba/stats.ts', 'lib/nba/types.ts',
];
const INHERITED_COMMUNICATION_DELTAS = ['lib/ai/agent/runner.ts', 'lib/ai/agent/session.ts'];
const hash = (content) => createHash('sha256').update(content).digest('hex');
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|mjs|json)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}
export function assertFrozenInventory(current, archive, label) {
  for (const path of Object.keys(archive)) if (!(path in current)) throw new Error(`${label} omitted archived source: ${path}`);
  const additions = Object.keys(current).filter((path) => !(path in archive));
  const rejected = additions.filter((path) => !NON_MODEL_ADDITION_PREFIXES.some((prefix) => path.startsWith(prefix))
    && !NBA_PRESENTATION_ADDITIONS.includes(path) && !(path === 'lib/nba/researchEvidence.ts' && hash(current[path]) === NBA_DESCRIPTIVE_EVIDENCE_HASHES[path]));
  if (rejected.length) throw new Error(`${label} source inventory drift outside isolated infrastructure: ${rejected.join(', ')}`);
  return additions;
}
function packageDependencyDeltaAllowed(path, originalText, currentText) {
  try {
    const original = JSON.parse(originalText);
    const current = JSON.parse(currentText);
    const stable = (value) => Array.isArray(value) ? value.map(stable)
      : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    if (path === 'package.json') {
      if (current.dependencies?.htmlparser2 !== '12.0.0' || current.dependencies?.unpdf !== '1.8.1') return false;
      delete current.dependencies.htmlparser2;
      delete current.dependencies.unpdf;
      return JSON.stringify(stable(current)) === JSON.stringify(stable(original));
    }
    if (path !== 'package-lock.json' || current.lockfileVersion !== original.lockfileVersion) return false;
    for (const [key, value] of Object.entries(original.packages ?? {})) {
      if (key === '') continue;
      if (JSON.stringify(stable(current.packages?.[key])) !== JSON.stringify(stable(value))) return false;
    }
    const added = new Set();
    for (const key of ['node_modules/dom-serializer', 'node_modules/domelementtype', 'node_modules/domhandler',
      'node_modules/domutils', 'node_modules/entities', 'node_modules/htmlparser2', 'node_modules/unpdf']) added.add(key);
    const currentAdditions = Object.keys(current.packages ?? {}).filter((key) => !(key in (original.packages ?? {})));
    const rootOriginal = original.packages?.['']?.dependencies ?? {};
    const rootCurrent = current.packages?.['']?.dependencies ?? {};
    const rootCurrentCopy = JSON.parse(JSON.stringify(current.packages?.[''] ?? {}));
    delete rootCurrentCopy.dependencies?.htmlparser2;
    delete rootCurrentCopy.dependencies?.unpdf;
    return rootCurrent.htmlparser2 === '12.0.0' && rootCurrent.unpdf === '1.8.1'
      && JSON.stringify(stable(rootCurrentCopy)) === JSON.stringify(stable(original.packages['']))
      && JSON.stringify(stable(Object.fromEntries(Object.entries(rootCurrent).filter(([key]) => key !== 'htmlparser2' && key !== 'unpdf')))) === JSON.stringify(stable(rootOriginal))
      && currentAdditions.length === added.size && currentAdditions.every((key) => added.has(key))
      && current.packages['node_modules/htmlparser2']?.version === '12.0.0'
      && current.packages['node_modules/unpdf']?.version === '1.8.1';
  } catch { return false; }
}
export function captureSources() {
  const configs = ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts'];
  const paths = [...sourceFiles(resolve(ROOT, 'lib')), ...configs.map((path) => resolve(ROOT, path)).filter(existsSync)].sort();
  return Object.fromEntries(paths.map((path) => [relative(ROOT, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')]));
}
function captureHardenedSources() {
  const sources = captureSources();
  for (const path of Object.keys(sources)) if (path.startsWith('lib/nfl/predictionLedger/')) delete sources[path];
  const communicationDir = resolve(ROOT, 'communication');
  if (existsSync(communicationDir)) for (const path of sourceFiles(communicationDir)) {
    sources[relative(ROOT, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8');
  }
  return Object.fromEntries(Object.entries(sources).sort(([first], [second]) => first.localeCompare(second)));
}
export function verifyFreeze({ communicationOnly = false } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(SNAPSHOT_DIR, 'manifest.json'), 'utf8'));
  const archive = JSON.parse(readFileSync(resolve(SNAPSHOT_DIR, 'sources.json'), 'utf8'));
  if (manifest.modelVersion !== MODEL_VERSION || hash(JSON.stringify(archive)) !== manifest.snapshotHash) throw new Error('Frozen archive integrity failed');
  const current = captureSources();
  const communicationFiles = ['lib/ai/agent/runner.ts', 'lib/ai/agent/session.ts'];
  assertFrozenInventory(current, archive, 'NFL_MODEL_V1');
  for (const [path, content] of Object.entries(archive)) {
    if (hash(content) !== manifest.files[path] || current[path] !== content && !(communicationOnly && communicationFiles.includes(path))) throw new Error(`Frozen model drift: ${path}`);
  }
  return manifest;
}
export function freezeModel() {
  if (existsSync(resolve(SNAPSHOT_DIR, 'manifest.json'))) return verifyFreeze();
  if (existsSync(resolve(SNAPSHOT_DIR, 'sources.json'))) throw new Error('Incomplete snapshot exists; do not overwrite');
  const sources = captureSources();
  const manifest = { modelVersion: MODEL_VERSION, frozenAt: new Date().toISOString(), calibrationStatus: 'UNVALIDATED',
    snapshotHash: hash(JSON.stringify(sources)), scope: 'All production lib sources plus dependency/config files; conservative transitive closure includes shared and other-sport helpers.',
    components: { historical: 'lib/nfl/projection.ts', opportunity: 'lib/nfl/opportunityProjection.ts', matchup: 'lib/nfl/matchupEfficiency.ts',
      environment: 'lib/nfl/gameEnvironment.ts', probability: 'lib/ai/probabilityModel.ts', researchModes: 'lib/nfl/researchMode.ts',
      profileRules: 'lib/nfl/researchModel.ts', ranking: 'lib/ai/agent/tools.ts', tiers: 'lib/ai/agent/pickTiers.ts',
      risk: 'lib/ai/eliteResearchFilter.ts', season: 'lib/nfl/seasonContext.ts' },
    files: Object.fromEntries(Object.entries(sources).map(([path, content]) => [path, hash(content)])) };
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(resolve(SNAPSHOT_DIR, 'sources.json'), JSON.stringify(sources));
  writeFileSync(resolve(SNAPSHOT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return verifyFreeze();
}
function readV1Base() {
  const baseManifest = JSON.parse(readFileSync(resolve(SNAPSHOT_DIR, 'manifest.json'), 'utf8'));
  const baseSources = JSON.parse(readFileSync(resolve(SNAPSHOT_DIR, 'sources.json'), 'utf8'));
  if (baseManifest.modelVersion !== MODEL_VERSION || hash(JSON.stringify(baseSources)) !== baseManifest.snapshotHash) throw new Error('NFL_MODEL_V1 parent archive integrity failed');
  return { baseManifest, baseSources };
}
export function verifyV1ParentArchive() {
  const { baseManifest, baseSources } = readV1Base();
  for (const [path, content] of Object.entries(baseSources)) if (hash(content) !== baseManifest.files[path]) throw new Error(`NFL_MODEL_V1 archived file hash mismatch: ${path}`);
  return baseManifest;
}
export function verifyHardenedFreeze() {
  const { baseManifest, baseSources } = readV1Base();
  const manifest = JSON.parse(readFileSync(resolve(HARDENED_SNAPSHOT_DIR, 'manifest.json'), 'utf8'));
  const archive = JSON.parse(readFileSync(resolve(HARDENED_SNAPSHOT_DIR, 'sources.json'), 'utf8'));
  if (manifest.modelVersion !== HARDENED_MODEL_VERSION || manifest.parentModelVersion !== MODEL_VERSION
    || manifest.parentSnapshotHash !== baseManifest.snapshotHash || hash(JSON.stringify(archive)) !== manifest.snapshotHash) throw new Error('Hardened archive identity/integrity failed');
  const current = captureHardenedSources();
  assertFrozenInventory(current, archive, 'NFL_MODEL_V1_1_HARDENED');
  for (const path of NBA_PRESENTATION_ADDITIONS) if (hash(current[path] ?? '') !== APPROVED_INFRASTRUCTURE_HASHES[path]) throw new Error(`Approved presentation source mismatch: ${path}`);
  for (const [path, digest] of Object.entries(NBA_DESCRIPTIVE_EVIDENCE_HASHES)) if (hash(current[path] ?? '') !== digest) throw new Error(`Approved descriptive evidence source mismatch: ${path}`);
  for (const [path, content] of Object.entries(archive)) {
    const guardedNBAChange = NBA_INTEGRATION_ALLOWED_DELTAS.includes(path) && current[path] !== content;
    const exactDependencyAddition = ['package.json', 'package-lock.json'].includes(path) && current[path] !== content
      && packageDependencyDeltaAllowed(path, content, current[path]);
    const exactSecurityChange = path === 'lib/odds/client.ts' && hash(current[path] ?? '') === APPROVED_INFRASTRUCTURE_HASHES[path];
    const exactDescriptiveChange = path === 'lib/nba/history.ts' && hash(current[path] ?? '') === NBA_DESCRIPTIVE_EVIDENCE_HASHES[path];
    if (hash(content) !== manifest.files[path] || current[path] !== content && !guardedNBAChange && !exactDependencyAddition && !exactSecurityChange && !exactDescriptiveChange) throw new Error(`Hardened archive source mismatch: ${path}`);
    if (path in baseSources && baseSources[path] !== content && !HARDENED_ALLOWED_DELTAS.includes(path)) throw new Error(`Unapproved V1.1 source delta: ${path}`);
    if (!(path in baseSources) && !path.startsWith('communication/')) throw new Error(`Unapproved new V1.1 source: ${path}`);
  }
  for (const path of Object.keys(baseSources)) if (!(path in archive)) throw new Error(`V1.1 omitted parent source: ${path}`);
  return manifest;
}
export function freezeHardenedModel() {
  if (existsSync(resolve(HARDENED_SNAPSHOT_DIR, 'manifest.json'))) return verifyHardenedFreeze();
  if (existsSync(resolve(HARDENED_SNAPSHOT_DIR, 'sources.json'))) throw new Error('Incomplete hardened snapshot exists; do not overwrite');
  const { baseManifest, baseSources } = readV1Base();
  const sources = captureHardenedSources();
  const deltas = Object.keys(sources).filter((path) => !(path in baseSources) || sources[path] !== baseSources[path]);
  for (const path of deltas) {
    if (path in baseSources && !HARDENED_ALLOWED_DELTAS.includes(path)) throw new Error(`Unapproved V1.1 source delta before freeze: ${path}`);
    if (!(path in baseSources) && !path.startsWith('communication/')) throw new Error(`Unapproved new source before freeze: ${path}`);
  }
  const manifest = { modelVersion: HARDENED_MODEL_VERSION, parentModelVersion: MODEL_VERSION, parentSnapshotHash: baseManifest.snapshotHash,
    frozenAt: new Date().toISOString(), snapshotHash: hash(JSON.stringify(sources)), calibrationStatus: 'UNVALIDATED',
    intendedScope: 'Four approved correctness hardenings only; preserve production formulas and qualification thresholds.',
    behaviorChanges: { negativeYardage: 'Reject yardage with missing/negative opportunity evidence; retain legitimate negative rushing/receiving outcomes with positive attempts/targets and negative passing yards with attempts or recorded sacks.',
      aggregateReplay: 'Retain algebra proven from unweighted role windows and existing 0.6 prior observation weights; add explicit contract tests.',
      cachedInjury: 'Revalidate injury snapshot, each relevant report and participation expiry on every cached recommendation path.',
      calibrationProvenance: 'Describe historical-hit-rate blend as supporting unvalidated evidence; remove unsupported backtest claim.' },
    protected: { probabilityFormula: 'unchanged', projectionFormula: 'unchanged except demonstrably invalid input exclusion',
      tierRequirements: 'unchanged', nukeRequirements: 'unchanged', ranking: 'unchanged', standardDeepBehavior: 'unchanged' },
    inheritedCommunicationDeltas: deltas.filter((path) => INHERITED_COMMUNICATION_DELTAS.includes(path) || path.startsWith('communication/')),
    hardeningSourceDeltas: deltas.filter((path) => !INHERITED_COMMUNICATION_DELTAS.includes(path) && !path.startsWith('communication/')),
    files: Object.fromEntries(Object.entries(sources).map(([path, content]) => [path, hash(content)])) };
  mkdirSync(HARDENED_SNAPSHOT_DIR, { recursive: true });
  writeFileSync(resolve(HARDENED_SNAPSHOT_DIR, 'sources.json'), JSON.stringify(sources));
  writeFileSync(resolve(HARDENED_SNAPSHOT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return verifyHardenedFreeze();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hardened = process.argv.includes('--hardened');
  const manifest = hardened
    ? process.argv.includes('--verify') ? verifyHardenedFreeze() : freezeHardenedModel()
    : process.argv.includes('--verify') ? verifyFreeze({ communicationOnly: process.argv.includes('--communication-only') }) : freezeModel();
  console.log(JSON.stringify({ modelVersion: manifest.modelVersion, snapshotHash: manifest.snapshotHash, files: Object.keys(manifest.files).length,
    calibrationStatus: manifest.calibrationStatus, verified: true }));
}