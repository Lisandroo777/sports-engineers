import { afterEach, expect, it, vi } from 'vitest';
import { verifyLedger } from './verify-production-ledger.mjs';
import { signPresentationReceipt, verifyPresentationReceipt } from '../lib/nfl/predictionLedger/security';
import { captureAcknowledgedNFLRows } from '../lib/nfl/predictionLedger/capture';
import { redisNFLLedgerRepository } from '../lib/nfl/predictionLedger/redisStore';
import type { NFLPredictionRecord, NFLPredictionSnapshot } from '../lib/nfl/predictionLedger/types';

const records = vi.hoisted(() => new Map<string, NFLPredictionRecord>());
vi.mock('../lib/nfl/predictionLedger/redisStore', () => ({ redisNFLLedgerRepository: {
  capture: async (snapshot: NFLPredictionSnapshot) => {
    const existing = [...records.values()].find(row => row.snapshot.dedupeFingerprint === snapshot.dedupeFingerprint);
    if (existing) return { created: false, record: existing };
    const record = { snapshot, currentGrade: 'PENDING', currentActual: null, currentRevisionId: null } as NFLPredictionRecord;
    records.set(snapshot.predictionId, record);
    return { created: true, record };
  },
  get: async (id: string) => records.get(id) ?? null,
  list: async () => [...records.values()],
} }));
afterEach(() => { vi.unstubAllEnvs(); records.clear(); });

it('exercises real signing and capture logic without logging tokens or fabricating a live prediction', async () => {
  vi.stubEnv('NFL_LEDGER_RECEIPT_SECRET', 'unit-test-only-signing-secret');
  await expect(verifyLedger({ sign: signPresentationReceipt, verify: verifyPresentationReceipt,
    capture: captureAcknowledgedNFLRows, repository: redisNFLLedgerRepository })).resolves.toEqual({
    signedReceipt: true, tamperRejected: true, durableCapture: true, duplicatePrevented: true,
  });
});