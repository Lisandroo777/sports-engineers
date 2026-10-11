import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditNFLSavedOpportunity } from './opportunityReplay';
import type { NFLMarketHistory } from './history';
import type { NFLOpportunityTrend } from './roleContext';

const savedPath = '.cache/nfl-readiness-fixes/final-run-3.json';
interface SavedCandidate {
  id: string;
  history: NFLMarketHistory;
  role: { opportunity: NFLOpportunityTrend };
  projection: { projection: number; uncertainty: number };
}
const saved: SavedCandidate[] = existsSync(savedPath)
  ? (JSON.parse(readFileSync(savedPath, 'utf8')) as { candidates: SavedCandidate[] }).candidates : [];

describe.skipIf(saved.length === 0)('Real saved NFL aggregate audits, not paired production replay', () => {
  it.each([
    ['Chris Olave', 'player_reception_yds', 122.72, 113.8954, 119.6314],
    ['Chris Olave', 'player_receptions', 8.82, 8.4206, 8.6802],
    ['Juwan Johnson', 'player_reception_yds', 59.61, 56.9356, 58.6740],
    ['Tyler Shough', 'player_pass_yds', 301.31, 307.0826, 303.3304],
    ['Tyler Shough', 'player_pass_completions', 28.94, 29.0448, 28.9767],
    ['Bijan Robinson', 'player_rush_yds', 114.11, 113.4221, 113.8692],
  ])('audits %s %s without inventing missing game opportunities', (player, market, baseline, opportunity, final) => {
    const record = saved.find((entry) => entry.id.split('|')[1] === player && entry.history.market === market)!;
    expect(record).toBeDefined();
    const audit = auditNFLSavedOpportunity({ history: record.history, opportunity: record.role.opportunity, historicalBaseline: record.projection.projection });
    expect(audit.status).toBe('AGGREGATE_AUDIT_ONLY');
    if (audit.status !== 'AGGREGATE_AUDIT_ONLY') return;
    expect(audit.historicalBaseline).toBe(baseline);
    expect(audit.opportunityProjection).toBeCloseTo(opportunity as number, 3);
    expect(audit.finalProjection).toBeCloseTo(final as number, 3);
  });

  it('blocks a mismatched opportunity window instead of assigning fake paired values', () => {
    const record = saved.find((entry) => entry.id.includes('|Chris Olave|player_reception_yds|'))!;
    expect(auditNFLSavedOpportunity({ history: record.history, opportunity: { ...record.role.opportunity, season: { games: 1, mean: 12 } },
      historicalBaseline: record.projection.projection }).status).toBe('BLOCKED');
  });
  it('quarantines saved yardage audit rows with negative production and missing per-game volume pairs', () => {
    const record = saved.find((entry) => entry.id.split('|')[1] === 'Tyler Shough' && entry.history.market === 'player_rush_yds')!;
    expect(record.history.observations.some((entry) => entry.value != null && entry.value < 0)).toBe(true);
    const audit = auditNFLSavedOpportunity({ history: record.history, opportunity: record.role.opportunity, historicalBaseline: record.projection.projection });
    expect(audit.status).toBe('BLOCKED');
    expect(audit.reason).toContain('per-game opportunity pair was not retained');
  });
});

describe('Saved aggregate replay matches role-window and history-weight contract', () => {
  it('reconstructs weighted opportunity from unweighted role means without changing the production weighting', () => {
    const observations = Array.from({ length: 10 }, (_, index) => ({ gameId: `g${index}`, date: `2026-09-${index + 1}`,
      season: index < 7 ? 2025 : 2026, source: index < 7 ? 'PREVIOUS_SEASON' as const : 'CURRENT_SEASON' as const,
      weight: index < 7 ? 0.6 : 1, value: index < 7 ? 100 : 80, outcome: 'MISS' as const }));
    const window = (games: number) => ({ games, gamesConsidered: games, missing: 0, hits: 0, misses: games, pushes: 0, decisions: games, hitRate: 0 });
    const history = { observations, windows: { rolling: window(10), l10: window(10), l5: window(5), l3: window(3), season: window(3) } } as NFLMarketHistory;
    const opportunity = { rolling: { games: 10, mean: 17 }, l10: { games: 10, mean: 17 }, season: { games: 3, mean: 10 },
      l5: { games: 5, mean: 14 }, l3: { games: 3, mean: 10 } } as NFLOpportunityTrend;
    const replay = auditNFLSavedOpportunity({ history, opportunity, historicalBaseline: 90 });
    expect(replay.status).toBe('AGGREGATE_AUDIT_ONLY');
    if (replay.status !== 'AGGREGATE_AUDIT_ONLY') return;
    const expectedRolling = (30 + 140 * 0.6) / (3 + 7 * 0.6);
    const expectedL5 = (30 + 40 * 0.6) / (3 + 2 * 0.6);
    const expectedOpportunity = 0.45 * 10 + 0.35 * expectedL5 + 0.20 * expectedRolling;
    const efficiency = (3 * 80 + 7 * 100 * 0.6) / (30 + 140 * 0.6);
    expect(replay.expectedOpportunity).toBeCloseTo(expectedOpportunity, 10);
    expect(replay.efficiency).toBeCloseTo(efficiency, 10);
    expect(replay.opportunityProjection).toBeCloseTo(expectedOpportunity * efficiency, 10);
  });
});