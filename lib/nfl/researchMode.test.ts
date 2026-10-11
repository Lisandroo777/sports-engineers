import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNFLResearchProfile, makeNFLResearchLayer, type NFLGameScriptResearch, type NFLResearchProfileInput } from './researchModel';
import { buildNFLRoleContext } from './roleContext';
import type { NFLGameLogEntry } from './types';
import { buildResearchSessionFromCandidates, type ResearchSession } from '../ai/agent/session';
import { analyzePickCandidate } from '../ai/eliteResearchFilter';
import { createAgentContext, executeTool, selectRankedCandidates } from '../ai/agent/tools';
import { rankCachedSession } from '../ai/agent/runner';
import type { NFLInjuryContext } from './injuries';

afterEach(() => vi.useRealTimers());

function input(): NFLResearchProfileInput {
  const injuryTimestamp = new Date().toISOString();
  const logs = Array.from({ length: 10 }, (_, index) => ({ gameId: `${index}`, date: `2026-09-${index + 1}`,
    result: 'W', week: index + 1, opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home' as const,
    stats: { receivingTargets: 8, receivingYards: 64 } })) satisfies NFLGameLogEntry[];
  return { player: 'Receiver', team: 'Team', position: 'WR', market: 'player_reception_yds', direction: 'over', line: 40.5,
    sportsbook: 'Book', oddsAmerican: -110, priceTimestamp: '2026-10-05T19:00:00Z', retrievedAt: '2026-10-05T19:00:00Z',
    priceCurrent: true, priceFreshness: 'FRESH', trueProbability: 65, priceEdge: 12.6, valueQualified: true,
    existingEliteQualified: false, dataQuality: 80, rawEdge: 23.5, roleContext: buildNFLRoleContext(logs, 'player_reception_yds'), roleLogs: logs,
    opponentContext: { status: 'PARTIAL', opponentTeamId: 2, metrics: [], evidence: ['Recorded basic opponent context'], missingFields: ['coverage shells'] } as never,
    injuryContext: { player: { player: 'Receiver', playerId: 1, teamId: 1, sourceStatus: 'CURRENT', availabilityDesignation: 'CONFIRMED_AVAILABLE', updatedAt: injuryTimestamp },
      sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: injuryTimestamp, teammateAbsences: [], opponentAbsences: [] } as never,
    weatherContext: null, marketSupport: 'full', historyGames: 10, projectionAvailable: true, availabilityEligible: true,
    alternatePrices: [], supportingReasons: ['Projection and recorded targets support the line.'], counterReasons: ['Opportunity can vary by game.'],
    layerOverrides: { gameScript: makeNFLResearchLayer<NFLGameScriptResearch>('UNAVAILABLE', null, ['spread', 'total']) },
  };
}

describe('NFL mode-specific completeness', () => {
  function record(score: number) {
    const base = input();
    const analysis = analyzePickCandidate({ candidateId: `receiver-${score}`, sport: 'nfl', playerId: 1, player: base.player,
      market: base.market, line: base.line, direction: 'over', isAlternate: false, projection: 64, projectionUncertainty: 15,
      historicalRates: [80, 80, 80], sampleSize: 10, oddsAmerican: -110, marketFairProbability: null, matchupAvailable: true,
      usageAvailable: true, roleKnown: true, gameContextAvailable: true, opponentPersonnelAvailable: false, statusKnown: true,
      marketConfirmationAvailable: true, lastUpdatedAt: new Date().toISOString(), requiredMarketSupported: true });
    const profile = buildNFLResearchProfile({ ...base, researchMode: 'DEEP' });
    return buildResearchSessionFromCandidates({ sport: 'nfl', date: '2026-10-05', queryIntent: '',
      candidates: [{ candidateId: `receiver-${score}`, player: base.player, team: base.team, opponent: 'Opponent',
        marketLabel: 'Receiving Yards', marketKey: base.market, line: base.line, direction: 'over', book: 'Book', odds: -110,
        projection: 64, projectionUncertainty: 15, sampleSize: 10, l5Rate: 80, l10Rate: 80, l20Rate: null, seasonRate: 80,
        analysis: { ...analysis, researchScore: score, eliteQualified: false, dataQuality: 80, trapRisk: 10 },
        injuryContext: base.injuryContext,
        nflResearchProfile: profile, opponentContext: { status: 'PARTIAL', availableMetrics: [], unavailableMetrics: ['coverage'], evidence: ['Basic context'] } }],
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1, cached: true, dataFreshnessSeconds: 0, budgetLimited: false },
    }).candidates[0];
  }
  it.each([[78, 'EDGE'], [72, 'LEAN']] as const)('returns score %s as %s with zero Elite, without promotion', (score, tier) => {
    const candidate = record(score);
    const standard = selectRankedCandidates([candidate], 'Give me low-threshold NFL plays', { sport: 'nfl' });
    expect(standard.selected).toHaveLength(1);
    expect(standard.selected[0].pickTier).toBe(tier);
    expect(standard.selected[0].eliteQualified).toBe(false);
    expect(selectRankedCandidates([candidate], 'Deep research low-threshold NFL plays', { sport: 'nfl' }).selected).toHaveLength(0);
  });
  it('does not reuse a Standard-only candidate for Deep and never bypasses stale-price safety', () => {
    const candidate = record(78);
    const standard = selectRankedCandidates([candidate], 'Give me low-threshold NFL plays', { sport: 'nfl' }).selected[0];
    expect(selectRankedCandidates([standard], 'Deep research low-threshold NFL plays', { sport: 'nfl' }).selected).toHaveLength(0);
    expect(selectRankedCandidates([{ ...candidate, priceCurrent: false, priceFreshness: 'STALE' }], 'Give me low-threshold NFL plays', { sport: 'nfl' }).selected).toHaveLength(0);
  });
  it('declines cached reranking when recorded quotes expire despite saved current flags', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T21:00:00Z'));
    const candidate = record(78);
    expect(candidate.priceCurrent).toBe(true);
    const session = { sport: 'nfl', date: '2026-10-05', candidates: [candidate] } as ResearchSession;
    expect(rankCachedSession(session, 'Give me low-threshold NFL plays', null)).toBeNull();
  });
  it('reuses cached NFL ranking only while both quote and every stored injury timestamp are fresh', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T19:30:00Z'));
    const candidate = record(78);
    const session = { sport: 'nfl', date: '2026-10-05', generatedAt: '2026-10-05T19:30:00Z', toolMeta: {}, candidates: [candidate] } as ResearchSession;
    expect(rankCachedSession(session, 'Give me low-threshold NFL plays', null)).not.toBeNull();
    const injury = candidate.injuryContext as NFLInjuryContext;
    const staleInjury = { ...candidate, injuryContext: { ...injury, lastUpdated: '2026-10-01T00:00:00Z',
      player: { ...injury.player, updatedAt: '2026-10-01T00:00:00Z', sourceStatus: 'CURRENT' as const } } };
    expect(rankCachedSession({ ...session, candidates: [staleInjury] }, 'Give me low-threshold NFL plays', null)).toBeNull();
    expect(selectRankedCandidates([staleInjury], 'Give me low-threshold NFL plays', { sport: 'nfl', requireFreshNFLInjury: true }).selected).toHaveLength(0);
  });
  it('does not expose stale NFL candidates through get_last_research_session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T19:30:00Z'));
    const fresh = record(78);
    const session = { sport: 'nfl', date: '2026-10-05', generatedAt: '2026-10-05T19:30:00Z', toolMeta: {}, candidates: [fresh] } as ResearchSession;
    const freshResult = await executeTool('get_last_research_session', {}, createAgentContext(session));
    expect(freshResult.status).toBe('SUCCESS');
    const stale = { ...fresh, injuryContext: { ...(fresh.injuryContext as NFLInjuryContext), lastUpdated: '2026-10-01T00:00:00Z',
      player: { ...(fresh.injuryContext as NFLInjuryContext).player, sourceStatus: 'CURRENT' as const, updatedAt: '2026-10-01T00:00:00Z' } } };
    const staleResult = await executeTool('get_last_research_session', {}, createAgentContext({ ...session, candidates: [stale] }));
    expect(staleResult.status).toBe('NO_CANDIDATES');
  });
  it('does not rank stale NFL injury candidates through the cached closest-miss tool', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T19:30:00Z'));
    const fresh = record(78);
    const injury = fresh.injuryContext as NFLInjuryContext;
    const stale = { ...fresh, injuryContext: { ...injury, lastUpdated: '2026-10-01T00:00:00Z',
      player: { ...injury.player, sourceStatus: 'CURRENT' as const, updatedAt: '2026-10-01T00:00:00Z' } } };
    const session = { sport: 'nfl', date: '2026-10-05', generatedAt: '2026-10-05T19:30:00Z', toolMeta: {}, candidates: [stale] } as ResearchSession;
    const result = await executeTool('get_closest_misses', {}, createAgentContext(session));
    expect(result.status).toBe('NO_CANDIDATES');
  });
  it('allows Standard with good basic evidence and missing optional spread/advanced layers', () => {
    const profile = buildNFLResearchProfile({ ...input(), researchMode: 'STANDARD' });
    expect(profile.evidence.verdict).toBe('PLAY');
    expect(profile.researchMode).toBe('STANDARD');
    expect(profile.productionEliteQualified).toBe(false);
    expect(profile.practice.status).toBe('UNAVAILABLE');
    expect(profile.role.value?.routeParticipation).toBeNull();
  });
  it('retains Deep completeness and every framework layer', () => {
    const profile = buildNFLResearchProfile({ ...input(), researchMode: 'DEEP' });
    expect(profile.evidence.verdict).toBe('PASS');
    expect(profile.hardGates.requiredDataPresent.passed).toBe(false);
    expect(profile.hardGates.evidenceQuality.passed).toBe(false);
    expect(profile).toHaveProperty('schemeMatchup');
    expect(profile).toHaveProperty('intelligence');
    expect(profile).toHaveProperty('marketIntelligence');
    expect(profile).toHaveProperty('seasonContext');
  });
  it.each(['STANDARD', 'DEEP'] as const)('keeps %s safety fail-closed for unresolved player availability', (researchMode) => {
    expect(buildNFLResearchProfile({ ...input(), researchMode, availabilityEligible: false }).evidence.verdict).toBe('PASS');
  });
});