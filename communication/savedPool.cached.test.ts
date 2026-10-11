import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { loadEnvConfig } from '@next/env';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { ResearchSession, ResearchCandidateRecord } from '../lib/ai/agent/session';
import { runAgentTurn, toClientResult } from '../lib/ai/agent/runner';
import { runNFLFinderDeepSearch } from '../lib/finder/nflEngine';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../lib/ai/agent/sessionStore', () => ({ getResearchSession: vi.fn(async (id: string) => store.get(id) ?? null),
  saveResearchSession: vi.fn(async (session: unknown) => { const id = `communication-replay-${store.size}`; store.set(id, structuredClone(session)); return id; }) }));
vi.mock('../lib/finder/nflEngine', async (original) => ({ ...await original<typeof import('../lib/finder/nflEngine')>(), runNFLFinderDeepSearch: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe.skipIf(process.env.DEEPSIDE_COMMUNICATION_REPLAY !== '1')('Actual full saved-pool conversational responses', () => {
  it('executes A–J at archived time with zero paid/provider research calls', async () => {
    loadEnvConfig(process.cwd());
    let session: ResearchSession;
    let readOnlyKVRequests = 0;
    if (existsSync('.cache/deepside-communication/pool.json')) session = JSON.parse(readFileSync('.cache/deepside-communication/pool.json', 'utf8'));
    else {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error('Local read-only KV environment required');
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(['GET', 'ai-session:52de806b-f3e6-4cf9-a1a4-4c3a9344bfe7']) });
    if (!response.ok) throw new Error('Saved session read failed');
    const payload = await response.json() as { result: string };
    if (!payload.result) throw new Error('Saved candidate pool expired');
    const saved = JSON.parse(payload.result) as { session?: ResearchSession; compressedSession?: string };
    session = saved.session ?? JSON.parse(inflateSync(Buffer.from(saved.compressedSession!, 'base64')).toString());
    readOnlyKVRequests = 1;
    mkdirSync('.cache/deepside-communication', { recursive: true });
    writeFileSync('.cache/deepside-communication/pool.json', JSON.stringify(session));
    }
    store.set('seed', session);
    vi.useFakeTimers(); vi.setSystemTime(new Date(session.generatedAt));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network calls forbidden after one read-only GET')));
    const records: unknown[] = [];
    const requests = [
      ['A', 'Give me the best 5 NFL plays', 5], ['B', 'Give me the safest 3', 3], ['C', 'Give me the best value 3', 3],
      ['D', 'Give me low-threshold receiving plays', 15], ['E', 'Give me Elite only', 15], ['F', 'Give me a 2 man', 2],
      ['G', 'Give me the best 3 Unders', 3], ['H', 'Anything for Chris Olave?', 15],
    ] as const;
    let firstId: string | null = null;
    async function turn(label: string, query: string, id: string | null, ceiling: number) {
      const result = await runAgentTurn([{ role: 'user', content: query }], id);
      const debug = result.meta?.intentDebug as { intent: { researchMode: string }; beforeFilters: number; afterFilters: number; returned: number; constraintsSatisfied: boolean };
      expect(debug).toBeDefined();
      expect(debug.constraintsSatisfied).toBe(true);
      expect(result.results.length).toBeLessThanOrEqual(ceiling);
      const cards = result.results as ResearchCandidateRecord[];
      expect(cards.every((row) => row.pickTier !== 'PASS')).toBe(true);
      expect(toClientResult(result, true).meta).not.toHaveProperty('intentDebug');
      const entry = { label, query, archivedSnapshotOnly: true, snapshotTime: session.generatedAt, interpretedIntent: debug.intent,
        candidateCountBeforeFilters: debug.beforeFilters, candidateCountAfterFilters: debug.afterFilters,
        returnedCount: cards.length, tiersReturned: cards.map((row) => row.pickTier), constraintsSatisfied: debug.constraintsSatisfied,
        reply: result.reply, cards: cards.map((row) => ({ player: row.player, market: row.marketKey, side: row.direction,
          line: row.line, price: row.odds, tier: row.pickTier, probability: row.trueProbability, edge: row.priceEdgePercent, ev: row.evPercent,
          researchMode: row.nflResearchProfile?.researchMode })) };
      console.info(JSON.stringify(entry)); records.push(entry);
      expect(fetch).not.toHaveBeenCalled();
      expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
      for (const storedId of store.keys()) {
        if (storedId !== 'seed' && storedId !== firstId && storedId !== result.researchSessionId) store.delete(storedId);
      }
      vi.clearAllMocks();
      return result;
    }
    for (const [label, query, ceiling] of requests) {
      const result = await turn(label, query, 'seed', ceiling);
      if (label === 'A') firstId = result.researchSessionId;
    }
    await turn('I', 'Deep research the best one', firstId, 1);
    let id: string | null = 'seed';
    for (const [index, query] of ['Give me the best 5', 'overs only', 'make it 2', 'most likely', 'deep research the first one'].entries()) {
      const result = await turn(`J${index + 1}`, query, id, index < 2 ? 5 : index < 4 ? 2 : 1);
      id = result.researchSessionId;
    }
    for (const [index, query] of [
      'Give me the best picks.', 'Give me the safest picks.', 'Give me the most likely 3.',
      'Give me the best value.', 'Give me low-threshold plays.', 'Give me the safest low-threshold plays.',
      'Give me the best 3 receiving-yard Overs.', 'Give me Unders.', 'Give me plus-money plays.',
      'Give me Elite plays.', 'Any Nukes?', 'Give me a 2 man.', 'What do you like for Olave?',
      'Give me the most value.', "Where's the edge?", 'What do you trust the most?',
      'Give me 2 low passing lines.', 'Give me the safest Elite plays.',
      'Give me the best 2.', 'Give me a 3 man.',
    ].entries()) {
      const result = await turn(`Natural${index + 1}`, query, 'seed', /most likely 3|best 3|3 man/.test(query) ? 3 : /2 man|2 low|best 2/.test(query) ? 2 : 15);
      const cards = result.results as ResearchCandidateRecord[];
      const intent = (result.meta?.intentDebug as { intent: { researchMode: string; rankingIntent: string; requestedTiers: string[] } }).intent;
      expect(intent.researchMode).toBe('STANDARD');
      if (/receiving-yard/.test(query)) expect(cards.every((row) => row.marketKey === 'player_reception_yds' && row.direction === 'over')).toBe(true);
      if (/Unders/.test(query)) expect(cards.every((row) => row.direction === 'under')).toBe(true);
      if (/plus-money/.test(query)) expect(cards.every((row) => row.odds != null && row.odds >= 100)).toBe(true);
      if (/Elite/.test(query)) expect(cards.every((row) => row.pickTier === 'ELITE')).toBe(true);
      if (/Nukes/.test(query)) expect(cards.every((row) => row.pickTier === 'NUKE')).toBe(true);
      if (/Olave/.test(query)) expect(cards.every((row) => row.player === 'Chris Olave')).toBe(true);
      if (/best 2/.test(query)) expect(cards).toHaveLength(2);
      if (/3 man/.test(query)) {
        expect(cards).toHaveLength(3);
        expect(new Set(cards.map((row) => row.player)).size).toBe(3);
      }
      if (/safest|most likely|trust/.test(query)) expect(cards.map((row) => row.trueProbability)).toEqual(cards.map((row) => row.trueProbability).sort((first, second) => second! - first!));
      if (/value|edge/.test(query)) expect(cards.map((row) => row.evPercent)).toEqual(cards.map((row) => row.evPercent).sort((first, second) => second! - first!));
    }
    let followUpId: string | null = 'seed';
    let firstDisplayedId: string | null = null;
    for (const [index, query] of ['Give me the best 5 NFL plays.', 'Only receiving.', 'Give me the safest 2.', 'Deep research the first one.'].entries()) {
      const result = await turn(`SimpleFollowUp${index + 1}`, query, followUpId, index < 2 ? 5 : index === 2 ? 2 : 1);
      const cards = result.results as ResearchCandidateRecord[];
      if (index >= 1) expect(cards.every((row) => row.marketKey.startsWith('player_reception'))).toBe(true);
      if (index === 2) firstDisplayedId = cards[0]?.candidateId ?? null;
      if (index === 3) {
        expect(cards).toHaveLength(1);
        expect(cards[0].candidateId).toBe(firstDisplayedId);
        expect(cards[0].nflResearchProfile?.researchMode).toBe('DEEP');
      }
      followUpId = result.researchSessionId;
    }
    const initial = await turn('GameContext', 'Give me the best 5 NFL plays.', 'seed', 5);
    const gameResult = await turn('ThisGame', 'Give me the best plays from this game.', initial.researchSessionId, 5);
    const allowedGames = new Set((initial.results as ResearchCandidateRecord[]).map((row) => row.gameId));
    expect((gameResult.results as ResearchCandidateRecord[]).every((row) => allowedGames.has(row.gameId))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    mkdirSync('.cache/deepside-communication', { recursive: true });
    writeFileSync('.cache/deepside-communication/saved-responses.json', JSON.stringify({ archivedSnapshotOnly: true, readOnlyKVRequests,
      sportsbookRefreshes: 0, paidCredits: 0, responses: records }, null, 2));
  }, 30000);
});