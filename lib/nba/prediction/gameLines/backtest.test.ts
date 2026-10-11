import { describe, expect, it } from 'vitest';
import { backtestNBAGameLines, type ArchivedGamePrediction } from './backtest';
import { historicalFixture, quote, binding } from './fixtures';

function archive(): ArchivedGamePrediction {
  return { origin: 'SYNTHETIC_FIXTURE', input: historicalFixture(), binding, quote: quote(),
    outcome: { gameId: 'target', homeScore: 115, awayScore: 101, completedAt: '2026-01-22T01:00:00Z', observedAt: '2026-01-22T02:00:00Z', source: 'Synthetic ESPN fixture', finalized: true } };
}

describe('Cutoff-safe NBA game-line offline evaluation', () => {
  it('retains wins/losses/pushes/missing outcomes and does not advertise synthetic performance as forward validation', () => {
    const win = archive();
    const loss = archive(); loss.quote = quote({ selection: 'UNDER' });
    const push = archive(); push.quote = quote({ line: 216 });
    const missing = archive(); missing.quote = quote({ line: 217 }); missing.outcome = null;
    const report = backtestNBAGameLines([win, loss, push, missing], '2026-01-23T00:00:00Z');
    expect(report.ledger.map(row => row.grade)).toEqual(['WIN', 'LOSS', 'PUSH', 'UNGRADABLE']);
    expect(report.cohorts.SYNTHETIC_FIXTURE.all).toMatchObject({ n: 3, wins: 1, losses: 1, pushes: 1, ungradable: 1 });
    expect(report.cohorts.SYNTHETIC_FIXTURE.all.units).toBeCloseTo(100 / 110 - 1);
    expect(report.cohorts.FORWARD.all.n).toBe(0);
    expect(report.validationStatus).toBe('UNVALIDATED');
    expect(report.calibration).toBe('REPORT_ONLY_NOT_FITTED');
  });
  it('keeps forecasts unchanged if later actual outcomes change, and excludes duplicated or not-yet-final outcomes', () => {
    const row = archive(); const corrected = structuredClone(row); corrected.outcome!.homeScore = 95;
    const first = backtestNBAGameLines([row], '2026-01-23T00:00:00Z');
    const second = backtestNBAGameLines([corrected], '2026-01-23T00:00:00Z');
    expect(first.ledger[0].forecast).toEqual(second.ledger[0].forecast);
    expect(backtestNBAGameLines([row, row], '2026-01-23T00:00:00Z').ledger[1].grade).toBe('DUPLICATE');
    expect(backtestNBAGameLines([row], '2026-01-21T22:00:00Z').ledger[0].grade).toBe('UNGRADABLE');
    const malformed = archive(); malformed.input.snapshot.target.startsAt = 'invalid';
    expect(backtestNBAGameLines([malformed], '2026-01-23T00:00:00Z').ledger[0].grade).toBe('UNGRADABLE');
  });
  it('partitions every same-slate quote together and separates reconstructed results', () => {
    const rows = Array.from({ length: 10 }, (_, index) => {
      const row = archive();
      const day = String(index + 21).padStart(2, '0');
      row.input.predictionAt = `2026-01-${day}T18:00:00Z`;
      row.input.snapshot.asOf = row.input.predictionAt;
      row.input.snapshot.target.startsAt = `2026-01-${day}T23:00:00Z`;
      row.input.snapshot.target.source.fetchedAt = row.input.predictionAt;
      row.input.snapshot.target.gameId = `target-${index}`;
      row.binding = { ...binding, sourceGameId: `target-${index}` };
      row.quote = quote({ commenceTime: row.input.snapshot.target.startsAt, observedAt: `2026-01-${day}T17:31:00Z`, updatedAt: `2026-01-${day}T17:30:00Z` });
      row.outcome = { ...row.outcome!, gameId: `target-${index}`, completedAt: `2026-01-${day}T23:30:00Z`, observedAt: `2026-01-${day}T23:45:00Z` };
      return [row, { ...row, quote: { ...row.quote, selection: 'UNDER' as const } }];
    }).flat();
    const report = backtestNBAGameLines([...rows, { ...archive(), origin: 'RECONSTRUCTED' }], '2026-02-01T00:00:00Z');
    expect(report.cohorts.SYNTHETIC_FIXTURE).toMatchObject({ developmentSlates: 7, holdoutSlates: 3, holdout: { n: 6 } });
    expect(report.cohorts.RECONSTRUCTED.all.n).toBe(1);
    expect(report.cohorts.FORWARD.all.brier).toBeNull();
  });
});