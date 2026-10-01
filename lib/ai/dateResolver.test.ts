import { describe, expect, it } from 'vitest';
import { resolveDateFromText } from './dateResolver';
import { applyRequestScope, createAgentContext, parseCandidateSearchConstraints, selectRankedCandidates } from './agent/tools';
import type { ResearchCandidateRecord } from './agent/session';

const WEDNESDAY = '2026-09-30';
const resolve = (text: string, today = WEDNESDAY) => resolveDateFromText(text, today)?.resolvedDate ?? null;

describe('natural-language date resolution (today = Wed Sep 30, 2026)', () => {
  it('resolves "Best NFL plays Sunday" to Sunday, October 4, 2026 without clarification', () => {
    const resolved = resolveDateFromText('Best NFL plays Sunday', WEDNESDAY);
    expect(resolved).toEqual({ rawDateText: 'sunday', resolvedDate: '2026-10-04', displayDate: 'Sunday, October 4', resolutionType: 'weekday' });
  });

  it.each([
    ['Best NFL plays this Sunday', '2026-10-04'],
    ['Best NFL plays next Sunday', '2026-10-11'],
    ['Best NFL plays tomorrow', '2026-10-01'],
    ['Best MLB props tonight', '2026-09-30'],
    ['Best MLB props today', '2026-09-30'],
    ['Best MLB props Friday', '2026-10-02'],
    ['Best NFL props Sunday under -200', '2026-10-04'],
    ['Give me the best 5 NFL props Sunday', '2026-10-04'],
    ['Monday night football props', '2026-10-05'],
    ['tomorrow night', '2026-10-01'],
    ['Best props this weekend', '2026-10-03'],
    ['Best props next weekend', '2026-10-10'],
    ['September 30', '2026-09-30'],
    ['October 4', '2026-10-04'],
    ['Oct 4', '2026-10-04'],
    ['10/4', '2026-10-04'],
    ['10/04/2026', '2026-10-04'],
    ['October 4, 2026', '2026-10-04'],
    ['2026-10-04', '2026-10-04'],
  ])('%s -> %s', (text, expected) => {
    expect(resolve(text)).toBe(expected);
  });

  it('treats a bare weekday equal to today as today, and "next" as the following week', () => {
    expect(resolve('Best NFL plays Sunday', '2026-10-04')).toBe('2026-10-04');
    expect(resolve('next Sunday', '2026-10-04')).toBe('2026-10-11');
    expect(resolve('Friday', '2026-09-29')).toBe('2026-10-02');
  });

  it('rolls a past month/day with no year forward to next year, never to a stale year', () => {
    expect(resolve('June 9', WEDNESDAY)).toBe('2027-06-09');
  });

  it('does not mistake odds or ordinary words for dates', () => {
    expect(resolve('Best props under -200')).toBeNull();
    expect(resolve('Give me money line value')).toBeNull();
    expect(resolve('Sunny weather overs')).toBeNull();
  });
});

describe('one canonical date and sport per request', () => {
  it('pins the resolved date and sport so the model cannot search a different day', () => {
    const context = createAgentContext();
    applyRequestScope(context, 'Best NFL plays Sunday', WEDNESDAY);
    expect(context.canonicalDate?.resolvedDate).toBe('2026-10-04');
    expect(context.canonicalSport).toBe('nfl');
  });

  it('ignores a stale date and wrong sport passed by the model (e.g. June 9, 2024)', async () => {
    const { executeTool } = await import('./agent/tools');
    const candidate = { candidateId: 'x', player: 'P', team: 'T', opponent: 'O', market: 'Passing Yards', marketKey: 'player_pass_yds', direction: 'over', odds: -110, eliteQualified: true, researchScore: 90, rejectionReasons: [] };
    const session = { sport: 'nfl', date: '2026-10-04', queryIntent: '', generatedAt: '', toolMeta: {}, candidates: [candidate] };
    const context = createAgentContext(session as never);
    applyRequestScope(context, 'Best NFL plays Sunday', WEDNESDAY);
    const result = await executeTool('rank_candidates', { sport: 'mlb', date: '2024-06-09' }, context);
    expect(result.status).toBe('SUCCESS');
    expect(result.date).toBe('2026-10-04');
    expect(result.sport).toBe('nfl');
  });

  it('keeps date, odds, and result-count constraints together', () => {
    const pool = [
      { candidateId: 'a', player: 'A', team: 'T', opponent: 'O', market: 'Passing Yards', marketKey: 'player_pass_yds', direction: 'over', odds: -250, eliteQualified: true, researchScore: 90 },
      { candidateId: 'b', player: 'B', team: 'T', opponent: 'O', market: 'Passing Yards', marketKey: 'player_pass_yds', direction: 'over', odds: -150, eliteQualified: true, researchScore: 95 },
    ] as unknown as ResearchCandidateRecord[];
    const constraints = parseCandidateSearchConstraints('Best NFL props Sunday under -200', pool);
    expect(constraints.sport).toBe('nfl');
    expect(constraints.maxOdds).toBe(-200);
    expect(selectRankedCandidates(pool, 'Best NFL props Sunday under -200').selected.map((c) => c.candidateId)).toEqual(['a']);
    expect(parseCandidateSearchConstraints('Give me the best 5 NFL props Sunday', pool).maxResults).toBe(5);
  });
});
