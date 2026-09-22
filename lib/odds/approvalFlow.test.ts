import { describe, expect, it } from 'vitest';
import { isPaidRefreshAllowed, withOneRunPaidRefresh } from './client';
import { tomorrowSlateDate, todaySlateDate } from '../dateModel';

describe('interactive refresh approval safety', () => {
  it('authorizes only the awaited operation while the global flag remains false', async () => {
    const previous = process.env.ODDS_ALLOW_PAID_REFRESH;
    process.env.ODDS_ALLOW_PAID_REFRESH = 'false';
    expect(isPaidRefreshAllowed()).toBe(false);
    const inside = await withOneRunPaidRefresh(async () => isPaidRefreshAllowed());
    expect(inside).toBe(true);
    expect(process.env.ODDS_ALLOW_PAID_REFRESH).toBe('false');
    expect(isPaidRefreshAllowed()).toBe(false);
    if (previous == null) delete process.env.ODDS_ALLOW_PAID_REFRESH;
    else process.env.ODDS_ALLOW_PAID_REFRESH = previous;
  });
});

describe('Tomorrow date resolution', () => {
  it('resolves to the next calendar date, not the current date', () => {
    const today = todaySlateDate();
    expect(tomorrowSlateDate()).not.toBe(today);
    expect(new Date(`${tomorrowSlateDate()}T12:00:00Z`).getTime()).toBeGreaterThan(new Date(`${today}T12:00:00Z`).getTime());
  });
});
