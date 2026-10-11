import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueNFLPresentationReceipt, captureAcknowledgedNFLRows } from './capture';
import type { NFLLedgerCandidateInput, NFLPredictionRecord } from './types';

const { captureMock, scheduleMock } = vi.hoisted(() => ({ captureMock: vi.fn(), scheduleMock: vi.fn() }));
vi.mock('./redisStore', () => ({ redisNFLLedgerRepository: { capture: captureMock } }));
vi.mock('../schedule', () => ({ getNFLSchedule: scheduleMock }));

const kickoff = '2026-10-11T17:00:00Z';
function candidate(overrides: Partial<NFLLedgerCandidateInput> = {}): NFLLedgerCandidateInput {
  return { candidateId: 'candidate-1', gameId: 'game-1', playerId: 12, player: 'Player One', teamId: 1, team: 'Home', opponent: 'Away',
    market: 'Passing Yards', marketKey: 'player_pass_yds', line: 230.5, direction: 'over', book: 'Book', odds: -115, projection: 250,
    trueProbability: 63, modelProbability: 61, edge: 19.5, evPercent: 8, researchScore: 90, trapRisk: 12, pickTier: 'NUKE',
    nflResearchProfile: { researchMode: 'STANDARD', sportFilterVersion: '1.0.0' }, ...overrides };
}

beforeEach(() => {
  process.env.NFL_LEDGER_RECEIPT_SECRET = 'test-receipt-secret';
  scheduleMock.mockResolvedValue([{ id: 'game-1', gameTime: kickoff, season: 2026, week: 6, seasonType: 'REGULAR', completed: false }]);
  captureMock.mockImplementation(async (snapshot) => ({ created: true, record: { snapshot, currentGrade: 'PENDING', currentActual: null, currentRevisionId: null } as NFLPredictionRecord }));
  vi.clearAllMocks();
});

describe('NFL display receipts and capture', () => {
  it('signs only the final NFL result set and captures acknowledged rendered rows', async () => {
    const issuedAt = new Date('2026-10-07T12:00:00Z');
    const token = await issueNFLPresentationReceipt({ results: [candidate()], meta: { sport: 'nfl', date: '2026-10-11', researchMode: 'STANDARD' },
      researchSessionId: 'session-1', rankingIntent: 'MOST_LIKELY', now: issuedAt });
    expect(token).toBeTruthy();
    const result = await captureAcknowledgedNFLRows(token!, ['candidate-1'], new Date('2026-10-07T12:00:01Z'));
    expect(result.created).toBe(1);
    expect(captureMock).toHaveBeenCalledOnce();
    expect(captureMock.mock.calls[0][0]).toMatchObject({ gameKickoff: '2026-10-11T17:00:00.000Z', kickoffSource: 'ESPN_SCOREBOARD', week: 6,
      rankingIntent: 'MOST_LIKELY', researchMode: 'STANDARD', pregameStatus: 'PREGAME_VALID', americanOdds: -115 });
  });

  it('rejects tampered receipts and candidate IDs not included in the signed display set', async () => {
    const token = await issueNFLPresentationReceipt({ results: [candidate()], meta: { sport: 'nfl', date: '2026-10-11' },
      researchSessionId: null, rankingIntent: 'BEST', now: new Date('2026-10-07T12:00:00Z') });
    const tampered = `${token!.startsWith('A') ? 'B' : 'A'}${token!.slice(1)}`;
    await expect(captureAcknowledgedNFLRows(tampered, ['candidate-1'], new Date('2026-10-07T12:00:01Z'))).rejects.toThrow(/receipt/i);
    await expect(captureAcknowledgedNFLRows(token!, ['forged-id'], new Date('2026-10-07T12:00:01Z'))).rejects.toThrow(/not included/i);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('marks post-kickoff presentation and unverified schedules ineligible for the pregame record', async () => {
    let token = await issueNFLPresentationReceipt({ results: [candidate()], meta: { sport: 'nfl', date: '2026-10-11' }, researchSessionId: null,
      rankingIntent: 'BEST', now: new Date('2026-10-11T17:01:00Z') });
    await captureAcknowledgedNFLRows(token!, ['candidate-1'], new Date('2026-10-11T17:01:01Z'));
    expect(captureMock.mock.calls[0][0].pregameStatus).toBe('POST_KICKOFF');
    captureMock.mockClear(); scheduleMock.mockRejectedValueOnce(new Error('offline'));
    token = await issueNFLPresentationReceipt({ results: [candidate()], meta: { sport: 'nfl', date: '2026-10-11' }, researchSessionId: null,
      rankingIntent: 'BEST', now: new Date('2026-10-07T12:00:00Z') });
    await captureAcknowledgedNFLRows(token!, ['candidate-1'], new Date('2026-10-07T12:00:01Z'));
    expect(captureMock.mock.calls[0][0].pregameStatus).toBe('KICKOFF_UNVERIFIED');
  });
});
