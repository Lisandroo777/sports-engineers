import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileIntelligenceStore } from './store';
import { createIntelligenceRefresher } from './refresh';
import { buildNBAIntelligence } from './engine';
import { INTELLIGENCE_SOURCES } from './sources';
import { createReviewedClaim, type ReviewedClaimInput } from './claims';
import type { AccessGrant, RefreshRequest } from './refresh';
import type { IdentityEntry, TargetEvent, IntelligenceSource } from './types';

export async function runManualRefresh(configPath: string): Promise<unknown> {
  const text = await readFile(configPath, 'utf8');
  if (Buffer.byteLength(text) > 500000) throw new Error('Refresh configuration too large.');
  const config = JSON.parse(text) as { storeDirectory: string; requests: RefreshRequest[]; grants: AccessGrant[]; target: TargetEvent; identities: IdentityEntry[]; teams: Array<{ teamId: number; names: string[] }>;
    activateGameArchive?: boolean; sources?: IntelligenceSource[];
    reviewedClaims?: Array<{ documentRevisionId: string; input: ReviewedClaimInput }> };
  if (!config.storeDirectory || !Array.isArray(config.requests) || !Array.isArray(config.grants) || !Array.isArray(config.identities) || !Array.isArray(config.teams)) throw new Error('Explicit store, requests, grants and verified identities/team aliases required.');
  if ((config.sources || config.reviewedClaims) && config.activateGameArchive !== true) throw new Error('Game archive metadata/claim import requires explicit activateGameArchive.');
  const sources = config.activateGameArchive ? [...new Map([...INTELLIGENCE_SOURCES, ...(config.sources ?? [])].map(source => [source.id, source])).values()] : undefined;
  if (config.activateGameArchive) {
    if (config.identities.some(identity => !Number.isInteger(identity.espnId) || identity.espnId <= 0 || !Number.isInteger(identity.teamId)
      || !Array.isArray(identity.aliases) || typeof identity.name !== 'string' || !Number.isFinite(Date.parse(identity.validFrom))
      || identity.validTo != null && (!Number.isFinite(Date.parse(identity.validTo)) || Date.parse(identity.validTo) <= Date.parse(identity.validFrom)))) {
      throw new Error('Reviewed dated identities required before activating game archive.');
    }
    if (sources!.some(source => !source.id || !Array.isArray(source.origins) || source.origins.some(origin => new URL(origin).protocol !== 'https:')
      || !Array.isArray(source.pathPrefixes) || !source.pathPrefixes.length || !Array.isArray(source.teamIds) || !Array.isArray(source.authors) || !source.access)) {
      throw new Error('Reviewed source authority required before activating game archive.');
    }
  }
  const store = createFileIntelligenceStore(config.storeDirectory);
  const result = await createIntelligenceRefresher({ store, sources }).refresh(config);
  const asOf = new Date().toISOString();
  const documents = await store.listDocuments();
  if (config.activateGameArchive) {
    const imported = (config.reviewedClaims ?? []).map(entry => {
      const document = documents.find(record => record.revisionId === entry.documentRevisionId);
      if (!document) throw new Error('Reviewed claim requires an existing immutable document revision.');
      return createReviewedClaim(document, entry.input);
    });
    const review = buildNBAIntelligence({ target: config.target, asOf, documents, claims: imported, identities: config.identities, sources });
    if (review.claims.length !== imported.length || review.claims.some(record => record.state !== 'CURRENT'
      || !['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED'].includes(record.verification)
      || record.claim.lineupLevel === 'OFFICIALLY_CONFIRMED' && record.verification !== 'OFFICIAL')) {
      throw new Error('Imported claims did not pass current exact-game identity, source and supporting-span verification.');
    }
    await store.putClaims(imported);
    await mkdir(config.storeDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(config.storeDirectory, 'identities.json'), JSON.stringify(config.identities), { mode: 0o600 });
    await writeFile(join(config.storeDirectory, 'sources.json'), JSON.stringify(sources), { mode: 0o600 });
  }
  const snapshot = buildNBAIntelligence({ target: config.target, asOf, documents: await store.listDocuments(), claims: await store.listClaims(), identities: config.identities,
    sources, previous: await store.latestSnapshot(config.target.gameId, asOf), missing: result.missing, refresh: result });
  await store.putSnapshot(snapshot);
  return { refresh: result, snapshot };
}