export const NBA_MODEL_VERSION = 'NBA_MODEL_V1' as const;
export const NBA_MODEL_VALIDATION_STATUS = 'UNVALIDATED' as const;
export const NBA_RESEARCH_CONTEXT_SCHEMA_VERSION = '1' as const;
export const NBA_INTELLIGENCE_SCHEMA_VERSION = '1' as const;
export const NBA_MODEL_SOURCE_SET = [
  'NBA_MODEL_VERSION',
  'NBA_AS_OF_HISTORY',
  'NBA_MINUTES_DISTRIBUTION',
  'NBA_MARKET_DISTRIBUTIONS',
  'NBA_PUSH_AWARE_PRICING',
  'NBA_COMBINATION_CORRELATION',
] as const;

export interface NBAModelVersionMetadata {
  modelVersion: typeof NBA_MODEL_VERSION;
  validationStatus: typeof NBA_MODEL_VALIDATION_STATUS;
  probabilityCalibration: 'OFFLINE_ONLY';
  researchContextSchemaVersion: typeof NBA_RESEARCH_CONTEXT_SCHEMA_VERSION;
  intelligenceSchemaVersion: typeof NBA_INTELLIGENCE_SCHEMA_VERSION;
  createdFrom: 'NBA_MODEL_V1_ISOLATED_CORE';
}

export function nbaModelVersionMetadata(): NBAModelVersionMetadata {
  return {
    modelVersion: NBA_MODEL_VERSION,
    validationStatus: NBA_MODEL_VALIDATION_STATUS,
    probabilityCalibration: 'OFFLINE_ONLY',
    researchContextSchemaVersion: NBA_RESEARCH_CONTEXT_SCHEMA_VERSION,
    intelligenceSchemaVersion: NBA_INTELLIGENCE_SCHEMA_VERSION,
    createdFrom: 'NBA_MODEL_V1_ISOLATED_CORE',
  };
}
