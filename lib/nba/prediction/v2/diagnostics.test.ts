import { describe, expect, it } from 'vitest';
import { buildNBAV2Diagnostics, hypotheticalEvPercent, NBA_V2_DIAGNOSTIC_LABEL } from './diagnostics';

const log = (index: number, start: string, points: number) => ({ gameId: `${start}-${index}`,
  date: new Date(Date.parse(start) + index * 86400000).toISOString(), stat: { minutes: 30, points: points + (index % 3) - 1, totalRebounds: 6, assists: 4 } });
const candidate = { candidateId: 'c1', playerId: 7, player: 'Fixture Guard', marketKey: 'points', line: 19.5,
  direction: 'over' as const, odds: -110, book: 'Fixture Book', tipoff: '2026-10-25T23:00:00Z' };

describe('NBA V2 research-only diagnostics', () => {
  it('evaluates cached props with the actual line and price, labeled unvalidated and never publishable or tiered', async () => {
    const loader = async (_: number, season: number) => season === 2026 ? Array.from({ length: 40 }, (_, i) => log(i, '2025-11-01', 22))
      : Array.from({ length: 2 }, (_, i) => log(i, '2026-10-21', 22));
    const [row] = await buildNBAV2Diagnostics([candidate], loader);
    expect(row).toMatchObject({ status: 'EVALUATED', label: NBA_V2_DIAGNOSTIC_LABEL, publishable: false, priorSeasonGames: 40, currentSeasonGames: 2, odds: -110 });
    expect(row.probability!).toBeGreaterThan(0.5);
    expect(row.hypotheticalEvPercent).toBeCloseTo(hypotheticalEvPercent(row.probability!, -110));
    expect(row).not.toHaveProperty('pickTier');
    expect(row.reasons.join(' ')).toMatch(/EV is not validated/);
  });

  it('reports unsupported markets, missing prior seasons, missing prices and history failures explicitly', async () => {
    const short = async () => Array.from({ length: 5 }, (_, i) => log(i, '2025-11-01', 22));
    const rows = await buildNBAV2Diagnostics([{ ...candidate, marketKey: 'pra' }, candidate, { ...candidate, candidateId: 'c3', odds: null }], short);
    expect(rows.map(row => row.status)).toEqual(['UNSUPPORTED_MARKET', 'INSUFFICIENT_PRIOR_SEASON', 'INSUFFICIENT_PRIOR_SEASON']);
    const failed = await buildNBAV2Diagnostics([candidate], async () => { throw new Error('provider down'); });
    expect(failed[0].status).toBe('NOT_EVALUATED');
    expect(hypotheticalEvPercent(0.55, 100)).toBeCloseTo(10);
  });
});
