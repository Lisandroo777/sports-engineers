import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStalePersistentCache, writePersistentCache } from '../odds/persistentCache';
import { recordNFLPropPriceSnapshot, summarizeNFLPropPriceMovement, type NFLPropPriceSnapshotPoint } from './marketSnapshots';

vi.mock('../odds/persistentCache', () => ({ readStalePersistentCache: vi.fn(), writePersistentCache: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const base = { eventId: 'event', player: 'Player One', marketKey: 'player_pass_yds', sportsbookKey: 'book', side: 'over' as const };

describe('NFL prop price observation snapshots', () => {
  it('records only an observed quote and never labels the first observation as sportsbook opening', async () => {
    vi.mocked(readStalePersistentCache).mockResolvedValue(null);
    const history = await recordNFLPropPriceSnapshot({ ...base, line: 244.5, odds: -110,
      retrievedAt: '2026-10-05T12:00:00Z', quoteUpdatedAt: '2026-10-05T11:59:30Z' });
    expect(history).toHaveLength(1);
    expect(writePersistentCache).toHaveBeenCalledOnce();
    expect(summarizeNFLPropPriceMovement({ history, currentLine: 244.5, currentPrice: -110,
      retrievedAt: '2026-10-05T12:00:00Z', valueQualified: true, priceCurrent: true })).toMatchObject({
      openingLine: null, firstObservedLine: 244.5, previousLine: null, lineMovement: null,
      previousPrice: null, movementReason: 'UNKNOWN', valueRemains: true, reEvaluatedAtCurrentLine: true,
    });
  });

  it('tracks actual line and price changes without guessing why they moved', () => {
    const history: NFLPropPriceSnapshotPoint[] = [
      { line: 244.5, odds: -110, observedAt: '2026-10-05T12:00:00Z', quoteUpdatedAt: null },
      { line: 248.5, odds: -115, observedAt: '2026-10-05T13:00:00Z', quoteUpdatedAt: null },
    ];
    expect(summarizeNFLPropPriceMovement({ history, currentLine: 248.5, currentPrice: -115,
      retrievedAt: '2026-10-05T13:00:00Z', valueQualified: false, priceCurrent: true })).toMatchObject({
      openingLine: null, firstObservedLine: 244.5, previousLine: 244.5, currentLine: 248.5,
      lineMovement: 4, previousPrice: -110, priceMovement: -5, movementReason: 'UNKNOWN', valueRemains: false,
    });
  });

  it('keeps the football line unchanged while recognizing improved price value', () => {
    const history: NFLPropPriceSnapshotPoint[] = [
      { line: 61.5, odds: -110, observedAt: '2026-10-05T12:00:00Z', quoteUpdatedAt: null },
      { line: 61.5, odds: 105, observedAt: '2026-10-05T13:00:00Z', quoteUpdatedAt: null },
    ];
    expect(summarizeNFLPropPriceMovement({ history, currentLine: 61.5, currentPrice: 105,
      retrievedAt: '2026-10-05T13:00:00Z', valueQualified: true, priceCurrent: true })).toMatchObject({
      currentLine: 61.5, previousLine: 61.5, currentPrice: 105, previousPrice: -110, lineMovement: 0,
      priceMovement: 215, movementReason: 'UNKNOWN', valueRemains: true, reEvaluatedAtCurrentLine: true,
    });
  });
});