import { describe, expect, it } from 'vitest';
import { buildNBAResearchContext } from '../context/engine';
import { fixtureGame, fixtureSource, fixturePlayer } from '../context/fixtures';
import type { InjuryObservation, NBAContextSnapshot } from '../context/types';
import { buildNBAIntelligence } from '../intelligence/engine';
import { adaptNBAAgent2Context, nbaObservedGamesFromAgent2Snapshot } from './contextAdapter';
import { predictNBAMarket } from './engine';
import type { NBAProjectionInput } from './types';

const targetTipoff = '2026-01-21T20:00:00.000Z';
const asOf = '2026-01-21T19:00:00.000Z';
const freshSource = (id: string) => ({ ...fixtureSource(id), publishedAt: '2026-01-21T18:00:00.000Z', updatedAt: '2026-01-21T18:00:00.000Z', fetchedAt: '2026-01-21T18:00:00.000Z' });

function snapshot(status?: InjuryObservation['status']): NBAContextSnapshot {
  const games = Array.from({ length: 20 }, (_, index) => {
    const points = index % 2 === 0 ? 24 : 16;
    const game = fixtureGame(index + 1, { gameId: `prior-${index + 1}`, seasonId: '2026', phase: 'REGULAR',
      startsAt: `2026-01-${String(index + 1).padStart(2, '0')}T18:00:00.000Z`,
      completedAt: `2026-01-${String(index + 1).padStart(2, '0')}T20:00:00.000Z`,
      source: freshSource(`prior-${index + 1}`), homeScore: 100, awayScore: 90 });
    game.teams[0].players = [fixturePlayer(10, { stats: { ...fixturePlayer(10).stats, minutes: 30, points, rebounds: 7, assists: 5, tpm: 3 } })];
    return game;
  });
  const target = fixtureGame(21, { gameId: 'target', seasonId: '2026', phase: 'REGULAR', startsAt: targetTipoff, completed: false, completedAt: null,
    homeScore: null, awayScore: null, source: freshSource('target') });
  const injuries: InjuryObservation[] = status ? [{ playerId: 10, teamId: 1, status, rawStatus: status, comment: null, source: freshSource('injury-10') }] : [];
  return { target, asOf, games, calendar: [...games, target], injuries, injuryFeed: { state: 'AVAILABLE', source: freshSource('injury-feed') }, news: [], missing: [] };
}

function buildContext(raw = snapshot()) {
  return buildNBAResearchContext({ playerId: 10, teamId: 1, gameId: 'target', asOf }, raw);
}

function projectionInput(): NBAProjectionInput {
  const observations = snapshot().games.map((game, index) => {
    const player = game.teams[0].players[0];
    return { season: 2026, phase: 'REGULAR' as const, source: game.source.id, log: { gameId: game.gameId, date: game.startsAt,
      opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home' as const, result: index % 2 ? 'L' : 'W',
      stats: { minutes: 30, points: player.stats.points!, totalRebounds: player.stats.rebounds!, assists: player.stats.assists!,
        'threePointFieldGoalsMade-threePointFieldGoalsAttempted': player.stats.tpm! } } };
  });
  return { playerId: 10, teamId: 1, playerName: 'Player 10', market: 'points', targetPhase: 'REGULAR', targetSeason: 2026,
    targetGameId: 'target', targetTipoff, observations, injury: 'UNKNOWN', line: 20, direction: 'over', americanOdds: -110,
    sportsbook: 'Fixture Book', quoteTimestamp: '2026-01-21T19:30:00.000Z', oppositeQuote: { market: 'points', line: 20, direction: 'under',
      americanOdds: -110, sportsbook: 'Fixture Book', quoteTimestamp: '2026-01-21T19:30:00.000Z' } };
}

describe('Agent #2 NBAResearchContext and NBAIntelligenceSnapshot integration', () => {
  it('adapts the actual schema v1 context without fabricating unavailable projections', () => {
    const context = buildContext();
    const adapted = adaptNBAAgent2Context({ researchContext: context, playerId: 10, teamId: 1, gameId: 'target', targetTipoff,
      targetSeason: 2026, targetPhase: 'REGULAR', market: 'points' });
    expect(context.schemaVersion).toBe('1');
    expect(adapted!.contextSchemaVersion).toBe('1');
    expect(adapted!.injury).toBe('REPORT_MISSING');
    expect(adapted!.contextEvidence.length).toBeGreaterThan(0);
    expect(adapted!.contextEvidence.some((entry) => entry.metric === 'officialExpectedUsage')).toBe(false);
    expect(nbaObservedGamesFromAgent2Snapshot(snapshot(), 10, 1)).toHaveLength(20);
  });

  it('uses phase from the real context games and separates regular, play-in and playoff histories', () => {
    const raw = snapshot();
    raw.target.phase = 'POSTSEASON';
    raw.target.round = 'Play-In';
    raw.games = raw.games.map((game) => ({ ...game, phase: 'POSTSEASON', round: 'Play-In' }));
    const context = buildNBAResearchContext({ playerId: 10, teamId: 1, gameId: 'target', asOf }, raw);
    const observations = nbaObservedGamesFromAgent2Snapshot(raw, 10, 1);
    expect(context.sections.season.phase).toBe('POSTSEASON');
    expect(observations[0].phase).toBe('PLAY_IN');
    expect(() => adaptNBAAgent2Context({ researchContext: context, playerId: 10, teamId: 1, gameId: 'target', targetTipoff,
      targetSeason: 2026, targetPhase: 'POSTSEASON', market: 'points' })).toThrow(/phase/i);
    expect(adaptNBAAgent2Context({ researchContext: context, playerId: 10, teamId: 1, gameId: 'target', targetTipoff,
      targetSeason: 2026, targetPhase: 'PLAY_IN', market: 'points' })!.contextSchemaVersion).toBe('1');
  });

  it('integrates a real empty intelligence v1 snapshot as missing coverage, not invented news', () => {
    const context = buildContext();
    const intelligence = buildNBAIntelligence({ target: { gameId: 'target', homeTeamId: 1, awayTeamId: 2, startsAt: targetTipoff,
      basketballDate: '2026-01-21', matchupAliases: [] }, asOf, documents: [], claims: [], identities: [], researchContexts: [context] });
    const result = predictNBAMarket({ ...projectionInput(), researchContext: context, intelligenceSnapshot: intelligence });
    expect(intelligence.schemaVersion).toBe('1');
    expect(result.researchContextVersion).toBe('1');
    expect(result.intelligenceSnapshotId).toBe(intelligence.snapshotId);
    expect(result.contextMissing).toContain('No verified applicable intelligence reports. Missing coverage does not imply availability.');
    expect(result.intelligenceEvidence).toEqual([]);
  });

  it('fails closed on wrong player/game and future cutoff contexts', () => {
    const context = buildContext();
    expect(() => adaptNBAAgent2Context({ researchContext: context, playerId: 99, teamId: 1, gameId: 'target', targetTipoff,
      targetSeason: 2026, targetPhase: 'REGULAR', market: 'points' })).toThrow(/identity/i);
    expect(() => adaptNBAAgent2Context({ researchContext: { ...context, cutoff: '2026-01-22T00:00:00Z' }, playerId: 10, teamId: 1,
      gameId: 'target', targetTipoff, targetSeason: 2026, targetPhase: 'REGULAR', market: 'points' })).toThrow(/cutoff/i);
  });

  it('honors a fresh explicit OUT report from the Agent #2 availability contract', () => {
    const context = buildContext(snapshot('OUT'));
    const result = predictNBAMarket({ ...projectionInput(), researchContext: context });
    expect(result.expectedStat).toBeNull();
    expect(result.eligibleForReview).toBe(false);
  });
});
