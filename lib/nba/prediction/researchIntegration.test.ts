import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCachedNBAEventResearch } from './gameLines/cachedEventResearch';
import { acquireNBAResearchReceipt } from './researchAcquisition';
import { normalizeNBAResearchFilter } from '../researchMarkets';
import type { NBAResearchReceipt } from './researchReceipt';

const mocks = vi.hoisted(() => ({ receipt: null as NBAResearchReceipt | null, fetch: vi.fn() }));
vi.mock('../../odds/persistentCache', () => ({
  readPersistentCache: vi.fn(async (key: string) => key.startsWith('nba:research-receipt:') && mocks.receipt ? { key, data: mocks.receipt } : null),
  readStalePersistentCache: vi.fn(async () => null), writePersistentCache: vi.fn(),
}));
vi.mock('../players', () => ({ searchNBAPlayers: vi.fn(async () => []) }));
vi.mock('../stats', () => ({ getNBAPlayerGameLogs: vi.fn(async () => []) }));
vi.mock('../client', () => ({ espnNBASiteFetch: vi.fn(async () => ({ sports: [] })) }));

const directory = resolve('data/nba-v3/live-market-verification/2026-10-24T00-13-19.899Z');
beforeEach(() => { vi.useFakeTimers(); mocks.receipt = null; mocks.fetch.mockReset(); vi.stubGlobal('fetch', mocks.fetch); });
afterEach(() => { expect(mocks.fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('verified broad quote ingestion through real research cards', () => {
  it.skipIf(!existsSync(`${directory}/quotes.json`))('renders all 26 real contracts preserving price/provenance and never publishes predictions', async () => {
    const raw = JSON.parse(readFileSync(`${directory}/quotes.json`, 'utf8'));
    const report = JSON.parse(readFileSync(`${directory}/report.json`, 'utf8'));
    mocks.receipt = { ...raw, regions: ['us', 'us2'], requestedMarkets: report.requestedMarkets };
    vi.setSystemTime(new Date(raw.observedAt));
    const event = { id: raw.data.id, commenceTime: raw.data.commence_time, homeTeam: raw.data.home_team, awayTeam: raw.data.away_team };
    const cards = await loadCachedNBAEventResearch('2026-10-23', [event], normalizeNBAResearchFilter(undefined));
    expect(cards).toHaveLength(5989);
    expect(new Set(cards.map(card => card.subject.market.key)).size).toBe(26);
    for (const card of cards) {
      expect(card).toMatchObject({ tierDecision: null, trueProbability: null, modelProbability: null, evPercent: null, researchScore: null });
      expect(card.researchEvidence?.[0].detail).toContain('requested regions us,us2');
    }
    const selected = await loadCachedNBAEventResearch('2026-10-23', [event], normalizeNBAResearchFilter({ marketIds: ['player_assists_q1'], sides: ['under'] }));
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every(card => card.subject.kind === 'PLAYER_PROP' && card.subject.market.key === 'player_assists_q1' && card.subject.market.side === 'under')).toBe(true);
    expect(selected.every(card => card.researchEvidence?.[1].detail.includes('unavailable'))).toBe(true);
    const alternates = await loadCachedNBAEventResearch('2026-10-23', [event], normalizeNBAResearchFilter({ marketIds: ['alternate_spreads'] }));
    expect(alternates).toHaveLength(701);
    expect(alternates.every(card => card.subject.market.key === 'alternate_spreads')).toBe(true);
  });

  it('rejects paid acquisition without authorization before network access', async () => {
    vi.setSystemTime(new Date('2026-10-24T00:13:20Z'));
    await expect(acquireNBAResearchReceipt({ id: '49fc89a9696a9a20b658732b34ce61c4', commenceTime: '2026-10-24T01:40:00Z',
      homeTeam: 'San Antonio Spurs', awayTeam: 'Houston Rockets' }, ['player_points_q1'])).rejects.toThrow('NBA live research is disabled');
  });
});