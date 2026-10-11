import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapshot, makeGradeRevision } from './core';
import { redisNFLLedgerRepository } from './redisStore';
import type { NFLLedgerCandidateInput } from './types';

function candidate(): NFLLedgerCandidateInput {
  return { candidateId: 'c', gameId: 'game', playerId: 4, player: 'Player', market: 'Passing Yards', marketKey: 'player_pass_yds', line: 200.5, direction: 'over',
    book: 'Book', odds: -110, projection: 220, trueProbability: 60, edge: 20, evPercent: 5, researchScore: 80, trapRisk: 10, pickTier: 'ELITE',
    game: { id: 'game', gameTime: '2026-10-11T17:00:00Z', season: 2026, week: 5, seasonType: 'REGULAR', completed: false } };
}
function snapshot(overrides: Partial<NFLLedgerCandidateInput> = {}) {
  return createSnapshot({ ...candidate(), ...overrides }, { presentedAt: '2026-10-07T12:00:00Z', researchSessionId: 's', rankingIntent: 'BEST', researchMode: 'DEEP',
    kickoff: { time: '2026-10-11T17:00:00Z', source: 'ESPN' } }, new Date('2026-10-07T12:01:00Z'));
}

function installRedis() {
  const data = new Map<string, string>();
  const sorted = new Map<string, Map<string, number>>();
  const addSorted = (key: string, member: string, score: number) => { const set = sorted.get(key) ?? new Map(); set.set(member, score); sorted.set(key, set); };
  const range = (key: string, start: number, stop: number, reverse: boolean) => {
    const rows = [...(sorted.get(key) ?? new Map()).entries()].sort((a, b) => reverse ? b[1] - a[1] : a[1] - b[1]).map(([member]) => member);
    const end = stop < 0 ? rows.length + stop + 1 : stop + 1;
    return rows.slice(start, end);
  };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as Array<string | number>;
    const op = String(command[0]);
    if (op === 'GET') return Response.json({ result: data.get(String(command[1])) ?? null });
    if (op === 'EVAL') {
      const count = Number(command[2]); const keys = command.slice(3, 3 + count).map(String); const args = command.slice(3 + count).map(String);
      if (String(command[1]).includes('local prior = redis.call')) {
        const existing = data.get(keys[0]);
        if (existing) return Response.json({ result: JSON.stringify({ record: JSON.parse(data.get(`${args[1]}${existing}`)!), snapshot: JSON.parse(data.get(`${args[0]}${existing}`)!) }) });
        const value = JSON.parse(args[2]);
        const prior = data.get(keys[1]); if (prior) value.lineageFromPredictionId = prior;
        const record = { currentGrade: 'PENDING', currentActual: null, currentRevisionId: null };
        data.set(keys[0], value.predictionId); data.set(`${args[0]}${value.predictionId}`, JSON.stringify(value));
        data.set(`${args[1]}${value.predictionId}`, JSON.stringify(record)); data.set(keys[1], value.predictionId);
        addSorted(keys[2], value.predictionId, Number(args[3])); addSorted(keys[3], `${value.gameId}|${value.playerId}`, Number(args[3]));
        return Response.json({ result: JSON.stringify({ record, snapshot: value }) });
      }
      const record = JSON.parse(data.get(keys[0])!);
      const revision = JSON.parse(args[1]);
      const current = record.currentRevisionId ? JSON.parse(data.get(`${args[0]}revision:${record.currentRevisionId}`) ?? 'null') : null;
      if (current?.sourceSignature === revision.sourceSignature && current?.grade === revision.grade && current?.actual === revision.actual) return Response.json({ result: JSON.stringify(record) });
      revision.supersedesRevisionId = record.currentRevisionId;
      data.set(`${args[0]}revision:${revision.revisionId}`, JSON.stringify(revision));
      addSorted(`${args[0]}revisions:${revision.predictionId}`, revision.revisionId, Number(args[2]));
      record.currentGrade = revision.grade; record.currentActual = revision.actual; record.currentRevisionId = revision.revisionId;
      const encoded = JSON.stringify(record); data.set(keys[0], encoded); return Response.json({ result: encoded });
    }
    if (op === 'ZREVRANGE' || op === 'ZRANGE') return Response.json({ result: range(String(command[1]), Number(command[2]), Number(command[3]), op === 'ZREVRANGE') });
    return Response.json({ error: `Unsupported ${op}` }, { status: 400 });
  }));
  return data;
}

let redisData = new Map<string, string>();
beforeEach(() => { process.env.KV_REST_API_URL = 'https://kv.test'; process.env.KV_REST_API_TOKEN = 'test'; redisData = installRedis(); });
afterEach(() => { delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; vi.unstubAllGlobals(); });

describe('atomic Redis NFL prediction repository', () => {
  it('deduplicates concurrent exact captures and preserves the first snapshot immutably', async () => {
    const input = snapshot();
    const results = await Promise.all([redisNFLLedgerRepository.capture(input), redisNFLLedgerRepository.capture({ ...input, predictionId: 'racing-id' })]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);
    const stored = await redisNFLLedgerRepository.get(results[0].record.snapshot.predictionId);
    expect(stored?.snapshot.predictionId).toBe(input.predictionId);
    expect(stored?.snapshot.line).toBe(200.5);
    expect(stored?.snapshot.americanOdds).toBe(-110);
  });

  it('stores changed line/price snapshots separately with explicit lineage', async () => {
    const first = await redisNFLLedgerRepository.capture(snapshot());
    const changed = await redisNFLLedgerRepository.capture(snapshot({ line: 201.5, odds: 105 }));
    expect(changed.created).toBe(true);
    expect(changed.record.snapshot.predictionId).not.toBe(first.record.snapshot.predictionId);
    expect(changed.record.snapshot.lineageFromPredictionId).toBe(first.record.snapshot.predictionId);
    expect((await redisNFLLedgerRepository.list({ limit: 10 })).length).toBe(2);
  });

  it('keeps snapshot bytes immutable while grading outcome state', async () => {
    const captured = await redisNFLLedgerRepository.capture(snapshot());
    const key = `nfl-ledger:v1:snapshot:${captured.record.snapshot.predictionId}`;
    const originalBytes = redisData.get(key);
    await redisNFLLedgerRepository.appendRevision(makeGradeRevision(captured.record.snapshot, 200.5, 'stat-hash'));
    expect(redisData.get(key)).toBe(originalBytes);
    expect((await redisNFLLedgerRepository.get(captured.record.snapshot.predictionId))?.currentGrade).toBe('PUSH');
  });
});
