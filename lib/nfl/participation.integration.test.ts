import { afterEach, describe, expect, it, vi } from 'vitest';
import { espnSiteFetch } from './client';
import { getNFLParticipationSnapshot, evaluateNFLParticipation } from './participation';
import { buildNFLInjuryContext, isNFLPlayerAvailabilityKnown, evaluateNFLPlayerAvailability, nflAvailabilityRisk, parseNFLInjuryReports } from './injuries';
import { analyzeNFLCandidate } from './research';
import { projectNFLMarket } from './projection';
import type { NFLGame } from './types';

vi.mock('./client', () => ({ espnSiteFetch: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const now = new Date('2026-10-05T12:00:00Z');
const game = { id: 'game', gameTime: '2026-10-06T00:15:00Z', homeTeam: { id: 18 }, awayTeam: { id: 1 } } as NFLGame;

function sources() {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.mocked(espnSiteFetch).mockImplementation(async (path) => {
    if (path === 'summary') return { header: { id: 'game', competitions: [{ date: game.gameTime, competitors: [{ team: { id: '1' } }, { team: { id: '18' } }] }] }, injuries: [{ team: { id: '1' }, injuries: [] }] } as never;
    const team = path.includes('/18/') ? '18' : '1';
    if (path.endsWith('/roster')) return { timestamp: now.toISOString(), team: { id: team }, athletes: [{ items: [{ id: '10', status: { name: 'Active' }, injuries: [] }] }] } as never;
    return { timestamp: now.toISOString(), team: { id: team }, depthchart: [{ positions: { qb: { position: { abbreviation: 'QB' }, athletes: [{ id: '10', injuries: [] }] } } }] } as never;
  });
}

describe('participation sources connected to Elite research', () => {
  it('fetches game, roster, and depth sources once and supports expected participation', async () => {
    sources();
    const snapshot = await getNFLParticipationSnapshot(game, now);
    expect(espnSiteFetch).toHaveBeenCalledTimes(5);
    expect(espnSiteFetch).toHaveBeenCalledWith('teams/1/roster', {}, 0);
    const participation = evaluateNFLParticipation({ playerId: 10, teamId: 1, position: 'QB', snapshot, injuries: null, now });
    const injury = buildNFLInjuryContext({ playerId: 10, player: 'QB', teamId: 1, team: 'Falcons', opponentTeamId: 18,
      market: 'player_pass_yds', position: 'QB', reports: [], sourceAvailable: false, participation, now });
    expect(injury.player.availabilityDesignation).toBe('EXPECTED_AVAILABLE');
    expect(isNFLPlayerAvailabilityKnown(injury, now)).toBe(true);
    expect(nflAvailabilityRisk(injury)).toMatchObject({ points: 5, uncertaintyMultiplier: 1.1 });
    const logs = Array.from({ length: 12 }, (_, index) => ({ gameId: String(index), week: index + 1, date: `2026-09-${String(index + 1).padStart(2, '0')}`, opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home' as const, result: 'W', stats: { passingAttempts: 35, passingYards: 280 + index * 2 } }));
    const projection = projectNFLMarket({ logs, market: 'player_pass_yds', injuryContext: injury });
    const analysis = analyzeNFLCandidate({ candidateId: 'qb', playerId: 10, player: 'QB', market: 'player_pass_yds', line: 244.5, direction: 'over',
      projection: projection.projection, projectionUncertainty: projection.uncertainty, logs, matchupAvailable: true, oddsAmerican: -110,
      lastUpdatedAt: now.toISOString(), isAlternate: false, marketSupport: 'full', injuryContext: injury, weatherContext: { sourceStatus: 'NOT_APPLICABLE' } as never });
    expect(analysis.dataQuality).toBe(100); expect(analysis.trapRisk).toBe(5); expect(analysis.eliteQualified).toBe(true);
    vi.setSystemTime(new Date(participation.expiresAt + 1));
    const afterExpiry = new Date(participation.expiresAt + 1);
    expect(isNFLPlayerAvailabilityKnown(injury, afterExpiry)).toBe(false);
    expect(evaluateNFLPlayerAvailability(injury, afterExpiry).eligible).toBe(false);
  });

  it('current INACTIVE evidence cannot qualify through the roster path', async () => {
    sources(); const snapshot = await getNFLParticipationSnapshot(game, now);
    const reports = parseNFLInjuryReports({ injuries: [{ id: '1', injuries: [{ athlete: { id: '10' }, status: 'Inactive', date: now.toISOString() }] }] }, now);
    const participation = evaluateNFLParticipation({ playerId: 10, teamId: 1, position: 'QB', snapshot,
      injuries: { reports, complete: true, sourceStatus: 'CURRENT', fetchedAt: now.toISOString() }, now });
    const context = buildNFLInjuryContext({ playerId: 10, player: 'QB', teamId: 1, team: 'Falcons', opponentTeamId: 18, market: 'player_pass_yds', position: 'QB', reports, participation, now });
    expect(context.player.availabilityDesignation).toBe('INACTIVE');
    expect(evaluateNFLPlayerAvailability(context).eligible).toBe(false);
  });

  it('source failure is preserved rather than turned into active status', async () => {
    sources(); vi.mocked(espnSiteFetch).mockRejectedValue(new Error('fixture source failure'));
    const snapshot = await getNFLParticipationSnapshot(game, now);
    expect(snapshot.failures).toHaveLength(5);
    expect(evaluateNFLParticipation({ playerId: 10, teamId: 1, position: 'QB', snapshot, injuries: null, now }).designation).toBe('DATA_FAILURE');
  });
});