import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileIntelligenceStore } from '../../intelligence/store';
import { buildNBAIntelligence } from '../../intelligence/engine';
import { INTELLIGENCE_SOURCES } from '../../intelligence/sources';
import { basketballDate } from '../../context/schedule';
import { buildLineups } from '../../intelligence/lineups';
import { buildCoaching } from '../../intelligence/coaching';
import { marketEvidence, marketViews } from '../../intelligence/marketRelevance';
import { digest } from '../../intelligence/documents';
import type { NBAContextSnapshot } from '../../context/types';
import type { IdentityEntry, IntelligenceSource, NBAIntelligenceSnapshot } from '../../intelligence/types';
import { loadPublishedNBAIntelligence } from '../../intelligence/published';

export async function loadNBAGameIntelligence(snapshot: NBAContextSnapshot,
  root = process.env.NBA_GAME_INTELLIGENCE_ARCHIVE): Promise<NBAIntelligenceSnapshot | null> {
  if (!root) {
    const target = snapshot.target;
    const published = await loadPublishedNBAIntelligence({ gameId: target.gameId, homeTeamId: target.homeTeamId,
      awayTeamId: target.awayTeamId, startsAt: target.startsAt, basketballDate: basketballDate(target.startsAt), matchupAliases: [] }, snapshot.asOf);
    return published ? recheckGameIntelligence(published, snapshot.asOf) : null;
  }
  const store = createFileIntelligenceStore(root);
  const identities = JSON.parse(await readFile(join(root, 'identities.json'), 'utf8')) as IdentityEntry[];
  if (!Array.isArray(identities) || identities.some(identity => !Number.isInteger(identity.espnId) || !Number.isInteger(identity.teamId)
    || !Array.isArray(identity.aliases) || typeof identity.name !== 'string' || !Number.isFinite(Date.parse(identity.validFrom)))) {
    throw new Error('Reviewed dated player identity archive required.');
  }
  let sources: IntelligenceSource[] = [...INTELLIGENCE_SOURCES];
  try {
    const configured = JSON.parse(await readFile(join(root, 'sources.json'), 'utf8')) as IntelligenceSource[];
    if (!Array.isArray(configured) || configured.some(source => !source.id || !Array.isArray(source.origins)
      || source.origins.some(origin => new URL(origin).protocol !== 'https:') || !Array.isArray(source.pathPrefixes)
      || !source.pathPrefixes.length || !Array.isArray(source.teamIds) || !Array.isArray(source.authors) || !source.access)) {
      throw new Error('Reviewed source-authority configuration required.');
    }
    sources = [...new Map([...sources, ...configured].map(source => [source.id, source])).values()];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const [documents, claims] = await Promise.all([store.listDocuments(), store.listClaims()]);
  const target = snapshot.target;
  const previous = await store.latestSnapshot(target.gameId, snapshot.asOf);
  const bound = previous?.target.homeTeamId === target.homeTeamId && previous.target.awayTeamId === target.awayTeamId
    && Date.parse(previous.target.startsAt) === Date.parse(target.startsAt);
  const rebuilt = buildNBAIntelligence({ target: { gameId: target.gameId, homeTeamId: target.homeTeamId, awayTeamId: target.awayTeamId,
    startsAt: target.startsAt, basketballDate: basketballDate(target.startsAt), matchupAliases: bound ? previous.target.matchupAliases : [] }, asOf: snapshot.asOf,
    documents, claims, identities, sources });
  return recheckGameIntelligence(rebuilt, snapshot.asOf);
}

function recheckGameIntelligence(rebuilt: NBAIntelligenceSnapshot, asOf: string): NBAIntelligenceSnapshot {
  const cutoff = Date.parse(asOf);
  const cutoffChecked = rebuilt.claims.map(record => [record.document.publishedAt, record.document.updatedAt, record.document.firstSeenAt,
    record.document.fetchedAt, record.document.statementAt, record.claim.statementAt, record.claim.reportedAt, record.claim.reviewedAt]
    .some(value => value != null && Number.isFinite(Date.parse(value)) && Date.parse(value) > cutoff)
    ? { ...record, state: 'AFTER_CUTOFF' as const, reasons: [...record.reasons, 'Game archive: publication, update, statement and observation are checked independently.'] }
    : record);
  const verified = cutoffChecked.map(record => {
    const statement = Date.parse(record.claim.statementAt ?? record.claim.reportedAt ?? '');
    const maxAge = ['LINEUP', 'STARTING_ROLE'].includes(record.claim.topic) ? 3 * 3600000 : 6 * 3600000;
    return record.state === 'CURRENT' && (!Number.isFinite(statement) || cutoff - statement > maxAge)
      ? { ...record, state: 'STALE' as const, reasons: [...record.reasons, 'Game archive statement exceeded publication freshness policy; receipt does not renew it.'] }
      : record;
  });
  if (verified.every((record, index) => record === rebuilt.claims[index])) return rebuilt;
  const evidence = marketEvidence(verified);
  return { ...rebuilt, snapshotId: digest(JSON.stringify([rebuilt.snapshotId, verified])), claims: verified,
    lineups: buildLineups(rebuilt.target, verified), coaching: buildCoaching(verified), evidence,
    marketViews: marketViews(evidence), affectedTeammates: [],
    coverage: { ...rebuilt.coverage, missing: [...rebuilt.coverage.missing, ...verified.filter(record => ['AFTER_CUTOFF', 'STALE'].includes(record.state)).flatMap(record => record.reasons)] } };
}