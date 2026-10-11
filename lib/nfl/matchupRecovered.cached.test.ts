import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { loadEnvConfig } from '@next/env';
import { getPlayerGameLogs } from './stats';
import { buildNFLRollingHistory } from './rollingHistory';
import { buildNFLRoleContext } from './roleContext';
import { applyNFLMatchupToProjection, projectNFLMarket } from './projection';
import { analyzeNFLCandidate } from './research';
import { getNFLMarketHistoricalValue, type NFLAnalyzableMarketKey } from './oddsTypes';
import { buildNFLOpponentContext, getNFLOpponentDefenseGames } from './opponentContext';
import { applyNFLHardGatesToAnalysis, buildNFLResearchProfile } from './researchModel';
import { buildResearchSessionFromCandidates, type ResearchSession } from '../ai/agent/session';
import { classifyPickTier } from '../ai/agent/pickTiers';
import type { NFLInjuryContext } from './injuries';
import type { NFLWeatherContext } from './weather';

afterEach(() => vi.useRealTimers());
describe.skipIf(process.env.NFL_RECOVERED_MATCHUP_REPLAY !== '1')('Real recovered paired Phase3 replay at saved prices', () => {
  it('matches original production games before replaying current opportunity and probability code', async () => {
    loadEnvConfig(process.cwd());
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error('Local read-only KV environment required');
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(['GET', 'ai-session:52de806b-f3e6-4cf9-a1a4-4c3a9344bfe7']) });
    expect(response.ok).toBe(true);
    const payload = await response.json() as { result: string };
    if (!payload.result) throw new Error('Saved session is unavailable');
    const stored = JSON.parse(payload.result) as { session?: ResearchSession; compressedSession?: string };
    const session = stored.session ?? JSON.parse(inflateSync(Buffer.from(stored.compressedSession!, 'base64')).toString()) as ResearchSession;
    const players = ['Chris Olave', 'Juwan Johnson', 'Bijan Robinson', 'Tyler Shough'];
    const identities = players.map((player) => session.candidates.find((candidate) => candidate.player === player)!);
    identities.forEach((candidate) => expect(candidate?.playerId).toBeTruthy());
    const logs = new Map(await Promise.all(identities.map(async (candidate) => [candidate.player, {
      current: await getPlayerGameLogs(candidate.playerId!, 2026), previous: await getPlayerGameLogs(candidate.playerId!, 2025),
    }] as const)));
    const defense = new Map(await Promise.all([1, 18].map(async (teamId) => [teamId, await getNFLOpponentDefenseGames(teamId, 2026)] as const)));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(session.generatedAt));
    const outputs = [];
    for (const [player, position, market] of [['Chris Olave', 'WR', 'player_reception_yds'], ['Chris Olave', 'WR', 'player_receptions'],
      ['Juwan Johnson', 'TE', 'player_reception_yds'], ['Bijan Robinson', 'RB', 'player_rush_yds'],
      ['Tyler Shough', 'QB', 'player_pass_yds'], ['Tyler Shough', 'QB', 'player_pass_completions'], ['Tyler Shough', 'QB', 'player_rush_yds']] as const) {
      const original = session.candidates.find((candidate) => candidate.player === player && candidate.marketKey === market && candidate.direction === 'over'
        && (player !== 'Chris Olave' || market !== 'player_reception_yds' || candidate.line === 84.5))!;
      expect(original).toBeDefined();
      if (original.line == null || original.odds == null || !original.book) throw new Error('Saved replay requires actual line, odds and book');
      const source = logs.get(player)!;
      const sample = buildNFLRollingHistory({ current: source.current.filter((log) => Date.parse(log.date) < Date.parse(session.generatedAt)),
        previous: source.previous, season: 2026, teamId: original.teamId, position, market });
      expect(sample.logs.map((log) => log.gameId)).toEqual(original.nflHistory!.observations.map((observation) => observation.gameId));
      for (const log of sample.logs) {
        const observed = original.nflHistory!.observations.find((observation) => observation.gameId === log.gameId)!;
        expect(getNFLMarketHistoricalValue(market, log.stats)).toBe(observed.value);
      }
      const injuryContext = original.injuryContext as NFLInjuryContext;
      const weatherContext = original.weatherContext as NFLWeatherContext;
      const roleContext = buildNFLRoleContext(sample.logs, market);
      const phase2 = projectNFLMarket({ logs: sample.logs, market, position, roleContext, historySample: sample, injuryContext });
      const opponentTeamId = original.teamId === 18 ? 1 : 18;
      const opponentContext = buildNFLOpponentContext({ opponentTeamId,
        games: defense.get(opponentTeamId)!.filter((game) => Date.parse(game.date) < Date.parse(session.generatedAt)), market, position, season: 2026 });
      const projection = applyNFLMatchupToProjection(phase2, { market, position, season: 2026, before: session.generatedAt,
        opponentContext, injuryContext, researchMode: 'STANDARD', now: new Date(session.generatedAt), snapshotOnly: true });
      const candidate = { candidateId: original.candidateId, playerId: original.playerId!, player, market: market as NFLAnalyzableMarketKey,
        line: original.line, direction: original.direction, projection: projection.projection, projectionUncertainty: projection.uncertainty,
        logs: sample.logs, historySample: sample, matchupAvailable: opponentContext.status !== 'UNAVAILABLE', oddsAmerican: original.odds,
        lastUpdatedAt: original.nflResearchProfile!.market.provenance[0].publishedAt, isAlternate: original.isAlternate,
        marketSupport: 'full' as const, roleContext, injuryContext, weatherContext };
      const analysis = analyzeNFLCandidate(candidate);
      const beforeAnalysis = analyzeNFLCandidate({ ...candidate, projection: phase2.projection, projectionUncertainty: phase2.uncertainty });
      expect(analysis.trueProbability).toBe(beforeAnalysis.trueProbability);
      const profile = buildNFLResearchProfile({ researchMode: 'STANDARD', player, team: original.team, position, market, direction: original.direction,
        line: original.line, sportsbook: original.book, oddsAmerican: original.odds, priceTimestamp: candidate.lastUpdatedAt,
        retrievedAt: original.retrievedAt ?? session.generatedAt, priceCurrent: analysis.priceCurrent, priceFreshness: analysis.priceFreshness,
        trueProbability: analysis.trueProbability, priceEdge: analysis.priceEdgePercent, valueQualified: analysis.valueQualified,
        existingEliteQualified: analysis.eliteQualified, dataQuality: analysis.dataQuality, rawEdge: analysis.rawEdge, roleContext, roleLogs: sample.logs,
        projectionModel: projection.projectionModel, opponentContext, injuryContext, weatherContext, marketSupport: 'full',
        historyGames: sample.observations, projectionAvailable: projection.status === 'OK', availabilityEligible: original.nflResearchProfile!.hardGates.majorInjuryResolved.passed,
        alternatePrices: [], supportingReasons: analysis.whyQualified, counterReasons: projection.projectionModel!.matchupModel!.counterCase,
        layerOverrides: { gameScript: original.nflResearchProfile!.gameScript },
      });
      const newSession = buildResearchSessionFromCandidates({ sport: 'nfl', date: session.date, queryIntent: '', toolMeta: session.toolMeta,
        candidates: [{ ...original, marketLabel: original.market, analysis: applyNFLHardGatesToAnalysis(analysis, profile),
          projection: projection.projection, projectionUncertainty: projection.uncertainty, nflResearchProfile: profile,
          sampleSize: sample.observations, opponentContext: { ...opponentContext, unavailableMetrics: opponentContext.missingFields } }],
      });
      const tier = classifyPickTier(newSession.candidates[0], 'nfl');
      const matchup = projection.projectionModel?.matchupModel;
      if (!matchup) throw new Error('Integrated matchup metadata is missing');
      const output = { player, position, market, snapshotTime: session.generatedAt, recoveredInputReplay: true, savedPricesOnly: true,
        line: original.line, odds: original.odds, historicalBaseline: phase2.projectionModel!.historicalBaseline,
        opportunityProjection: phase2.projectionModel!.opportunityProjection, expectedOpportunity: phase2.projectionModel!.expectedOpportunity,
        expectedEfficiency: phase2.projectionModel!.expectedEfficiency, phase2Projection: phase2.projection,
        matchupOpportunityProjection: projection.projectionModel!.matchupModel!.matchupOpportunityProjection,
        finalProjection: projection.projection, uncertainty: projection.uncertainty, probability: analysis.trueProbability,
        impliedProbability: analysis.breakEvenProbability, priceEdge: analysis.priceEdgePercent, ev: analysis.evPercent,
        tier: tier.pickTier, tierReason: tier.tierReason, matchup,
        projectionModel: projection.projectionModel, recoveredLogs: sample.logs };
      expect(output.matchup.projectionAdjustment).toBe(0);
      expect(output.finalProjection).toBe(output.phase2Projection);
      console.info(JSON.stringify({ ...output, projectionModel: undefined, recoveredLogs: undefined, matchup: { confidence: output.matchup.confidence,
        adjustment: output.matchup.projectionAdjustment, seasonEfficiency: output.matchup.inputs.seasonEfficiency,
        recentEfficiency: output.matchup.inputs.recentEfficiency, sackRate: output.matchup.inputs.sackRate,
        pairedDefenseGames: output.matchup.inputs.seasonalGames, injuryEvidence: output.matchup.injuryEvidence } }));
      outputs.push(output);
    }
    mkdirSync('.cache/nfl-phase3', { recursive: true });
    writeFileSync('.cache/nfl-phase3/recovered-paired-replay.json', JSON.stringify({ snapshotOnly: true, generatedAt: session.generatedAt, outputs }, null, 2));
  }, 120000);
});