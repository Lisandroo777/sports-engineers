import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasDurableKV, kvGetJson, kvSetJson } from '../../storage/kv';
import { loadPublishedNBAIntelligence, publishNBAIntelligence } from './published';
import { availabilityFixture } from '../prediction/gameLines/availability.fixtures';

vi.mock('../../storage/kv', () => ({ hasDurableKV: vi.fn(() => true), kvGetJson: vi.fn(), kvSetJson: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasDurableKV).mockReturnValue(true); });

describe('durable exact-game Agent 2 intelligence delivery', () => {
  it('delivers a verified snapshot without a local archive path and rejects another game or future observation', async () => {
    const snapshot = availabilityFixture().intelligence;
    vi.mocked(kvGetJson).mockResolvedValue(snapshot);
    expect(await loadPublishedNBAIntelligence(snapshot.target, snapshot.asOf)).toEqual(snapshot);
    expect(await loadPublishedNBAIntelligence({ ...snapshot.target, homeTeamId: 999 }, snapshot.asOf)).toBeNull();
    expect(await loadPublishedNBAIntelligence(snapshot.target, '2020-01-01T00:00:00Z')).toBeNull();
  });
  it('publishes only upcoming snapshots with durable storage and never falls back to paid sources', async () => {
    const snapshot = availabilityFixture().intelligence;
    vi.useFakeTimers(); vi.setSystemTime(new Date(snapshot.asOf));
    try {
      await publishNBAIntelligence(snapshot);
      expect(kvSetJson).toHaveBeenCalledOnce();
      vi.mocked(hasDurableKV).mockReturnValue(false);
      expect(await loadPublishedNBAIntelligence(snapshot.target, snapshot.asOf)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});