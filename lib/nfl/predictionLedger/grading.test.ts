import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapshot } from './core';
import type { NFLGradeRevision, NFLPredictionRecord } from './types';

const state = vi.hoisted(() => ({ record: null as NFLPredictionRecord | null, revisions: [] as NFLGradeRevision[], logs: [] as Array<{ gameId: string; stats: Record<string, number> }> }));
const { scheduleMock, logsMock } = vi.hoisted(() => ({ scheduleMock: vi.fn(), logsMock: vi.fn() }));
vi.mock('./redisStore', () => ({ redisNFLLedgerRepository: {
  list: vi.fn(async () => state.record ? [state.record] : []),
  get: vi.fn(async () => state.record),
  revisions: vi.fn(async () => state.revisions),
  appendRevision: vi.fn(async (revision: NFLGradeRevision) => {
    const current = state.revisions.find((entry) => entry.revisionId === state.record?.currentRevisionId);
    if (current?.sourceSignature === revision.sourceSignature && current.grade === revision.grade && current.actual === revision.actual) return { created: false, record: state.record! };
    revision.supersedesRevisionId = state.record!.currentRevisionId;
    state.revisions.push(revision);
    state.record = { ...state.record!, currentGrade: revision.grade, currentActual: revision.actual, currentRevisionId: revision.revisionId };
    return { created: true, record: state.record };
  }),
} }));
vi.mock('../schedule', () => ({ getNFLSchedule: scheduleMock }));
vi.mock('../stats', () => ({ getPlayerGameLogs: logsMock }));

const kickoff = '2026-10-11T17:00:00Z';
function makeRecord(pregameStatus: NFLPredictionRecord['snapshot']['pregameStatus'] = 'PREGAME_VALID'): NFLPredictionRecord {
  const snapshot = createSnapshot({ candidateId: 'c', gameId: 'g', playerId: 7, player: 'Player', team: 'A', opponent: 'B', market: 'Passing Yards',
    marketKey: 'player_pass_yds', line: 250.5, direction: 'over', book: 'Book', odds: -110, projection: 260, trueProbability: 62,
    edge: 10, evPercent: 3, researchScore: 80, trapRisk: 15, pickTier: 'ELITE',
    game: { id: 'g', gameTime: kickoff, season: 2026, week: 6, seasonType: 'REGULAR', completed: false } },
  { presentedAt: '2026-10-07T12:00:00Z', researchSessionId: null, rankingIntent: 'BEST', researchMode: 'DEEP', kickoff: { time: kickoff, source: 'ESPN' } });
  snapshot.pregameStatus = pregameStatus;
  return { snapshot, currentGrade: 'PENDING', currentActual: null, currentRevisionId: null };
}

beforeEach(() => {
  state.record = makeRecord(); state.revisions = []; state.logs = [{ gameId: 'g', stats: { passingYards: 260, passingAttempts: 30 } }];
  scheduleMock.mockResolvedValue([{ id: 'g', gameTime: kickoff, completed: true }]);
  logsMock.mockImplementation(async () => state.logs);
  vi.clearAllMocks();
});

describe('automatic NFL grading', () => {
  it('grades from final ESPN stats against the saved line and is idempotent', async () => {
    const { runNFLAutomaticGrading } = await import('./grading');
    const first = await runNFLAutomaticGrading(new Date('2026-10-12T12:00:00Z'));
    const second = await runNFLAutomaticGrading(new Date('2026-10-12T13:00:00Z'));
    expect(first.changed).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(state.record?.currentGrade).toBe('WIN');
    expect(state.record?.currentActual).toBe(260);
    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0]).toMatchObject({ source: 'ESPN_PLAYER_GAMELOG', sourceGameId: 'g', gradingVersion: 'NFL_ESPN_GAMELOG_V1', grade: 'WIN' });
  });

  it('appends an auditable revision when an authoritative stat correction changes the grade', async () => {
    const { runNFLAutomaticGrading } = await import('./grading');
    await runNFLAutomaticGrading(new Date('2026-10-12T12:00:00Z'));
    const previousId = state.record?.currentRevisionId;
    state.logs = [{ gameId: 'g', stats: { passingYards: 240, passingAttempts: 30 } }];
    await runNFLAutomaticGrading(new Date('2026-10-13T12:00:00Z'));
    expect(state.revisions).toHaveLength(2);
    expect(state.revisions[0].grade).toBe('WIN');
    expect(state.revisions[1]).toMatchObject({ grade: 'LOSS', actual: 240, supersedesRevisionId: previousId });
    expect(state.record?.currentGrade).toBe('LOSS');
  });

  it('appends a new linked revision if the provider later restores an earlier authoritative value', async () => {
    const { runNFLAutomaticGrading } = await import('./grading');
    await runNFLAutomaticGrading(new Date('2026-10-12T12:00:00Z'));
    state.logs = [{ gameId: 'g', stats: { passingYards: 240, passingAttempts: 30 } }];
    await runNFLAutomaticGrading(new Date('2026-10-13T12:00:00Z'));
    state.logs = [{ gameId: 'g', stats: { passingYards: 260, passingAttempts: 30 } }];
    await runNFLAutomaticGrading(new Date('2026-10-14T12:00:00Z'));
    expect(state.revisions.map((revision) => revision.grade)).toEqual(['WIN', 'LOSS', 'WIN']);
    expect(state.revisions[2].supersedesRevisionId).toBe(state.revisions[1].revisionId);
  });

  it('treats missing final stats as UNGRADABLE, not zero, and can later correct them', async () => {
    const { runNFLAutomaticGrading } = await import('./grading');
    state.logs = [{ gameId: 'g', stats: { passingAttempts: 0 } }];
    await runNFLAutomaticGrading(new Date('2026-10-12T12:00:00Z'));
    expect(state.record?.currentGrade).toBe('UNGRADABLE');
    expect(state.record?.currentActual).toBeNull();
    expect(state.revisions[0].reason).toMatch(/no zero was inferred/);
    state.logs = [{ gameId: 'g', stats: { passingYards: 251, passingAttempts: 30 } }];
    await runNFLAutomaticGrading(new Date('2026-10-13T12:00:00Z'));
    expect(state.record?.currentGrade).toBe('WIN');
    expect(state.revisions).toHaveLength(2);
  });

  it('leaves feed errors pending and excludes non-pregame records', async () => {
    const { runNFLAutomaticGrading } = await import('./grading');
    logsMock.mockRejectedValueOnce(new Error('feed unavailable'));
    const retryable = await runNFLAutomaticGrading();
    expect(retryable.pending).toBe(1);
    expect(retryable.sourceErrors).toHaveLength(1);
    state.record = makeRecord('POST_KICKOFF');
    const excluded = await runNFLAutomaticGrading();
    expect(excluded.skippedIneligible).toBe(1);
    expect(state.record?.currentGrade).toBe('PENDING');
    state.record = makeRecord();
    state.record.currentGrade = 'VOID';
    const voidRun = await runNFLAutomaticGrading();
    expect(voidRun.skippedIneligible).toBe(1);
  });

  it('requires a specific audit reason for operator VOID and preserves disposition provenance', async () => {
    const { appendOperatorDisposition } = await import('./grading');
    await expect(appendOperatorDisposition({ predictionId: 'prediction', grade: 'VOID', reason: 'too short' })).rejects.toThrow(/audit reason/i);
    const result = await appendOperatorDisposition({ predictionId: state.record!.snapshot.predictionId, grade: 'VOID',
      reason: 'Official operator review confirmed the book voided this wager.' }, new Date('2026-10-12T12:00:00Z'));
    expect(result.record.currentGrade).toBe('VOID');
    expect(state.revisions[0]).toMatchObject({ source: 'OPERATOR_ADJUDICATION', grade: 'VOID', sourceGameId: 'g',
      gradingVersion: 'NFL_LEDGER_OPERATOR_V1', reason: 'Official operator review confirmed the book voided this wager.' });
  });
});
