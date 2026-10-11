import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNFLProjectionExplanation, type NFLProjectionExplanation } from './opportunityProjection';
import { buildNFLMatchupEfficiency, type NFLMatchupEfficiency } from './matchupEfficiency';
import type { NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLGameLogEntry } from './types';
import { buildNFLOpponentContext } from './opponentContext';

const path = '.cache/nfl-phase3/recovered-paired-replay.json';
interface RecoveredReplay {
  player: string;
  position: string;
  market: NFLAnalyzableMarketKey;
  historicalBaseline: number;
  phase2Projection: number;
  finalProjection: number;
  probability: number;
  priceEdge: number;
  ev: number;
  tier: string;
  snapshotTime: string;
  recoveredLogs: NFLGameLogEntry[];
  projectionModel: NFLProjectionExplanation;
  matchup: NFLMatchupEfficiency;
}
const outputs: RecoveredReplay[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).outputs : [];
describe.skipIf(!outputs.length)('Offline real recovered Phase3 pairs', () => {
  it.each(outputs)('replays $player $market without network', (saved) => {
    const opportunity = buildNFLProjectionExplanation({ market: saved.market, position: saved.position, logs: saved.recoveredLogs,
      historicalBaseline: saved.historicalBaseline, finalProjection: saved.historicalBaseline });
    expect(opportunity.opportunityInputs).toEqual(saved.projectionModel.opportunityInputs);
    expect(opportunity.finalProjection).toBe(saved.phase2Projection);
    const matchup = buildNFLMatchupEfficiency({ market: saved.market, position: saved.position, projectionModel: opportunity,
      now: new Date(saved.snapshotTime), before: saved.snapshotTime, season: 2026,
      opponentContext: buildNFLOpponentContext({ opponentTeamId: saved.matchup.inputs.opponentTeamId!,
        games: saved.matchup.inputs.games, market: saved.market, position: saved.position, season: 2026 }) });
    expect(matchup.inputs.seasonEfficiency).toBe(saved.matchup.inputs.seasonEfficiency);
    expect(matchup.inputs.sackRate).toBe(saved.matchup.inputs.sackRate);
    expect(matchup.finalProjection).toBe(saved.finalProjection);
    expect(matchup.projectionAdjustment).toBe(0);
  });
  it('retains the exact genuine Olave trace for future backtesting', () => {
    const olave = outputs.find((row) => row.player === 'Chris Olave' && row.market === 'player_reception_yds')!;
    expect(olave).toMatchObject({ phase2Projection: 119.63, finalProjection: 119.63, probability: 78.9,
      priceEdge: 25.9, ev: 48.8, tier: 'ELITE' });
    expect(olave.recoveredLogs).toHaveLength(10);
    expect(olave.projectionModel.expectedOpportunity).toBe(12.07);
  });
});