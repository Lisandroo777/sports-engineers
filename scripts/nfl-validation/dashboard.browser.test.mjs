import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.env.NFL_VALIDATION_BROWSER !== '1')('Internal validation dashboard, no network', () => {
  it('shows empty evidence and locked test truthfully on desktop/mobile', async () => {
    const { chromium } = createRequire(import.meta.url)(process.env.NFL_BROWSER_MODULE);
    const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    mkdirSync('.cache/nfl-validation', { recursive: true });
    try {
      for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('http**://**', (route) => route.abort());
        await page.goto(pathToFileURL(resolve('reports/nfl-validation/dashboard.html')).href);
        expect(await page.getByRole('heading', { name: 'NFL Model Validation', exact: true }).isVisible()).toBe(true);
        expect(await page.getByText('0', { exact: true }).count()).toBeGreaterThan(0);
        expect(await page.getByText('Clean settled observations').count()).toBeGreaterThan(0);
        expect(await page.getByText('Locked', { exact: true }).isVisible()).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
        expect(errors).toEqual([]);
        const screenshot = `.cache/nfl-validation/dashboard-${name}.png`;
        await page.screenshot({ path: screenshot });
        console.info(JSON.stringify({ viewport: name, screenshot, noOverflow: true, noPageErrors: true, networkBlocked: true }));
        await page.close();
      }
    } finally { await browser.close(); }
  }, 30000);
});