import { describe, expect, it } from 'vitest';
import { buildPickPresentation } from './adapter';
import type { AuthoritativeTierDecision, PickPresentationInput, PresentationSort } from './types';

const evidence = [{ id: 'fixture-evidence', category: 'form', source: 'offline fixture', detail: 'Supplied research observation.', observedAt: '2026-01-01T00:00:00Z', stance: 'SUPPORTING' as const }];

function decision(pickTier: AuthoritativeTierDecision['pickTier']): AuthoritativeTierDecision {
  return {
    pickTier,
    tierReason: `Authoritative ${pickTier} fixture decision.`,
    tierScore: 87,
    tierRequirementsPassed: ['fixture gate passed'],
    tierRequirementsFailed: pickTier === 'PASS' ? ['fixture gate failed'] : [],
  };
}

function prop(id: string, tier: AuthoritativeTierDecision['pickTier'], overrides: Partial<PickPresentationInput> = {}): PickPresentationInput {
  return {
    candidateId: id,
    subject: { kind: 'PLAYER_PROP', gameId: 'game-1', player: { id: 23, name: 'Fixture Player', team: 'Fixture Team' },
      market: { key: 'points', label: 'Points', line: 24.5, side: 'over' } },
    tierDecision: decision(tier), sportsbook: 'Fixture Book', americanOdds: -110, quoteStatus: 'CURRENT',
    trueProbability: 57.4, modelProbability: 58.1, evPercent: 9.2, researchScore: 91,
    seasonPhase: 'REGULAR', seasonPhaseCertainty: 'VERIFIED', researchEvidence: evidence,
    ...overrides,
  };
}

describe('NBA pick presentation adapter', () => {
  it.each(['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS'] as const)('preserves the authoritative %s tier without classifying it', (tier) => {
    const result = buildPickPresentation({ picks: [prop(tier.toLowerCase(), tier)], requestedSort: 'BEST', includePasses: true });
    expect(result.picks[0].tierDecision).toEqual(decision(tier));
    expect(result.picks[0].metrics.tierScore).toBe(87);
    expect(result.picks[0].disposition).toBe(tier === 'PASS' ? 'PASS' : tier === 'LEAN' ? 'LEAN' : 'RECOMMENDED');
  });

  it('marks a missing quote UNPRICED and keeps supplied tier, research and null metrics intact', () => {
    const result = buildPickPresentation({ picks: [prop('unpriced', 'ELITE', { sportsbook: null, americanOdds: null, evPercent: null })], requestedSort: 'BEST' });
    expect(result.picks[0]).toMatchObject({ disposition: 'UNPRICED', pricing: { state: 'UNPRICED', sportsbook: null, americanOdds: null },
      tierDecision: { pickTier: 'ELITE' }, metrics: { evPercent: null } });
    expect(result.picks[0].missing).toContain('americanOdds');
    expect(result.outcome).toBe('NO_QUALIFIED_PICKS');
  });

  it('keeps preseason phase uncertainty as supplied context without changing tier', () => {
    const input = prop('preseason', 'SHARP', { americanOdds: null, seasonPhase: 'PRESEASON', seasonPhaseCertainty: 'UNCERTAIN',
      seasonPhaseReason: 'Fixture has not been classified by an official schedule source.' });
    const presented = buildPickPresentation({ picks: [input], requestedSort: 'MOST_LIKELY' }).picks[0];
    expect(presented.tierDecision?.pickTier).toBe('SHARP');
    expect(presented.season).toEqual({ phase: 'PRESEASON', certainty: 'UNCERTAIN', reason: input.seasonPhaseReason });
    expect(presented.disposition).toBe('UNPRICED');
  });

  it('marks absent tier or evidence RESEARCH_ONLY instead of inventing qualification', () => {
    const noTier = prop('no-tier', 'ELITE', { tierDecision: null });
    const noEvidence = prop('no-evidence', 'ELITE', { researchEvidence: [] });
    const result = buildPickPresentation({ picks: [noTier, noEvidence], requestedSort: 'BEST' });
    expect(result.picks.map((pick) => pick.disposition)).toEqual(['RESEARCH_ONLY', 'RESEARCH_ONLY']);
    expect(result.picks[0].tierDecision).toBeNull();
    expect(result.picks[1].tierDecision?.pickTier).toBe('ELITE');
    expect(result.outcome).toBe('RESEARCH_ONLY');
  });

  it('supports moneyline, spread, total, and team-total game-line cards', () => {
    const markets = ['MONEYLINE', 'SPREAD', 'TOTAL', 'TEAM_TOTAL'] as const;
    const picks = markets.map((market, index) => ({
      candidateId: market,
      subject: { kind: 'GAME_LINE' as const, gameId: 'game-1', home: { id: 1, name: 'Home' }, away: { id: 2, name: 'Away' },
        market: { type: market, key: market, label: market, line: market === 'MONEYLINE' ? null : 220.5,
          selection: market === 'MONEYLINE' ? 'HOME' as const : 'OVER' as const, team: market === 'TEAM_TOTAL' ? 'HOME' as const : null } },
      tierDecision: decision('EDGE'), sportsbook: 'Fixture Book', americanOdds: 105 + index, trueProbability: 52 + index,
      evPercent: 3 + index, researchScore: 82, seasonPhase: 'POSTSEASON' as const, researchEvidence: evidence,
    } satisfies PickPresentationInput));
    const result = buildPickPresentation({ picks, requestedSort: 'BEST_VALUE' });
    expect(result.picks.map((pick) => pick.subject.kind === 'GAME_LINE' ? pick.subject.market.type : null)).toEqual(markets);
    expect(result.picks.every((pick) => pick.subject.kind === 'GAME_LINE')).toBe(true);
  });

  it.each(['BEST', 'MOST_LIKELY', 'BEST_VALUE'] as PresentationSort[])('uses upstream %s order and preserves source order for omitted IDs', (requestedSort) => {
    const picks = [prop('a', 'SHARP'), prop('b', 'EDGE'), prop('c', 'LEAN')];
    const result = buildPickPresentation({ picks, requestedSort, upstreamRankings: { [requestedSort]: ['c', 'a', 'missing'] } });
    expect(result.picks.map((pick) => pick.candidateId)).toEqual(['c', 'a', 'b']);
    expect(result.sortStatus).toBe('UPSTREAM_ORDER');
    expect(result.picks.map((pick) => pick.tierDecision?.pickTier)).toEqual(['LEAN', 'SHARP', 'EDGE']);
  });

  it('preserves input order when an authoritative order is not supplied', () => {
    const result = buildPickPresentation({ picks: [prop('b', 'EDGE'), prop('a', 'SHARP')], requestedSort: 'MOST_LIKELY' });
    expect(result.picks.map((pick) => pick.candidateId)).toEqual(['b', 'a']);
    expect(result.sortStatus).toBe('SOURCE_ORDER');
  });

  it('does not apply an authoritative order belonging to a different sort mode', () => {
    const result = buildPickPresentation({ picks: [prop('a', 'SHARP'), prop('b', 'EDGE')], requestedSort: 'MOST_LIKELY',
      upstreamRankings: { BEST: ['b', 'a'] } });
    expect(result.picks.map((pick) => pick.candidateId)).toEqual(['a', 'b']);
    expect(result.sortStatus).toBe('SOURCE_ORDER');
  });

  it('represents no qualified picks with an empty result rather than synthetic PASS cards', () => {
    const result = buildPickPresentation({ picks: [], requestedSort: 'BEST' });
    expect(result).toMatchObject({ outcome: 'NO_QUALIFIED_PICKS', picks: [], sortStatus: 'SOURCE_ORDER' });
  });

  it('omits PASS cards unless the caller explicitly includes them', () => {
    const result = buildPickPresentation({ picks: [prop('pass', 'PASS'), prop('lean', 'LEAN')], requestedSort: 'BEST' });
    expect(result.picks.map((pick) => pick.candidateId)).toEqual(['lean']);
  });
});