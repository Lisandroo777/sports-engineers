import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNFLHistory } from '../../nfl/history';
import { normalizeNFLEventProps } from '../../nfl/odds';
import type { NFLGameLogEntry } from '../../nfl/types';
import { parseNFLRequestScope } from './nflRequestScope';
import { createAgentContext, prepareNFLRequestScope } from './tools';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in offline kicking tests'); })); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('NFL exact kicking lines (offline)', () => {
  it.each([0.5, 1.5, 2.5])('uses the supplied FG %s line, never a fixed replacement', (line) => {
    const props = normalizeNFLEventProps({ id: 'fixture', bookmakers: [{ key: 'fixture', title: 'Fixture', markets: [{
      key: 'player_field_goals', outcomes: [
        { name: 'Over', description: 'Fixture Kicker', point: line, price: 115 },
        { name: 'Under', description: 'Fixture Kicker', point: line, price: -135 },
      ],
    }] }] });
    expect(props).toHaveLength(1);
    expect(props[0]).toMatchObject({ marketKey: 'player_field_goals', line, overOdds: 115, underOdds: -135, historicalAnalysisAvailable: true });
    const logs: NFLGameLogEntry[] = [0, 1, 2, 3].map((fieldGoalsMade, index) => ({
      gameId: `fixture-${index}`, week: index + 1, date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      opponent: 'Fixture', opponentAbbreviation: 'FIX', homeAway: 'home', result: 'W', stats: { fieldGoalsMade },
    }));
    expect(buildNFLHistory(logs, 'player_field_goals', props[0].line, 'over').windows.season)
      .toMatchObject({ games: 4, hits: logs.filter((log) => log.stats.fieldGoalsMade > line).length });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not manufacture FG lines from missing outcomes or absent markets', () => {
    expect(normalizeNFLEventProps({ id: 'empty', bookmakers: [] })).toEqual([]);
    expect(normalizeNFLEventProps({ id: 'missing-line', bookmakers: [{ key: 'fixture', title: 'Fixture', markets: [{
      key: 'player_field_goals', outcomes: [{ name: 'Over', description: 'Fixture Kicker', price: -110 }],
    }] }] })).toEqual([]);
  });

  it.each(['NFL field goals attempted', 'NFL longest FG', 'NFL team field goals'])('direct preparation clarifies %s before lookup or network', async (query) => {
    const context = createAgentContext();
    context.nflScope = parseNFLRequestScope(query);
    const search = vi.fn().mockResolvedValue([]);
    expect(await prepareNFLRequestScope(context, search)).toBe(context.nflScope.clarification);
    expect(search).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});