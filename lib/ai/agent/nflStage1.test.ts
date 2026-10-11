import { describe, expect, it } from 'vitest';
import { analyzePickCandidate, type EliteCandidateInput } from '../eliteResearchFilter';
import { filterOfficialResults, rankCachedSession, resolveStructuredResults, toClientResult, type AgentTurnResult } from './runner';
import { buildResearchSessionFromCandidates, type GenericResearchCandidate, type ResearchCandidateRecord } from './session';
import { nflNameMatches, parseNFLRequestScope } from './nflRequestScope';
import { selectRankedCandidates } from './tools';
import type { NFLInjuryContext } from '../../nfl/injuries';

function nflInput(): EliteCandidateInput {
  return {
    candidateId: 'qb', sport: 'nfl', playerId: 1, player: 'Patrick Mahomes', market: 'player_pass_yds',
    line: 244.5, direction: 'over', isAlternate: false, projection: 300, projectionUncertainty: 40,
    historicalRates: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100], sampleSize: 10,
    oddsAmerican: -110, marketFairProbability: null, matchupAvailable: true, usageAvailable: true,
    roleKnown: true, gameContextAvailable: true, opponentPersonnelAvailable: false,
    marketConfirmationAvailable: true, statusKnown: true, lastUpdatedAt: new Date().toISOString(),
    requiredMarketSupported: true, marketSupport: 'SUPPORTED', unsupportedSignals: ['projectionAgreement', 'opponentPersonnel'],
  };
}

function nflCandidate(overrides: Partial<GenericResearchCandidate> = {}): GenericResearchCandidate {
  const analysis = overrides.analysis ?? analyzePickCandidate(nflInput());
  const injuryTimestamp = new Date().toISOString();
  const hardGates = Object.fromEntries(['currentPrice', 'majorInjuryResolved', 'roleClear', 'requiredDataPresent', 'currentLineReEvaluated',
    'footballThesisExplained', 'sourceConflictsResolved', 'projectionAdvantage', 'priceValueRemains', 'evidenceQuality']
    .map((key) => [key, { passed: true, reason: null }]));
  return {
    candidateId: 'qb', playerId: 1, player: 'Patrick Mahomes', team: 'Kansas City Chiefs', opponent: 'Las Vegas Raiders',
    marketLabel: 'Passing Yards', marketKey: 'player_pass_yds', line: 244.5, direction: 'over', book: 'Book A', odds: -110,
    projection: 300, projectionUncertainty: 40, l5Rate: 100, l10Rate: 100, l20Rate: null, seasonRate: 100,
    analysis, sport: 'nfl', sampleSize: 10,
    injuryContext: { player: { player: 'Patrick Mahomes', playerId: 1, teamId: 12, team: 'Kansas City Chiefs', position: 'QB', injury: null, status: 'Active',
      availabilityDesignation: 'CONFIRMED_AVAILABLE', sourceStatus: 'CURRENT', updatedAt: injuryTimestamp, evidence: null, affectedRole: 'PLAYER', missingFields: [] },
    team: 'Kansas City Chiefs', teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'CURRENT' },
    lastUpdated: injuryTimestamp, missingFields: [] },
    nflResearchProfile: {
      hardGates,
      productionEliteQualified: analysis.eliteQualified,
      evidence: { verdict: 'PLAY', counterCaseReviewed: true, conflictStatus: 'NONE', for: [{}], against: [{}], unresolvedRisks: [] },
      role: { value: { roleStatus: 'STABLE' } },
    } as never,
    ...overrides,
  };
}

function session(candidates: GenericResearchCandidate[] = [nflCandidate()]) {
  return buildResearchSessionFromCandidates({
    sport: 'nfl', date: '2026-10-04', queryIntent: 'Best NFL props Sunday', candidates,
    toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1, cached: true, dataFreshnessSeconds: 0, budgetLimited: false },
  });
}

describe('NFL official response boundary', () => {
  it('requires a strict Elite flag and a fully supported offensive market', () => {
    const saved = session();
    const official = saved.candidates[0];
    const rows = [official, { ...official, eliteQualified: false }, { ...official, eliteQualified: 'true' },
      { ...official, marketKey: 'player_anytime_td' }, { ...official, marketKey: 'player_sacks' },
      { ...official, marketKey: 'player_field_goals' }, { ...official, isAlternate: true }, null];
    expect(filterOfficialResults(rows, 'nfl')).toEqual([official]);
    expect(resolveStructuredResults(rows, true, saved)).toMatchObject([official]);
  });

  it.each([true, false])('protects the final client boundary in production=%s', (production) => {
    const official = session().candidates[0];
    const failedGate = { ...official, eliteQualified: false, nflResearchProfile: {
      ...official.nflResearchProfile!, hardGates: { ...official.nflResearchProfile!.hardGates, currentPrice: { passed: false, reason: 'Stale price.' } },
    } };
    const result: AgentTurnResult = { reply: '', results: [failedGate], closestMisses: [], meta: { sport: 'nfl' }, toolTrace: [], researchSessionId: null };
    expect(toClientResult(result, production).results).toEqual([]);
  });

  it('requires the NFL profile hard-gate verdict before publishing a new profiled result', () => {
    const official = session().candidates[0];
    const blocked = { ...official, nflResearchProfile: { productionEliteQualified: false } };
    expect(filterOfficialResults([blocked], 'nfl')).toEqual([]);
    expect(filterOfficialResults([official], 'nfl')).toEqual([official]);
  });

  it('rejects cached recommendation results when saved CURRENT injury timestamps have expired', () => {
    const official = nflCandidate();
    const injury = official.injuryContext as NFLInjuryContext;
    const stale = { ...official, injuryContext: { ...injury, lastUpdated: '2026-10-01T00:00:00Z',
      player: { ...injury.player, sourceStatus: 'CURRENT' as const, updatedAt: '2026-10-01T00:00:00Z' } } };
    const saved = session([stale]);
    const stored = saved.candidates[0];
    expect(resolveStructuredResults([stored], false, saved, 'Best NFL props')).toEqual([]);
    expect(toClientResult({ reply: '', results: [stored], closestMisses: [], meta: { sport: 'nfl' }, toolTrace: [], researchSessionId: null }, true).results).toEqual([]);
    expect(rankCachedSession(saved, 'Best NFL props', null)).toBeNull();
  });

  it('records sport filter identity and version on newly built NFL sessions', () => {
    expect(session()).toMatchObject({ sportFilter: 'NFL', sportFilterId: 'NFL_FILTER', sportFilterVersion: '1.0.0' });
  });

  it('round-trips the full NFL research profile in the server-side candidate record', () => {
    const profile = { sportFilter: 'NFL_FILTER', sportFilterVersion: '1.0.0', productionEliteQualified: false,
      evidence: { conflictStatus: 'UNRESOLVED', conflicts: [{ topic: 'availability', status: 'UNRESOLVED' }] }, score: { score: null } } as never;
    const saved = session([nflCandidate()]);
    saved.candidates[0].nflResearchProfile = profile;
    const restored = JSON.parse(JSON.stringify(saved)) as typeof saved;
    expect(restored.candidates[0].nflResearchProfile).toMatchObject({ sportFilter: 'NFL_FILTER', sportFilterVersion: '1.0.0', productionEliteQualified: false,
      evidence: { conflictStatus: 'UNRESOLVED' }, score: { score: null } });
  });
});

describe('NFL probability units', () => {
  it('preserves percentages and computes percentage-point player edge', () => {
    const record = session().candidates[0];
    expect(record.breakEvenProbability).toBe(52.4);
    expect(record.playerEdgePercent).toBe(47.6);
    expect(record.trueProbability).toBeGreaterThan(0);
    expect(record.trueProbability).toBeLessThanOrEqual(100);
  });

  it.each([[-200, 66.7], [-110, 52.4], [120, 45.5]])('keeps price %s probabilities in percent units', (odds, expected) => {
    const analysis = analyzePickCandidate({ ...nflInput(), oddsAmerican: odds });
    const record = session([nflCandidate({ analysis, odds })]).candidates[0];
    expect(record.breakEvenProbability).toBe(expected);
    expect(record.trueProbability).toBe(analysis.trueProbability);
    expect(record.modelProbability).toBe(analysis.modelProbability);
    expect(record.priceEdgePercent).toBe(analysis.priceEdgePercent);
  });

  it('preserves unavailable probabilities instead of inventing zeroes', () => {
    const analysis = analyzePickCandidate({ ...nflInput(), oddsAmerican: null });
    const record = session([nflCandidate({ analysis, odds: null })]).candidates[0];
    expect(record.breakEvenProbability).toBeNull();
    expect(record.playerEdgePercent).toBeNull();
  });
});

describe('deterministic NFL scope', () => {
  it('recognizes team nicknames without requiring NFL in the request', () => {
    expect(parseNFLRequestScope('Best Chiefs vs Raiders props').teams).toEqual(['Kansas City Chiefs', 'Las Vegas Raiders']);
    expect(parseNFLRequestScope('Best Chiefs vs Raiders props').playerQuery).toBeNull();
  });

  it('extracts full names, surnames, and unknown player requests', () => {
    expect(parseNFLRequestScope('Best Patrick Mahomes props').playerQuery).toBe('Patrick Mahomes');
    expect(parseNFLRequestScope('Best Mahomes props').playerQuery).toBe('Mahomes');
    expect(parseNFLRequestScope('Best Unknown Player NFL props').playerQuery).toBe('Unknown');
    expect(nflNameMatches('Mahomes', 'Patrick Mahomes')).toBe(true);
    expect(nflNameMatches('Patrick', 'Patrick Mahomes')).toBe(false);
  });

  it('uses passing market keys without treating a family request as a player', () => {
    const scope = parseNFLRequestScope('Give me the best NFL passing props Sunday');
    expect(scope.playerQuery).toBeNull();
    expect(scope.marketKeys).toEqual(['player_pass_yds', 'player_pass_attempts', 'player_pass_completions', 'player_pass_tds', 'player_pass_interceptions']);
  });

  it('retains player restrictions alongside team restrictions', () => {
    const scope = parseNFLRequestScope('Best Chiefs Patrick Mahomes props');
    expect(scope.teams).toEqual(['Kansas City Chiefs']);
    expect(scope.playerQuery).toBe('Patrick Mahomes');
    expect(parseNFLRequestScope('Show NFL props for Mahomes under -200').playerQuery).toBe('Mahomes');
  });
});

describe('NFL scoped official ranking', () => {
  function pool() {
    const official = session().candidates[0];
    return [official,
      { ...official, candidateId: 'wr', player: 'Justin Jefferson', team: 'Minnesota Vikings', opponent: 'Miami Dolphins', market: 'Receiving Yards', marketKey: 'player_reception_yds' },
      { ...official, candidateId: 'rb', player: 'Isiah Pacheco', market: 'Rushing Yards', marketKey: 'player_rush_yds' },
    ];
  }

  it('never lets the tier floor admit a failed-hard-gate or unsupported candidate', () => {
    const official = pool()[0];
    const candidates = [official,
      { ...official, candidateId: 'reject', eliteQualified: false, nflResearchProfile: { ...official.nflResearchProfile!,
        hardGates: { ...official.nflResearchProfile!.hardGates, currentPrice: { passed: false, reason: 'Stale.' } } } },
      { ...official, candidateId: 'partial', marketKey: 'player_anytime_td' }];
    expect(selectRankedCandidates(candidates, 'Best NFL picks', { eliteOnly: false }).selected).toMatchObject([official]);
  });

  it.each([
    ['Best NFL passing props Sunday', ['qb']],
    ['Best NFL rushing props', ['rb']],
    ['Best NFL receiving props', ['wr']],
    ['Best Mahomes props', ['qb']],
    ['Best Patrick Mahomes props', ['qb']],
    ['Best Chiefs vs Raiders props', ['qb', 'rb']],
    ['Best Chiefs vs Dolphins props', []],
    ['Best Unknown Player props', []],
  ])('scopes %s before ranking', (query, ids) => {
    expect(selectRankedCandidates(pool(), query).selected.map((candidate) => candidate.candidateId)).toEqual(ids);
  });

  it('rejects an ambiguous surname', () => {
    const official = pool()[0];
    const candidates = [{ ...official, player: 'Josh Allen' }, { ...official, candidateId: 'other', player: 'Kyle Allen' }];
    expect(selectRankedCandidates(candidates, 'Best Allen props').selected).toEqual([]);
  });

  it('rejects different player identities sharing a full name', () => {
    const official = pool()[0];
    const candidates = [{ ...official, player: 'Josh Allen' }, { ...official, candidateId: 'other', playerId: 2, player: 'Josh Allen', team: 'Jacksonville Jaguars' }];
    expect(selectRankedCandidates(candidates, 'Best Josh Allen props').selected).toEqual([]);
  });

  it('filters maximum juice before ranking and keeps the boundary price', () => {
    const official = pool()[0];
    const candidates = [-250, -200, -150, 120].map((odds, index) => ({ ...official, candidateId: String(odds), line: 244.5 + index, odds }));
    expect(selectRankedCandidates(candidates, 'Best NFL props under -200').selected.map((candidate) => candidate.odds).sort((a, b) => a! - b!)).toEqual([-200, -150, 120]);
    expect(selectRankedCandidates(candidates, 'Best NFL props between -200 and +120').selected.map((candidate) => candidate.odds).sort((a, b) => a! - b!)).toEqual([-200, -150, 120]);
  });

  it('reapplies scope and stored qualification at the final result boundary', () => {
    const saved = { ...session(), candidates: pool() };
    expect(resolveStructuredResults(pool(), true, saved, 'Best Mahomes props').map((row) => (row as { candidateId: string }).candidateId)).toEqual(['qb']);
    expect(resolveStructuredResults(pool(), true, saved, 'Best NFL props 2026-10-11')).toEqual([]);
    const rejected = { ...saved, candidates: saved.candidates.map((candidate) => ({ ...candidate, eliteQualified: false,
      nflResearchProfile: { ...candidate.nflResearchProfile!, hardGates: { ...candidate.nflResearchProfile!.hardGates, currentPrice: { passed: false, reason: 'Stale price.' } } } })) };
    expect(resolveStructuredResults(pool(), true, rejected, 'Best NFL picks')).toEqual([]);
  });

  it('returns lower tiers without unsolicited misses and exposes passes only when asked', () => {
    const saved = { ...session(), candidates: pool().map((candidate) => ({ ...candidate, eliteQualified: false })) };
    const result = rankCachedSession(saved, 'Best NFL passing props', 'saved');
    expect(result?.results.length).toBeGreaterThan(0);
    expect(result?.results.every((row) => (row as ResearchCandidateRecord).pickTier === 'SHARP')).toBe(true);
    expect(result?.closestMisses).toEqual([]);
    const requested = rankCachedSession(saved, 'Show closest misses for NFL passing props', 'saved');
    expect(requested?.closestMisses.map((row) => (row as { candidateId: string }).candidateId)).toEqual(['qb']);
  });
});