import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeNBAResearchReceipt } from '../lib/nba/prediction/researchReceipt';
import { nbaResearchQuotePresentation } from '../lib/nba/prediction/researchPresentation';
import { buildPickPresentation } from '../lib/nba/presentation';

const receiptPath = resolve('data/nba-v3/live-market-verification/2026-10-24T00-13-19.899Z');
describe.skipIf(process.env.NBA_RECEIPT_UI_BROWSER !== '1')('saved receipt responsive pagination, no paid/provider calls', () => {
  it('shows all 26 identities accurately and mounts bounded cards for all 5989 outcomes', async () => {
    if (!existsSync(`${receiptPath}/quotes.json`)) throw new Error('Saved live receipt required; no live fallback allowed.');
    const raw = JSON.parse(readFileSync(`${receiptPath}/quotes.json`, 'utf8'));
    const report = JSON.parse(readFileSync(`${receiptPath}/report.json`, 'utf8'));
    const receipt = { ...raw, regions: ['us', 'us2'], requestedMarkets: report.requestedMarkets };
    const quotes = normalizeNBAResearchReceipt(receipt, { id: raw.data.id, tipoff: raw.data.commence_time,
      homeTeam: raw.data.home_team, awayTeam: raw.data.away_team }, undefined, Date.parse(raw.observedAt));
    expect(quotes).toHaveLength(5989);
    const representatives = [...new Map(quotes.map(quote => [quote.sourceMarket, quote])).values()];
    const representativeSet = new Set(representatives);
    const ordered = [...representatives, ...quotes.filter(quote => !representativeSet.has(quote))];
    const presentation = { ...buildPickPresentation({ picks: ordered.map(quote => nbaResearchQuotePresentation(quote,
      'Saved receipt UI replay only. Historical evidence unavailable in this fixture; no new live request was performed.')),
      requestedSort: 'BEST', includePasses: true }), recommendedCandidateIds: [] };
    const { chromium } = createRequire(import.meta.url)(process.env.NBA_BROWSER_MODULE ?? 'playwright');
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const target = process.env.NBA_SAFE_PREVIEW_URL ?? 'http://127.0.0.1:3118';
    mkdirSync('.cache/nba-release-ui', { recursive: true });
    try {
      for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const errors = [];
        let mockedResearchRequests = 0;
        let blockedExternalRequests = 0;
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.origin !== new URL(target).origin) { blockedExternalRequests += 1; return route.abort(); }
          if (url.pathname.startsWith('/api/')) {
            if (url.pathname === '/api/ai/demo/nba' && route.request().method() === 'GET') {
              return route.continue();
            }
            if (url.pathname === '/api/ai/chat' && route.request().method() === 'POST') {
              mockedResearchRequests += 1;
              return route.fulfill({ json: { reply: 'Saved sportsbook receipt replay; not current live research.', results: [], toolTrace: [],
                closestMisses: [], researchSessionId: null, nbaPresentation: presentation,
                meta: { sport: 'nba', date: '2026-10-23', researchComplete: false, partialCoverage: true } } });
            }
            return route.fulfill({ json: { data: [] } });
          }
          return route.continue();
        });
        try {
          await page.goto(`${target}/ai?sport=nba&date=2026-10-23`, { waitUntil: 'networkidle' });
          await page.getByRole('textbox', { name: 'Ask anything...' }).fill('Research NBA Houston Rockets vs San Antonio Spurs on October 23 2026');
          await page.getByRole('button', { name: 'Search', exact: true }).click();
          const surface = page.locator('[data-nba-presentation]');
          await surface.waitFor();
          expect(await surface.locator('article').count()).toBe(20);
          const allKeys = new Set();
          for (const currentPage of [0, 1]) {
            if (currentPage === 1) await surface.getByRole('button', { name: 'Next page', exact: true }).first().click();
            await expect.poll(() => surface.locator('article').first().getAttribute('data-candidate-id')).toBe(presentation.picks[currentPage * 20].candidateId);
            const cards = surface.locator('article');
            for (const card of await cards.all()) {
              const key = await card.getAttribute('data-market-key');
              allKeys.add(key);
              const text = await card.innerText();
              const original = ordered.find(quote => quote.sourceMarket === key);
              expect(text).toContain('RESEARCH ONLY');
              expect(text).toContain('Unavailable');
              if (key.endsWith('_q1')) expect(text).toContain('1Q');
              if (key.startsWith('alternate_')) expect(text).toContain('Alternate');
              if (currentPage === 0 || allKeys.size <= 26) {
                const candidateId = await card.getAttribute('data-candidate-id');
                const candidate = presentation.picks.find(pick => pick.candidateId === candidateId);
                expect(text).toContain(candidate.pricing.sportsbook);
                expect(text).toContain(String(candidate.pricing.americanOdds));
                if (candidate.subject.market.line != null) expect(text).toContain(String(candidate.subject.market.line));
              }
              expect(original).toBeDefined();
            }
          }
          expect(allKeys.size).toBe(26);
          await surface.getByRole('button', { name: 'Previous page', exact: true }).first().click();
          await expect.poll(() => surface.getByRole('spinbutton', { name: 'Research page', exact: true }).first().inputValue()).toBe('1');
          await surface.getByRole('button', { name: 'Next page', exact: true }).first().click();
          await expect.poll(() => surface.getByRole('spinbutton', { name: 'Research page', exact: true }).first().inputValue()).toBe('2');
          await surface.getByRole('spinbutton', { name: 'Research page', exact: true }).first().fill('300');
          await surface.getByRole('spinbutton', { name: 'Research page', exact: true }).first().press('Enter');
          await expect.poll(() => surface.locator('article').count()).toBe(9);
          expect(await surface.locator('article').count()).toBe(9);
          expect(await surface.getByRole('button', { name: 'Next page', exact: true }).first().isDisabled()).toBe(true);
          await surface.getByRole('spinbutton', { name: 'Research page', exact: true }).first().fill('2');
          await surface.getByRole('spinbutton', { name: 'Research page', exact: true }).first().press('Enter');
          await expect.poll(() => surface.locator('article').first().getAttribute('data-candidate-id')).toBe(presentation.picks[20].candidateId);
          await surface.scrollIntoViewIfNeeded();
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
          expect(await surface.locator('article').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth).length)).toBe(0);
          await page.screenshot({ path: `.cache/nba-release-ui/receipt-pagination-${name}.png` });
          expect(mockedResearchRequests).toBe(1);
          expect(errors).toEqual([]);
          console.log(JSON.stringify({ viewport: name, totalOutcomes: quotes.length, verifiedMarkets: allKeys.size, pageSize: 20,
            lastPageSize: 9, researchRequestsMocked: mockedResearchRequests, blockedExternalRequests, runtimeErrors: errors.length }));
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }, 180000);

  it('loads the synthetic demo on desktop and mobile with no Redis/live API dependency', async () => {
    const target = new URL(process.env.NBA_SAFE_PREVIEW_URL ?? 'http://127.0.0.1:3118');
    const { chromium } = createRequire(import.meta.url)(process.env.NBA_BROWSER_MODULE ?? 'playwright');
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
      for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          const errors = [];
          let demoCalls = 0;
          const nonDemoApiCalls = [];
          page.on('pageerror', error => errors.push(error.message));
          await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== target.origin) return route.abort();
            if (url.pathname === '/api/ai/demo/nba') { demoCalls += 1; return route.continue(); }
            if (url.pathname.startsWith('/api/')) {
              nonDemoApiCalls.push(url.pathname);
              if (url.pathname === '/api/ai/chat') return route.fulfill({ json: { reply: '', results: [], closestMisses: [], toolTrace: [], meta: null } });
              return route.fulfill({ json: { data: [], configured: false } });
            }
            return route.continue();
          });
          await page.goto(`${target}/ai?sport=nba&date=2026-10-23`, { waitUntil: 'networkidle' });
          const filter = page.locator('details').filter({ hasText: 'Research Filter' }).first();
          await filter.locator('summary').click();
          await filter.getByRole('button', { name: 'Show NBA test fixtures', exact: true }).click();
          await filter.getByRole('button', { name: 'Load synthetic test fixtures', exact: true }).click();
          const panel = page.getByRole('region', { name: 'NBA synthetic research test demo' });
          await panel.getByText('TEST DATA · SYNTHETIC NBA FIXTURES', { exact: true }).waitFor();
          await panel.getByRole('heading', { name: 'Research candidates · Not recommended wagers', exact: true }).waitFor();
          expect(await panel.locator('article').count()).toBe(20);
          expect(await panel.getByText(/Mock values for UI testing only/).count()).toBe(1);
          expect(await panel.getByText(/No API, Redis, AI, storage or odds acquisition is called/).count()).toBe(1);
          expect(await panel.locator('article').evaluateAll(nodes => nodes.every(node => node.getAttribute('data-tier') === 'RESEARCH_ONLY'))).toBe(true);
          expect(await panel.locator('article').evaluateAll(nodes => nodes.every(node => node.innerText.includes('UNPRICED · RESEARCH ONLY')))).toBe(true);
          expect(await panel.locator('article').evaluateAll(nodes => nodes.some(node => /Fixture Book|\b-110\b|\+125|\d+\.\d+%/.test(node.innerText)))).toBe(false);
          await panel.getByRole('button', { name: 'Next page', exact: true }).first().click();
          await expect.poll(() => panel.locator('article').first().getAttribute('data-candidate-id')).toContain('demo.');
          expect(demoCalls).toBe(1);
          expect(nonDemoApiCalls).not.toContain('/api/ai/chat');
          expect(nonDemoApiCalls.some(path => path.includes('odds'))).toBe(false);
          expect(errors).toEqual([]);
          await page.screenshot({ path: `.cache/nba-release-ui/synthetic-demo-${name}.png` });
          console.log(JSON.stringify({ mode: 'synthetic-only', viewport: name, mountedCards: await panel.locator('article').count(), demoCalls, nonDemoApiCalls, runtimeErrors: errors.length }));
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }, 90000);
});