import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SystemHealthPanel, { SystemHealthView, type SystemHealthSnapshot } from './SystemHealthPanel';
import SystemHealthPage, { metadata } from '../app/system-health/page';

afterEach(() => vi.unstubAllGlobals());

describe('system health dashboard', () => {
  it('renders a private empty login state without requests, polling, or embedded data', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const html = renderToStaticMarkup(<SystemHealthPanel />);
    expect(fetch).not.toHaveBeenCalled();
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('Authenticate');
    expect(html).toContain('Refresh');
    expect(html).toContain('Not observed');
    expect(html).not.toContain('Healthy');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('<script');
  });

  it('uses wrapping, shrinking mobile layout and semantic labeled facts', () => {
    const html = renderToStaticMarkup(<SystemHealthPage />);
    expect(html).toContain('<main');
    expect(html).toContain('<h1>System Health</h1>');
    expect(html).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1fr)');
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain('flex-wrap:wrap');
    expect(html).toContain('<dt>Durable storage</dt>');
    for (const sport of ['NFL', 'MLB', 'NBA']) expect(html).toContain(`aria-labelledby="system-health-${sport}"`);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('displays recorded counters, complete rate, credit freshness and unknown authorization separately', () => {
    const snapshot: SystemHealthSnapshot = {
      checkedAt: 1_800_000_000_000, state: 'UNKNOWN', durable: { state: 'HEALTHY', configured: true },
      providers: { odds: { state: 'CONFIGURED', configured: true, authorization: 'UNKNOWN' }, openai: { state: 'NOT_CONFIGURED', configured: false, authorization: 'UNKNOWN' } },
      credits: { state: 'UNKNOWN', freshness: 'STALE', balance: 3100, observedAt: 1_799_999_600_000, ageMs: 400_000 },
      refresh: { state: 'CONFIGURED', enabled: false, limits: { perSearchCredits: 50, dailyCredits: 300, minProviderRemaining: 2000, requestsPerMinute: 10 } },
      monitoring: { state: 'UNKNOWN', sports: [{ sport: 'NFL', state: 'DEGRADED', observedAt: 1_799_999_900_000, ageMs: 100_000, total: 10, complete: 8, partial: 1, failed: 1, completeRate: .8, lastOutcome: 'PARTIAL', durability: 'durable' }] },
      healthReadErrors: [],
    };
    const html = renderToStaticMarkup(<SystemHealthView snapshot={snapshot} />);
    expect(html).toContain('Stale');
    expect(html).toContain('400s');
    expect(html).toContain('80.0%');
    expect(html).toContain('Partial');
    expect(html).toContain('<dt>Total</dt><dd>10</dd>');
    expect(html).toContain('<dt>Odds authorization</dt><dd><span data-state="UNKNOWN">Unknown</span>');
    expect(html).not.toContain('Live');
  });
});

interface OfflinePage {
  setViewportSize(viewport: { width: number; height: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  route(pattern: string, handler: (route: { abort(): Promise<void> }) => Promise<void>): Promise<void>;
  evaluate<Result>(callback: () => Result): Promise<Result>;
}

interface OfflineBrowser {
  newPage(): Promise<OfflinePage>;
  close(): Promise<void>;
}

describe.skipIf(!process.env.SYSTEM_HEALTH_BROWSER_MODULE)('offline system health SSR layout', () => {
  it('has no horizontal overflow on narrow mobile or desktop without any network requests', async () => {
    const { chromium } = createRequire(import.meta.url)(process.env.SYSTEM_HEALTH_BROWSER_MODULE!) as {
      chromium: { launch(options: { headless: boolean; executablePath: string; args: string[] }): Promise<OfflineBrowser> };
    };
    const browser = await chromium.launch({
      headless: true,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--disable-background-networking', '--disable-component-update'],
    });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.abort());
      const markup = renderToStaticMarkup(<SystemHealthPanel />);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif}</style></head><body>${markup}</body></html>`);
        const metrics = await page.evaluate(() => ({
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          overflowing: [...document.querySelectorAll('main, input, button, dt, dd')].filter(element => element.scrollWidth > element.clientWidth + 1).length,
          passwordCount: document.querySelectorAll('label[for="system-health-password"] + input, input[type="password"]').length,
          mainCount: document.querySelectorAll('main').length,
        }));
        expect(metrics).toEqual({ pageOverflow: false, overflowing: 0, passwordCount: 1, mainCount: 1 });
      }
    } finally { await browser.close(); }
  });
});