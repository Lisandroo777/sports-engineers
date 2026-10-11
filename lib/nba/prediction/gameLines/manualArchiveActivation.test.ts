import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReviewedClaim, supportedClaim, type ReviewedClaimInput } from '../../intelligence/claims';
import { runManualRefresh } from '../../intelligence/refresh.cli';
import type { AccessGrant, RefreshRequest } from '../../intelligence/refresh';
import { INTELLIGENCE_SOURCES } from '../../intelligence/sources';
import { createFileIntelligenceStore } from '../../intelligence/store';
import type { IdentityEntry, IntelligenceSource, NBAIntelligenceSnapshot, TargetEvent } from '../../intelligence/types';
import { assessNBAGameAvailability } from './availability';
import { availabilityFixture, availabilityTime, starterIds } from './availability.fixtures';
import { loadNBAGameIntelligence } from './intelligenceArchive';

interface ManualConfig {
  storeDirectory: string;
  requests: RefreshRequest[];
  grants: AccessGrant[];
  target: TargetEvent;
  identities: IdentityEntry[];
  teams: Array<{ teamId: number; names: string[] }>;
  activateGameArchive?: boolean;
  sources?: IntelligenceSource[];
  reviewedClaims?: Array<{ documentRevisionId: string; input: ReviewedClaimInput }>;
}

let directory: string;
let fixture: ReturnType<typeof availabilityFixture>;
let config: ManualConfig;
let store: ReturnType<typeof createFileIntelligenceStore>;

async function refresh() {
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify(config));
  return runManualRefresh(configPath);
}

async function expectNoImport() {
  expect(await store.listClaims()).toHaveLength(10);
  for (const claim of await store.listClaims()) {
    expect(claim).toEqual(fixture.rawInput.claims.find(record => record.id === claim.id));
    expect(claim.extraction).toBe('OFFICIAL_STRUCTURED');
  }
  expect(await store.latestSnapshot(config.target.gameId, '2026-01-22T00:00:00Z')).toBeNull();
  for (const file of ['identities.json', 'sources.json']) {
    await expect(readFile(join(config.storeDirectory, file), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }
  expect(await store.listDocuments()).toHaveLength(3);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(availabilityTime));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Fetch forbidden in manual archive activation tests.'); }));
  directory = await mkdtemp(join(tmpdir(), 'nba-manual-archive-'));
  fixture = availabilityFixture();
  config = {
    storeDirectory: join(directory, 'store'), requests: [], grants: [],
    target: fixture.rawInput.target, identities: fixture.rawInput.identities,
    teams: [{ teamId: 1, names: ['Home'] }, { teamId: 2, names: ['Away'] }],
    activateGameArchive: true, sources: fixture.rawInput.sources,
    reviewedClaims: fixture.rawInput.claims.filter(claim => claim.topic === 'LINEUP').map(claim => {
      const { id, documentRevisionId, sourceId, extraction, evidence, ...fields } = claim;
      void id;
      void sourceId;
      void extraction;
      const input: ReviewedClaimInput = { ...fields, excerpt: evidence.excerpt,
        page: evidence.page, timecode: evidence.timecode,
        reviewedBy: 'manual-archive-test-reviewer', reviewedAt: '2026-01-21T17:50:00Z' };
      return { documentRevisionId, input };
    }),
  };
  store = createFileIntelligenceStore(config.storeDirectory);
  for (const document of fixture.rawInput.documents) await store.putDocument(document);
  await store.putClaims(fixture.rawInput.claims.filter(claim => claim.topic === 'INJURY'));
});

afterEach(async () => {
  try {
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('manual NBA game archive activation', () => {
  it('imports reviewed exact-span official-team lineups alongside archived official injury claims without fetching', async () => {
    const expectedClaims = [...fixture.rawInput.claims.filter(claim => claim.topic === 'INJURY'),
      ...config.reviewedClaims!.map(entry => createReviewedClaim(
        fixture.rawInput.documents.find(document => document.revisionId === entry.documentRevisionId)!, entry.input))];
    const result = await refresh() as { refresh: { requestsUsed: number }; snapshot: NBAIntelligenceSnapshot };
    expect(result.refresh.requestsUsed).toBe(0);
    expect(result.snapshot).toMatchObject({ schemaVersion: '1', target: config.target,
      asOf: new Date(availabilityTime).toISOString(), cutoff: new Date(availabilityTime).toISOString(),
      coverage: { refreshMode: 'MANUAL' } });
    expect(result.snapshot.claims).toHaveLength(12);
    expect(result.snapshot.claims.filter(record => record.claim.topic === 'INJURY')).toHaveLength(10);
    expect(result.snapshot.claims.filter(record => record.claim.topic === 'LINEUP')).toHaveLength(2);
    for (const record of result.snapshot.claims) {
      expect(record).toMatchObject({ verification: 'OFFICIAL', state: 'CURRENT', reasons: [] });
      if (record.claim.topic === 'LINEUP') {
        expect(record.claim).toMatchObject({ extraction: 'REVIEWED', reviewedBy: 'manual-archive-test-reviewer' });
      } else expect(record.claim.extraction).toBe('OFFICIAL_STRUCTURED');
      expect(supportedClaim(record.claim, record.document)).toBe(true);
      expect(record.claim).toEqual(expectedClaims.find(claim => claim.id === record.claim.id));
      expect(record.document).toEqual(fixture.rawInput.documents.find(document => document.revisionId === record.claim.documentRevisionId));
    }
    expect((await store.listClaims()).sort((first, second) => first.id.localeCompare(second.id)))
      .toEqual(expectedClaims.sort((first, second) => first.id.localeCompare(second.id)));
    expect(await store.listDocuments()).toHaveLength(3);
    for (const document of await store.listDocuments()) {
      expect(document).toEqual(fixture.rawInput.documents.find(record => record.revisionId === document.revisionId));
    }
    expect(await store.latestSnapshot(config.target.gameId, '2026-01-21T18:00:01Z')).toEqual(result.snapshot);
    expect(JSON.parse(await readFile(join(config.storeDirectory, 'identities.json'), 'utf8'))).toEqual(config.identities);
    const persistedSources = JSON.parse(await readFile(join(config.storeDirectory, 'sources.json'), 'utf8')) as IntelligenceSource[];
    expect(persistedSources).toEqual([...new Map([...INTELLIGENCE_SOURCES, ...config.sources!].map(source => [source.id, source])).values()]);
    expect(persistedSources.filter(source => source.id.startsWith('fixture-official-team-')).map(source => source.category))
      .toEqual(['OFFICIAL_TEAM', 'OFFICIAL_TEAM']);

    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, config.storeDirectory);
    expect(intelligence).not.toBeNull();
    expect(intelligence!.asOf).toBe(new Date(availabilityTime).toISOString());
    expect(intelligence!.cutoff).toBe(new Date(availabilityTime).toISOString());
    expect(intelligence!.claims).toHaveLength(12);
    expect(intelligence!.claims.map(record => record.claim.id).sort()).toEqual(expectedClaims.map(claim => claim.id).sort());
    expect(intelligence!.claims.every(record => record.state === 'CURRENT' && record.verification === 'OFFICIAL'
      && supportedClaim(record.claim, record.document))).toBe(true);
    const availability = assessNBAGameAvailability(fixture.snapshot, intelligence);
    expect(availability).toMatchObject({ injuriesVerified: true, startingLineupsVerified: true,
      conflictsResolved: true, impactReviewResolved: true, blockers: [], phase: { verified: true } });
    expect(availability.teams.map(team => team.confirmedStarterIds)).toEqual(starterIds);
  });

  it('persists reviewed identity and source metadata with explicit activation even without claim imports', async () => {
    delete config.reviewedClaims;
    const result = await refresh() as { refresh: { requestsUsed: number }; snapshot: NBAIntelligenceSnapshot };
    expect(result.refresh.requestsUsed).toBe(0);
    expect(result.snapshot.claims).toHaveLength(10);
    expect(result.snapshot.claims.every(record => record.claim.topic === 'INJURY'
      && record.verification === 'OFFICIAL' && record.state === 'CURRENT')).toBe(true);
    expect(await store.listClaims()).toHaveLength(10);
    expect(JSON.parse(await readFile(join(config.storeDirectory, 'identities.json'), 'utf8'))).toEqual(config.identities);
    const sources = JSON.parse(await readFile(join(config.storeDirectory, 'sources.json'), 'utf8'));
    expect(sources).toEqual(expect.arrayContaining(config.sources!));
    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, config.storeDirectory);
    expect(intelligence!.claims).toHaveLength(10);
    expect(intelligence!.lineups.every(lineup => lineup.level === 'UNKNOWN')).toBe(true);
  });

  it.each([undefined, false])('legacy config with activation %s returns a snapshot without writing archive metadata', async activation => {
    config.activateGameArchive = activation;
    delete config.sources;
    delete config.reviewedClaims;
    const result = await refresh() as { refresh: { requestsUsed: number }; snapshot: NBAIntelligenceSnapshot };
    expect(result.refresh.requestsUsed).toBe(0);
    expect(result.snapshot).toMatchObject({ schemaVersion: '1', coverage: { refreshMode: 'MANUAL' } });
    expect(result.snapshot.claims).toHaveLength(10);
    expect(await store.latestSnapshot(config.target.gameId, '2026-01-21T18:00:01Z')).toEqual(result.snapshot);
    expect(await store.listClaims()).toHaveLength(10);
    for (const file of ['identities.json', 'sources.json']) {
      await expect(readFile(join(config.storeDirectory, file), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  const rejectedImports: Array<[string, (value: ManualConfig) => void, string]> = [
    ['unknown document revision', value => { value.reviewedClaims![0].documentRevisionId = 'unknown-revision'; },
      'Reviewed claim requires an existing immutable document revision.'],
    ['document ID instead of revision ID', value => { value.reviewedClaims![0].documentRevisionId = fixture.rawInput.documents[1].documentId; },
      'Reviewed claim requires an existing immutable document revision.'],
    ['missing reviewer', value => { value.reviewedClaims![0].input.reviewedBy = null; },
      'Reviewer, review timestamp and bounded supporting excerpt required.'],
    ['blank reviewer', value => { value.reviewedClaims![0].input.reviewedBy = '   '; },
      'Reviewer, review timestamp and bounded supporting excerpt required.'],
    ['nonexact supporting excerpt', value => { value.reviewedClaims![0].input.excerpt += ' invented text'; },
      'Supporting excerpt must be exact text in this revision.'],
    ['future reviewed timestamp', value => { value.reviewedClaims![0].input.reviewedAt = '2026-01-21T18:00:01Z'; },
      'Imported claims did not pass'],
    ['unreviewed lineup player identity', value => { value.identities = value.identities.filter(identity => identity.espnId !== 105); },
      'Imported claims did not pass'],
    ['expired lineup player membership', value => { value.identities.find(identity => identity.espnId === 105)!.validTo = '2026-01-20T00:00:00Z'; },
      'Imported claims did not pass'],
    ['team editorial attempting official lineup confirmation', value => {
      value.sources!.find(source => source.id === 'fixture-official-team-1')!.category = 'TEAM_EDITORIAL';
    }, 'Imported claims did not pass'],
    ['unregistered official lineup source', value => {
      value.sources = value.sources!.filter(source => source.id !== 'fixture-official-team-1');
    }, 'Imported claims did not pass'],
    ['noninteger identity', value => { value.identities[0].espnId = 101.5; }, 'Reviewed dated identities required'],
    ['nonpositive identity', value => { value.identities[0].espnId = 0; }, 'Reviewed dated identities required'],
    ['noninteger team identity', value => { value.identities[0].teamId = 1.5; }, 'Reviewed dated identities required'],
    ['invalid identity start date', value => { value.identities[0].validFrom = 'invalid'; }, 'Reviewed dated identities required'],
    ['invalid identity end date', value => { value.identities[0].validTo = 'invalid'; }, 'Reviewed dated identities required'],
    ['reversed identity date interval', value => { value.identities[0].validTo = value.identities[0].validFrom; }, 'Reviewed dated identities required'],
  ];

  it.each(rejectedImports)('rejects %s without importing claims or metadata', async (_label, mutate, message) => {
    mutate(config);
    await expect(refresh()).rejects.toThrow(message);
    await expectNoImport();
  });

  it.each([
    ['sources', undefined], ['reviewedClaims', undefined], ['sources', false], ['reviewedClaims', false],
  ] as const)('requires explicit activation for %s with opt-in %s', async (field, activation) => {
    config.activateGameArchive = activation;
    if (field === 'sources') delete config.reviewedClaims;
    else delete config.sources;
    await expect(refresh()).rejects.toThrow('Game archive metadata/claim import requires explicit activateGameArchive.');
    await expectNoImport();
  });
});