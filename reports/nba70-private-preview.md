# NBA70 Private Preview

One approved Preview created from the current local worktree, without a commit, push, merge or production deployment.

- URL: https://sports-engineers-kgz3897sr-deepside.vercel.app/ai?sport=nba
- Deployment: `dpl_6h4ok8hmATvWYy9zqyCHxYRCYMhs`
- Vercel project: deepside/sports-engineers. Target: Preview. Status: Ready.
- Remote Next.js compilation and TypeScript completed; remote build duration approximately 39 seconds.
- Project SSO protection is `deploymentType=all`; CLI confirms Vercel Authentication on. Anonymous request returned HTTP302 to authentication. No bypass secret or public share link was created.
- Deployment-only runtime and build overrides: `ODDS_AUTO_REFRESH=false`, `ODDS_ALLOW_PAID_REFRESH=false`. No project/production environment variables were edited. Runtime cache status independently confirms automatic refresh disabled. Vercel's deployment API exposes environment names only, not values; the paid flag override is recorded by the actual deployment command, not independently echoed from the API.
- The existing cache-only guard and authorization checks remain. No manual paid authorization was provided; no paid Odds API calls were made. No live research or picks activated.
- Authenticated Preview HTML and twelve served JavaScript bundles were read. The latest market-label formatter, Research Filter and bounded pagination are present.
- Production alias still points to `dpl_4jfpFER5CqLsuKmm2uskK97fFC4e`; it was not promoted or changed.

## Storage Result

`GET /api/odds/cache/status?refreshPreflight=1` on the Preview reports `REDIS_NOT_CONFIGURED` with HTTP503 and automatic refresh disabled. Production Upstash variables exist only in the Production environment, not Preview. No credentials were copied, pulled or modified.

An explicit `cacheOnly=true` chat POST returned HTTP503 `RESEARCH_STORAGE_UNAVAILABLE`, confirming fail-closed behavior before research acquisition. This Preview cannot currently load/save durable cached research or verify daily-ledger operations. It must not be described as a successful live-research deployment.

Next storage step requires separate approval: provision/configure an isolated Preview Redis store or approve a carefully scoped existing store connection. Retain both paid flags false. Adding Preview secrets and redeploying is outside this one-deployment approval; no second deployment was created.

## Upload Hygiene

Added `.vercelignore` after dry-run inspection revealed Vercel would otherwise upload ignored local build/data directories. Final upload: 643 source files, approximately 7.7MB, excluding `.env*`, `.cache`, `data`, `.next*`, node_modules and TypeScript build state. The historical sportsbook receipts remain local and are not published as current quotes.

## Phone Checks

1. Open the Preview URL and sign in with an authorized Vercel account. Request access if not a member; do not disable Vercel Authentication.
2. Open Research Filter, choose NBA, and check all 41 market options, category selection, Clear All/Select All, Over/Under and Best/Most Likely/Best Value.
3. Navigate away and back; check filter persistence and mobile overflow/navigation.
4. A research submission currently should show the saved-storage unavailable state, not invented cards or qualified picks. Do not expect cached receipt cards until Preview storage is separately configured.
5. Card-label/pagination checks were passed locally with the saved receipt and mocked API responses. The deployed bundles contain those changes, but interactive card testing on this Preview is blocked by missing storage. The integrated browser connection timed out during this deployment check; private-page access was verified through authenticated CLI and anonymous redirect checks instead.

Next approval needed: isolated Preview storage setup and one replacement Preview deployment, still with paid acquisition disabled and no production alias change. Production release/configuration and a paid live canary remain separate approvals.