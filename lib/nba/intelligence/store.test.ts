import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryIntelligenceStore, createFileIntelligenceStore } from './store';
import { fixtureInput } from './fixtures';
import { buildNBAIntelligence } from './engine';

describe('append-only storage interfaces', () => {
  it('rejects record mutation and preserves detached memory records', async () => {
    const store = new MemoryIntelligenceStore(); const input = fixtureInput();
    await store.putDocument(input.documents[0]);
    await expect(store.putDocument({ ...input.documents[0], text: 'Mutated' })).rejects.toThrow('collision');
    expect(Object.isFrozen((await store.listDocuments())[0])).toBe(true);
  });
  it('persists revisions/claims/snapshots across store instances with atomic idempotent writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nba-intelligence-'));
    try {
      const store = createFileIntelligenceStore(directory); const input = fixtureInput(); const snapshot = buildNBAIntelligence(input);
      await Promise.all([store.putDocument(input.documents[0]), store.putDocument(input.documents[0])]);
      await store.putClaims(input.claims); await store.putSnapshot(snapshot);
      const reopened = createFileIntelligenceStore(directory);
      expect(await reopened.listDocuments()).toEqual(input.documents);
      expect(await reopened.listClaims()).toEqual(input.claims);
      expect(await reopened.latestSnapshot('100', '2026-10-07T22:01:00Z')).toEqual(snapshot);
      expect(await reopened.latestSnapshot('100', '2026-10-07T21:00:00Z')).toBeNull();
      await expect(reopened.putDocument({ ...input.documents[0], text: 'Changed' })).rejects.toThrow('collision');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('persists refresh reservations and Retry-After across process/store restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nba-intelligence-rates-'));
    try {
      const first = createFileIntelligenceStore(directory);
      expect(await first.reserveRefresh('source:url', '2026-10-07T22:00:00Z', 120000)).toBe(true);
      const second = createFileIntelligenceStore(directory);
      expect(await second.reserveRefresh('source:url', '2026-10-07T22:01:00Z', 120000)).toBe(false);
      await second.recordBackoff('source:url', '2026-10-07T22:10:00Z');
      expect(await createFileIntelligenceStore(directory).reserveRefresh('source:url', '2026-10-07T22:03:00Z', 120000)).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});