import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source } from './fixtures.spec.helper';
import { runAgentTurn, toClientResult } from '../lib/ai/agent/runner';
import { runNFLFinderDeepSearch } from '../lib/finder/nflEngine';
import { interpretWithLanguageModel } from './modelInterpretation';
import { emptyIntent } from './intent';
import type { ResearchSession, ResearchCandidateRecord } from '../lib/ai/agent/session';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../lib/ai/agent/sessionStore', () => ({ getResearchSession: vi.fn(async (id: string) => store.get(id) ?? null),
  saveResearchSession: vi.fn(async (session: unknown) => { const id = `session-${store.size}`; store.set(id, structuredClone(session)); return id; }) }));
vi.mock('../lib/finder/nflEngine', async (original) => ({ ...await original<typeof import('../lib/finder/nflEngine')>(), runNFLFinderDeepSearch: vi.fn() }));
const snapshotSession = (): ResearchSession => ({ sport: 'nfl', date: '2026-10-05', generatedAt: source.snapshotTime, queryIntent: '',
  candidates: source.outputs.filter((row: { researchMode: string }) => row.researchMode === 'DEEP').map((row: { record: ResearchCandidateRecord }) => structuredClone(row.record)),
  toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 7, booksFound: 1, candidatesFound: 7, eliteFound: 5, cached: true, dataFreshnessSeconds: 0, budgetLimited: false, researchComplete: true },
});
beforeEach(() => {
  vi.clearAllMocks(); store.clear(); store.set('seed', snapshotSession()); vi.useFakeTimers(); vi.setSystemTime(new Date(source.snapshotTime));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Provider calls disabled in communication execution tests')));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Actual chat-turn intent execution, saved archived quotes', () => {
  it.each([['Give me the best 5 NFL plays', 5], ['Give me the safest 3', 3], ['Give me the best value 3', 3],
    ['Give me a 2 man', 2], ['Give me the best 3 Unders', 0], ['Anything for Chris Olave?', 2], ['Give me your favorite', 1]])('returns requested cards for %s', async (query, count) => {
    const result = await runAgentTurn([{ role: 'user', content: query }], 'seed');
    expect(result.results).toHaveLength(count);
    expect(result.toolTrace).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    expect(toClientResult(result, true).meta).not.toHaveProperty('intentDebug');
  });
  it('executes the exact five-turn sequence preserving filters and the first reference', async () => {
    let id: string | null = 'seed';
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const queries = ['Give me the best 5', 'overs only', 'make it 2', 'most likely', 'deep research the first one'];
    const results = [];
    for (const query of queries) {
      history.push({ role: 'user', content: query });
      const result = await runAgentTurn(history, id);
      id = result.researchSessionId;
      results.push(result);
      history.push({ role: 'assistant', content: result.reply });
    }
    expect(results.map((result) => result.results.length)).toEqual([5, 5, 2, 2, 1]);
    const firstSafe = results[3].results[0] as ResearchCandidateRecord;
    const deep = results[4].results[0] as ResearchCandidateRecord;
    expect(deep.candidateId).toBe(firstSafe.candidateId);
    expect(deep.nflResearchProfile?.researchMode).toBe('DEEP');
    expect(results.slice(1).flatMap((result) => result.results).every((row) => (row as ResearchCandidateRecord).direction === 'over')).toBe(true);
    expect(fetch).not.toHaveBeenCalled(); expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
  });
  it('explains a referenced play without researching the slate again', async () => {
    const first = await runAgentTurn([{ role: 'user', content: 'Give me your favorite' }], 'seed');
    const explanation = await runAgentTurn([{ role: 'user', content: "What's the risk?" }], first.researchSessionId);
    expect(explanation.reply).toContain('Main risk:');
    expect(explanation.results).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled(); expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
  });
  it('explains expired stored research without presenting a current card or refreshing', async () => {
    const first = await runAgentTurn([{ role: 'user', content: 'Give me your favorite' }], 'seed');
    vi.setSystemTime(new Date(Date.parse(source.snapshotTime) + 7200000));
    const result = await runAgentTurn([{ role: 'user', content: 'Why do you like number 1?' }], first.researchSessionId);
    expect(result.reply).toContain('stored research, not a current verified recommendation');
    expect(result.results).toEqual([]);
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
  });
  it('answers betting capabilities and refuses to invent previous settlements', async () => {
    for (const query of ['What sports do you support?', 'What are your supported markets?', 'What are the results of previous picks?']) {
      const result = await runAgentTurn([{ role: 'user', content: query }], 'seed');
      expect(result.results).toEqual([]);
      expect(result.reply.length).toBeGreaterThan(20);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('compares distinct named players with the requested dimension', async () => {
    const result = await runAgentTurn([{ role: 'user', content: 'Compare Olave and Johnson — which has more value?' }], 'seed');
    expect(new Set(result.results.map((row) => (row as ResearchCandidateRecord).player)).size).toBe(2);
    expect(result.reply).toContain('stronger value');
  });
  it('does not suggest started/final games in a pregame request', async () => {
    const session = snapshotSession();
    session.toolMeta.nflLedger = { researchComplete: true, games: [{ gameId: session.candidates[0].gameId, eligibility: 'STARTED', kickoff: '2026-10-05T12:00:00Z' }] } as never;
    store.set('seed', session);
    const result = await runAgentTurn([{ role: 'user', content: 'Anything left tonight?' }], 'seed');
    expect(result.results).toEqual([]);
    expect(result.reply).toContain('pregame');
  });
  it('refuses unrelated requests and explains unsupported game markets honestly', async () => {
    const out = await runAgentTurn([{ role: 'user', content: 'Write Python code for a calculator' }], 'seed');
    expect(out.reply).toContain('sports-betting research');
    const unsupported = await runAgentTurn([{ role: 'user', content: 'Give me NFL moneylines' }], 'seed');
    expect(unsupported.results).toEqual([]);
    expect(unsupported.reply).toContain('cannot supply a verified pick');
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe('Constrained intent-only language model', () => {
  it('cannot override explicit user dimensions, invent candidate IDs, or elevate research depth', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ requestedCount: 15,
      rankingIntent: 'BEST_VALUE', researchMode: 'DEEP', referenceIds: ['invented'], candidates: [{ player: 'Invented' }] }) }] }] }) } as Response);
    const base = { ...emptyIntent(), sport: 'nfl' as const, requestedCount: 2, changedDimensions: ['requestedCount'] };
    const result = await interpretWithLanguageModel('Suggest a pair with value', base, 'test-placeholder', 'test-model');
    expect(result.requestedCount).toBe(2);
    expect(result.rankingIntent).toBe('BEST_VALUE');
    expect(result.researchMode).toBe('STANDARD');
    expect(result.referenceIds).toEqual([]);
    expect(result).not.toHaveProperty('candidates');
  });
});