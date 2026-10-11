import { describe, expect, it } from 'vitest';
import { NBA_INTELLIGENCE_SCHEMA_VERSION, NBA_MODEL_VERSION, NBA_RESEARCH_CONTEXT_SCHEMA_VERSION, nbaModelVersionMetadata } from './version';
import { evaluateNBAForwardValidation } from './validation';

describe('NBA model identity and Agent #2 context boundary', () => {
  it('creates explicit unvalidated model metadata without assuming an external context contract', () => {
    expect(nbaModelVersionMetadata()).toMatchObject({ modelVersion: 'NBA_MODEL_V1', validationStatus: 'UNVALIDATED',
      probabilityCalibration: 'OFFLINE_ONLY', researchContextSchemaVersion: NBA_RESEARCH_CONTEXT_SCHEMA_VERSION,
      intelligenceSchemaVersion: NBA_INTELLIGENCE_SCHEMA_VERSION });
    expect(NBA_MODEL_VERSION).toBe('NBA_MODEL_V1');
  });
});

describe('NBA chronological offline validation', () => {
  it('excludes synthetic/reconstructed and post-prediction-time-invalid rows from holdout metrics', () => {
    const forward = Array.from({ length: 10 }, (_, index) => ({ slateId: `slate-${index}`, modelVersion: 'NBA_MODEL_V1', origin: 'FORWARD_SETTLED' as const,
      predictedAt: `2025-01-${String(index + 1).padStart(2, '0')}T12:00:00Z`, settledAt: `2025-01-${String(index + 1).padStart(2, '0')}T23:00:00Z`,
      probability: 0.6, grade: index % 2 === 0 ? 'WIN' as const : 'LOSS' as const }));
    const report = evaluateNBAForwardValidation([...forward,
      { ...forward[0], origin: 'SYNTHETIC_FIXTURE' as const }, { ...forward[1], settledAt: forward[1].predictedAt },
      { ...forward[2], modelVersion: 'OTHER_MODEL' }, { ...forward[0], grade: 'PUSH' as const }, { ...forward[1], grade: 'VOID' as const }]);
    expect(report.eligibleForwardSample).toBe(10);
    expect(report.chronologicalDevelopmentSample).toBe(7);
    expect(report.chronologicalDevelopmentSlates).toBe(7);
    expect(report.chronologicalHoldoutSample).toBe(3);
    expect(report.chronologicalHoldoutSlates).toBe(3);
    expect(report.brierScore).toBeCloseTo(0.2933333333);
    expect(report.validationStatus).toBe('UNVALIDATED');
    expect(report.fittingAllowed).toBe(false);
  });

  it('excludes PUSH and VOID outcomes from binary calibration samples', () => {
    const base = { slateId: 'slate-1', modelVersion: 'NBA_MODEL_V1', origin: 'FORWARD_SETTLED' as const, predictedAt: '2025-01-01T12:00:00Z',
      settledAt: '2025-01-01T23:00:00Z', probability: 0.7 };
    const report = evaluateNBAForwardValidation([{ ...base, grade: 'PUSH' as const }, { ...base, grade: 'VOID' as const },
      { ...base, grade: 'UNGRADABLE' as const }]);
    expect(report.eligibleForwardSample).toBe(0);
    expect(report.brierScore).toBeNull();
  });

  it('never splits same-slate correlated recommendations across chronological partitions', () => {
    const rows = Array.from({ length: 10 }, (_, slate) => Array.from({ length: 3 }, (_, pick) => ({
      slateId: `slate-${slate}`, modelVersion: 'NBA_MODEL_V1', origin: 'FORWARD_SETTLED' as const,
      predictedAt: `2025-02-${String(slate + 1).padStart(2, '0')}T12:${String(pick).padStart(2, '0')}:00Z`,
      settledAt: `2025-02-${String(slate + 1).padStart(2, '0')}T23:00:00Z`, probability: 0.65, grade: 'WIN' as const,
    }))).flat();
    const report = evaluateNBAForwardValidation(rows);
    expect(report.chronologicalDevelopmentSlates).toBe(7);
    expect(report.chronologicalHoldoutSlates).toBe(3);
    expect(report.chronologicalDevelopmentSample).toBe(21);
    expect(report.chronologicalHoldoutSample).toBe(9);
  });
});
