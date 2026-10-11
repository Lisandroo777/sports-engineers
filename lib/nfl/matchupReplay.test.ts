import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditNFLSavedOpportunity } from './opportunityReplay';
import { buildNFLMatchupEfficiency } from './matchupEfficiency';
import type { NFLMarketHistory } from './history';
import type { NFLOpportunityTrend } from './roleContext';
import type { NFLOpponentContext } from './opponentContext';
import type { NFLInjuryContext } from './injuries';

const path = '.cache/nfl-readiness-fixes/final-run-3.json';
interface ArchivedRow {
  id: string;
  history: NFLMarketHistory;
  role: { opportunity: NFLOpportunityTrend };
  projection: { projection: number };
  opponent: NFLOpponentContext;
  injury: NFLInjuryContext;
}
const rows: ArchivedRow[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).candidates : [];
describe.skipIf(!rows.length)('Phase3 real saved aggregate audit, not reconstructed production replay', () => {
  it.each([
    ['Chris Olave', 'WR', 'player_reception_yds'], ['Chris Olave', 'WR', 'player_receptions'],
    ['Juwan Johnson', 'TE', 'player_reception_yds'], ['Bijan Robinson', 'RB', 'player_rush_yds'],
    ['Tyler Shough', 'QB', 'player_pass_yds'], ['Tyler Shough', 'QB', 'player_pass_completions'],
  ] as const)('audits %s %s %s with a disclosed zero modifier', (player, position, market) => {
    const row = rows.find((candidate) => candidate.id.split('|')[1] === player && candidate.history.market === market)!;
    expect(row).toBeDefined();
    const audit = auditNFLSavedOpportunity({ history: row.history, opportunity: row.role.opportunity, historicalBaseline: row.projection.projection });
    expect(audit.status).toBe('AGGREGATE_AUDIT_ONLY');
    if (audit.status !== 'AGGREGATE_AUDIT_ONLY') return;
    const matchup = buildNFLMatchupEfficiency({ market, position, phase2Projection: audit.finalProjection,
      opponentContext: row.opponent, injuryContext: row.injury, researchMode: 'DEEP' });
    expect(matchup.projectionAdjustment).toBe(0);
    expect(matchup.finalProjection).toBe(Number(audit.finalProjection.toFixed(2)));
    expect(matchup.opportunityModelVersion).toBeNull();
    expect(matchup.expectedOpportunity).toBeNull();
    expect(matchup.inputs.games).toHaveLength(0);
    if (process.env.NFL_MATCHUP_AUDIT_REPORT === '1') console.info(JSON.stringify({ player, market,
      status: audit.status, historicalBaseline: audit.historicalBaseline, aggregateOpportunityProjection: audit.opportunityProjection,
      aggregateExpectedOpportunity: audit.expectedOpportunity, aggregateEfficiency: audit.efficiency,
      phase2AggregateEstimate: audit.finalProjection, phase3AggregateEstimate: matchup.finalProjection,
      adjustment: matchup.projectionAdjustment, confidence: matchup.confidence,
      probability: 'Not recomputed: original paired opportunities unavailable', tier: 'Not recomputed',
    }));
  });
  it('does not turn missing aggregate rush attempts into an audited QB negative-yard efficiency', () => {
    const row = rows.find((candidate) => candidate.id.split('|')[1] === 'Tyler Shough' && candidate.history.market === 'player_rush_yds')!;
    expect(auditNFLSavedOpportunity({ history: row.history, opportunity: row.role.opportunity, historicalBaseline: row.projection.projection })).toMatchObject({ status: 'BLOCKED' });
  });
});