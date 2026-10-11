import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supportedClaim } from '../../intelligence/claims';
import { createFileIntelligenceStore } from '../../intelligence/store';
import { assessNBAGameAvailability } from './availability';
import { availabilityFixture, availabilityTime, starterIds } from './availability.fixtures';
import { loadNBAGameIntelligence } from './intelligenceArchive';

type ArchiveFixture = ReturnType<typeof availabilityFixture>;
const directories: string[] = [];

async function writeArchive(fixture: ArchiveFixture, configuredSources = true) {
  const root = await mkdtemp(join(tmpdir(), 'nba-game-intelligence-'));
  directories.push(root);
  const store = createFileIntelligenceStore(root);
  await writeFile(join(root, 'identities.json'), JSON.stringify(fixture.rawInput.identities));
  if (configuredSources) await writeFile(join(root, 'sources.json'), JSON.stringify(fixture.rawInput.sources));
  for (const document of fixture.rawInput.documents) await store.putDocument(document);
  await store.putClaims(fixture.rawInput.claims);
  return { root, store };
}

beforeEach(() => {
  vi.stubEnv('NBA_GAME_INTELLIGENCE_ARCHIVE', '');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in archive tests'); }));
});

afterEach(async () => {
  try {
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })));
  }
});

describe('NBA game intelligence archive loader', () => {
  it('expires old report and lineup statements before they reach any model adapter', async () => {
    const fixture = availabilityFixture('stale');
    const { root } = await writeArchive(fixture);
    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, root);
    expect(intelligence!.claims.every(record => record.state === 'STALE')).toBe(true);
    expect(intelligence!.lineups.every(lineup => lineup.state !== 'CURRENT')).toBe(true);
    expect(assessNBAGameAvailability(fixture.snapshot, intelligence).impactReviewResolved).toBe(false);
  });
  it('rebuilds verified exact-game official evidence from configured file-store records', async () => {
    const fixture = availabilityFixture();
    const { root, store } = await writeArchive(fixture);
    vi.stubEnv('NBA_GAME_INTELLIGENCE_ARCHIVE', root);
    expect(await store.listDocuments()).toHaveLength(3);
    expect(await store.listClaims()).toHaveLength(12);
    expect(await store.latestSnapshot(fixture.snapshot.target.gameId, availabilityTime)).toBeNull();

    const intelligence = await loadNBAGameIntelligence(fixture.snapshot);
    expect(intelligence).not.toBeNull();
    expect(intelligence).toMatchObject({
      target: { gameId: fixture.snapshot.target.gameId, homeTeamId: 1, awayTeamId: 2,
        startsAt: fixture.snapshot.target.startsAt, basketballDate: '2026-01-21' },
      asOf: new Date(availabilityTime).toISOString(), cutoff: new Date(availabilityTime).toISOString(),
    });
    expect(intelligence!.claims).toHaveLength(12);
    expect(intelligence!.claims.map(record => record.claim.id).sort()).toEqual(fixture.rawInput.claims.map(claim => claim.id).sort());
    for (const record of intelligence!.claims) {
      expect(record).toMatchObject({ verification: 'OFFICIAL', state: 'CURRENT', reasons: [] });
      expect(supportedClaim(record.claim, record.document)).toBe(true);
      expect(record.document).toEqual(fixture.rawInput.documents.find(document => document.revisionId === record.claim.documentRevisionId));
    }
    const result = assessNBAGameAvailability(fixture.snapshot, intelligence);
    expect(result).toMatchObject({ injuriesVerified: true, startingLineupsVerified: true, conflictsResolved: true,
      impactReviewResolved: true, numericAdjustmentsApplied: false, blockers: [], phase: { verified: true } });
    expect(result.teams.map(team => team.confirmedStarterIds)).toEqual(starterIds);
    expect(result.teams.map(team => team.report)).toEqual(['VERIFIED', 'VERIFIED']);
    expect(result.teams.flatMap(team => team.players)).toHaveLength(10);
    expect(result.teams.flatMap(team => team.players).every(player => player.status === 'AVAILABLE' && player.starter === 'CONFIRMED')).toBe(true);
  });

  it('returns null when no archive is configured', async () => {
    const { snapshot } = availabilityFixture();
    expect(await loadNBAGameIntelligence(snapshot)).toBeNull();
    expect(await loadNBAGameIntelligence(snapshot, '')).toBeNull();
    expect(assessNBAGameAvailability(snapshot, null)).toMatchObject({ injuriesVerified: false,
      startingLineupsVerified: false, impactReviewResolved: false });
  });

  it.each([
    ['not an array', {}],
    ['noninteger player ID', [{ espnId: 101.5, teamId: 1, name: 'Fixture Player 101', aliases: [], validFrom: availabilityTime }]],
    ['noninteger team ID', [{ espnId: 101, teamId: '1', name: 'Fixture Player 101', aliases: [], validFrom: availabilityTime }]],
    ['missing alias array', [{ espnId: 101, teamId: 1, name: 'Fixture Player 101', validFrom: availabilityTime }]],
    ['invalid name', [{ espnId: 101, teamId: 1, name: null, aliases: [], validFrom: availabilityTime }]],
    ['undated membership', [{ espnId: 101, teamId: 1, name: 'Fixture Player 101', aliases: [], validFrom: 'invalid' }]],
  ])('rejects identities with %s', async (_label, identities) => {
    const fixture = availabilityFixture();
    const { root } = await writeArchive(fixture);
    await writeFile(join(root, 'identities.json'), JSON.stringify(identities));
    await expect(loadNBAGameIntelligence(fixture.snapshot, root)).rejects.toThrow('Reviewed dated player identity archive required.');
  });

  it('rejects structurally valid identities whose dated team membership excludes the target', async () => {
    const fixture = availabilityFixture();
    fixture.rawInput.identities.find(identity => identity.espnId === 101)!.validTo = '2026-01-20T00:00:00Z';
    const { root } = await writeArchive(fixture);
    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, root);
    const affected = intelligence!.claims.filter(record => record.claim.playerIds.includes(101));
    expect(affected).toHaveLength(2);
    for (const record of affected) {
      expect(record).toMatchObject({ verification: 'UNVERIFIED', state: 'UNKNOWN' });
      expect(record.reasons).toContain('Player identity or dated team membership unverified.');
    }
    expect(assessNBAGameAvailability(fixture.snapshot, intelligence)).toMatchObject({
      startingLineupsVerified: false, impactReviewResolved: false });
  });

  it('cannot confirm custom official-team claims using only the default seed registry', async () => {
    const fixture = availabilityFixture();
    const { root } = await writeArchive(fixture, false);
    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, root);
    const lineups = intelligence!.claims.filter(record => record.claim.topic === 'LINEUP');
    expect(lineups).toHaveLength(2);
    for (const record of lineups) {
      expect(record).toMatchObject({ verification: 'UNVERIFIED', state: 'UNKNOWN' });
      expect(record.reasons).toContain('Source ownership or exact supporting span unverified.');
    }
    expect(intelligence!.claims.filter(record => record.claim.topic === 'INJURY')).toHaveLength(10);
    expect(assessNBAGameAvailability(fixture.snapshot, intelligence)).toMatchObject({
      injuriesVerified: true, startingLineupsVerified: false, impactReviewResolved: false });
  });

  it.each(['firstSeenAt', 'fetchedAt', 'publishedAt', 'updatedAt'] as const)
    ('rejects an official document with future %s at the current cutoff', async field => {
      const fixture = availabilityFixture();
      fixture.rawInput.documents[0][field] = '2026-01-21T18:00:01Z';
      const { root } = await writeArchive(fixture);
      const intelligence = await loadNBAGameIntelligence(fixture.snapshot, root);
      const injuries = intelligence!.claims.filter(record => record.claim.topic === 'INJURY');
      expect(injuries).toHaveLength(10);
      expect(assessNBAGameAvailability(fixture.snapshot, intelligence)).toMatchObject({
        injuriesVerified: false, startingLineupsVerified: true, impactReviewResolved: false });
      expect([...new Set(injuries.map(record => record.state))]).toEqual(['AFTER_CUTOFF']);
    });

  it('rejects a rebuilt snapshot observed after the current prediction time', async () => {
    const fixture = availabilityFixture();
    const { root } = await writeArchive(fixture);
    fixture.snapshot.asOf = '2026-01-21T18:00:01Z';
    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, root);
    expect(intelligence!.claims.every(record => record.state === 'CURRENT')).toBe(true);
    const result = assessNBAGameAvailability(fixture.snapshot, intelligence, availabilityTime);
    expect(result).toMatchObject({ intelligenceSnapshotId: null, injuriesVerified: false,
      startingLineupsVerified: false, impactReviewResolved: false });
    expect(result.blockers).toContain('No cutoff-safe, exact-game Agent #2 intelligence snapshot.');
  });

  it('does not substitute a cached future snapshot for rebuilding unsafe archived documents', async () => {
    const fixture = availabilityFixture();
    fixture.rawInput.documents[0].firstSeenAt = '2026-01-21T18:00:01Z';
    const { root, store } = await writeArchive(fixture);
    await store.putSnapshot({ ...fixture.intelligence, snapshotId: 'future-cached-snapshot',
      asOf: '2026-01-21T18:00:01Z', cutoff: '2026-01-21T18:00:01Z' });
    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, root);
    expect(intelligence!.snapshotId).not.toBe('future-cached-snapshot');
    expect(intelligence!.asOf).toBe(new Date(availabilityTime).toISOString());
    expect(assessNBAGameAvailability(fixture.snapshot, intelligence)).toMatchObject({
      injuriesVerified: false, impactReviewResolved: false });
  });

  it('blocks a fresh secondary context conflict without replacing official availability', async () => {
    const fixture = availabilityFixture();
    const source = { ...fixture.snapshot.target.source, id: 'fresh-secondary-injuries',
      publishedAt: '2026-01-21T17:50:00Z', updatedAt: null, fetchedAt: '2026-01-21T17:55:00Z', freshness: 'FRESH' as const };
    fixture.snapshot.injuryFeed = { state: 'AVAILABLE', source };
    fixture.snapshot.injuries = [{ playerId: 101, teamId: 1, status: 'OUT', rawStatus: 'Out', comment: null, source }];
    const { root } = await writeArchive(fixture);
    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, root);
    const result = assessNBAGameAvailability(fixture.snapshot, intelligence);
    expect(result).toMatchObject({ injuriesVerified: true, startingLineupsVerified: true,
      conflictsResolved: false, impactReviewResolved: false, numericAdjustmentsApplied: false });
    expect(result.teams[0].players.find(player => player.playerId === 101)).toMatchObject({
      status: 'AVAILABLE', secondaryStatus: 'OUT', starter: 'CONFIRMED', sourceIds: [source.id] });
    expect(result.blockers).toContain('Team 1, player 101: fresh secondary OUT conflicts with AVAILABLE; review required.');
  });

  it.each(['healthy', 'missing'] as const)('handles an unavailable secondary feed with %s official coverage', async scenario => {
    const fixture = availabilityFixture(scenario);
    fixture.snapshot.injuryFeed = { state: 'UNAVAILABLE', source: null };
    fixture.snapshot.injuries = [];
    const { root } = await writeArchive(fixture);
    const intelligence = await loadNBAGameIntelligence(fixture.snapshot, root);
    const result = assessNBAGameAvailability(fixture.snapshot, intelligence);
    expect(result.startingLineupsVerified).toBe(true);
    expect(result.injuriesVerified).toBe(scenario === 'healthy');
    expect(result.impactReviewResolved).toBe(scenario === 'healthy');
    expect(result.teams.flatMap(team => team.players).every(player => player.secondaryStatus === null)).toBe(true);
    if (scenario === 'missing') {
      expect(result.teams[1].report).toBe('MISSING');
      expect(result.teams[1].players.every(player => player.status === 'NOT_REPORTED')).toBe(true);
      expect(result.blockers).toContain('Team 2: official target-game injury report missing; missing reports do not imply availability.');
    } else expect(result.blockers).toEqual([]);
  });
});