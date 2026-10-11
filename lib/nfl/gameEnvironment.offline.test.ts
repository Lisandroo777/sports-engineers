import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyNFLGameEnvironmentToProjection, type NFLMarketProjection } from './projection';
import type { NFLGameScriptResearch, NFLResearchLayer } from './researchModel';
import type { NFLInjuryContext } from './injuries';
import type { NFLWeatherContext } from './weather';
import { evaluateNFLSavedResearchMode } from './researchMode';
import type { ResearchCandidateRecord } from '../ai/agent/session';
import { classifyPickTier } from '../ai/agent/pickTiers';

interface SavedReplay {
  player: string;
  market: string;
  position: string;
  researchMode: 'STANDARD' | 'DEEP';
  finalProjection: number;
  probability: number;
  edge: number;
  ev: number;
  tier: string;
  projection: NFLMarketProjection;
  record: ResearchCandidateRecord;
  gameScript: NFLResearchLayer<NFLGameScriptResearch>;
  injuryContext: NFLInjuryContext;
  weatherContext: NFLWeatherContext;
}
const path = '.cache/nfl-phase4/game-environment-replay.json';
const saved: { snapshotTime: string; outputs: SavedReplay[] } = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { snapshotTime: '', outputs: [] };
describe.skipIf(!saved.outputs.length)('Offline real Phase4 saved-price replays', () => {
  it.each(saved.outputs)('replays $player $market $researchMode without network', (row) => {
    const result = applyNFLGameEnvironmentToProjection(row.projection, { market: row.market, position: row.position,
      teamId: row.record.teamId, season: 2026, researchMode: row.researchMode, gameScript: row.gameScript,
      injuryContext: row.injuryContext, weatherContext: row.weatherContext, now: new Date(saved.snapshotTime), snapshotOnly: true });
    expect(result.projection).toBe(row.finalProjection);
    expect(result.uncertainty).toBe(row.projection.uncertainty);
    expect(result.projectionModel?.matchupModel).toEqual(row.projection.projectionModel?.matchupModel);
    expect(result.projectionModel?.gameEnvironmentModel?.volumeAdjustment).toBe(0);
    expect(result.projectionModel?.gameEnvironmentModel?.scenarios).toHaveLength(row.researchMode === 'DEEP' ? 3 : 0);
    expect(classifyPickTier(row.record, 'nfl').pickTier).toBe(row.tier);
  });
  it('upgrades a legacy profile additively without changing saved value or tier', () => {
    const original = saved.outputs[0].record;
    const legacy = { ...original, nflResearchProfile: { ...original.nflResearchProfile!, gameEnvironmentModel: undefined,
      projectionModel: { ...original.nflResearchProfile!.projectionModel!, gameEnvironmentModel: undefined } } };
    const upgraded = evaluateNFLSavedResearchMode(legacy, 'STANDARD');
    expect(upgraded.nflResearchProfile?.gameEnvironmentModel?.modelVersion).toBe('nfl_game_environment_v1');
    expect(upgraded.trueProbability).toBe(original.trueProbability);
    expect(upgraded.evPercent).toBe(original.evPercent);
    expect(upgraded.projection).toBe(original.projection);
    expect(classifyPickTier(upgraded, 'nfl').pickTier).toBe(classifyPickTier(original, 'nfl').pickTier);
  });
});