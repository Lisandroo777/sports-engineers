import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteResearchSession, getResearchSession, saveResearchSession } from './sessionStore';
import type { ResearchSession } from './session';

vi.mock('../../storage/kv', () => ({
  allowLocalPersistenceFallback: vi.fn(() => false),
  hasDurableKV: vi.fn(() => true),
  kvDel: vi.fn().mockResolvedValue(undefined),
  kvGetJson: vi.fn().mockResolvedValue(null),
  kvSetJson: vi.fn().mockResolvedValue(undefined),
}));

import { kvGetJson, kvSetJson } from '../../storage/kv';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

function largeSession(): ResearchSession {
  return {
    sport: 'nfl', sportFilter: 'NFL', sportFilterId: 'NFL_FILTER', sportFilterVersion: '1.0.0', date: '2026-10-05',
    queryIntent: 'Give me the best NFL props today.', generatedAt: '2026-10-05T16:00:00.000Z', scopeGameIds: null,
    toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 584, booksFound: 7, candidatesFound: 584, eliteFound: 3,
      cached: false, dataFreshnessSeconds: 0, budgetLimited: false, researchComplete: true },
    candidates: Array.from({ length: 584 }, (_, index) => ({ candidateId: `candidate-${index}`, rank: index + 1,
      playerId: index + 1, teamId: 18, player: 'Repeated Player Name', team: 'New Orleans Saints', opponent: 'Atlanta Falcons',
      market: 'Receiving Yards', marketKey: 'player_reception_yds', line: 64.5, direction: 'over', book: 'Book', odds: -110,
      availableBooks: 7, projection: 71.5, projectionUncertainty: 12, edge: 7, l5Rate: 60, l10Rate: 60, l20Rate: 55, seasonRate: 55,
      researchScore: 80, signalAgreement: 4, signalsAvailable: 6, evidenceCoverage: 90, priceFreshness: 'CURRENT', trueProbability: 62,
      evPercent: 10, isAlternate: false, dataQuality: 95, trapRisk: 10, qualification: 'REJECT', eliteQualified: false,
      rejectionReasons: ['Existing production gate'], grade: 'B', priceGrade: 'B', playerEdgePercent: 10, priceEdgePercent: 8,
      breakEvenProbability: 52.4, projectedRange: null, bestAlternateLine: null, howItLoses: ['Role evidence incomplete'],
      evidenceBoard: [], outlierDependencePercent: null, position: 'WR', modelProbability: 62, historicalHitRate: 60,
      projectionReliability: 'MEDIUM', priceCurrent: true, valueQualified: true, crossBookThreshold: null, marketMovement: null,
      outlierAnalysis: null, roleContext: { requirement: 'CRITICAL', status: 'STABLE', confidence: 'MEDIUM', workloadTrend: 'STABLE', reasons: [], evidence: [], unavailableEvidence: [] },
      opponentContext: null, injuryContext: null, weatherContext: null, gameId: 'game', eventId: 'event', retrievedAt: '2026-10-05T16:00:00.000Z',
      nflResearchProfile: { sportFilter: 'NFL_FILTER', sportFilterVersion: '1.0.0', repeatedEvidence: 'Same cached ESPN profile '.repeat(20) },
    } as never)),
  };
}

describe('durable NFL research session payload', () => {
  it('compresses the complete candidate pool below the KV payload limit and round-trips every candidate/profile', async () => {
    const persistedValues: Record<string, unknown>[] = [];
    vi.mocked(kvSetJson).mockImplementation(async (_key, value) => { persistedValues.push(value as Record<string, unknown>); });
    const session = largeSession();
    const plainSize = Buffer.byteLength(JSON.stringify(session));
    const id = await saveResearchSession(session);
    const persisted = persistedValues[0];
    expect(typeof persisted?.compressedSession).toBe('string');
    expect(persisted?.sessionEncoding).toBe('deflate-base64-v1');
    expect(persisted?.session).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(persisted))).toBeLessThan(1_000_000);
    expect(Buffer.byteLength(JSON.stringify(persisted)) * 5).toBeLessThan(plainSize);
    vi.mocked(kvGetJson).mockResolvedValue(persisted as never);
    const restored = await getResearchSession(id);
    expect(restored?.candidates).toHaveLength(584);
    expect(restored?.candidates[583].nflResearchProfile).toEqual(session.candidates[583].nflResearchProfile);
    expect(restored?.sportFilterVersion).toBe('1.0.0');
  });

  it('continues to read legacy uncompressed durable sessions', async () => {
    const session = largeSession();
    vi.mocked(kvGetJson).mockResolvedValue({ id: 'legacy', savedAt: Date.now(), expiresAt: Date.now() + 10000, session } as never);
    expect(await getResearchSession('legacy')).toEqual(session);
  });

  it('retains the opaque-ID deletion contract', async () => {
    await deleteResearchSession('session-id');
    expect((await import('../../storage/kv')).kvDel).toHaveBeenCalledWith('ai-session:session-id');
  });
});