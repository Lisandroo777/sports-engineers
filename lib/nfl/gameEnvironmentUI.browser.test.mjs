import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.env.NFL_GAME_ENVIRONMENT_BROWSER !== '1')('Phase4 provider-free Game Script browser check', () => {
  it('renders visible supported data and Deep scenarios at desktop/mobile widths', async () => {
    const { chromium } = createRequire(import.meta.url)(process.env.NFL_BROWSER_MODULE);
    const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const replay = JSON.parse(readFileSync('.cache/nfl-phase4/game-environment-replay.json', 'utf8'));
    const captured = JSON.parse(readFileSync('.cache/nfl-readiness-fixes/ui-captured.json', 'utf8'));
    mkdirSync('.cache/nfl-phase4', { recursive: true });
    try {
      for (const researchMode of ['STANDARD', 'DEEP']) {
        const record = replay.outputs.find((row) => row.player === 'Chris Olave' && row.market === 'player_reception_yds' && row.researchMode === researchMode).record;
        const response = { ...captured, results: [record], closestMisses: [], researchSessionId: null };
        for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
          const page = await browser.newPage({ viewport });
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === '/api/ai/chat') return route.fulfill({ json: response });
            if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { games: [], players: [], news: [] } });
            if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
            return route.continue();
          });
          await page.goto(process.env.NFL_BROWSER_URL ?? 'http://localhost:3013/ai', { waitUntil: 'domcontentloaded', timeout: 20000 });
          const textbox = page.locator('textarea').first();
          await textbox.fill(researchMode === 'DEEP' ? 'Deep research the best NFL plays' : 'Give me the best NFL plays');
          await textbox.press('Enter');
          await page.getByRole('button', { name: 'View Full Research', exact: true }).first().click({ timeout: 20000 });
          await page.getByText('Game Script', { exact: true }).first().click();
          expect(await page.getByText('Projected team plays', { exact: true }).first().isVisible()).toBe(true);
          const section = page.getByText('Game Script', { exact: true }).first().locator('xpath=ancestor::details');
          expect(await section.getByText('12.07 / 12.07', { exact: true }).isVisible()).toBe(true);
          expect(await section.getByText('24.5 / 23', { exact: true }).isVisible()).toBe(true);
          expect(await section.getByText('Game-Flow Counter-Case', { exact: true }).isVisible()).toBe(true);
          expect(await section.getByText('Missing Game-Script Inputs', { exact: true }).isVisible()).toBe(true);
          if (researchMode === 'DEEP') expect(await section.getByText('Deep Script Scenarios', { exact: true }).isVisible()).toBe(true);
          else expect(await section.getByText('Deep Script Scenarios', { exact: true }).count()).toBe(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
          expect(await section.evaluate((element) => [...element.querySelectorAll('p')].some((paragraph) => paragraph.scrollWidth > paragraph.clientWidth + 1))).toBe(false);
          expect(errors).toEqual([]);
          await section.scrollIntoViewIfNeeded();
          const screenshot = `.cache/nfl-phase4/game-script-${researchMode.toLowerCase()}-${name}.png`;
          await page.screenshot({ path: screenshot });
          console.info(JSON.stringify({ researchMode, viewport: name, screenshot, pageErrors: errors.length, overflow: false, apiMocked: true }));
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }, 60000);
});