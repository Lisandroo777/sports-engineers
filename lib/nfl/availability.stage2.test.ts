import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNFLInjuryContext, evaluateNFLPlayerAvailability, getNFLInjurySnapshot, isNFLPlayerAvailabilityKnown, nflAvailabilityRisk, parseNFLInjuryReports, type NFLInjurySnapshot } from './injuries';
import { espnSiteFetch } from './client';
import { projectNFLMarket } from './projection';
import { analyzeNFLCandidate, buildNFLEliteCandidate, type NFLResearchCandidate } from './research';
import type { NFLGameLogEntry } from './types';

vi.mock('./client', () => ({ espnSiteFetch: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

const now = new Date('2026-10-04T12:00:00Z');
const snapshot: NFLInjurySnapshot = { reports: [], complete: true, fetchedAt: now.toISOString(), sourceStatus: 'CURRENT' };

function context(status?: string, failed = false) {
  const reports = status ? parseNFLInjuryReports({ injuries: [{ id: '12', injuries: [{ athlete: { id: '1', displayName: 'Test QB' }, status, date: now.toISOString() }] }] }, now) : [];
  return buildNFLInjuryContext({ playerId: 1, player: 'Test QB', teamId: 12, team: 'Kansas City Chiefs', opponentTeamId: 13, market: 'player_pass_yds', position: 'QB', reports,
    snapshot: failed ? { ...snapshot, complete: false, sourceStatus: 'MISSING' } : { ...snapshot, reports }, sourceAvailable: !failed, now });
}

function candidate(injuryContext = context()): NFLResearchCandidate {
  const logs: NFLGameLogEntry[] = Array.from({ length: 10 }, (_, index) => ({ gameId: String(index), week: index + 1, date: `2026-09-${String(index + 1).padStart(2, '0')}`, opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats: { passingAttempts: 35, passingYards: 280 + index * 2 } }));
  return { candidateId: 'qb', playerId: 1, player: 'Test QB', market: 'player_pass_yds', line: 244.5, direction: 'over', projection: 290, projectionUncertainty: 30, logs,
    matchupAvailable: true, injuryContext, weatherContext: { sourceStatus: 'NOT_APPLICABLE' } as NFLResearchCandidate['weatherContext'],
    oddsAmerican: -110, lastUpdatedAt: new Date().toISOString(), isAlternate: false, marketSupport: 'full' };
}

describe('NFL availability evidence', () => {
  it('treats no designation in a complete current feed as evidence, not confirmed active status', () => {
    const injury = context();
    expect(injury.player.availabilityDesignation).toBe('NO_CURRENT_INJURY_DESIGNATION');
    expect(isNFLPlayerAvailabilityKnown(injury)).toBe(true);
    expect(injury.player.evidence).toContain('not confirmation');
    expect(buildNFLEliteCandidate(candidate(injury)).statusKnown).toBe(true);
    expect(analyzeNFLCandidate(candidate(injury)).dataQuality).toBe(100);
    expect(analyzeNFLCandidate(candidate(injury)).eliteQualified).toBe(true);
  });

  it('keeps explicit active confirmation distinct', () => {
    expect(context('Active').player.availabilityDesignation).toBe('CONFIRMED_AVAILABLE');
  });

  it('materially increases questionable uncertainty and qualification risk', () => {
    const injury = context('Questionable');
    const base = candidate();
    const healthyProjection = projectNFLMarket({ logs: base.logs, market: base.market, injuryContext: context() });
    const questionableProjection = projectNFLMarket({ logs: base.logs, market: base.market, injuryContext: injury });
    expect(questionableProjection.uncertainty).toBeCloseTo(healthyProjection.uncertainty! * 1.35, 1);
    expect(analyzeNFLCandidate(candidate(injury)).trapRisk).toBeGreaterThanOrEqual(20);
    expect(nflAvailabilityRisk(injury).points).toBe(20);
  });

  it.each(['Doubtful', 'Out'])('rejects %s regardless of strong statistical evidence', (status) => {
    const injury = context(status);
    expect(evaluateNFLPlayerAvailability(injury).eligible).toBe(false);
    expect(analyzeNFLCandidate(candidate(injury)).eliteQualified).toBe(false);
  });

  it('keeps actual data failure unknown and ineligible', () => {
    const injury = context(undefined, true);
    expect(injury.player.availabilityDesignation).toBe('UNKNOWN');
    expect(isNFLPlayerAvailabilityKnown(injury)).toBe(false);
    expect(analyzeNFLCandidate(candidate(injury)).eliteQualified).toBe(false);
    expect(analyzeNFLCandidate(candidate(injury)).rejectedReasons).toContain('Current player availability could not be verified.');
  });

  it('does not use an expired retrieval timestamp as current no-designation evidence', () => {
    const injury = buildNFLInjuryContext({ playerId: 1, player: 'Test QB', teamId: 12, team: 'Kansas City Chiefs', opponentTeamId: 13,
      market: 'player_pass_yds', position: 'QB', reports: [], snapshot: { ...snapshot, fetchedAt: '2026-09-01T12:00:00Z' }, now });
    expect(injury.player.availabilityDesignation).toBe('UNKNOWN');
    expect(isNFLPlayerAvailabilityKnown(injury)).toBe(false);
  });

  it('questionable risk can reject an otherwise positive statistical candidate', () => {
    const uncertain = candidate(context('Questionable'));
    const analysis = analyzeNFLCandidate({ ...uncertain, historySample: {
      season: 2026, logs: uncertain.logs, currentSeason: uncertain.logs.slice(-1), previousSeason: uncertain.logs.slice(0, -1),
      currentObservations: 1, previousObservations: 9, observations: 10, supplemented: true, confidence: 'LIMITED',
      uncertaintyMultiplier: 1.42, excludedPreviousGames: 0, reasons: [],
    } });
    expect(analysis.trapRisk).toBeGreaterThan(25);
    expect(analysis.eliteQualified).toBe(false);
  });

  it('distinguishes an empty valid feed from a malformed no-data response', async () => {
    vi.mocked(espnSiteFetch).mockResolvedValueOnce({ injuries: [] }).mockResolvedValueOnce({});
    expect(await getNFLInjurySnapshot(now)).toMatchObject({ complete: true, sourceStatus: 'CURRENT' });
    await expect(getNFLInjurySnapshot(now)).rejects.toThrow('incomplete');
    expect(espnSiteFetch).toHaveBeenCalledWith('injuries', {}, 0);
  });

  it('propagates a retrieval failure instead of converting it to a healthy designation', async () => {
    vi.mocked(espnSiteFetch).mockRejectedValue(new Error('fixture provider failure'));
    await expect(getNFLInjurySnapshot(now)).rejects.toThrow('fixture provider failure');
  });
});