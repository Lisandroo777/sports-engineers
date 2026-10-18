import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  'lib/odds/client.ts': '848444d3cf4ea5b752f69fd53d246a70b9bae6ef16b10c4e5a03a7e5b3100e82',
  'lib/storage/kv.ts': 'db073dd51fc361bdb1d2a6c325c9a5fd15e1dc2aae231d9524ffcc796b4ceb10',
  'lib/odds/autoRefreshLedger.ts': '55722203ddd11f45fa9e15f375e8da8bd271787e7c08bfc9648adf8925339591',
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
const REVIEWED_MLB_CACHE_TRANSPORT = Object.freeze({
  archived: '96f9626804fac34f2764aa76694ceac6fa3132828ff2e2a416679047c6fab8d6',
  integrated: '9cca4f1059a203114f7c38c3fee39e35c3a481722e430d9e05c992f84abc78b3',
});
export const REVIEWED_MLB_ENGINE_VERSION = 'MLB_RESEARCH_CONTEXT_V1';
export const INHERITED_ROUTING_BASELINE = 'c2975fe2d27d550809dc885803ad7a13b194cefb';
export const RELIABILITY_VERSION = 'RELIABILITY_V1';
export const RELIABILITY_BASELINE = 'c2975fe2d27d550809dc885803ad7a13b194cefb';
export const RELIABILITY_SOURCE_APPROVED_HASHES = Object.freeze(Object.fromEntries(Object.entries({
  'lib/storage/kv.ts': { archived: '4c6fcf9631a66e37af0f089ecb8627a41cf0aad00f5111d221f61b54df72da66', baseline: 'db073dd51fc361bdb1d2a6c325c9a5fd15e1dc2aae231d9524ffcc796b4ceb10', integrated: 'd79463e1347745d66f19f93a57e48054c1096543bc3263465b9862f650707b82' },
  'lib/odds/client.ts': { archived: '599398c78d3a6eb3d26222c9bb89bbf8fee869a1cf4ad5d9050e50dd7457143e', baseline: 'f5e391d311b025345468fa3b2e390407ed5af8d03a3bbcaf60ba997790d95e75', integrated: '2d9c80a348d9d3e5afc2af0c5594b8b992014953d23cc6b9c03aef8ee40dae41' },
  'lib/nfl/sportsbook.ts': { archived: 'ece06cfdf82bd01585c0126ad0725053cbd9df3f3535d8e26efee44e73183c25', baseline: 'ece06cfdf82bd01585c0126ad0725053cbd9df3f3535d8e26efee44e73183c25', integrated: '91d26d43b63e77e75baea25318b6adecd4a3adea78dbe973145ffe8048946e5b' },
  'lib/nfl/client.ts': { archived: '209e75a81c23e26e1c1e39d7a5d1520f479057daa0ba6a7e0dd5516ff2a7595c', baseline: '209e75a81c23e26e1c1e39d7a5d1520f479057daa0ba6a7e0dd5516ff2a7595c', integrated: '7f936b245df4d49d13b59d0373d7ce9da8794ddfb01b336b6a8cb62d5f1a37d0' },
  'lib/mlb/client.ts': { archived: 'fd767e11e57a41f394a4de6878da7d7ab0fdb6dcce8b3b2da4b89c178bb798ef', baseline: 'fd767e11e57a41f394a4de6878da7d7ab0fdb6dcce8b3b2da4b89c178bb798ef', integrated: '5ae1d205581b3baef7143d4b8b2553051db75cbfd36dc8b97a27946e0240c24c' },
  'lib/nba/client.ts': { archived: 'eb3a9f589764a625925dc0b8887d9ce61d805ffce3f3e5109058f1c0490aa880', baseline: 'eb3a9f589764a625925dc0b8887d9ce61d805ffce3f3e5109058f1c0490aa880', integrated: 'f064ef427488300a40f0e8075eed3b82366c8191afb232a59b0cb52e85a42172' },
  'lib/ai/agent/sessionStore.ts': { archived: '383f28223aa7cbd0c6b4c5d06dafe712f5ff590684a9199c879f2714881f19b4', baseline: '383f28223aa7cbd0c6b4c5d06dafe712f5ff590684a9199c879f2714881f19b4', integrated: 'e3226a75dae5b1728bd1469676fe5494815d7e90ffd2c73273afe8dfe2c11229' },
  'lib/finder/engine.ts': { archived: '96f9626804fac34f2764aa76694ceac6fa3132828ff2e2a416679047c6fab8d6', baseline: '9cca4f1059a203114f7c38c3fee39e35c3a481722e430d9e05c992f84abc78b3', integrated: 'f3819a0c36e29abec6e8e397623d79c003371e4df12030ff6dd595c96674de17' },
  'lib/odds/eventProps.ts': { archived: 'eb4f1df338c42b868c61fdebb19bf6f7e7368d02beba017314d9b5fb03377c91', baseline: 'eb4f1df338c42b868c61fdebb19bf6f7e7368d02beba017314d9b5fb03377c91', integrated: '6ba55364e837833b309e62a605e7922c2b2a83b38de1403b49a13e530a8f1ed7' },
  'lib/finder/nbaEngine.ts': { archived: '4419c53835d6690cb7940220f8b152df28d6cc904089bdb0a36fe360f71fabf5', baseline: 'bf9b08c38a233050370b936fcdd47ffa84b18cef4861f4cf2792c145ec013fec', integrated: 'bdfd916af24de411dd8f2ee5ceb5d17c051149df4199b6de609465b42981194e' },
  'lib/reliability/retry.ts': { archived: null, baseline: null, integrated: '3671af3ce9964f7aad083633fcbea5fb1e93699826a54c11b369cc9ee9fb89be' },
  'lib/reliability/monitor.ts': { archived: null, baseline: null, integrated: '6b693a5e825ff73111e1df30745062276eadedef8ab86ab21723a0ac0b72923b' },
}).map(([path, approval]) => [path, Object.freeze(approval)])));
export function isReviewedReliabilitySource(path, archived, current, parentModelVersion, version, baseline, baselineHEAD) {
  const approval = Object.hasOwn(RELIABILITY_SOURCE_APPROVED_HASHES, path) ? RELIABILITY_SOURCE_APPROVED_HASHES[path] : null;
  return Boolean(approval && parentModelVersion === HARDENED_MODEL_VERSION && version === RELIABILITY_VERSION && baselineHEAD === RELIABILITY_BASELINE
    && (approval.archived === null ? archived === undefined : typeof archived === 'string' && hash(archived) === approval.archived)
    && (approval.baseline === null ? baseline === undefined : typeof baseline === 'string' && hash(baseline) === approval.baseline)
    && typeof current === 'string' && hash(current) === approval.integrated);
}
export function assertApprovedReliabilitySources(current, archive, baseline, parentModelVersion, version, baselineHEAD, requestRecovery) {
  for (const [path, approval] of Object.entries(RELIABILITY_SOURCE_APPROVED_HASHES)) {
    if (!Object.hasOwn(current, path) || approval.archived === null && Object.hasOwn(archive, path)
      || approval.baseline === null && Object.hasOwn(baseline, path)
      || !(isReviewedReliabilitySource(path, archive[path], current[path], parentModelVersion, version, baseline[path], baselineHEAD)
        || version === RELIABILITY_VERSION && baselineHEAD === RELIABILITY_BASELINE
          && requestRecoverySourceApproved(path, archive[path], current[path], parentModelVersion, requestRecovery)
          && (approval.baseline === null ? baseline[path] === undefined : typeof baseline[path] === 'string' && hash(baseline[path]) === approval.baseline))) {
      throw new Error(`Approved RELIABILITY_V1 source mismatch: ${path}`);
    }
  }
}
function reliabilitySourceApproved(path, archive, current, parentModelVersion, reliability) {
  return Boolean(reliability && isReviewedReliabilitySource(path, archive, current, parentModelVersion,
    reliability.version, reliability.baseline[path], reliability.baselineHEAD));
}
export const NFL_KICKING_VERSION = 'NFL_KICKING_V1';
export const NFL_PARTIAL_COVERAGE_VERSION = 'NFL_PARTIAL_COVERAGE_V1';
export const NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES = Object.freeze(Object.fromEntries(Object.entries({
  'lib/finder/nflEngine.ts': { archived: '275b2234cb184f524175ffca8ea7287f8bd5642be049bab3dbbb2b718847c734', baseline: '275b2234cb184f524175ffca8ea7287f8bd5642be049bab3dbbb2b718847c734', integrated: '60795aca90406abf0ff57563c32f487aa9549098055a45dccc5ba4cde2023a90' },
  'lib/nfl/partialCoverage.ts': { archived: null, baseline: null, integrated: '9e572d850c13c1c76db771a3f3e9998a5dab594701906c9a857ff76c096f3bdc' },
}).map(([path, approval]) => [path, Object.freeze(approval)])));
export function isReviewedNFLPartialCoverageSource(path, archived, current, parentModelVersion, version) {
  const approval = Object.hasOwn(NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES, path) ? NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES[path] : null;
  return Boolean(approval && parentModelVersion === HARDENED_MODEL_VERSION && version === NFL_PARTIAL_COVERAGE_VERSION
    && (approval.archived === null ? archived === undefined : typeof archived === 'string' && hash(archived) === approval.archived)
    && typeof current === 'string' && hash(current) === approval.integrated);
}
export function assertApprovedNFLPartialCoverageSources(current, archive, baseline, parentModelVersion, version, requestRecovery) {
  for (const [path, approval] of Object.entries(NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES)) {
    if (!Object.hasOwn(current, path)
      || (approval.archived === null && Object.hasOwn(archive, path))
      || (approval.baseline === null ? Object.hasOwn(baseline, path) : typeof baseline[path] !== 'string' || hash(baseline[path]) !== approval.baseline)
      || !(isReviewedNFLPartialCoverageSource(path, archive[path], current[path], parentModelVersion, version)
        || version === NFL_PARTIAL_COVERAGE_VERSION && requestRecoverySourceApproved(path, archive[path], current[path], parentModelVersion, requestRecovery))) {
      throw new Error(`Approved NFL_PARTIAL_COVERAGE_V1 source mismatch: ${path}`);
    }
  }
}
export const NFL_KICKING_SOURCE_APPROVED_HASHES = Object.freeze(Object.fromEntries(Object.entries({
  'lib/nfl/stats.ts': { archived: 'f314c5e22c0f375ca18257372e183dd3ad44185c6a4ca993c888772f3e8c18bc', baseline: 'f314c5e22c0f375ca18257372e183dd3ad44185c6a4ca993c888772f3e8c18bc', integrated: '09c9b04be8bd0c2699e459890b896a7abd7d8b6da5495bd8ef63ecb0f9bcf214' },
  'lib/nfl/oddsTypes.ts': { archived: 'd0c4051fd335e064175d37f90fa3c93a2fdccd69182b66f1d2862bacf5aa7518', baseline: 'd0c4051fd335e064175d37f90fa3c93a2fdccd69182b66f1d2862bacf5aa7518', integrated: 'b339cc66504ca8b7d4f8f5fd5b91ec07416f793174830d310b9a50971e71817f' },
  'lib/nfl/roleContext.ts': { archived: 'd55da71b93ff8816b769b1bffe349e44f5d2f461cb25281d6aaf2b38c3d5a304', baseline: 'd55da71b93ff8816b769b1bffe349e44f5d2f461cb25281d6aaf2b38c3d5a304', integrated: '8808a5105f560e59d12803e1bad17cf84d4dd82268b95e6d2ee4f50097ba736b' },
  'lib/finder/nflEngine.ts': { archived: '275b2234cb184f524175ffca8ea7287f8bd5642be049bab3dbbb2b718847c734', baseline: '275b2234cb184f524175ffca8ea7287f8bd5642be049bab3dbbb2b718847c734', integrated: '263d9e026e290ef3fbbc5b13c74598c4e32da7c9742fb81c6a983c3a999344cd' },
  'lib/ai/probabilityModel.ts': { archived: 'eb9edc451214c119cecbce579b95f3d4ebb6b6c1f71ef6cda6fb409678aefea6', baseline: 'eb9edc451214c119cecbce579b95f3d4ebb6b6c1f71ef6cda6fb409678aefea6', integrated: '3aab737e67a57fd84afe2095a6aea16ed5e7bac86a0a16b2b47d7a1f9d304cf8' },
  'communication/intent.ts': { archived: '09f7cf2749a45533477325069da0f8a0a7d2062bf234e2de1cf916d988e6258f', baseline: '444cf93f0bd23e26adb96063382111045271eaa0fc997e7ee854cc26167befd4', integrated: 'd550cd3c5c6b6b434ff994c4a22f49079f9c40ac7ea45423532eb56b8e5e8691' },
  'lib/ai/sportResearchAdapters.ts': { archived: 'ebbe217dae2dadc29909b74f23e3aaff8863fb855d423e3880e16d37f78b2ab9', baseline: 'ebbe217dae2dadc29909b74f23e3aaff8863fb855d423e3880e16d37f78b2ab9', integrated: '0730923f2c0606d01ed0d5d0af5ce5c31c3aee180927bc947bade723ce51c1de' },
  'lib/ai/agent/nflRequestScope.ts': { archived: '61ee8a9885a14b79c4b2e9c098685adb14911749ffad9e1db86e6e12eec4d97e', baseline: '1f6b6efd646fd3b7c4849bcb7815d9e31e3b352e507c8914f26a37ad1370c0e1', integrated: '8e756403b670b9c17f33f795ecfda9f8e1ae6ae45aa6346b7711ae7e5352b245' },
  'lib/nfl/kickingResearch.ts': { archived: null, baseline: null, integrated: '0e5dfb05970e1f8ab2834566816ccd291044b2b06c0cfe0ffc92fab5f053da00' },
  'lib/nfl/kickingOpportunity.ts': { archived: null, baseline: null, integrated: 'dccfc6fa03811de7fe26d9cf2988aa6daf2d44955592453ef31354355f8efaa1' },
}).map(([path, approval]) => [path, Object.freeze(approval)])));
export function isReviewedNFLKickingSource(path, archived, current, parentModelVersion, version) {
  const approval = Object.hasOwn(NFL_KICKING_SOURCE_APPROVED_HASHES, path) ? NFL_KICKING_SOURCE_APPROVED_HASHES[path] : null;
  return Boolean(approval && parentModelVersion === HARDENED_MODEL_VERSION && version === NFL_KICKING_VERSION
    && (approval.archived === null ? archived === undefined : typeof archived === 'string' && hash(archived) === approval.archived)
    && typeof current === 'string' && hash(current) === approval.integrated);
}
export function assertApprovedNFLKickingSources(current, archive, parentModelVersion, version, partialCoverageVersion, requestRecovery) {
  for (const path of Object.keys(NFL_KICKING_SOURCE_APPROVED_HASHES)) {
    if (!Object.hasOwn(current, path)
      || NFL_KICKING_SOURCE_APPROVED_HASHES[path].archived === null && Object.hasOwn(archive, path)
      || !isReviewedNFLKickingSource(path, archive[path], current[path], parentModelVersion, version)
        && !(version === NFL_KICKING_VERSION && isReviewedNFLPartialCoverageSource(path, archive[path], current[path], parentModelVersion, partialCoverageVersion))
        && !(version === NFL_KICKING_VERSION && partialCoverageVersion === NFL_PARTIAL_COVERAGE_VERSION
          && requestRecoverySourceApproved(path, archive[path], current[path], parentModelVersion, requestRecovery))) {
      throw new Error(`Approved additive NFL_KICKING_V1 source mismatch: ${path}`);
    }
  }
}
export const INHERITED_PRODUCTION_ROUTING_HASHES = Object.freeze(Object.fromEntries(Object.entries({
  'lib/ai/agent/nflRequestScope.ts': { archived: '61ee8a9885a14b79c4b2e9c098685adb14911749ffad9e1db86e6e12eec4d97e', inherited: '1f6b6efd646fd3b7c4849bcb7815d9e31e3b352e507c8914f26a37ad1370c0e1', sourceCommit: 'c15edf6d9f116f7dff9cda81d3077c118d336589' },
  'lib/nfl/players.ts': { archived: 'a843318338e4bb5b260fee83c0eb0c21aa5a674a3970a38ad0da72b157fa6bff', inherited: 'b81a02911c12f330c6d3fe65cca5d2f569dbea3b8ece8c0a3c3d10b1f175e413', sourceCommit: '469d8c7336d51d5f1b9d59401ee62b903aa2a771' },
}).map(([path, approval]) => [path, Object.freeze(approval)])));
export function isInheritedProductionRouting(path, archived, current, parentModelVersion, baseline) {
  const approval = Object.hasOwn(INHERITED_PRODUCTION_ROUTING_HASHES, path) ? INHERITED_PRODUCTION_ROUTING_HASHES[path] : null;
  return Boolean(approval && parentModelVersion === HARDENED_MODEL_VERSION && baseline === INHERITED_ROUTING_BASELINE
    && typeof archived === 'string' && hash(archived) === approval.archived
    && typeof current === 'string' && hash(current) === approval.inherited);
}
export function assertInheritedProductionRouting(current, archive, parentModelVersion, baseline, kickingVersion) {
  for (const path of Object.keys(INHERITED_PRODUCTION_ROUTING_HASHES)) {
    const additiveKicking = baseline === INHERITED_ROUTING_BASELINE
      && isReviewedNFLKickingSource(path, archive[path], current[path], parentModelVersion, kickingVersion);
    if (!Object.hasOwn(current, path) || !isInheritedProductionRouting(path, archive[path], current[path], parentModelVersion, baseline) && !additiveKicking) {
      throw new Error(`Inherited production routing source mismatch (not an NFL model change): ${path}`);
    }
  }
}
export const MLB_SOURCE_APPROVED_HASHES = Object.freeze(Object.fromEntries(Object.entries({
  'lib/ai/agent/pickTiers.ts': { archived: 'bfc6d6ac18698969f915612471e5ca25f1c8d7c3a3c3e33ce8f9d4d0f5443103', integrated: '3bfcf4f23a676d088f4a8c1f29df938b0dea1d75e15f72cdcc49853406951230' },
  'communication/intent.ts': { archived: '09f7cf2749a45533477325069da0f8a0a7d2062bf234e2de1cf916d988e6258f', integrated: 'ef9524370bfef1971f1d2b525df6915a4fef8b6fb1391710a1957083804dbdba' },
  'lib/ai/agent/status.ts': { archived: 'a4848fe2db70facfae8e16f22943fcc61a79cdc522eb1fa1a82c2773f62a4fe1', integrated: '348bf152bf8056dfec65e3b44c0d26bc2a422e3179739746fd71209bbff1cd6f' },
  'lib/mlb/gameMarkets.ts': { archived: null, integrated: 'f62bab87621dd6183df6e75cd32647f88c4e539e6e174c72177ffc6f21c80c85' },
  'lib/mlb/researchContext.ts': { archived: null, integrated: 'e760290b4ffad813fd6c2f930ad68397a9d49dffb18f4af12e344d86896b0c3e' },
  'lib/finder/engine.ts': { archived: '96f9626804fac34f2764aa76694ceac6fa3132828ff2e2a416679047c6fab8d6', integrated: '3186d29aefd76b412682419adb9ae90a3242518d183efc64b677a333d8bb5101' },
  'lib/mlb/stats.ts': { archived: '63ef564a72d8d88a809e9a34da5d23b2961acdad6555c93e8e317eb70efe90dc', integrated: '381351f96631d4b7df8eef553f0ab12b664a0d422042c601e6e3dfa2267b6b16' },
  'lib/mlb/types.ts': { archived: '3f0178f5736361e2e1da4bbf72d8bfcd6d4b508fe60016dcc856347c6f82ca0e', integrated: 'e4a273f51038fc342bec27f670419d77f49b777c862c305df5a290fbed41cf41' },
  'lib/odds/match.ts': { archived: '2d422de41152ab93f5ddc66c2a1c9c179fbe38eb3b377df9ad4602542e39be7a', integrated: 'dc6fac3928d763e1ed3676a6399b933bb2facf6142394be6607428acb8395522' },
  'lib/odds/eventProps.ts': { archived: 'eb4f1df338c42b868c61fdebb19bf6f7e7368d02beba017314d9b5fb03377c91', integrated: '4975e93cbd0dcfaecd5da730b61471d1ad649c3fea0df44a9e4107382cfb31cc' },
  'lib/ai/sportResearchAdapters.ts': { archived: 'ebbe217dae2dadc29909b74f23e3aaff8863fb855d423e3880e16d37f78b2ab9', integrated: '2fd244350af9ea8256979224be412a52f4f01f22bfb2e8ffaee118239e9137a8' },
}).map(([path, approval]) => [path, Object.freeze(approval)])));
const REVIEWED_MLB_ENGINE_REVISION = Object.freeze({
  parentModelVersion: HARDENED_MODEL_VERSION,
  ...MLB_SOURCE_APPROVED_HASHES['lib/finder/engine.ts'],
  version: REVIEWED_MLB_ENGINE_VERSION,
});
export function isReviewedMLBSource(path, archived, current, parentModelVersion, version, kickingVersion, reliability) {
  const approval = Object.hasOwn(MLB_SOURCE_APPROVED_HASHES, path) ? MLB_SOURCE_APPROVED_HASHES[path] : null;
  return Boolean(approval && parentModelVersion === HARDENED_MODEL_VERSION && version === REVIEWED_MLB_ENGINE_VERSION
    && typeof current === 'string' && (hash(current) === approval.integrated
      || isReviewedNFLKickingSource(path, archived, current, parentModelVersion, kickingVersion)
      || reliabilitySourceApproved(path, archived, current, parentModelVersion, reliability))
    && (approval.archived === null ? archived === undefined : typeof archived === 'string' && hash(archived) === approval.archived));
}
export function assertApprovedMLBSources(current, archive, parentModelVersion, version, kickingVersion, reliability) {
  for (const path of Object.keys(MLB_SOURCE_APPROVED_HASHES)) {
    if (!Object.hasOwn(current, path) || !isReviewedMLBSource(path, archive[path], current[path], parentModelVersion, version, kickingVersion, reliability)) {
      throw new Error(`Approved versioned MLB source mismatch: ${path}`);
    }
  }
}
export function isReviewedMLBCacheTransport(path, archived, current) {
  return path === 'lib/finder/engine.ts' && hash(archived) === REVIEWED_MLB_CACHE_TRANSPORT.archived
    && hash(current ?? '') === REVIEWED_MLB_CACHE_TRANSPORT.integrated;
}
export function isReviewedMLBEngineRevision(path, archived, current, parentModelVersion, version) {
  return path === 'lib/finder/engine.ts' && parentModelVersion === REVIEWED_MLB_ENGINE_REVISION.parentModelVersion
    && version === REVIEWED_MLB_ENGINE_REVISION.version
    && hash(archived ?? '') === REVIEWED_MLB_ENGINE_REVISION.archived
    && hash(current ?? '') === REVIEWED_MLB_ENGINE_REVISION.integrated;
}
export const NFL_REQUEST_RECOVERY_VERSION = 'NFL_REQUEST_RECOVERY_V1';
export const NFL_REQUEST_RECOVERY_BASELINE = '61086d27ef9bccaab92fe9d4a67196b95fe4f658';
export const NFL_REQUEST_RECOVERY_SOURCE_APPROVED_HASHES = Object.freeze(Object.fromEntries(Object.entries({
  'lib/odds/client.ts': { archived: '599398c78d3a6eb3d26222c9bb89bbf8fee869a1cf4ad5d9050e50dd7457143e', baseline: '2d9c80a348d9d3e5afc2af0c5594b8b992014953d23cc6b9c03aef8ee40dae41', integrated: 'c3599291d23323c1ce49b93ad7bce55c3528d959b1c7abd309b4fbe68daa388b' },
  'lib/nfl/sportsbook.ts': { archived: 'ece06cfdf82bd01585c0126ad0725053cbd9df3f3535d8e26efee44e73183c25', baseline: '91d26d43b63e77e75baea25318b6adecd4a3adea78dbe973145ffe8048946e5b', integrated: 'b3096fdd4ebfe2dc125b0352fec90b303bd754b7f47040f246ce0737264689b9' },
  'lib/finder/nflEngine.ts': { archived: '275b2234cb184f524175ffca8ea7287f8bd5642be049bab3dbbb2b718847c734', baseline: '60795aca90406abf0ff57563c32f487aa9549098055a45dccc5ba4cde2023a90', integrated: '03fa89afdf117949e12e072f489c0d32596bc1a1cc519ca9a1ee662982d8d54b' },
  'lib/ai/agent/sessionStore.ts': { archived: '383f28223aa7cbd0c6b4c5d06dafe712f5ff590684a9199c879f2714881f19b4', baseline: 'e3226a75dae5b1728bd1469676fe5494815d7e90ffd2c73273afe8dfe2c11229', integrated: 'e40cd58d8fbd9ca614d6a57e451c58f83b5341686e3a113b77b95f0387ae9466' },
  'lib/reliability/researchFailure.ts': { archived: null, baseline: null, integrated: '8a9921c77e12c2526ff363d916230580286e98c5460d5a9e8597d817271708cd' },
}).map(([path, approval]) => [path, Object.freeze(approval)])));
export function isReviewedNFLRequestRecoverySource(path, archived, current, parentModelVersion, version, baseline, baselineHEAD) {
  const approval = Object.hasOwn(NFL_REQUEST_RECOVERY_SOURCE_APPROVED_HASHES, path) ? NFL_REQUEST_RECOVERY_SOURCE_APPROVED_HASHES[path] : null;
  return Boolean(approval && parentModelVersion === HARDENED_MODEL_VERSION && version === NFL_REQUEST_RECOVERY_VERSION
    && baselineHEAD === NFL_REQUEST_RECOVERY_BASELINE
    && (approval.archived === null ? archived === undefined : typeof archived === 'string' && hash(archived) === approval.archived)
    && (approval.baseline === null ? baseline === undefined : typeof baseline === 'string' && hash(baseline) === approval.baseline)
    && typeof current === 'string' && hash(current) === approval.integrated);
}
function requestRecoverySourceApproved(path, archived, current, parentModelVersion, requestRecovery) {
  return Boolean(requestRecovery && Object.hasOwn(NFL_REQUEST_RECOVERY_SOURCE_APPROVED_HASHES, path)
    && (NFL_REQUEST_RECOVERY_SOURCE_APPROVED_HASHES[path].baseline === null ? !Object.hasOwn(requestRecovery.baseline, path) : Object.hasOwn(requestRecovery.baseline, path))
    && isReviewedNFLRequestRecoverySource(path, archived, current, parentModelVersion,
      requestRecovery.version, requestRecovery.baseline[path], requestRecovery.baselineHEAD));
}
export function assertApprovedNFLRequestRecoverySources(current, archive, baseline, parentModelVersion, version, baselineHEAD) {
  for (const [path, approval] of Object.entries(NFL_REQUEST_RECOVERY_SOURCE_APPROVED_HASHES)) {
    if (!Object.hasOwn(current, path) || (approval.archived === null ? Object.hasOwn(archive, path) : !Object.hasOwn(archive, path))
      || !requestRecoverySourceApproved(path, archive[path], current[path], parentModelVersion, { version, baseline, baselineHEAD })) {
      throw new Error(`Approved NFL_REQUEST_RECOVERY_V1 source mismatch: ${path}`);
    }
  }
}
export function assertApprovedSecuritySources(current, archive = {}, parentModelVersion, reliability, requestRecovery) {
  for (const path of ['lib/odds/client.ts', 'lib/odds/autoRefreshLedger.ts', 'lib/storage/kv.ts']) {
    if (hash(current[path] ?? '') !== APPROVED_INFRASTRUCTURE_HASHES[path]
      && !reliabilitySourceApproved(path, archive[path], current[path], parentModelVersion, reliability)
      && !requestRecoverySourceApproved(path, archive[path], current[path], parentModelVersion, requestRecovery)) throw new Error(`Approved security infrastructure source mismatch: ${path}`);
  }
}
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|mjs|json)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}
export function assertFrozenInventory(current, archive, label, { parentModelVersion = HARDENED_MODEL_VERSION, kickingVersion = NFL_KICKING_VERSION, partialCoverageVersion = NFL_PARTIAL_COVERAGE_VERSION, reliability, requestRecovery } = {}) {
  for (const path of Object.keys(archive)) if (!Object.hasOwn(current, path)) throw new Error(`${label} omitted archived source: ${path}`);
  const additions = Object.keys(current).filter((path) => !Object.hasOwn(archive, path));
  const rejected = additions.filter((path) => !NON_MODEL_ADDITION_PREFIXES.some((prefix) => path.startsWith(prefix))
    && !requestRecoverySourceApproved(path, undefined, current[path], parentModelVersion, requestRecovery)
    && !reliabilitySourceApproved(path, undefined, current[path], parentModelVersion, reliability)
    && !(Object.hasOwn(NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES, path) && NFL_PARTIAL_COVERAGE_SOURCE_APPROVED_HASHES[path].archived === null
      && isReviewedNFLPartialCoverageSource(path, undefined, current[path], parentModelVersion, partialCoverageVersion))
    && !(Object.hasOwn(NFL_KICKING_SOURCE_APPROVED_HASHES, path) && NFL_KICKING_SOURCE_APPROVED_HASHES[path].archived === null
      && isReviewedNFLKickingSource(path, undefined, current[path], parentModelVersion, kickingVersion))
    && !(Object.hasOwn(MLB_SOURCE_APPROVED_HASHES, path) && MLB_SOURCE_APPROVED_HASHES[path].archived === null
      && isReviewedMLBSource(path, undefined, current[path], HARDENED_MODEL_VERSION, REVIEWED_MLB_ENGINE_VERSION))
    && !NBA_PRESENTATION_ADDITIONS.includes(path) && !(path === 'lib/nba/researchEvidence.ts' && hash(current[path]) === NBA_DESCRIPTIVE_EVIDENCE_HASHES[path])
    && !(path === 'lib/odds/autoRefreshLedger.ts' && hash(current[path]) === APPROVED_INFRASTRUCTURE_HASHES[path]));
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
  assertFrozenInventory(current, archive, 'NFL_MODEL_V1', { parentModelVersion: MODEL_VERSION });
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
  const baselinePaths = new Set(execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', RELIABILITY_BASELINE], { encoding: 'utf8' }).trim().split('\n'));
  const baseline = Object.fromEntries(Object.keys(RELIABILITY_SOURCE_APPROVED_HASHES).filter(path => baselinePaths.has(path))
    .map(path => [path, execFileSync('git', ['-C', ROOT, 'show', `${RELIABILITY_BASELINE}:${path}`], { encoding: 'utf8' })]));
  const reliability = { version: RELIABILITY_VERSION, baseline, baselineHEAD: RELIABILITY_BASELINE };
  const recoveryPaths = new Set(execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', NFL_REQUEST_RECOVERY_BASELINE], { encoding: 'utf8' }).trim().split('\n'));
  const recoveryBaseline = Object.fromEntries(Object.keys(NFL_REQUEST_RECOVERY_SOURCE_APPROVED_HASHES).filter(path => recoveryPaths.has(path))
    .map(path => [path, execFileSync('git', ['-C', ROOT, 'show', `${NFL_REQUEST_RECOVERY_BASELINE}:${path}`], { encoding: 'utf8' })]));
  const requestRecovery = { version: NFL_REQUEST_RECOVERY_VERSION, baseline: recoveryBaseline, baselineHEAD: NFL_REQUEST_RECOVERY_BASELINE };
  assertApprovedNFLRequestRecoverySources(current, archive, recoveryBaseline, manifest.modelVersion, requestRecovery.version, requestRecovery.baselineHEAD);
  assertApprovedReliabilitySources(current, archive, baseline, manifest.modelVersion, reliability.version, reliability.baselineHEAD, requestRecovery);
  assertFrozenInventory(current, archive, 'NFL_MODEL_V1_1_HARDENED', { reliability, requestRecovery });
  assertApprovedSecuritySources(current, archive, manifest.modelVersion, reliability, requestRecovery);
  assertApprovedMLBSources(current, archive, manifest.modelVersion, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION, reliability);
  assertInheritedProductionRouting(current, archive, manifest.modelVersion, INHERITED_ROUTING_BASELINE, NFL_KICKING_VERSION);
  assertApprovedNFLKickingSources(current, archive, manifest.modelVersion, NFL_KICKING_VERSION, NFL_PARTIAL_COVERAGE_VERSION, requestRecovery);
  assertApprovedNFLPartialCoverageSources(current, archive, baseSources, manifest.modelVersion, NFL_PARTIAL_COVERAGE_VERSION, requestRecovery);
  for (const path of NBA_PRESENTATION_ADDITIONS) if (hash(current[path] ?? '') !== APPROVED_INFRASTRUCTURE_HASHES[path]) throw new Error(`Approved presentation source mismatch: ${path}`);
  for (const [path, digest] of Object.entries(NBA_DESCRIPTIVE_EVIDENCE_HASHES)) if (hash(current[path] ?? '') !== digest) throw new Error(`Approved descriptive evidence source mismatch: ${path}`);
  for (const [path, content] of Object.entries(archive)) {
    const guardedNBAChange = NBA_INTEGRATION_ALLOWED_DELTAS.includes(path) && current[path] !== content;
    const exactDependencyAddition = ['package.json', 'package-lock.json'].includes(path) && current[path] !== content
      && packageDependencyDeltaAllowed(path, content, current[path]);
    const exactSecurityChange = ['lib/odds/client.ts', 'lib/storage/kv.ts'].includes(path) && hash(current[path] ?? '') === APPROVED_INFRASTRUCTURE_HASHES[path];
    const exactDescriptiveChange = path === 'lib/nba/history.ts' && hash(current[path] ?? '') === NBA_DESCRIPTIVE_EVIDENCE_HASHES[path];
    const exactCacheTransport = isReviewedMLBCacheTransport(path, content, current[path]);
    const exactMLBRevision = isReviewedMLBEngineRevision(path, content, current[path], manifest.modelVersion, REVIEWED_MLB_ENGINE_VERSION);
    const exactMLBSource = isReviewedMLBSource(path, content, current[path], manifest.modelVersion, REVIEWED_MLB_ENGINE_VERSION, NFL_KICKING_VERSION);
    const exactKickingSource = isReviewedNFLKickingSource(path, content, current[path], manifest.modelVersion, NFL_KICKING_VERSION);
    const exactPartialCoverageSource = isReviewedNFLPartialCoverageSource(path, content, current[path], manifest.modelVersion, NFL_PARTIAL_COVERAGE_VERSION);
    const exactReliabilitySource = reliabilitySourceApproved(path, content, current[path], manifest.modelVersion, reliability);
    const exactRequestRecoverySource = requestRecoverySourceApproved(path, content, current[path], manifest.modelVersion, requestRecovery);
    const inheritedProductionRouting = isInheritedProductionRouting(path, content, current[path], manifest.modelVersion, INHERITED_ROUTING_BASELINE);
    if (hash(content) !== manifest.files[path] || current[path] !== content && !guardedNBAChange && !exactDependencyAddition && !exactSecurityChange && !exactDescriptiveChange && !exactCacheTransport && !exactMLBRevision && !exactMLBSource && !inheritedProductionRouting && !exactKickingSource && !exactPartialCoverageSource && !exactReliabilitySource && !exactRequestRecoverySource) throw new Error(`Hardened archive source mismatch: ${path}`);
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