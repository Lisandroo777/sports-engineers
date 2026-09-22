import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchSession, ResearchCandidateRecord } from '../ai/agent/session';

function candidate(overrides: Partial<ResearchCandidateRecord> = {}): ResearchCandidateRecord {
  return {
    candidateId: 'c1', rank: 1, playerId: 1, teamId: 1, player: 'Player', team: 'Team', opponent: 'Opponent',
    market: 'Passing Yards', marketKey: 'player_pass_yds', line: 250, direction: 'over', book: 'Book', odds: -110,
    availableBooks: 1, projection: 260, projectionUncertainty: 25, edge: 10,
    l5Rate: 60, l10Rate: 60, l20Rate: null, seasonRate: 60, researchScore: 90,
    signalAgreement: 5, signalsAvailable: 5, evidenceCoverage: 100, priceFreshness: 'FRESH', trueProbability: 60,
    evPercent: 5, isAlternate: false, dataQuality: 100, trapRisk: 5, qualification: 'ELITE', eliteQualified: true,
    rejectionReasons: [], grade: 'A', priceGrade: 'A', playerEdgePercent: null, priceEdgePercent: 5,
    breakEvenProbability: 52, projectedRange: null, bestAlternateLine: null, howItLoses: ['Risk'], evidenceBoard: [],
    outlierDependencePercent: null, position: 'qb', modelProbability: 60, historicalHitRate: 60,
    projectionReliability: 'MEDIUM', priceCurrent: true, valueQualified: true,
    crossBookThreshold: null, marketMovement: null, outlierAnalysis: null, roleContext: null, opponentContext: null,
    injuryContext: null, weatherContext: null,
    ...overrides,
  } as ResearchCandidateRecord;
}

function session(): ResearchSession {
  return {
    sport: 'nfl', date: '2026-09-21', queryIntent: 'test', generatedAt: new Date().toISOString(),
    toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1, eliteFound: 1, cached: false, dataFreshnessSeconds: null, budgetLimited: false },
    candidates: [candidate()],
  };
}

function installFakeRedis() {
  const store = new Map<string, string>();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body ?? '[]')) as Array<string | number>;
    const op = String(command[0]).toUpperCase();
    if (op === 'GET') return Response.json({ result: store.get(String(command[1])) ?? null });
    if (op === 'SET') { store.set(String(command[1]), String(command[2])); return Response.json({ result: 'OK' }); }
    if (op === 'DEL') { for (const key of command.slice(1)) store.delete(String(key)); return Response.json({ result: command.length - 1 }); }
    if (op === 'SCAN') {
      const pattern = String(command[command.indexOf('MATCH') + 1] ?? '*').replace(/\*$/, '');
      return Response.json({ result: ['0', [...store.keys()].filter((key) => key.startsWith(pattern))] });
    }
    return Response.json({ error: `unsupported ${op}` }, { status: 400 });
  }));
  return store;
}

beforeEach(() => {
  process.env.KV_REST_API_URL = 'https://example-kv.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  installFakeRedis();
});

afterEach(() => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('durable KV persistence adapters', () => {
  it('preserves a full ResearchSession across module reinitialization and supports follow-up ranking', async () => {
    const { saveResearchSession } = await import('../ai/agent/sessionStore');
    const id = await saveResearchSession(session());

    vi.resetModules();
    const { getResearchSession } = await import('../ai/agent/sessionStore');
    const { rankCachedSession } = await import('../ai/agent/runner');
    const restored = await getResearchSession(id);

    expect(restored?.candidates[0].candidateId).toBe('c1');
    expect(rankCachedSession(restored!, 'higher value', id)?.results).toHaveLength(1);
  });

  it('preserves Odds cache entries and stale entries across module reinitialization', async () => {
    const { writePersistentCache } = await import('../odds/persistentCache');
    await writePersistentCache('odds-key', { ok: true }, Date.now() + 60_000);
    await writePersistentCache('stale-key', { stale: true }, Date.now() - 1_000);

    vi.resetModules();
    const { readPersistentCache, readStalePersistentCache } = await import('../odds/persistentCache');

    expect((await readPersistentCache<{ ok: boolean }>('odds-key'))?.data.ok).toBe(true);
    expect(await readPersistentCache('stale-key')).toBeNull();
    expect((await readStalePersistentCache<{ stale: boolean }>('stale-key'))?.data.stale).toBe(true);
  });

  it('preserves Odds snapshots across module reinitialization', async () => {
    const parts = { eventId: 'event', player: 'Player', marketKey: 'market', line: 1.5, sportsbookKey: 'book', side: 'over' as const };
    const { recordSnapshot } = await import('../odds/snapshotStore');
    await recordSnapshot(parts, 120, 1000);

    vi.resetModules();
    const { getSnapshotHistory } = await import('../odds/snapshotStore');

    expect(await getSnapshotHistory(parts)).toEqual([{ odds: 120, timestamp: 1000 }]);
  });
});
