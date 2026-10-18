import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  getOddsEvents: vi.fn(),
  getDiscoveredEventPlayerProps: vi.fn(),
  getPropsCacheTtlMs: vi.fn(() => 60_000),
}));
vi.mock('./match', () => ({ matchOddsEvent: (_game: unknown, events: unknown[]) => events[0] ?? null }));
vi.mock('../mlb/players', () => ({ findMLBPlayerIdByName: vi.fn() }));

import { getEventProps } from './eventProps';
import { getDiscoveredEventPlayerProps } from './client';
import { findMLBPlayerIdByName } from '../mlb/players';
import type { NormalizedProp, OddsEvent } from './types';

const event: OddsEvent = { id: 'event', homeTeam: 'Home', awayTeam: 'Away', commenceTime: '2026-10-18T23:00:00Z' };
const props: NormalizedProp[] = ['Available', 'Unavailable', 'Available'].map((player, index) => ({
  eventId: event.id, player, playerId: null, marketKey: 'batter_hits', line: index + 0.5,
  sourceMarketKey: 'batter_hits', marketLabel: 'Hits', historicalAnalysisAvailable: true,
  overOdds: -110, underOdds: -110, sportsbookKey: 'fixture', sportsbookName: 'Fixture',
  isAlternate: false, lastUpdate: '2026-10-18T18:00:00Z',
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getDiscoveredEventPlayerProps).mockResolvedValue(props);
  vi.mocked(findMLBPlayerIdByName).mockImplementation(async name => {
    if (name === 'Unavailable') throw new Error('Player lookup failed');
    return 10;
  });
});

describe('MLB event player resolution isolation', () => {
  it('retains all pricing and available identities when one lookup rejects', async () => {
    const result = await getEventProps('Home', 'Away', '2026-10-18', event);
    expect(result.event).toEqual(event);
    expect(result.props).toEqual(props.map(prop => ({ ...prop, playerId: prop.player === 'Unavailable' ? null : 10 })));
    expect(findMLBPlayerIdByName).toHaveBeenCalledTimes(2);
  });

  it('does not suppress a whole-event pricing provider failure', async () => {
    const failure = new Error('Pricing provider unavailable');
    vi.mocked(getDiscoveredEventPlayerProps).mockRejectedValueOnce(failure);
    await expect(getEventProps('Home', 'Away', '2026-10-18', event)).rejects.toBe(failure);
    expect(findMLBPlayerIdByName).not.toHaveBeenCalled();
  });
});