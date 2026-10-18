import { describe, expect, it } from 'vitest';
import { getResearchFailureDiagnostic, ResearchStageError, withResearchStage, type ResearchStage } from './researchFailure';

const privateText = 'private-query private-session-id Authorization=secret-token https://user:password@redis.example';
const stages: ResearchStage[] = ['candidate-conversion', 'session-build', 'session-save', 'intent-ranking',
  'session-read', 'response-serialization'];

describe('research stage failures', () => {
  it('preserves successful sync and async operation results', async () => {
    const value = { results: [1, 2] };
    expect(await withResearchStage('session-build', () => value)).toBe(value);
    expect(await withResearchStage('session-save', async () => value)).toBe(value);
  });

  it.each(stages)('tags %s without exposing the underlying error', async (stage) => {
    const original = new Error(`Research session could not be persisted. ${privateText}`);
    const failure = await withResearchStage(stage, async () => { throw original; }).catch((error) => error);
    expect(failure).toBeInstanceOf(ResearchStageError);
    expect(failure.cause).toBe(original);
    expect(failure.message).toBe('Research stage failed.');
    expect(getResearchFailureDiagnostic(failure)).toEqual({ stage, category: 'STORAGE' });
    expect(JSON.stringify(getResearchFailureDiagnostic(failure))).not.toMatch(/private|secret|password|redis.example/);
  });

  it.each([
    [new Error('Redis HTTP 401 unauthorized'), 'AUTH'],
    [new Error('Redis HTTP 413 payload too large'), 'PAYLOAD'],
    [new Error('Research session exceeds storage capacity.'), 'PAYLOAD'],
    [new Error('Redis request timed out'), 'TIMEOUT'],
    [new Error('Redis persistence unavailable'), 'STORAGE'],
    [new Error('Research session is temporarily unavailable.'), 'STORAGE'],
    [new Error('OpenAI provider unavailable'), 'PROVIDER'],
    [new TypeError('Invalid data'), 'INVALID_DATA'],
    [new SyntaxError('Unexpected token'), 'INVALID_DATA'],
    [new Error('Unexpected failure'), 'UNKNOWN'],
  ])('classifies only fixed categories for %s', (error, category) => {
    error.message += ` ${privateText}`;
    expect(getResearchFailureDiagnostic(error)).toEqual({ stage: 'UNKNOWN', category });
  });

  it.each([undefined, null, 'secret-token', { message: 'Redis HTTP 401', stage: 'session-save', category: 'AUTH' }])(
    'does not trust non-error values: %s', (error) => {
      expect(getResearchFailureDiagnostic(error)).toEqual({ stage: 'UNKNOWN', category: 'UNKNOWN' });
    });

  it('tags synchronous throws and retains the innermost stage through nested operations', async () => {
    const original = new TypeError(privateText);
    const failure = await withResearchStage('session-build', () => withResearchStage('candidate-conversion', () => {
      throw original;
    })).catch((error) => error);
    expect(failure.cause).toBe(original);
    expect(getResearchFailureDiagnostic(failure)).toEqual({ stage: 'candidate-conversion', category: 'INVALID_DATA' });
  });

  it('whitelists fields even on a malformed stage error', () => {
    const failure = new ResearchStageError('session-read', new Error(privateText));
    Object.assign(failure, { stage: privateText, category: privateText });
    expect(getResearchFailureDiagnostic(failure)).toEqual({ stage: 'UNKNOWN', category: 'UNKNOWN' });
    expect(JSON.stringify(getResearchFailureDiagnostic(failure))).not.toContain('password');
  });
});