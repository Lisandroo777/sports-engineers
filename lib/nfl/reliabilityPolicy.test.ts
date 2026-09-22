import { describe, it, expect } from 'vitest';
import { evaluateNFLReliabilityPolicy } from './reliabilityPolicy';

describe('NFL Elite reliability policy (Phase 5, deterministic, no LLM judgment)', () => {
  it('UNRELIABLE always fails regardless of role', () => {
    expect(evaluateNFLReliabilityPolicy({ reliability: 'UNRELIABLE', roleRequirement: 'OPTIONAL', roleStatus: 'STABLE' }).acceptable).toBe(false);
    expect(evaluateNFLReliabilityPolicy({ reliability: null, roleRequirement: 'CRITICAL', roleStatus: 'STABLE' }).acceptable).toBe(false);
  });

  it('HIGH/MEDIUM are never restricted by this policy', () => {
    for (const reliability of ['HIGH', 'MEDIUM'] as const) {
      for (const roleStatus of ['STABLE', 'CHANGING', 'UNCERTAIN', 'UNAVAILABLE'] as const) {
        expect(evaluateNFLReliabilityPolicy({ reliability, roleRequirement: 'CRITICAL', roleStatus }).acceptable).toBe(true);
      }
    }
  });

  it('LOW + CRITICAL market + non-STABLE role status -> FAIL (real role-instability signal)', () => {
    for (const roleStatus of ['CHANGING', 'UNCERTAIN', 'UNAVAILABLE'] as const) {
      const v = evaluateNFLReliabilityPolicy({ reliability: 'LOW', roleRequirement: 'CRITICAL', roleStatus });
      expect(v.acceptable).toBe(false);
      expect(v.reason).toMatch(/CRITICAL/);
    }
  });

  it('LOW + CRITICAL market + STABLE role status -> allowed (LOW came from something else)', () => {
    expect(evaluateNFLReliabilityPolicy({ reliability: 'LOW', roleRequirement: 'CRITICAL', roleStatus: 'STABLE' }).acceptable).toBe(true);
  });

  it('LOW + IMPORTANT market + non-STABLE role status -> FAIL', () => {
    const v = evaluateNFLReliabilityPolicy({ reliability: 'LOW', roleRequirement: 'IMPORTANT', roleStatus: 'CHANGING' });
    expect(v.acceptable).toBe(false);
  });

  it('LOW + IMPORTANT market + STABLE role status -> allowed', () => {
    expect(evaluateNFLReliabilityPolicy({ reliability: 'LOW', roleRequirement: 'IMPORTANT', roleStatus: 'STABLE' }).acceptable).toBe(true);
  });

  it('LOW + OPTIONAL market -> allowed regardless of role status (role evidence isn\'t required for OPTIONAL markets)', () => {
    for (const roleStatus of ['STABLE', 'CHANGING', 'UNCERTAIN', 'UNAVAILABLE'] as const) {
      expect(evaluateNFLReliabilityPolicy({ reliability: 'LOW', roleRequirement: 'OPTIONAL', roleStatus }).acceptable).toBe(true);
    }
  });

  it('matches the real live-validation outcome: 4 CRITICAL+CHANGING candidates rejected, 1 OPTIONAL+STABLE candidate kept', () => {
    // Emeka Egbuka: CRITICAL market, CHANGING role, LOW reliability -> rejected.
    expect(evaluateNFLReliabilityPolicy({ reliability: 'LOW', roleRequirement: 'CRITICAL', roleStatus: 'CHANGING' }).acceptable).toBe(false);
    // Vita Vea: OPTIONAL market, STABLE role, LOW reliability (from rare-event rate volatility) -> kept.
    expect(evaluateNFLReliabilityPolicy({ reliability: 'LOW', roleRequirement: 'OPTIONAL', roleStatus: 'STABLE' }).acceptable).toBe(true);
  });
});
