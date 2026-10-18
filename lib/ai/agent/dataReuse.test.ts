import { describe, expect, it } from 'vitest';
import { getClosestMisses, type ResearchSession, type ResearchCandidateRecord } from './session';
import { rankCachedSession, resolveStructuredResults } from './runner';
import { parseCandidateSearchConstraints, selectRankedCandidates } from './tools';

/**
 * Covers the data-reuse CONTRACT: which requests may reuse a stored session and which must not,
 * and that narrowing filters operate on the stored pool rather than triggering a slate reload.
 * The predicates below mirror tools.ts exactly.
 */

/** Mirrors getSportsbookCandidates' reuse guard. */
function canReuseSession(session: ResearchSession | null, sport: string, date: string): boolean {
  return !!session && session.sport === sport && session.date === date && session.candidates.length > 0;
}

/** Mirrors rankCandidates' filter chain. */
function filterPool(pool: ResearchCandidateRecord[], args: {
  playerType?: 'hitter' | 'pitcher' | 'any'; side?: 'over' | 'under' | 'any';
  team?: string; player?: string; marketContains?: string;
}) {
  let out = pool;
  if (args.playerType === 'pitcher') out = out.filter((c) => c.marketKey.startsWith('pitcher_'));
  if (args.playerType === 'hitter') out = out.filter((c) => c.marketKey.startsWith('batter_'));
  if (args.side && args.side !== 'any') out = out.filter((c) => c.direction === args.side);
  if (args.team) out = out.filter((c) => (c.team ?? '').toLowerCase().includes(args.team!.toLowerCase()) || (c.opponent ?? '').toLowerCase().includes(args.team!.toLowerCase()));
  if (args.player) out = out.filter((c) => c.player.toLowerCase().includes(args.player!.toLowerCase()));
  if (args.marketContains) out = out.filter((c) => c.market.toLowerCase().includes(args.marketContains!.toLowerCase()) || c.marketKey.toLowerCase().includes(args.marketContains!.toLowerCase()));
  return out;
}

function candidate(over: Partial<ResearchCandidateRecord>): ResearchCandidateRecord {
  return {
    candidateId: 'c1', rank: 1, player: 'Test Player', team: 'New York Yankees', opponent: 'Boston Red Sox',
    market: 'Hits', marketKey: 'batter_hits', line: 0.5, direction: 'over', book: 'DK', odds: -110,
    availableBooks: 3, projection: 1.2, projectionUncertainty: 0.6, edge: 0.7, sampleSize: 10, priceCurrent: true, valueQualified: true, modelProbability: 70,
    l5Rate: 80, l10Rate: 80, l20Rate: 75, seasonRate: 78, researchScore: 80, signalAgreement: 5,
    signalsAvailable: 6, evidenceCoverage: 93, priceFreshness: 'FRESH', trueProbability: 70,
    evPercent: 5, isAlternate: false, dataQuality: 100, trapRisk: 0, qualification: 'WATCH',
    eliteQualified: false, rejectionReasons: [], grade: 'C', priceGrade: 'B', playerEdgePercent: 5,
    priceEdgePercent: 4, breakEvenProbability: 52, projectedRange: null, bestAlternateLine: null,
    howItLoses: [], evidenceBoard: [], outlierDependencePercent: null,
    ...over,
  } as ResearchCandidateRecord;
}

const pool = [
  candidate({ candidateId: 'a', player: 'Max Scherzer', team: 'Toronto Blue Jays', opponent: 'Baltimore Orioles', market: 'Pitcher Strikeouts', marketKey: 'pitcher_strikeouts', direction: 'under' }),
  candidate({ candidateId: 'b', player: 'Aaron Judge', team: 'New York Yankees', opponent: 'New York Mets', market: 'Hits', marketKey: 'batter_hits', direction: 'over' }),
  candidate({ candidateId: 'c', player: 'Pete Alonso', team: 'New York Mets', opponent: 'New York Yankees', market: 'Total Bases', marketKey: 'batter_total_bases', direction: 'under' }),
  candidate({ candidateId: 'd', player: 'Chris Bassitt', team: 'Baltimore Orioles', opponent: 'Toronto Blue Jays', market: 'Outs Recorded', marketKey: 'pitcher_outs', direction: 'over' }),
];

const session = { sport: 'mlb', date: '2026-09-11', queryIntent: '', generatedAt: '', toolMeta: {}, candidates: pool } as unknown as ResearchSession;

describe('session reuse prevents unnecessary sportsbook reloads', () => {
  it('reuses a stored session for the same sport and date', () => {
    expect(canReuseSession(session, 'mlb', '2026-09-11')).toBe(true);
  });

  it('does NOT reuse a session from a different date', () => {
    expect(canReuseSession(session, 'mlb', '2026-09-12')).toBe(false);
  });

  it('does NOT reuse a session from a different sport', () => {
    expect(canReuseSession(session, 'nfl', '2026-09-11')).toBe(false);
  });

  it('does not reuse an empty session', () => {
    expect(canReuseSession({ ...session, candidates: [] } as ResearchSession, 'mlb', '2026-09-11')).toBe(false);
  });

  it('reuses regardless of how the question is worded (wording is not part of the key)', () => {
    for (const _ of ['favourite opportunities', 'best overs', 'strongest pitcher Ks', 'top 5']) {
      expect(canReuseSession(session, 'mlb', '2026-09-11')).toBe(true);
    }
  });
});

describe('custom queries filter the existing candidate pool', () => {
  it('filters by market (pitcher strikeouts)', () => {
    const out = filterPool(pool, { marketContains: 'strikeout' });
    expect(out.map((c) => c.candidateId)).toEqual(['a']);
  });

  it('filters by direction (overs)', () => {
    expect(filterPool(pool, { side: 'over' }).map((c) => c.candidateId)).toEqual(['b', 'd']);
  });

  it('filters by direction (unders)', () => {
    expect(filterPool(pool, { side: 'under' }).map((c) => c.candidateId)).toEqual(['a', 'c']);
  });

  it('filters by team on either side of the matchup', () => {
    expect(filterPool(pool, { team: 'Yankees' }).map((c) => c.candidateId).sort()).toEqual(['b', 'c']);
  });

  it('filters by player name', () => {
    expect(filterPool(pool, { player: 'scherzer' }).map((c) => c.candidateId)).toEqual(['a']);
  });

  it('filters by player type', () => {
    expect(filterPool(pool, { playerType: 'pitcher' }).map((c) => c.candidateId)).toEqual(['a', 'd']);
    expect(filterPool(pool, { playerType: 'hitter' }).map((c) => c.candidateId)).toEqual(['b', 'c']);
  });

  it('combines filters without reloading anything', () => {
    expect(filterPool(pool, { playerType: 'pitcher', side: 'under' }).map((c) => c.candidateId)).toEqual(['a']);
  });

  it('every filter draws from the same stored pool', () => {
    for (const args of [{ side: 'over' as const }, { team: 'Mets' }, { marketContains: 'hits' }]) {
      expect(filterPool(pool, args).every((c) => pool.includes(c))).toBe(true);
    }
  });
});

describe('blocking reasons are reported accurately', () => {
  /** Mirrors the status selection in getSportsbookCandidates. */
  const statusFor = (blockReason: 'RESERVE' | 'NOT_AUTHORIZED' | null) =>
    blockReason === 'RESERVE' ? 'RESERVE_BLOCKED'
      : blockReason === 'NOT_AUTHORIZED' ? 'PAID_REFRESH_NOT_AUTHORIZED'
        : 'NO_CACHED_SPORTSBOOK_DATA';

  it('only reports RESERVE_BLOCKED when the reserve actually blocked', () => {
    expect(statusFor('RESERVE')).toBe('RESERVE_BLOCKED');
  });

  it('reports an authorization block as PAID_REFRESH_NOT_AUTHORIZED, never as a reserve block', () => {
    expect(statusFor('NOT_AUTHORIZED')).toBe('PAID_REFRESH_NOT_AUTHORIZED');
    expect(statusFor('NOT_AUTHORIZED')).not.toBe('RESERVE_BLOCKED');
  });

  it('reports plain absence of data without blaming credits at all', () => {
    expect(statusFor(null)).toBe('NO_CACHED_SPORTSBOOK_DATA');
  });
});

describe('structured result delivery', () => {
  it('returns tiered recommendations when the model did not explicitly rank a subset', () => {
    const qualified = Array.from({ length: 8 }, (_, index) => ({
      ...pool[index % pool.length],
      candidateId: `elite-${index}`,
      eliteQualified: true,
    }));
    const saved = { ...session, candidates: qualified } as ResearchSession;

    const results = resolveStructuredResults([], false, saved, 'Find me the 5 strongest plays') as ResearchCandidateRecord[];
    expect(results.map((candidate) => candidate.candidateId)).toEqual(qualified.slice(0, 5).map((candidate) => candidate.candidateId));
    expect(results.every((candidate) => candidate.pickTier === 'ELITE')).toBe(true);
    expect(resolveStructuredResults([], true, saved)).toEqual([]);
  });

  it('never reuses a stored session from a different day than the one requested', () => {
    const qualified = pool.map((row) => ({ ...row, eliteQualified: true }));
    const stale = { ...session, date: '2026-09-11', candidates: qualified } as ResearchSession;
    expect(resolveStructuredResults([], false, stale, 'Find me the 5 strongest plays today')).toEqual([]);
  });
});

describe('research-session memory bounds', () => {
  it('keeps full candidate pools server-side rather than defaulting model reads to every record', async () => {
    const { executeTool, createAgentContext } = await import('./tools');
    const candidates = Array.from({ length: 40 }, (_, index) => ({ ...pool[index % pool.length], candidateId: `stored-${index}` }));
    const context = createAgentContext({ ...session, candidates } as ResearchSession);
    const result = await executeTool('get_last_research_session', { limit: undefined }, context);
    expect((result.data as { candidates: unknown[] }).candidates).toHaveLength(15);
  });
});

describe('cached ranking turn', () => {
  it('re-ranks an existing NFL session without calling the model or reloading sportsbook data', async () => {
    const injuryTimestamp = new Date().toISOString();
    const injuryContext = { player: { player: 'Patrick Mahomes', playerId: 1, teamId: 1, team: 'Kansas City Chiefs', position: 'QB', injury: null, status: 'Active',
      availabilityDesignation: 'CONFIRMED_AVAILABLE', updatedAt: injuryTimestamp, sourceStatus: 'CURRENT', evidence: null, affectedRole: 'PLAYER', missingFields: [] },
      team: 'Kansas City Chiefs', teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' }, lastUpdated: injuryTimestamp, missingFields: [] };
    const candidates = [
      candidate({ candidateId: 'value', odds: -110, evPercent: 12, priceEdgePercent: 8, eliteQualified: true }),
      candidate({ candidateId: 'payout', odds: 200, evPercent: 3, priceEdgePercent: 2, eliteQualified: true }),
    ].map((record, index) => ({ ...record, injuryContext, line: 244.5 + index, player: 'Patrick Mahomes', team: 'Kansas City Chiefs', opponent: 'Las Vegas Raiders', market: 'Passing Yards', marketKey: 'player_pass_yds' }));
    const saved = { ...session, sport: 'nfl', date: '2026-09-20', candidates } as ResearchSession;
    const result = rankCachedSession(saved, 'Give me higher value NFL plays.', 'session');
    expect(result?.results.map((row) => (row as ResearchCandidateRecord).candidateId)).toEqual(['value', 'payout']);
    expect(result?.toolTrace.map((entry) => entry.name)).toEqual(['get_last_research_session', 'rank_candidates']);
  });
});

describe('closest-miss ranking', () => {
  it('orders failed candidates by existing Elite-gate deficits rather than payout odds', () => {
    const near = candidate({ candidateId: 'near', odds: -110, researchScore: 83, dataQuality: 89, trapRisk: 26, signalsAvailable: 4, signalAgreement: 3, valueQualified: true, eliteQualified: false });
    const longshot = candidate({ candidateId: 'longshot', odds: 1000, researchScore: 45, dataQuality: 50, trapRisk: 60, signalsAvailable: 1, signalAgreement: 0, valueQualified: false, eliteQualified: false });
    const saved = { ...session, sport: 'nfl', candidates: [longshot, near] } as ResearchSession;
    expect(getClosestMisses(saved, 2).map((entry) => entry.candidateId)).toEqual(['near', 'longshot']);
  });
});

describe('latest command constraints and price ranking', () => {
  const pricedPool = [
    candidate({ candidateId: 'blocked', odds: -950, researchScore: 100, eliteQualified: true }),
    candidate({ candidateId: 'best', odds: -110, researchScore: 96, trueProbability: 72, trapRisk: 12, eliteQualified: true, evPercent: 12, priceEdgePercent: 8 }),
    candidate({ candidateId: 'minus-200', odds: -200, researchScore: 90, trueProbability: 76, trapRisk: 8, eliteQualified: true, evPercent: 4, priceEdgePercent: 3 }),
    candidate({ candidateId: 'plus-120', odds: 120, researchScore: 88, trueProbability: 62, trapRisk: 18, eliteQualified: true, evPercent: 18, priceEdgePercent: 11 }),
    candidate({ candidateId: 'plus-200', odds: 200, researchScore: 84, trueProbability: 55, trapRisk: 22, eliteQualified: true, evPercent: 9, priceEdgePercent: 7 }),
  ];

  it('parses and applies four different commands against the same candidate data', () => {
    const queries = [
      'Find me the best plays',
      'Find me higher value plays',
      'Find me plays around -200',
      'Find me plays around +200',
    ];
    const outputs = queries.map((query) => ({
      constraints: parseCandidateSearchConstraints(query, pricedPool),
      ids: selectRankedCandidates(pricedPool, query).selected.map((row) => row.candidateId),
    }));

    expect(outputs.map((output) => [output.constraints.sort, output.constraints.targetOdds])).toEqual([
      ['balanced', null], ['value', null], ['balanced', -200], ['balanced', 200],
    ]);
    expect(outputs[0].ids[0]).toBe('best');
    expect(outputs[1].ids.slice(0, 2)).toEqual(['plus-120', 'best']);
    expect(outputs[2].ids).toEqual(['minus-200']);
    expect(outputs[3].ids).toEqual(['plus-200']);
  });

  it('never permits an official result shorter than -900', () => {
    for (const query of ['Find me the best plays', 'Find me higher value plays', 'Find me plays around -950']) {
      expect(selectRankedCandidates(pricedPool, query).selected.every((row) => row.odds != null && row.odds >= -900)).toBe(true);
    }
    expect(selectRankedCandidates(pricedPool, 'Find me plays around -950').selected).toEqual([]);
  });

  it('materially changes safety ranking without weakening Elite qualification', () => {
    expect(selectRankedCandidates(pricedPool, 'Find me safer plays').selected[0].candidateId).toBe('minus-200');
    expect(selectRankedCandidates(pricedPool, 'Find me safer plays').selected.every((row) => row.eliteQualified)).toBe(true);
  });

  it('keeps the probability/value frontier while separating safest and best-value intents', () => {
    const controlled = [
      candidate({ candidateId: 'A', trueProbability: 70, evPercent: 8, priceEdgePercent: 5, playerEdgePercent: 6, researchScore: 88, dataQuality: 94, trapRisk: 12, odds: -110, eliteQualified: true }),
      candidate({ candidateId: 'B', trueProbability: 80, evPercent: 2, priceEdgePercent: 1, playerEdgePercent: 2, researchScore: 90, dataQuality: 96, trapRisk: 10, odds: -180, eliteQualified: true }),
      candidate({ candidateId: 'C', trueProbability: 60, evPercent: 20, priceEdgePercent: 15, playerEdgePercent: 10, researchScore: 84, dataQuality: 91, trapRisk: 18, odds: 200, eliteQualified: true }),
      candidate({ candidateId: 'D', trueProbability: 65, evPercent: 1, priceEdgePercent: 1, playerEdgePercent: 1, researchScore: 75, dataQuality: 90, trapRisk: 24, odds: 300, eliteQualified: true }),
    ].map((row, index) => ({ ...row, player: `Player ${row.candidateId}`, line: 240 + index, market: 'Passing Yards', marketKey: 'player_pass_yds' }));

    const balanced = selectRankedCandidates(controlled, 'Find me the best NFL props today').selected;
    const safest = selectRankedCandidates(controlled, 'Find me the safest NFL props today').selected;
    const bestValue = selectRankedCandidates(controlled, 'Find me the best value NFL props today').selected;

    expect(new Set(balanced.slice(0, 3).map((row) => row.candidateId))).toEqual(new Set(['A', 'B', 'C']));
    expect(balanced.at(-1)?.candidateId).toBe('D');
    expect(safest[0].candidateId).toBe('B');
    expect(bestValue[0].candidateId).toBe('C');
    expect([...balanced, ...safest, ...bestValue].every((row) => row.eliteQualified)).toBe(true);
  });

  it('keeps game, player, market, odds, and result-count constraints deterministic', () => {
    const gameScoped = selectRankedCandidates(pool, 'Give me the best Yankees vs Mets props').pool;
    expect(gameScoped.map((row) => row.candidateId)).toEqual(['b', 'c']);

    const playerScoped = selectRankedCandidates(pool, 'Research Max Scherzer props today').pool;
    expect(playerScoped.map((row) => row.candidateId)).toEqual(['a']);

    const marketScoped = selectRankedCandidates(pool, 'Best pitcher strikeout props in MLB today').pool;
    expect(marketScoped.map((row) => row.candidateId)).toEqual(['a']);

    const underMinus200 = selectRankedCandidates(pricedPool, 'Best MLB props under -200').pool;
    expect(underMinus200.map((row) => row.candidateId)).toEqual(['minus-200']);
    expect(selectRankedCandidates(pricedPool, 'Give me the best 2 MLB props today').selected).toHaveLength(2);
  });
});

describe('stale data can never become official Elite', () => {
  const stalePool = pool.map((c) => ({ ...c, priceFreshness: 'STALE', eliteQualified: false }));
  it('no stale candidate is elite-qualified', () => {
    expect(stalePool.some((c) => c.eliteQualified)).toBe(false);
  });
  it('elite selection over a stale pool returns nothing', () => {
    expect(stalePool.filter((c) => c.eliteQualified).length).toBe(0);
  });
});
