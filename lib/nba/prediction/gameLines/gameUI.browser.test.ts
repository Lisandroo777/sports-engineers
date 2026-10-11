import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { binding, historicalFixture, quote } from './fixtures';
import { projectNBAGame } from './model';
import { buildGameRecommendation, withoutScenarios } from './recommendations';
import { availabilityFixture } from './availability.fixtures';
import { assessNBAGameAvailability } from './availability';

describe.skipIf(process.env.NBA_GAME_BROWSER !== '1')('NBA game recommendation browser checks', () => {
  it('renders exact market identities and separate unpriced research without overflow', async () => {
    const { chromium } = createRequire(import.meta.url)(process.env.NBA_BROWSER_MODULE!);
    const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const projection = projectNBAGame(historicalFixture());
    const fixture = availabilityFixture();
    const availability = assessNBAGameAvailability(fixture.snapshot, fixture.intelligence);
    const missing = assessNBAGameAvailability(fixture.snapshot, null);
    const ready = { ...availability, assessment: availability };
    const records = [
      quote({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null }),
      quote({ market: 'SPREAD', selection: 'HOME', team: 'HOME', line: -1.5 }),
      quote({ market: 'TOTAL', selection: 'OVER', team: null, line: 180.5 }),
      quote({ market: 'TEAM_TOTAL', selection: 'OVER', team: 'HOME', line: 90.5 }),
    ].map((price, index) => ({ ...buildGameRecommendation(projection, price, binding, ready, new Date(projection.predictionAt)), rank: index + 1,
      home: { id: 1, name: 'Home', logoUrl: 'https://a.espncdn.com/i/teamlogos/nba/500/atl.png' },
      away: { id: 2, name: 'Away', logoUrl: 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png' } }));
    mkdirSync('.cache/nba-game-integration', { recursive: true });
    try {
      for (const scenario of ['priced', 'unpriced']) {
        for (const [viewportName, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
          const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
          const errors: string[] = [];
          page.on('pageerror', (error: Error) => errors.push(error.message));
          await page.route('**/*', (route: { request(): { url(): string }; fulfill(options: { json: unknown }): Promise<void>; abort(): Promise<void>; continue(): Promise<void> }) => {
            const url = new URL(route.request().url());
            if (url.pathname === '/api/ai/chat') return route.fulfill({ json: {
              reply: scenario === 'priced' ? 'Qualified fixture selections.' : 'No qualified selections. Team research is not bettable.',
              results: scenario === 'priced' ? records : [], closestMisses: [], toolTrace: [], researchSessionId: null,
              modeledGames: scenario === 'priced' ? [] : [{ recommendationType: 'GAME', gameId: projection.gameId,
                home: { id: projection.homeTeamId, name: binding.homeTeam }, away: { id: projection.awayTeamId, name: binding.awayTeam },
                projection: withoutScenarios(projection), availability: missing, status: 'MODELED_NOT_BETTABLE', reason: 'No matching timestamped sportsbook quotes. No price or EV invented.' }],
              meta: { sport: 'nba', date: '2026-01-21', researchComplete: true },
            } });
            if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
            if (!['localhost', '127.0.0.1', 'a.espncdn.com'].includes(url.hostname)) return route.abort();
            return route.continue();
          });
          await page.goto(`${process.env.NBA_BROWSER_URL ?? 'http://localhost:3021'}/ai?sport=nba&date=2026-01-21`, { waitUntil: 'domcontentloaded' });
          const query = page.locator('textarea').first();
          await query.fill('Best NBA game lines');
          await query.press('Enter');
          if (scenario === 'priced') {
            await page.getByText('Home moneyline', { exact: true }).waitFor();
            expect(await page.getByText('4 recommended plays', { exact: true }).count()).toBe(1);
            expect(await page.getByText('Home -1.5', { exact: true }).isVisible()).toBe(true);
            expect(await page.getByText('Game total over 180.5', { exact: true }).count()).toBe(1);
            expect(await page.getByText('Home team total over 90.5', { exact: true }).count()).toBe(1);
            expect(await page.getByText('Win, excluding push', { exact: true }).count()).toBe(4);
            expect(await page.getByText('Quote updated:', { exact: false }).count()).toBe(4);
            await page.locator('article img').first().waitFor();
            await page.waitForFunction(() => {
              const visible = Array.from(document.querySelectorAll<HTMLImageElement>('article img')).filter(image => {
                const bounds = image.getBoundingClientRect();
                return bounds.top < innerHeight && bounds.bottom > 0;
              });
              return visible.length > 0 && visible.every(image => image.complete && image.naturalWidth > 0);
            });
          } else {
            await page.getByText('Modeled research · Not bettable', { exact: true }).waitFor();
            expect(await page.getByText('No matching timestamped sportsbook quotes. No price or EV invented.', { exact: true }).count()).toBe(1);
            expect(await page.getByText('Quote updated:', { exact: false }).count()).toBe(0);
            expect(await page.getByText('EV', { exact: true }).count()).toBe(0);
          }
          const article = page.locator('article').first();
          await article.scrollIntoViewIfNeeded();
          await article.getByText(`Team availability · ${scenario === 'priced' ? 'Verified' : 'Unresolved'}`, { exact: true }).click();
          expect(await article.getByText(`Team 1 · Report ${scenario === 'priced' ? 'VERIFIED' : 'MISSING'} · Lineup ${scenario === 'priced' ? 'OFFICIALLY_CONFIRMED' : 'UNKNOWN'}`, { exact: true }).isVisible()).toBe(true);
          if (scenario === 'priced') expect(await article.getByText('Player 101: AVAILABLE · Starter CONFIRMED', { exact: false }).isVisible()).toBe(true);
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
          expect(await page.locator('article').evaluateAll((elements: HTMLElement[]) => elements.some(element => element.scrollWidth > element.clientWidth + 1))).toBe(false);
          expect(errors).toEqual([]);
          await page.screenshot({ path: `.cache/nba-game-integration/${scenario}-${viewportName}.png` });
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }, 90000);
});