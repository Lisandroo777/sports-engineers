import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildPickPresentation, type PickPresentationInput, type PresentationTier } from '../lib/nba/presentation';

interface Locator {
  locator(selector: string): Locator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  first(): Locator;
  filter(options: { has: Locator }): Locator;
  scrollIntoViewIfNeeded(): Promise<void>;
  waitFor(options?: { state: 'visible' }): Promise<void>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  count(): Promise<number>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  click(): Promise<void>;
  inputValue(): Promise<string>;
  innerText(): Promise<string>;
  allTextContents(): Promise<string[]>;
  getAttribute(name: string): Promise<string | null>;
  evaluateAll<Result>(callback: (elements: Element[]) => Result): Promise<Result>;
}

interface BrowserRequest {
  url(): string;
  method(): string;
  postDataJSON(): { messages: Array<{ content: string }>; context: { sport: string; date: string } };
}

interface Route {
  request(): BrowserRequest;
  fulfill(options: { json: unknown }): Promise<void>;
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface BrowserResponse {
  url(): string;
  request(): BrowserRequest;
}

interface Page {
  locator(selector: string): Locator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  setDefaultTimeout(timeout: number): void;
  on(event: 'pageerror', callback: (error: Error) => void): void;
  evaluate<Result>(callback: () => Result): Promise<Result>;
  goto(url: string, options: { waitUntil: 'domcontentloaded' }): Promise<unknown>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  waitForResponse(predicate: (response: BrowserResponse) => boolean): Promise<BrowserResponse>;
}

interface BrowserContext {
  newPage(): Promise<Page>;
  route(pattern: string, handler: (route: Route) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

interface Browser {
  newContext(options: { viewport: { width: number; height: number }; serviceWorkers: 'block' }): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface BrowserType {
  launch(options: { headless: boolean; executablePath: string }): Promise<Browser>;
}

const queryText = 'Find best NBA picks today';
const slateDate = '2026-10-11';
const observedAt = '2026-10-11T12:00:00Z';
const tiers = ['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS'] as const;
const fixturePurpose = 'Presentation contract fixture only; not a model claim or validated prediction.';
const source = 'fixture://nba/2026-10-11/season-evidence';
const risk = 'Fixture risk: rotations and minutes remain uncertain.';

function fixtureInput(tier: PresentationTier | null, candidateId: string): PickPresentationInput {
  return {
    candidateId,
    subject: {
      kind: 'PLAYER_PROP', gameId: 'fixture-game',
      player: { id: null, name: `Fixture ${candidateId}`, team: 'Fixture Home' },
      market: { key: 'points', label: 'Points', side: 'over', line: 24.5 },
    },
    tierDecision: tier == null ? null : {
      pickTier: tier, tierReason: `${tier}: ${fixturePurpose}`, tierScore: 87,
      tierRequirementsPassed: ['Supplied fixture contract gate'],
      tierRequirementsFailed: tier === 'PASS' ? ['Fixture publication gate failed'] : [],
    },
    sportsbook: 'Fixture Book', americanOdds: -110, quoteStatus: 'CURRENT',
    trueProbability: 57.4, modelProbability: 58.1, evPercent: 9.2, researchScore: 91,
    seasonPhase: 'REGULAR', seasonPhaseCertainty: 'VERIFIED', seasonPhaseReason: fixturePurpose,
    researchEvidence: [
      { id: `${candidateId}-season`, category: 'season', source, detail: 'Fixture season evidence: verified regular-season metadata.', observedAt, stance: 'CONTEXT' },
      { id: `${candidateId}-risk`, category: 'risk', source: 'fixture://nba/rotation-risk', detail: risk, observedAt, stance: 'COUNTER' },
    ],
    missing: ['Fixture lineup confirmation unavailable'],
  };
}

function populatedPresentation() {
  const inputs = tiers.map(tier => fixtureInput(tier, `tier-${tier.toLowerCase()}`));
  const gameMarkets = [
    { type: 'TOTAL', selection: 'OVER', team: null, line: 224.5 },
    { type: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null },
    { type: 'SPREAD', selection: 'HOME', team: 'HOME', line: -3.5 },
    { type: 'SPREAD', selection: 'AWAY', team: 'AWAY', line: 3.5 },
    { type: 'TEAM_TOTAL', selection: 'UNDER', team: 'AWAY', line: 108.5 },
  ] as const;
  for (const [index, market] of gameMarkets.entries()) {
    inputs[index + 1].subject = {
      kind: 'GAME_LINE', gameId: `fixture-game-${index}`,
      home: { id: null, name: 'Fixture Home' }, away: { id: null, name: 'Fixture Away' },
      market: { key: market.type, label: market.type, ...market },
    };
    inputs[index + 1].americanOdds = [-105, 125, -115, 105, -120][index];
  }
  const unpriced = fixtureInput(null, 'unpriced-research');
  unpriced.seasonPhase = 'PRESEASON';
  unpriced.sportsbook = null;
  unpriced.americanOdds = null;
  unpriced.quoteStatus = null;
  const stale = fixtureInput('EDGE', 'stale-research');
  stale.quoteStatus = 'STALE';
  const presentation = buildPickPresentation({ picks: [...inputs, unpriced, stale], requestedSort: 'BEST', includePasses: true });
  const unsupported = presentation.picks.filter(pick => ['unpriced-research', 'stale-research'].includes(pick.candidateId));
  for (const pick of unsupported) {
    pick.pricing.sportsbook = 'Erroneous Upstream Book';
    pick.pricing.americanOdds = 777;
    pick.metrics = { trueProbability: 99.9, modelProbability: 99.8, evPercent: 88.8, researchScore: 999, tierScore: 999 };
  }
  const recommendedCandidateIds = inputs.filter(input => input.tierDecision?.pickTier !== 'PASS').map(input => input.candidateId);
  return {
    ...presentation, recommendedCandidateIds,
    recommendations: presentation.picks.filter(pick => recommendedCandidateIds.includes(pick.candidateId)),
    researchedCandidates: presentation.picks.filter(pick => !recommendedCandidateIds.includes(pick.candidateId)),
  };
}

type Scenario = 'populated' | 'empty' | 'legacy-nba' | 'cross-sport';

function responseFixture(scenario: Scenario) {
  const empty = { ...buildPickPresentation({ picks: [], requestedSort: 'BEST', includePasses: true }),
    recommendedCandidateIds: [], recommendations: [], researchedCandidates: [] };
  return {
    reply: fixturePurpose, results: [], modeledGames: [], closestMisses: [], toolTrace: [], researchSessionId: null,
    ...(scenario === 'legacy-nba' ? {} : { nbaPresentation: scenario === 'empty' ? empty : populatedPresentation() }),
    meta: { sport: scenario === 'cross-sport' ? 'nfl' : 'nba', date: slateDate, researchComplete: true,
      gamesFound: 4, gamesScheduled: 4, candidatesFound: scenario === 'populated' ? 8 : 0,
      recommendedFound: scenario === 'populated' ? 5 : 0, includePasses: false },
  };
}

async function visible(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.waitFor({ state: 'visible' });
  expect(await locator.isVisible()).toBe(true);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth + 1,
    body: document.body.scrollWidth > innerWidth + 1,
    elements: Array.from(document.querySelectorAll<HTMLElement>('main, article, h1, h2, h3, [role="heading"]'))
      .filter(element => element.getClientRects().length > 0)
      .filter(element => element.scrollWidth > element.clientWidth + 1)
      .map(element => `${element.tagName}: ${element.textContent?.slice(0, 100)}`),
  }))).toEqual({ page: false, body: false, elements: [] });
}

describe.skipIf(process.env.NBA_PRESENTATION_BROWSER !== '1')('NBA presentation contract browser fixtures (not model claims)', () => {
  it('renders tiers, guarded metrics, evidence and reset states on desktop and mobile', async () => {
    const target = new URL(process.env.NBA_PRESENTATION_BROWSER_URL ?? 'http://localhost:3022');
    const health = await fetch(new URL('/ai', target), { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!health?.ok) throw new Error(`Start the existing app server at ${target.origin} before running NBA_PRESENTATION_BROWSER=1.`);
    const { chromium } = createRequire(import.meta.url)(process.env.NBA_BROWSER_MODULE ?? 'playwright') as { chromium: BrowserType };
    const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    mkdirSync('.cache/nba-release-ui', { recursive: true });
    try {
      for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(15_000);
          const errors: string[] = [];
          const requests: Array<{ messages: Array<{ content: string }>; context: { sport: string; date: string } }> = [];
          page.on('pageerror', error => errors.push(error.message));
          let scenario: Scenario = 'populated';
          let responseGate: Promise<void> | null = null;
          await context.route('**/*', async (route: Route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.pathname.startsWith('/api/')) {
              if (url.pathname === '/api/ai/chat' && request.method() === 'POST') {
                requests.push(request.postDataJSON());
                const payload = responseFixture(scenario);
                await responseGate;
                return route.fulfill({ json: payload });
              }
              return route.fulfill({ json: { data: [], games: [], results: [], alerts: [], news: [], scope: null } });
            }
            if (url.origin !== target.origin) return route.abort();
            return route.continue();
          });
          const pageUrl = new URL('/ai', target);
          pageUrl.searchParams.set('sport', 'nba');
          pageUrl.searchParams.set('date', slateDate);
          await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded' });
          const query = page.locator('textarea').first();
          const presentation = page.locator('[data-nba-presentation="deepside-nba-pick-presentation/1"]');
          async function search() {
            await query.fill(queryText);
            await query.press('Enter');
          }
          async function populated() {
            await search();
            await presentation.waitFor({ state: 'visible' });
            await expect.poll(() => presentation.locator('article').count()).toBe(8);
          }
          await populated();
          expect(requests[0].messages.at(-1)?.content).toBe(queryText);
          expect(requests[0].context).toMatchObject({ sport: 'nba', date: slateDate });
          expect(await presentation.count()).toBe(1);
          expect(await page.locator('article').count()).toBe(8);
          expect(await page.getByRole('heading', { name: 'Recommendations', exact: true }).count()).toBe(1);
          await visible(page.getByText('5 recommended plays', { exact: true }));
          await visible(page.getByText('4 / 4', { exact: true }));
          expect(await page.getByText('games researched', { exact: false }).count()).toBe(1);
          const recommendations = presentation.locator('section').filter({ has: page.getByRole('heading', { name: 'Recommendations', exact: true }) });
          const research = presentation.locator('section').filter({ has: page.getByRole('heading', { name: 'Research candidates', exact: false }) });
          expect(await recommendations.locator('article').count()).toBe(5);
          expect(await research.locator('article').count()).toBe(3);
          expect(await recommendations.locator('[data-tier="PASS"]').count()).toBe(0);
          expect(await recommendations.locator('article').evaluateAll(elements => elements.map(element => element.getAttribute('data-tier')))).toEqual(tiers.slice(0, 5));
          const expectedMarkets = ['Points over 24.5', 'Game total over 224.5', 'Fixture Home moneyline', 'Fixture Home -3.5', 'Fixture Away +3.5', 'Fixture Away team total under 108.5'];
          const expectedOdds = ['-110', '-105', '+125', '-115', '+105', '-120'];
          for (const [index, tier] of tiers.entries()) {
            const card = presentation.locator(`[data-candidate-id="tier-${tier.toLowerCase()}"][data-tier="${tier}"]`);
            expect(await card.count()).toBe(1);
            await visible(card.getByText(tier, { exact: true }));
            await visible(card.getByText(expectedMarkets[index], { exact: true }));
            await visible(card.getByText(`Fixture Book · ${expectedOdds[index]}`, { exact: true }));
            expect(await card.locator('dd').allTextContents()).toEqual(['57.4%', '9.2%', '91/100']);
            expect(await card.getByText('REGULAR · VERIFIED · UNVALIDATED', { exact: true }).count()).toBe(1);
            expect(await card.getByText(fixturePurpose, { exact: true }).count()).toBe(1);
          }
          await visible(research.locator('[data-tier="PASS"]').getByText('PASS · NOT A WAGER', { exact: true }));
          for (const candidateId of ['unpriced-research', 'stale-research']) {
            const card = research.locator(`[data-candidate-id="${candidateId}"]`);
            await visible(card.getByText(candidateId === 'stale-research' ? 'STALE PRICE · RESEARCH ONLY' : 'UNPRICED · RESEARCH ONLY', { exact: true }));
            expect(await card.getByText('Verified sportsbook price unavailable', { exact: true }).count()).toBe(1);
            expect(await card.locator('dd').allTextContents()).toEqual(['Unavailable', 'Unavailable', 'Unavailable']);
            expect(await card.innerText()).not.toMatch(/Erroneous Upstream Book|777|99\.9|99\.8|88\.8|999/);
          }
          expect(await research.locator('[data-candidate-id="unpriced-research"]').getAttribute('data-tier')).toBe('RESEARCH_ONLY');
          const evidenceCard = recommendations.locator('[data-candidate-id="tier-nuke"]');
          await evidenceCard.locator('summary').click();
          await visible(evidenceCard.getByText(risk, { exact: true }));
          await visible(evidenceCard.getByText(source, { exact: true }));
          await visible(evidenceCard.getByText('Fixture season evidence: verified regular-season metadata.', { exact: true }));
          expect(await evidenceCard.getByText(`Observed: ${observedAt}`, { exact: true }).count()).toBe(2);
          expect(await evidenceCard.getByText('Fixture lineup confirmation unavailable', { exact: true }).count()).toBe(1);
          const passCard = research.locator('[data-tier="PASS"]');
          await passCard.locator('summary').click();
          await visible(passCard.getByText('Fixture publication gate failed', { exact: true }));
          await noOverflow(page);
          await query.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `.cache/nba-release-ui/presentation-${name}-full.png`, fullPage: true });
          await research.getByRole('heading', { name: 'Research candidates', exact: false }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: `.cache/nba-release-ui/presentation-${name}-research.png`, fullPage: true });
          if (name === 'desktop') {
            await page.getByRole('button', { name: 'Clear', exact: true }).click();
            await expect.poll(() => presentation.count()).toBe(0);
            expect(await page.locator('article[data-candidate-id]').count()).toBe(0);
            await populated();
          }
          await page.getByRole('button', { name: 'New Search', exact: true }).click();
          await expect.poll(() => presentation.count()).toBe(0);
          expect(await query.inputValue()).toBe('');
          expect(await page.locator('article[data-candidate-id]').count()).toBe(0);
          await populated();
          scenario = 'empty';
          let releaseResponse: () => void = () => {};
          responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
          try {
            await search();
            await page.getByText('DeepSide AI is researching', { exact: true }).waitFor();
            expect(await presentation.count()).toBe(0);
          } finally {
            releaseResponse();
            responseGate = null;
          }
          await visible(presentation.getByRole('status'));
          expect(await presentation.getByRole('status').innerText()).toBe('No qualified NBA picks or researched candidates are available for this slate.');
          expect(await page.locator('article').count()).toBe(0);
          expect(await page.getByText('5 recommended plays', { exact: true }).count()).toBe(0);
          await noOverflow(page);
          await page.screenshot({ path: `.cache/nba-release-ui/empty-${name}.png`, fullPage: true });
          for (const fallback of ['legacy-nba', 'cross-sport'] as const) {
            scenario = 'populated';
            await populated();
            scenario = fallback;
            const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ai/chat'
              && response.request().method() === 'POST');
            await search();
            await response;
            await expect.poll(() => page.getByRole('button', { name: 'Search', exact: true }).isEnabled()).toBe(true);
            await visible(page.getByText('No recommendable plays', { exact: true }));
            await expect.poll(() => presentation.count()).toBe(0);
            expect(await page.locator('article[data-candidate-id]').count()).toBe(0);
          }
          await noOverflow(page);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }, 180_000);
});