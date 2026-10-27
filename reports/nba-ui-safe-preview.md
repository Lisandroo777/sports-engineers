# NBA Card UI And Safe Preview

## Local Changes

- Every team contract uses its supplied market label. Q1 Moneyline/Spread/Total and Alternate Spread/Total/Team Total cannot silently appear as a standard full-game contract. Player labels retain Q1 and combined-stat names; Double-/Triple-Double retain explicit Yes/No interpretation.
- Selected team/player, exact line, over/under or moneyline selection, sportsbook and actual American price remain visible. Source market identity is retained in the DOM for verification. Prices, evidence and upstream order are not changed.
- Recommendations and research candidates have independent 20-outcome pagination, previous/next buttons, bounded numeric page access and visible range/total counts. Only the current page's cards and evidence DOM are mounted. This bounds rendering, not the API response size; the full received pool remains in client memory.
- Research-only evidence remains separate from recommendations; missing probability, EV, season certainty and tier are never fabricated. All 41 filter choices and 26 verified connections remain unchanged.

## Safe Local Preview

Run `node scripts/nba-v3/previewSafe.mjs` from the release worktree, or use its absolute path. Default URL: http://127.0.0.1:3118/ai?sport=nba . The launcher sets an explicit project path and child-process cwd, binds only to loopback, uses the ignored `.next-verify` output, disables both automatic and paid refresh and masks Odds/OpenAI/Upstash/KV credentials in the child environment. It does not modify any secret, environment file or production setting. `--check` prints only non-secret safety assertions and does not start a server.

This is a local, loopback-restricted preview, NOT a Vercel deployment or a new authentication system. It is not reachable from a phone through localhost. A hosted protected preview is still a deployment and requires separate approval. Vercel Authentication must remain enabled for any later hosted preview.

The default local page cannot acquire fresh odds because provider credentials and paid flags are disabled. Development-only existing local caches may be read subject to normal freshness rules. The saved historical receipt is NOT imported into runtime caches or relabeled current. Repeatable saved-receipt rendering is provided by the opt-in browser test, which intercepts all API requests and blocks external browser requests. Unmocked empty caches honestly show unavailable research.

## Offline Browser Verification

The saved US/US2 receipt is normalized at its original observation time, yielding 5,989 currently eligible outcomes across 26 markets. The responsive browser test sends that fixture through the existing `/ai` response path, not a new page. It verifies 20 mounted cards, all 26 source identities across the first two deliberately representative pages, real books/prices/lines, arrow and numeric page navigation, 9 cards on page 300, disabled final Next control, zero page/card horizontal overflow and zero client runtime errors at 1440x1000 and 390x844.

All browser research requests are fulfilled locally; no Odds API or OpenAI request is sent. Credentials are masked in the preview process, adding a server-side fail-closed layer. Screenshots are retained locally in `.cache/nba-release-ui/receipt-pagination-desktop.png` and `receipt-pagination-mobile.png` and are not committed. Existing tier/evidence/reset/empty/error-state browser fixtures also pass on both viewports.

Browser command (requires installed Playwright path):

`NBA_RECEIPT_UI_BROWSER=1 NBA_BROWSER_MODULE=<local-playwright-path> NBA_SAFE_PREVIEW_URL=http://127.0.0.1:3118 ODDS_AUTO_REFRESH=false ODDS_ALLOW_PAID_REFRESH=false npx vitest run components/nbaReceiptPagination.browser.test.mjs`

The browser test is disabled by default and fails rather than making live calls if the saved receipt or local preview is missing. The preview launcher's dry-run regression verifies inherited true paid flags are overridden without exposing values.

## Remaining Activation Blockers

1. Production storage/ledger connectivity still needs an authenticated `/system-health` session; metadata/credential presence alone is not proof. Enter the existing site health password directly in the UI, never in chat.
2. The current production environment was previously observed with automatic refresh on. Deploying NBA70 code there can activate its higher default even without adding the NBA variable. Any production deployment therefore needs explicit spending/configuration approval, not only build approval.
3. Full response serialization and client memory still scale with the entire research pool. Pagination resolves thousands of mounted cards; server-side cursor delivery is a separate future optimization if real response/network measurements require it.
4. Fresh live quotes, exact player matching and complete historical/Q1 source data still govern actual availability. The preview is fixture evidence, not a claim that live research or qualified picks are ready on a phone.
5. Hosted private-preview deployment, production release, production configuration and a <=70-credit single-game live canary are all still unapproved and unexecuted.

Next approval: create a private Vercel preview with Vercel Authentication retained, both paid flags explicitly false and no production alias change. First verify cache-only/mock behavior and storage health there. Then request separate approval for production release/configuration and the live one-game canary; do not combine them with recurring refresh enablement.