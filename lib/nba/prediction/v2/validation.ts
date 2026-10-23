import { NBA_V2_MODEL_VERSION } from './earlySeason';

// Mirrors reports/nba-v2/validation.json; publishable stays false until EV is validated against real historical prices.
export const NBA_V2_VALIDATION = Object.freeze({
  modelVersion: NBA_V2_MODEL_VERSION,
  report: 'reports/nba-v2/validation.json',
  calibrationPassed: true,
  heldOutPredictions: 4509,
  heldOutExpectedCalibrationError: 0.0225,
  heldOutBrier: 0.2364,
  priorOnlyBaselineBrier: 0.247,
  leakageViolations: 0,
  evValidated: false,
  publishable: false,
  reasons: Object.freeze([
    'NBA V2 early-season probability calibration passed on held-out 2025-26 players (ECE 0.0225, Brier 0.236 vs 0.247 prior-only).',
    'NBA V2 EV is not validated: no historical sportsbook prices are available, so V2 cannot publish picks.',
  ]),
});
