import { describe, expect, it } from 'vitest';
import { projectNBAEarlySeason, type NBAV2Observation } from './earlySeason';
import { NBA_V2_VALIDATION } from './validation';

const games = (count: number, start: string, minutes: number, value: number): NBAV2Observation[] =>
  Array.from({ length: count }, (_, index) => ({ gameId: `${start}-${index}`, date: new Date(Date.parse(start) + index * 86400000).toISOString(),
    minutes, value: value + (index % 3) - 1 }));
const tipoff = '2026-10-25T23:00:00Z';

describe('NBA V2 early-season model', () => {
  it('labels prior-season and current-season samples separately and ignores post-tipoff data', () => {
    const projection = projectNBAEarlySeason({ priorSeason: games(40, '2025-11-01', 30, 20), targetTipoff: tipoff, line: 19.5,
      currentSeason: [...games(2, '2026-10-21', 30, 24), { gameId: 'future', date: '2026-10-26T00:00:00Z', minutes: 40, value: 60 }] });
    expect(projection).toMatchObject({ status: 'AVAILABLE', priorSeasonGames: 40, currentSeasonGames: 2 });
    expect(projection.reasons[0]).toMatch(/not current-season evidence/);
    expect(projection.expectedStat!).toBeGreaterThan(20);
    expect(projection.expectedStat!).toBeLessThan(24);
  });

  it('requires a prior-season baseline and penalizes an unstable role', () => {
    expect(projectNBAEarlySeason({ priorSeason: games(10, '2025-11-01', 30, 20), currentSeason: [], targetTipoff: tipoff, line: 19.5 }).status)
      .toBe('INSUFFICIENT_PRIOR_SEASON');
    const stable = projectNBAEarlySeason({ priorSeason: games(40, '2025-11-01', 30, 20), currentSeason: games(3, '2026-10-20', 30, 20), targetTipoff: tipoff, line: 19.5 });
    const unstable = projectNBAEarlySeason({ priorSeason: games(40, '2025-11-01', 30, 20), currentSeason: games(3, '2026-10-20', 15, 10), targetTipoff: tipoff, line: 19.5 });
    expect(unstable.uncertaintyMultiplier!).toBeGreaterThan(stable.uncertaintyMultiplier!);
    expect(unstable.reasons.join(' ')).toMatch(/Unstable role/);
  });

  it('cannot publish until EV is validated against real historical prices', () => {
    expect(NBA_V2_VALIDATION).toMatchObject({ calibrationPassed: true, evValidated: false, publishable: false, leakageViolations: 0 });
  });
});
