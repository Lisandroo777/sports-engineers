# Isolated NBA70 Preview Storage Plan

Status: preparation only. No database was created; no credential was read, copied, generated or installed; no Vercel variable was modified; no replacement deployment or paid API call was made. Production database, settings, deployment and domain were not changed.

## Recommended Separate Database

- Create a NEW account-owned Upstash Redis database named `deepside-nba70-preview`, separate from the production database. Prefer a US East primary close to the existing Vercel `iad1` functions. Do not add read replicas, paid add-ons or automatic upgrades for this test without cost approval.
- Use new database-specific REST URL/token. Do NOT copy production credentials, clone production data, export production ledger state, or attach the production Marketplace resource to Preview.
- Isolation must be by database/endpoint and credentials. This application uses common `ai-session:`, `odds-cache:` and `deepside:odds:auto:v2:` keys; an invented Preview prefix does not isolate existing code. No `REDIS_NAMESPACE` setting exists in the current implementation.
- Use the read/write REST token in server-only Secret variables. A read-only token cannot save sessions/receipts, acquire locks or run the mutating Lua ledger. Never use `NEXT_PUBLIC_` names, put credentials in source, paste them in chat, pass secrets in visible command arguments or pull production env files.
- Prefer manual Preview-scoped connection through the Vercel dashboard over an integration wizard that might also target Production. If a Marketplace wizard is used later, inspect its selected environments before confirming anything. Both credentials must target the SAME new database; choose Preview only, and narrow to the intended preview branch/environment where possible. No Production or Development scope is required.
- Request/record the new database name, non-secret resource ID and region. Verify the new endpoint differs from production in the provider console without exporting production credentials. Require TLS, expiry support and atomic `EVAL`, `TIME`, hash, `SET NX PX` and owner-checked unlock operations. Avoid eviction settings that could silently discard accounting/locks; fail closed on capacity errors.
- Do not create an anonymous short-lived agent database for this persistent private Preview. Upstash advertises one, but it expires after three days unless claimed and generates credentials; using it is not necessary or authorized here.

## Costs Before Resource Creation

Official pricing checked through public documentation only; the account's available plan/eligibility has NOT been verified because no provider account resource/billing changes were attempted. Dashboard checkout is authoritative before creation.

| Option | Published cost/limits | Recommendation |
| --- | --- | --- |
| Free | $0/month; 250 MB data; 500,000 commands/month; 10 GB bandwidth; free account allows one database | Preferred ONLY if an additional genuinely separate free database is available without upgrading or moving production |
| Pay as You Go | $0.20 per 100,000 commands; storage $0.25/GB after first 1 GB; bandwidth free to 200 GB/month, then $0.03/GB; extra database charges may apply beyond account allowance | STOP and request approval before creation/upgrade. If approved, request a low monthly hard budget such as $1, with no auto-upgrade. Illustrative 1,000 commands is $0.002 command charge, not a total bill guarantee |
| Fixed 250 MB | $10/month, additional read-region charges | Not needed for initial isolated Preview testing; do not create without explicit approval |

Upstash bills Redis commands independently from Odds API credits. A non-paid sportsbook test may still consume Redis plan quota. Do not call it free unless the chosen database's actual plan is confirmed. Do not add a credit card or upgrade the production account/database to obtain a second test DB without approval. Free availability is not assumed merely because a free plan is advertised.

Sources: https://upstash.com/pricing/redis , https://upstash.com/docs/redis/overall/getstarted , https://upstash.com/docs/redis/features/restapi , https://upstash.com/docs/redis/commands/scripting/eval . Prices/limits can change; check the final plan screen before confirming.

## Exact Preview Environment Matrix

Prepare these entries in Vercel project `deepside/sports-engineers`, **Preview scope only**, after explicit permission to install credentials. This document contains placeholders, not actual secrets.

| Name | Prepared value / source | Type |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | HTTPS root REST URL from NEW `deepside-nba70-preview` database | Secret (server only) |
| `UPSTASH_REDIS_REST_TOKEN` | NEW database read/write REST token, raw, no `Bearer ` prefix or quotes | Secret (server only) |
| `ODDS_AUTO_REFRESH` | `false` | Config |
| `ODDS_ALLOW_PAID_REFRESH` | `false` | Config; replace/override inherited Preview value only if separately approved |
| `ODDS_REFRESH_MAX_NBA_SEARCH_CREDITS` | `70` | Config; allowance only, NOT acquisition authorization |
| `ODDS_REFRESH_MAX_SEARCH_CREDITS` | `50` | Config |
| `ODDS_REFRESH_MAX_DAILY_CREDITS` | `300` | Config |
| `ODDS_REFRESH_MIN_REMAINING` | `2000` | Config |
| `ODDS_MIN_CREDIT_RESERVE` | `2000` | Config; coordinate a Preview-only override without touching Production if required |
| `ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE` | `10` | Config |

Do NOT add `KV_REST_API_URL` / `KV_REST_API_TOKEN` alongside this pair: this application's KV family takes precedence if either exists, including a malformed partial pair. Preview currently has neither family configured. Use exactly one complete family. TCP `REDIS_URL` is not consumed by the current REST adapter. Do not set `NODE_ENV`; Vercel uses the production runtime for Preview too, and absent durable configuration correctly disables disk fallback.

Existing Odds/OpenAI credentials need not be copied or modified. Both paid flags must remain false at Preview runtime AND build on the future replacement deployment, as on the existing one. Vercel Authentication remains `deploymentType=all`; do not generate a public share/bypass link or relax protection.

Optional protected health UI uses `NFL_LEDGER_VIEW_SECRET` and `NFL_LEDGER_SESSION_SECRET`, which are currently Production-only. Do not copy those either. Leave that health UI locked or separately approve new Preview-only health credentials entered directly in Vercel. They are NOT required for cache/session storage or the Vercel-protected `/api/odds/cache/status` check. `NFL_LEDGER_RECEIPT_SECRET` is NFL-specific and not needed to test NBA research-only cards.

## Verification Prepared Without Paid Sportsbook Data

### Completed locally

81 tests passed across `lib/storage/kv.test.ts`, `kvPersistence.test.ts`, `kvRecovery.test.ts` and `lib/odds/autoRefresh.test.ts`. TypeScript passed. Newly added synthetic checks route every mocked REST request to `https://isolated-preview.example`, test JSON round-trip, TTL `SET PX`, NX lock contention, delete and the exact EVAL command wire format. Existing persistence/recovery tests cover session/cache durability. Existing mocked ledger checks cover NBA70 reservation/settlement, shared daily300, provider floor, missing storage, rate limits, concurrency and post-lock zero-spend reuse.

These tests do NOT execute Lua on a real Upstash server, certify a new database's connectivity, permissions or billing plan, or seed a real provider balance. No local Redis executable is installed; no package/resource was installed to bypass that limit.

### Pending after resource and credential approval, before any replacement deployment

1. Verify the NEW database identity, plan, region and distinct endpoint in the console. Confirm that no production resource is attached or cloned.
2. Use a process that receives only NEW Preview credentials directly, with both paid Odds flags false, to run scoped synthetic operations. Do not load an existing production `.env.local`. Do not print tokens or authenticated request URLs.
3. Use a unique `preview-smoke:<random-id>:` prefix and short TTL for synthetic keys only. Check JSON SET/GET round-trip, TTL, `SET NX PX` acquisition/contended lock, and owner-checked Lua release. Use the application's actual ledger Lua scripts with **all KEYS remapped to this synthetic prefix**, synthetic remaining10000/day0, reserve52 then settle52, verify daily spent52/pending0, reject remaining2051 for a 52-cost reservation, and reject spent260 plus52 against daily300. This tests Redis/Lua behavior without buying odds.
4. Never seed synthetic values into `deepside:odds:auto:v2:account`, real daily keys or the provider-credit cache. A fake provider remaining balance in those real keys could accidentally authorize later spending. No fake samples may appear as genuine research or qualified picks.
5. Clean up ONLY the keys created by that smoke test (or let their TTL expire). No `FLUSHDB`, wildcard production scans, bulk deletion, ledger reset or production writes.
6. If any read/write/EVAL/TTL check fails, stop before deploying. Request size is also relevant: the published Free/PAYG REST maximum is 10 MB; measure each serialized saved receipt/session chunk before seeding. The app chunks large sessions; no unlimited payload assumption should be made.

### Pending separately approved replacement Preview

Environment changes apply only to new deployments; the existing Preview will not gain storage retroactively. Do not redeploy now. After explicit replacement-deployment approval, force both paid flags false at build/runtime, retain Vercel Authentication, and verify `/api/odds/cache/status?refreshPreflight=1` reports configured/readable storage and refresh disabled. A readable cache endpoint is not alone proof of write/Lua capability; the isolated smoke test above must pass too.

An empty new database contains no actual sportsbook research. It should display no cached data, not fabricate results. Use an explicitly labeled synthetic fixture for UI verification or a separately approved import of a permitted saved receipt preserving its original timestamps. Historical stale odds must not be relabeled current to fill cards. Paid acquisition and qualified picks remain disabled/unactivated.

## Current Checks And Approval Boundary

- Read-only Vercel inspection reconfirmed Authentication for all deployments and absence of Preview Redis variables. No production database or settings were queried or changed through Redis.
- The existing Preview remains Ready but lacks storage. No new resource, credentials or replacement deployment was created.
- Next approval/request: choose an account-owned isolated Free database if available; otherwise approve an explicit paid plan and hard budget first. Separately authorize installation of NEW Preview-only REST secrets through the dashboard. The user should enter secrets directly, not in chat. Resource creation that generates credentials and secret installation were intentionally not attempted under the prohibition on secret changes.
- After isolated smoke-test success, request replacement Preview deployment approval. That approval does not enable Odds spending, production release or live canaries.