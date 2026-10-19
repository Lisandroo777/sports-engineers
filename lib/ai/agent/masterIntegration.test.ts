import { describe, expect, it } from 'vitest';
import { parseCandidateSearchConstraints } from './tools';
import { crossSportScope, runCrossSportSearch } from './runner';
import type { AgentTurnResult } from './runner';
import { buildResearchSession } from './session';
import type { FinderResult } from '../../finder/engine';
import { computeMarketMovement } from '../../finder/marketMovement';
import { computeOutlierDependency } from '../../finder/outlierAnalysis';
import { computeVolumeEfficiency } from '../../finder/volumeEfficiency';
import { computeAlternateLineOptimizer } from '../../finder/alternateLineOptimizer';
import { computeCrossBookThreshold } from '../../finder/crossBookThreshold';

describe('master integration request boundaries', () => {
  it('retains calculated model price edge even when pre-research provider EV is unavailable', () => {
    const result = {
      sport: 'mlb', id: 'priced', player: 'Fixture', playerId: 1, teamId: 1, teamName: 'Home', opponentTeamId: 2, opponentName: 'Away',
      homeAway: 'home', gameTimeIso: new Date(Date.now() + 3600000).toISOString(), marketLabel: 'Hits', marketKey: 'batter_hits', line: 0.5,
      side: 'over', isAlternate: false, bestBook: { sportsbookName: 'Book', odds: 110 }, availableBooks: 2,
      evPercent: null, projection: 1.8, projectionUncertainty: 0.8, finderScore: 90, grade: null,
      historical: { l5: '5/5', l10: '9/10', l20: '18/20', l40: '18/20', season: '18/20', l5Rate: 100, l10Rate: 90, l20Rate: 90, seasonRate: 90 },
      signals: [], concerns: [], gameId: 'game', eventId: 'event', marketUpdatedAt: new Date().toISOString(),
      marketMovement: computeMarketMovement([]), outlierDependency: computeOutlierDependency([], 'batter_hits'),
      volumeEfficiency: computeVolumeEfficiency([], 'batter_hits', 0.5, 'over', false),
      alternateLineOptimizer: computeAlternateLineOptimizer([], 'Fixture', 'batter_hits', 'over'), crossBookThreshold: computeCrossBookThreshold([], 'Fixture', 'batter_hits'),
      howItLoses: ['Production may fall short.'], sources: [],
    } as FinderResult;
    const session = buildResearchSession({ sport: 'mlb', date: '2026-10-14', queryIntent: '', results: [result],
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 2, candidatesFound: 1, cached: true, dataFreshnessSeconds: 0, budgetLimited: false } });
    expect(session.candidates[0].evPercent).toBeGreaterThan(0);
    expect(session.candidates[0].priceEdgePercent).toBeGreaterThan(0);
    expect(session.candidates[0].pickTier).not.toBe('PASS');
  });
  it('does not reinterpret ISO slate dates as American odds', () => {
    for (const sport of ['NBA', 'NFL', 'MLB']) {
      expect(parseCandidateSearchConstraints(`Best ${sport} picks 2026-10-14`, []).targetOdds).toBeNull();
    }
  });

  it('preserves explicitly requested signed American prices', () => {
    expect(parseCandidateSearchConstraints('Best NBA picks around -200', []).targetOdds).toBe(-200);
    expect(parseCandidateSearchConstraints('Best MLB picks around +120', []).targetOdds).toBe(120);
  });

  it('discovers all connected sports without widening an explicit sport or matchup', () => {
    expect(crossSportScope('Best picks today')).toEqual(['mlb', 'nba', 'nfl']);
    expect(crossSportScope('Most likely picks')).toEqual(['mlb', 'nba', 'nfl']);
    expect(crossSportScope('Best NBA and NFL picks')).toEqual(['nba', 'nfl']);
    expect(crossSportScope('Best NBA picks')).toEqual([]);
    expect(crossSportScope('Best picks for Lakers vs Celtics')).toEqual([]);
    expect(crossSportScope('Can you show previous pick results?')).toEqual([]);
  });

  it('retains qualified results when another provider fails and preserves source tiers', async () => {
    const searched: string[] = [];
    const result = await runCrossSportSearch('Best value picks today', '2026-10-14', ['mlb', 'nba', 'nfl'], async sport => {
      searched.push(sport);
      if (sport === 'nfl') throw new Error('Provider fixture failure');
      return { reply: '', results: [{ candidateId: sport, pickTier: sport === 'nba' ? 'EDGE' : 'SHARP', evPercent: sport === 'nba' ? 8 : 4 }],
        closestMisses: [], toolTrace: [], researchSessionId: `${sport}-session`, meta: { sport, researchComplete: true, gamesFound: 2, gamesScheduled: 2, candidatesFound: 10 } } as AgentTurnResult;
    });
    expect(searched).toEqual(['mlb', 'nba', 'nfl']);
    expect(result.results).toMatchObject([{ candidateId: 'nba', sport: 'nba', pickTier: 'EDGE' }, { candidateId: 'mlb', sport: 'mlb', pickTier: 'SHARP' }]);
    expect(result.results).toMatchObject([{ rank: 1 }, { rank: 2 }]);
    expect(result.meta).toMatchObject({ sport: 'all', partialCoverage: true, gamesFound: 4, candidatesFound: 20 });
    expect(result.researchSessionId).toBeNull();
    expect((result.meta?.coverage as Array<{ status: string }>)[2].status).toBe('PROVIDER_ERROR');
  });

  it('returns every independently qualified result unless the user explicitly requests a count', async () => {
    const search = async (): Promise<AgentTurnResult> => ({ reply: '', results: Array.from({ length: 24 }, (_, index) => ({
      candidateId: `qualified-${index}`, pickTier: 'EDGE', evPercent: 24 - index,
    })), closestMisses: [], toolTrace: [], researchSessionId: null, meta: { researchComplete: true } });
    expect((await runCrossSportSearch('Best value NBA and MLB picks tomorrow', '2026-10-20', ['nba'], search)).results).toHaveLength(24);
    expect((await runCrossSportSearch('Best 20 NBA and MLB picks tomorrow', '2026-10-20', ['nba'], search)).results).toHaveLength(20);
  });
});