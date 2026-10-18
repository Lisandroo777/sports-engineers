export type ResearchStage = 'candidate-conversion' | 'session-build' | 'session-save'
  | 'intent-ranking' | 'session-read' | 'response-serialization';

export type ResearchFailureCategory = 'STORAGE' | 'AUTH' | 'PAYLOAD' | 'TIMEOUT'
  | 'PROVIDER' | 'INVALID_DATA' | 'UNKNOWN';

export type ResearchFailureDiagnostic = {
  stage: ResearchStage | 'UNKNOWN';
  category: ResearchFailureCategory;
};

const STAGES: readonly ResearchStage[] = ['candidate-conversion', 'session-build', 'session-save',
  'intent-ranking', 'session-read', 'response-serialization'];
const CATEGORIES: readonly ResearchFailureCategory[] = ['STORAGE', 'AUTH', 'PAYLOAD', 'TIMEOUT',
  'PROVIDER', 'INVALID_DATA', 'UNKNOWN'];

const CATEGORY_PATTERNS: readonly [ResearchFailureCategory, RegExp][] = [
  ['AUTH', /\b(?:401|403|unauthorized|forbidden|authentication|invalid credentials)\b/],
  ['PAYLOAD', /\b(?:413|payload too large|request entity too large|exceeds storage capacity|command size|request body too large)\b/],
  ['TIMEOUT', /\b(?:timeout|timed out|etimedout|aborterror|timeouterror)\b/],
  ['STORAGE', /\b(?:redis|kv|storage|persistence|persisted|research session|session persistence)\b/],
  ['PROVIDER', /\b(?:provider|openai|anthropic|upstream|rate limit|429)\b/],
  ['INVALID_DATA', /\b(?:invalid data|invalid payload|validation|serialization|serialize|circular|bigint)\b/],
];

function categoryFor(error: unknown): ResearchFailureCategory {
  if (!(error instanceof Error)) return 'UNKNOWN';
  const text = `${error.name} ${error.message}`.slice(0, 4096)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/\b(?:authorization|token|api[_-]?key|password|credential)s?\s*[:=]\s*\S+/gi, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError
    ? 'INVALID_DATA' : 'UNKNOWN';
}

export class ResearchStageError extends Error {
  readonly stage: ResearchStage;
  readonly category: ResearchFailureCategory;

  constructor(stage: ResearchStage, cause: unknown) {
    super('Research stage failed.', { cause });
    this.name = 'ResearchStageError';
    this.stage = stage;
    this.category = categoryFor(cause);
  }
}

export function getResearchFailureDiagnostic(error: unknown): ResearchFailureDiagnostic {
  return error instanceof ResearchStageError
    ? { stage: STAGES.includes(error.stage) ? error.stage : 'UNKNOWN',
      category: CATEGORIES.includes(error.category) ? error.category : 'UNKNOWN' }
    : { stage: 'UNKNOWN', category: categoryFor(error) };
}

export async function withResearchStage<Result>(
  stage: ResearchStage,
  operation: () => Result | PromiseLike<Result>,
): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw error instanceof ResearchStageError ? error : new ResearchStageError(stage, error);
  }
}