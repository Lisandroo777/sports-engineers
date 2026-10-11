import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNFLResearchProfile } from './researchModel';
import { buildNFLMatchupEfficiency } from './matchupEfficiency';

describe.skipIf(process.env.NFL_MATCHUP_BROWSER !== '1')('Phase3 mocked research-card browser check', () => {
  it('renders existing scheme/trench sections without overflow on desktop and mobile', async () => {
    const { chromium } = createRequire(import.meta.url)(process.env.NFL_BROWSER_MODULE);
    const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const captured = JSON.parse(readFileSync('.cache/nfl-readiness-fixes/ui-captured.json', 'utf8'));
    const row = captured.results.find((candidate) => candidate.player === 'Chris Olave' && candidate.line === 84.5);
    const audit = JSON.parse(readFileSync('.cache/nfl-readiness-fixes/run-3.json', 'utf8')).candidates
      .find((candidate) => candidate.id.includes('|Chris Olave|player_reception_yds|84.5|over|'));
    const matchupModel = buildNFLMatchupEfficiency({ market: row.marketKey, position: 'WR', opponentContext: audit.opponent,
      injuryContext: audit.injury, researchMode: 'STANDARD', snapshotOnly: true });
    const profile = buildNFLResearchProfile({ researchMode: 'STANDARD', player: row.player, team: row.team, position: 'WR',
      market: row.marketKey, direction: 'over', line: row.line, sportsbook: row.book, oddsAmerican: row.odds,
      priceTimestamp: new Date().toISOString(), retrievedAt: new Date().toISOString(), priceCurrent: true, priceFreshness: 'FRESH',
      trueProbability: row.trueProbability, priceEdge: row.priceEdgePercent, valueQualified: true, existingEliteQualified: true,
      dataQuality: row.dataQuality, rawEdge: row.edge, roleContext: audit.role, opponentContext: audit.opponent, injuryContext: audit.injury,
      weatherContext: audit.weather, marketSupport: 'full', historyGames: row.sampleSize, projectionAvailable: true,
      availabilityEligible: true, alternatePrices: [], supportingReasons: ['Archived UI fixture only'], counterReasons: matchupModel.counterCase,
    });
    profile.matchupModel = matchupModel;
    profile.schemeMatchup.value.matchupAnalysis = matchupModel;
    const response = { ...captured, results: [{ ...row, nflResearchProfile: profile }], closestMisses: [], researchSessionId: null };
    mkdirSync('.cache/nfl-phase3', { recursive: true });
    try {
      for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
        const page = await browser.newPage({ viewport });
        const externalCalls = [];
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname === '/api/ai/chat') return route.fulfill({ json: response });
          if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { games: [], players: [], news: [] } });
          if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
            externalCalls.push(url.hostname);
            return route.abort();
          }
          return route.continue();
        });
        await page.goto(process.env.NFL_BROWSER_URL ?? 'http://localhost:3013/ai', { waitUntil: 'domcontentloaded', timeout: 20000 });
        const textbox = page.locator('textarea').first();
        await textbox.fill('Give me the best NFL plays');
        await textbox.press('Enter');
        await page.getByRole('button', { name: 'View Full Research', exact: true }).first().click({ timeout: 20000 });
        await page.getByText('Scheme Matchup', { exact: true }).first().waitFor();
        await page.getByText('Scheme Matchup', { exact: true }).first().click();
        await page.getByText('Trench / Protection', { exact: true }).first().click();
        expect(await page.getByText('Matchup confidence', { exact: true }).first().isVisible()).toBe(true);
        expect(await page.getByText('Matchup confidence', { exact: true }).count()).toBeGreaterThan(0);
        expect(await page.getByText('Efficiency adjustment', { exact: true }).count()).toBeGreaterThan(0);
        expect(await page.getByText('Missing Matchup Evidence', { exact: true }).count()).toBeGreaterThan(0);
        expect(await page.getByText('Trench / Protection', { exact: true }).count()).toBeGreaterThan(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        expect(overflow).toBe(false);
        const textOverflow = await page.getByText('Matchup confidence', { exact: true }).first().locator('xpath=ancestor::details')
          .evaluate((section) => [...section.querySelectorAll('p')].some((paragraph) => paragraph.scrollWidth > paragraph.clientWidth + 1));
        expect(textOverflow).toBe(false);
        await page.getByText('Scheme Matchup', { exact: true }).first().scrollIntoViewIfNeeded();
        const screenshot = `.cache/nfl-phase3/matchup-${name}.png`;
        await page.screenshot({ path: screenshot });
        expect(existsSync(screenshot)).toBe(true);
        console.info(JSON.stringify({ viewport: name, width: viewport.width, horizontalOverflow: overflow, screenshot, externalRequestsBlocked: externalCalls.length }));
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }, 60000);
});