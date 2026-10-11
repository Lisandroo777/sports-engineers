import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { loadEnvConfig } from '@next/env';
import type { ResearchSession } from '../ai/agent/session';
import { selectRankedCandidates } from '../ai/agent/tools';
import { classifyPickTier } from '../ai/agent/pickTiers';
import { evaluateNFLSavedResearchMode } from './researchMode';
import { matchesNFLLowThreshold } from './researchIntent';

afterEach(() => vi.useRealTimers());
describe.skipIf(process.env.NFL_CACHED_MODE_REPLAY !== '1')('Read-only saved NFL mode replay', () => {
  it('reports actual saved-pool counts at the recorded snapshot time without provider refresh', async () => {
    loadEnvConfig(process.cwd());
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(url).toBeTruthy();
    expect(token).toBeTruthy();
    const response = await fetch(url!, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(['GET', 'ai-session:52de806b-f3e6-4cf9-a1a4-4c3a9344bfe7']) });
    expect(response.ok).toBe(true);
    const payload = await response.json() as { result: string };
    expect(payload.result).toBeTruthy();
    const stored = JSON.parse(payload.result) as { session?: ResearchSession; compressedSession?: string };
    const session = stored.session ?? JSON.parse(inflateSync(Buffer.from(stored.compressedSession!, 'base64')).toString()) as ResearchSession;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(session.generatedAt));
    const candidates = session.candidates;
    const basic = candidates.filter((candidate) => candidate.odds != null && candidate.odds >= -900 && !candidate.isAlternate
      && candidate.priceCurrent && candidate.projection != null && candidate.modelProbability != null
      && candidate.nflResearchProfile?.hardGates.majorInjuryResolved.passed && candidate.nflResearchProfile?.hardGates.roleClear.passed);
    const low = basic.filter(matchesNFLLowThreshold);
    expect(candidates).toHaveLength(594);
    expect(basic).toHaveLength(202);
    expect(low).toHaveLength(46);
    for (const query of ['Give me low-threshold NFL plays', 'Deep research low-threshold NFL plays']) {
      const ranked = selectRankedCandidates(candidates, query, { sport: 'nfl' });
      const surviving = low.map((candidate) => evaluateNFLSavedResearchMode(candidate, ranked.constraints.researchMode))
        .map((candidate) => ({ ...candidate, ...classifyPickTier(candidate, 'nfl') })).filter((candidate) => candidate.pickTier !== 'PASS');
      const tiers = ranked.selected.reduce<Record<string, number>>((counts, candidate) => {
        counts[candidate.pickTier!] = (counts[candidate.pickTier!] ?? 0) + 1;
        return counts;
      }, {});
      console.info(JSON.stringify({ query, snapshotTime: session.generatedAt, snapshotOnly: true,
        researchMode: ranked.constraints.researchMode, sportsbookCandidates: candidates.length, basicEligibility: basic.length,
        lowThresholdPreference: low.length, researchSurvivors: surviving.length, returned: ranked.selected.length, tiers,
        picks: ranked.selected.map((candidate) => ({ player: candidate.player, market: candidate.marketKey, line: candidate.line, tier: candidate.pickTier })) }));
      expect(ranked.constraints.lowThreshold).toBe(true);
      expect(surviving).toHaveLength(45);
      expect(ranked.selected).toHaveLength(15);
      expect(tiers).toEqual({ ELITE: 13, EDGE: 2 });
      expect(ranked.selected.every((candidate) => candidate.pickTier !== 'PASS')).toBe(true);
    }
    for (const [player, market] of [['Chris Olave', 'player_reception_yds'], ['Chris Olave', 'player_receptions'],
      ['Juwan Johnson', 'player_reception_yds'], ['Bijan Robinson', 'player_rush_yds'], ['Tyler Shough', 'player_pass_yds'],
      ['Tyler Shough', 'player_pass_completions'], ['Tyler Shough', 'player_rush_yds']]) {
      const original = candidates.find((candidate) => candidate.player === player && candidate.marketKey === market
        && (player !== 'Chris Olave' || market !== 'player_reception_yds' || candidate.line === 84.5));
      if (!original) { console.info(JSON.stringify({ player, market, savedPlayUnavailable: true })); continue; }
      const updated = evaluateNFLSavedResearchMode(original, 'STANDARD');
      expect(updated.nflResearchProfile?.matchupModel?.projectionAdjustment).toBe(0);
      expect(updated.projection).toBe(original.projection);
      expect(updated.trueProbability).toBe(original.trueProbability);
      expect(updated.priceEdgePercent).toBe(original.priceEdgePercent);
      expect(updated.evPercent).toBe(original.evPercent);
      console.info(JSON.stringify({ player, market, snapshotOnly: true, originalPairedOpportunityAvailable: Boolean(original.nflResearchProfile?.projectionModel?.opportunityInputs?.length),
        line: original.line, odds: original.odds, savedProjectionBefore: original.projection, savedProjectionAfter: updated.projection,
        savedProbability: updated.trueProbability, savedImpliedProbability: updated.breakEvenProbability, savedPriceEdge: updated.priceEdgePercent,
        savedEV: updated.evPercent, tierAfterUnchangedClassifier: classifyPickTier(updated, 'nfl').pickTier,
        matchupConfidence: updated.nflResearchProfile?.matchupModel?.confidence,
        adjustment: updated.nflResearchProfile?.matchupModel?.projectionAdjustment,
        injuryEvidence: updated.nflResearchProfile?.matchupModel?.injuryEvidence,
        opponentEvidence: updated.nflResearchProfile?.matchupModel?.evidenceFor,
      }));
    }
  });
});