import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source } from './fixtures.spec.helper';
import { emptyIntent, interpretBettingIntent, type BettingConversation } from './intent';
import { executeBettingIntent } from './execute';
import type { ResearchCandidateRecord, ResearchSession } from '../lib/ai/agent/session';
import type { NFLInjuryContext } from '../lib/nfl/injuries';

const candidates: ResearchCandidateRecord[] = source.outputs.filter((row: { researchMode: string }) => row.researchMode === 'STANDARD').map((row: { record: ResearchCandidateRecord }) => row.record);
const session = { sport: 'nfl', date: '2026-10-05', generatedAt: source.snapshotTime, candidates, queryIntent: '', toolMeta: {} } as ResearchSession;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(source.snapshotTime)); });
afterEach(() => vi.useRealTimers());
const interpret = (query: string, previous?: BettingConversation) => interpretBettingIntent(query, candidates, previous, 'nfl');
describe('conversational structured sports intent', () => {
  it.each([
    ['Give me the best NFL plays today', { rankingIntent: 'BEST', researchMode: 'STANDARD' }],
    ['Give me your favorite', { requestedCount: 1 }], ['Give me one', { requestedCount: 1 }], ['Give me 3', { requestedCount: 3 }],
    ['Give me everything you like', { requestedCount: 15 }], ['Give me the safest plays', { rankingIntent: 'MOST_LIKELY' }],
    ['Which one is most likely?', { rankingIntent: 'MOST_LIKELY', requestedCount: 1 }], ['Give me the best value', { rankingIntent: 'BEST_VALUE' }],
    ['Give me low lines', { linePreference: 'LOW_THRESHOLD', rankingIntent: 'BEST', researchMode: 'STANDARD' }],
    ['Give me low receiving lines', { linePreference: 'LOW_THRESHOLD', markets: ['player_reception_yds', 'player_receptions'] }],
    ['Give me passing props', { markets: ['player_pass_yds', 'player_pass_attempts', 'player_pass_completions', 'player_pass_tds', 'player_pass_interceptions'] }],
    ['Give me receiving yards', { markets: ['player_reception_yds'] }], ['Receptions only', { markets: ['player_receptions'] }],
    ['Unders only', { directions: ['under'] }], ['Overs only', { directions: ['over'] }],
    ['Plus money only', { oddsConstraints: { min: 100, max: null } }], ['Nothing worse than -200', { oddsConstraints: { min: -200, max: null } }],
    ['Elite only', { requestedTiers: ['ELITE'] }], ['Elite or better', { requestedTiers: ['NUKE', 'ELITE'] }], ['Any Nukes?', { requestedTiers: ['NUKE'] }],
    ['Give me a 2 man', { requestedCount: 2, combinationIntent: true }], ['Build me a 3 leg', { requestedCount: 3, combinationIntent: true }],
    ['Anything for Olave?', { players: ['Chris Olave'] }], ['Compare Olave and Johnson', { players: ['Chris Olave', 'Juwan Johnson'], action: 'COMPARE' }],
    ['Which one is safer?', { rankingIntent: 'MOST_LIKELY', action: 'COMPARE' }], ['Which one has more value?', { rankingIntent: 'BEST_VALUE', action: 'COMPARE' }],
    ['Go deeper on Olave', { players: ['Chris Olave'], researchMode: 'DEEP' }], ['Anything left tonight?', { pregameOnly: true }],
  ])('normalizes %s', (query, expected) => { expect(interpret(query)).toMatchObject(expected); });
  it.each([['give me two', 2], ['best two', 2], ['top five', 5], ['give me 5', 5], ['best play', 1], ['top pick', 1], ['Give me your best 2', 2]])('recognizes count %s', (query, requestedCount) => {
    expect(interpret(query).requestedCount).toBe(requestedCount);
  });
  it.each(['-200 or better', "Don't give me anything worse than -200", "don't give me anything over -300"])('normalizes negative American floor %s', (query) => {
    expect(interpret(query).oddsConstraints.min).toBe(query.includes('-300') ? -300 : -200);
  });
  it('preserves plus versus minus and asks about genuinely ambiguous price wording', () => {
    expect(interpret('between -150 and +150').oddsConstraints).toEqual({ min: -150, max: 150 });
    expect(interpret('receiving yard overs under -200')).toMatchObject({ action: 'CLARIFY' });
    expect(interpret('write me a poem about javascript').action).toBe('OUT_OF_SCOPE');
  });
  it('resolves first and number references from displayed recommendations', () => {
    const displayed = { intent: { ...emptyIntent(), sport: 'nfl' as const }, displayedIds: candidates.slice(0, 2).map((row) => row.candidateId), referencedIds: [] };
    expect(interpret('Deep research number 1', displayed).referenceIds).toEqual([displayed.displayedIds[0]]);
    expect(interpret('Why do you like number 1?', displayed)).toMatchObject({ action: 'EXPLAIN', referenceIds: [displayed.displayedIds[0]] });
    expect(interpret("What's the risk?", displayed).action).toBe('CLARIFY');
  });
  it('infers sport and game from context and team names', () => {
    expect(interpret('football picks').sport).toBe('nfl');
    expect(interpret('Saints game').teams).toEqual(['New Orleans Saints']);
    const previous = { intent: { ...emptyIntent(), sport: 'nfl' as const, markets: ['player_reception_yds'] }, displayedIds: [candidates[0].candidateId], referencedIds: [] };
    expect(interpret("What's your favorite from this game?", previous)).toMatchObject({ requestedCount: 1, games: [candidates[0].gameId] });
  });
});
describe('final candidate intent execution, archived quotes not current picks', () => {
  it.each([
    ['Give me the best 3 receiving-yard Overs.', { markets: ['player_reception_yds'], directions: ['over'], rankingIntent: 'BEST', requestedCount: 3 }],
    ['Give me the most likely 3.', { rankingIntent: 'MOST_LIKELY', requestedCount: 3 }],
    ['Give me plus-money plays.', { oddsConstraints: { min: 100, max: null } }],
    ["Where's the edge?", { rankingIntent: 'BEST_VALUE', requestedTiers: [] }],
    ['Give me the most value.', { rankingIntent: 'BEST_VALUE' }],
    ['Give me the safest low-threshold plays.', { rankingIntent: 'MOST_LIKELY', linePreference: 'LOW_THRESHOLD' }],
    ['Give me a 3-man.', { requestedCount: 3, combinationIntent: true }],
    ['Only receiving.', { markets: ['player_reception_yds', 'player_receptions', 'player_reception_tds'] }],
  ])('combines natural preferences and executes %s', (query, expected) => {
    const intent = interpret(query);
    expect(intent).toMatchObject({ ...expected, researchMode: 'STANDARD', action: 'PICKS' });
    const result = executeBettingIntent(session, intent);
    expect(result.constraintsSatisfied).toBe(true);
    expect(result.results.length).toBeLessThanOrEqual(intent.requestedCount);
    if (intent.markets.length) expect(result.results.every((row) => intent.markets.includes(row.marketKey))).toBe(true);
    if (intent.rankingIntent === 'BEST_VALUE') expect(result.results.map((row) => row.evPercent)).toEqual(result.results.map((row) => row.evPercent).sort((first, second) => second! - first!));
  });
  it.each([1, 2, 3, 5])('returns no more than requested %s, never 15', (count) => {
    const result = executeBettingIntent(session, interpret(`Give me ${count}`));
    expect(result.results).toHaveLength(count);
    expect(result.constraintsSatisfied).toBe(true);
  });
  it.each(['Give me receiving yards', 'Receptions only', 'Give me passing props', 'Anything for Olave?', 'Nothing worse than -200', 'Elite only', 'Elite or better'])('enforces %s before ranking', (query) => {
    const result = executeBettingIntent(session, interpret(query));
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.constraintsSatisfied).toBe(true);
  });
  it('orders safest by probability and value by EV', () => {
    const safest = executeBettingIntent(session, interpret('Give me the safest plays')).results;
    const value = executeBettingIntent(session, interpret('Give me the best value')).results;
    expect(safest.map((row) => row.trueProbability)).toEqual(safest.map((row) => row.trueProbability).sort((first, second) => second! - first!));
    expect(value.map((row) => row.evPercent)).toEqual(value.map((row) => row.evPercent).sort((first, second) => second! - first!));
  });
  it('never supplies an Over for an Under request or invents a Nuke', () => {
    for (const query of ['Give me 3 Unders', 'Any Nukes?', 'Plus money only']) expect(executeBettingIntent(session, interpret(query)).results).toHaveLength(0);
  });
  it('does not return a cached NFL recommendation when saved injury timestamps have expired', () => {
    const stale = candidates.map((row) => ({ ...row, injuryContext: { ...(row.injuryContext as NFLInjuryContext),
      lastUpdated: '2026-10-01T00:00:00Z',
      player: { ...(row.injuryContext as NFLInjuryContext).player,
        sourceStatus: 'CURRENT' as const, updatedAt: '2026-10-01T00:00:00Z' },
    } }));
    const result = executeBettingIntent({ ...session, candidates: stale }, interpret('Give me the best 3'));
    expect(result.results).toEqual([]);
    expect(result.eliminatedBy).toContain('current injury evidence');
  });
  it('fails closed rather than throwing when a legacy cached injury object is malformed', () => {
    const legacy = candidates.map((row) => ({ ...row, injuryContext: null }));
    const result = executeBettingIntent({ ...session, candidates: legacy }, interpret('Give me the best 2'));
    expect(result.results).toEqual([]);
    expect(result.constraintsSatisfied).toBe(true);
  });
  it('builds only independently qualified different-player legs', () => {
    const result = executeBettingIntent(session, interpret('Give me a 2 man'));
    expect(result.results).toHaveLength(2);
    expect(new Set(result.results.map((row) => row.player)).size).toBe(2);
    expect(result.reply).toContain('correlated');
  });
  it('only changes named dimensions in a five-turn sequence', () => {
    let previous: BettingConversation | undefined;
    const queries = ['Give me the best 5 NFL receiving props', 'overs only', 'make it 2', 'most likely', 'deep research the first one'];
    const intents = [];
    for (const query of queries) {
      const intent = interpret(query, previous);
      const result = executeBettingIntent(session, intent);
      previous = result.conversation;
      intents.push(intent);
    }
    expect(intents[1]).toMatchObject({ requestedCount: 5, directions: ['over'], markets: intents[0].markets });
    expect(intents[2]).toMatchObject({ requestedCount: 2, directions: ['over'], rankingIntent: 'BEST' });
    expect(intents[3]).toMatchObject({ requestedCount: 2, directions: ['over'], rankingIntent: 'MOST_LIKELY', researchMode: 'STANDARD' });
    expect(intents[4]).toMatchObject({ requestedCount: 1, rankingIntent: 'MOST_LIKELY', researchMode: 'DEEP', markets: intents[0].markets });
    expect(intents[4].referenceIds).toHaveLength(1);
  });
  it('enforces a qualifying Under with plus money without substituting a different side', () => {
    const row = { ...candidates[0], candidateId: 'SYNTHETIC_UNDER_FIXTURE', direction: 'under' as const, odds: 120 };
    const synthetic = { ...session, candidates: [row, candidates[1]] };
    const intent = interpretBettingIntent('Give me 3 receiving yard unders plus money only', synthetic.candidates, null, 'nfl');
    const result = executeBettingIntent(synthetic, intent);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].direction).toBe('under');
    expect(result.results[0].odds).toBe(120);
    expect(result.reply).toContain('Only 1');
  });
  it('does not include a Sharp or Nuke in exact Elite-only results', () => {
    const sharp = { ...candidates[0], candidateId: 'SYNTHETIC_SHARP', eliteQualified: false, researchScore: 88,
      nflResearchProfile: { ...candidates[0].nflResearchProfile!, productionEliteQualified: false } };
    const result = executeBettingIntent({ ...session, candidates: [sharp, candidates[1]] }, interpret('Elite only'));
    expect(result.results).toHaveLength(1);
    expect(result.results[0].pickTier).toBe('ELITE');
  });
  it('filters a specific game before ranking without unrelated-game substitutions', () => {
    const other = { ...candidates[0], candidateId: 'SYNTHETIC_OTHER_GAME', gameId: 'other', team: 'Buffalo Bills', opponent: 'New York Jets' };
    const result = executeBettingIntent({ ...session, candidates: [...candidates, other] }, interpret('Saints game'));
    expect(result.results.every((row) => row.gameId !== 'other')).toBe(true);
  });
  it('preserves the original displayed list for a comparison after deep first-one research', () => {
    const initial = executeBettingIntent(session, interpret('Give me 2'));
    const deepIntent = interpret('Deep research the first one', initial.conversation);
    const deep = executeBettingIntent(session, deepIntent, initial.conversation);
    expect(deep.conversation.displayedIds).toEqual(initial.conversation.displayedIds);
    const comparison = interpret('compare it to number 2', deep.conversation);
    expect(comparison.referenceIds).toEqual(initial.conversation.displayedIds);
    expect(interpret('how has he done recently?', deep.conversation).referenceIds).toEqual(deepIntent.referenceIds);
  });
  it('does not satisfy an explicit Deep request using Standard-only cached evidence', () => {
    const intent = interpret('Deep research the best one');
    expect(executeBettingIntent(session, intent).results).toEqual([]);
    const deep = { ...session, candidates: source.outputs.filter((row: { researchMode: string }) => row.researchMode === 'DEEP').map((row: { record: ResearchCandidateRecord }) => row.record) };
    expect(executeBettingIntent(deep, intent).results).toHaveLength(1);
  });
  it.each(['Olave props', 'what do you like for Olave?', 'anything for Bijan?', 'best Shough play'])('resolves conversational player filter %s', (query) => {
    const intent = interpret(query);
    expect(intent.players).toHaveLength(1);
    const result = executeBettingIntent(session, intent);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((row) => row.player === intent.players[0])).toBe(true);
  });
});