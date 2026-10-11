import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { loadEnvConfig } from '@next/env';
import type { ResearchSession } from '../ai/agent/session';
import { buildResearchSessionFromCandidates } from '../ai/agent/session';
import { classifyPickTier } from '../ai/agent/pickTiers';
import { selectRankedCandidates } from '../ai/agent/tools';
import { buildNFLRollingHistory } from './rollingHistory';
import { buildNFLRoleContext } from './roleContext';
import { projectNFLMarket, applyNFLMatchupToProjection, applyNFLGameEnvironmentToProjection } from './projection';
import { buildNFLOpponentContext } from './opponentContext';
import { analyzeNFLCandidate } from './research';
import { buildNFLResearchProfile, applyNFLHardGatesToAnalysis } from './researchModel';
import type { NFLProjectionExplanation } from './opportunityProjection';
import type { NFLGameLogEntry } from './types';
import type { NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLInjuryContext } from './injuries';
import type { NFLWeatherContext } from './weather';

interface PairedReplay {
  player: string;
  position: string;
  market: NFLAnalyzableMarketKey;
  line: number;
  odds: number;
  historicalBaseline: number;
  phase2Projection: number;
  finalProjection: number;
  uncertainty: number;
  probability: number;
  priceEdge: number;
  ev: number;
  tier: string;
  snapshotTime: string;
  recoveredLogs: NFLGameLogEntry[];
  projectionModel: NFLProjectionExplanation;
  matchup: NonNullable<NFLProjectionExplanation['matchupModel']>;
}
afterEach(() => vi.useRealTimers());
describe.skipIf(process.env.NFL_GAME_ENVIRONMENT_REPLAY !== '1')('Phase4 real saved-price replay', () => {
  it('preserves seven real Phase3 outputs in both modes without provider refresh', async () => {
    loadEnvConfig(process.cwd());
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error('Read-only local KV environment required');
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(['GET', 'ai-session:52de806b-f3e6-4cf9-a1a4-4c3a9344bfe7']) });
    expect(response.ok).toBe(true);
    const payload = await response.json() as { result: string };
    if (!payload.result) throw new Error('Saved session unavailable');
    const stored = JSON.parse(payload.result) as { session?: ResearchSession; compressedSession?: string };
    const session = stored.session ?? JSON.parse(inflateSync(Buffer.from(stored.compressedSession!, 'base64')).toString()) as ResearchSession;
    const paired: PairedReplay[] = JSON.parse(readFileSync('.cache/nfl-phase3/recovered-paired-replay.json', 'utf8')).outputs;
    expect(paired).toHaveLength(7);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(session.generatedAt));
    const outputs = [];
    for (const replay of paired) {
      const original = session.candidates.find((candidate) => candidate.player === replay.player && candidate.marketKey === replay.market
        && candidate.line === replay.line && candidate.odds === replay.odds && candidate.direction === 'over')!;
      if (!original?.nflResearchProfile || original.line == null || original.odds == null || !original.book) throw new Error('Saved quote/profile missing');
      const sample = buildNFLRollingHistory({ current: replay.recoveredLogs.filter((log) => log.historySource === 'CURRENT_SEASON'),
        previous: replay.recoveredLogs.filter((log) => log.historySource === 'PREVIOUS_SEASON'), season: 2026, teamId: original.teamId,
        position: replay.position, market: replay.market });
      expect(sample.logs.map((log) => log.gameId)).toEqual(replay.recoveredLogs.map((log) => log.gameId));
      const roleContext = buildNFLRoleContext(sample.logs, replay.market);
      const injuryContext = original.injuryContext as NFLInjuryContext;
      const weatherContext = original.weatherContext as NFLWeatherContext;
      const phase2 = projectNFLMarket({ logs: sample.logs, market: replay.market, position: replay.position, roleContext, historySample: sample, injuryContext });
      const opponentContext = buildNFLOpponentContext({ opponentTeamId: replay.matchup.inputs.opponentTeamId!,
        games: replay.matchup.inputs.games, market: replay.market, position: replay.position, season: 2026 });
      const phase3 = applyNFLMatchupToProjection(phase2, { market: replay.market, position: replay.position, opponentContext,
        season: 2026, injuryContext, before: session.generatedAt, now: new Date(session.generatedAt), snapshotOnly: true });
      expect(phase3.projection).toBe(replay.finalProjection);
      expect(phase3.uncertainty).toBe(replay.uncertainty);
      for (const researchMode of ['STANDARD', 'DEEP'] as const) {
        const gameScript = { ...original.nflResearchProfile.gameScript, value: original.nflResearchProfile.gameScript.value
          ? { ...original.nflResearchProfile.gameScript.value, candidateEvidence: null } : null };
        const phase4 = applyNFLGameEnvironmentToProjection(phase3, { market: replay.market, position: replay.position, teamId: original.teamId,
          season: 2026, gameScript, researchMode, injuryContext, weatherContext, now: new Date(session.generatedAt), snapshotOnly: true });
        const environment = phase4.projectionModel!.gameEnvironmentModel!;
        if (gameScript.value) gameScript.value.environmentModel = environment;
        const analysis = analyzeNFLCandidate({ candidateId: original.candidateId, playerId: original.playerId!, player: replay.player,
          market: replay.market, line: original.line, direction: original.direction, projection: phase4.projection, projectionUncertainty: phase4.uncertainty,
          logs: sample.logs, historySample: sample, matchupAvailable: opponentContext.status !== 'UNAVAILABLE', oddsAmerican: original.odds,
          lastUpdatedAt: original.nflResearchProfile.market.provenance[0].publishedAt, isAlternate: original.isAlternate,
          marketSupport: 'full', roleContext, injuryContext, weatherContext });
        const profile = buildNFLResearchProfile({ researchMode, player: replay.player, team: original.team, position: replay.position,
          market: replay.market, direction: original.direction, line: original.line, sportsbook: original.book, oddsAmerican: original.odds,
          priceTimestamp: original.nflResearchProfile.market.provenance[0].publishedAt, retrievedAt: original.retrievedAt ?? session.generatedAt,
          priceCurrent: analysis.priceCurrent, priceFreshness: analysis.priceFreshness, trueProbability: analysis.trueProbability,
          priceEdge: analysis.priceEdgePercent, valueQualified: analysis.valueQualified, existingEliteQualified: analysis.eliteQualified,
          dataQuality: analysis.dataQuality, rawEdge: analysis.rawEdge, roleContext, roleLogs: sample.logs, projectionModel: phase4.projectionModel,
          opponentContext, injuryContext, weatherContext, marketSupport: 'full', historyGames: sample.observations,
          projectionAvailable: phase4.status === 'OK', availabilityEligible: original.nflResearchProfile.hardGates.majorInjuryResolved.passed,
          alternatePrices: [], supportingReasons: analysis.whyQualified,
          counterReasons: [...replay.matchup.counterCase, ...environment.counterCase], layerOverrides: { gameScript },
        });
        const record = buildResearchSessionFromCandidates({ sport: 'nfl', date: session.date, queryIntent: '', toolMeta: session.toolMeta,
          candidates: [{ ...original, marketLabel: original.market, analysis: applyNFLHardGatesToAnalysis(analysis, profile),
            projection: phase4.projection, projectionUncertainty: phase4.uncertainty, nflResearchProfile: profile, sampleSize: sample.observations }],
        }).candidates[0];
        const tier = classifyPickTier(record, 'nfl');
        expect(environment.volumeAdjustment).toBe(0);
        expect(phase4.projection).toBe(replay.finalProjection);
        expect(analysis.trueProbability).toBe(replay.probability);
        expect(analysis.priceEdgePercent).toBe(replay.priceEdge);
        expect(analysis.evPercent).toBe(replay.ev);
        expect(tier.pickTier).toBe(replay.tier);
        const output = { player: replay.player, market: replay.market, position: replay.position, researchMode, snapshotOnly: true,
          line: original.line, odds: original.odds, historicalBaseline: replay.historicalBaseline,
          opportunityProjection: phase2.projectionModel!.opportunityProjection, expectedOpportunity: phase2.projectionModel!.expectedOpportunity,
          matchupAdjustedEfficiency: environment.matchupAdjustedEfficiency, phase2Projection: phase2.projection,
          phase3Projection: phase3.projection, phase4Projection: phase4.projection, finalProjection: phase4.projection,
          probability: analysis.trueProbability, impliedProbability: analysis.breakEvenProbability, edge: analysis.priceEdgePercent,
          ev: analysis.evPercent, tier: tier.pickTier, environment, projection: phase4, record, gameScript, injuryContext, weatherContext };
        console.info(JSON.stringify({ ...output, projection: undefined, record: undefined, gameScript: undefined, injuryContext: undefined, weatherContext: undefined,
          environment: { confidence: environment.confidence, inputs: environment.inputs, expectedTeamVolume: environment.expectedTeamVolume,
            expectedPlayerOpportunity: environment.expectedPlayerOpportunity, volumeAdjustment: environment.volumeAdjustment,
            scenarioCount: environment.scenarios.length, adjustmentReason: environment.adjustmentReason } }));
        outputs.push(output);
      }
    }
    const standard = outputs.filter((output) => output.researchMode === 'STANDARD').map((output) => output.record);
    expect(selectRankedCandidates(standard, 'Give me the best NFL plays', { sport: 'nfl' }).selected).toHaveLength(7);
    const counts = Object.fromEntries(standard.map((candidate) => [candidate.marketKey + candidate.player, classifyPickTier(candidate, 'nfl').pickTier]));
    console.info(JSON.stringify({ standardRecommendations: 7, exactTiers: counts, paidOddsCalls: 0, archivedQuotesOnly: true }));
    mkdirSync('.cache/nfl-phase4', { recursive: true });
    writeFileSync('.cache/nfl-phase4/game-environment-replay.json', JSON.stringify({ snapshotTime: session.generatedAt, outputs }, null, 2));
  }, 30000);
});