# Final Release Readiness - 2026-10-14

## Decision

The local integrated source has demonstrated genuine current-odds pick generation. The previously failing frozen-source check is repaired without replacing immutable archives or broadening the permitted model delta list. Source validation and production compilation pass. Production release remains subject to explicit commit/push/deployment approval and authorized fresh-market operation; none was performed here.

Working foundation: `/Users/lisandrorodrigues/deepside-agent-3`, branch `main-release`, base `1d63af7`, with preserved uncommitted integration work. Other agents' worktrees were not edited.

## Frozen Verification Repair

The failure was an exact frozen-source mismatch in `lib/finder/engine.ts`. Its reviewed delta is cache transport, not a new prediction formula: exact fresh supported-primary receipt selection, existing player-ID resolution, consistent preflight eligibility, and the selected best-book quote timestamp.

The verifier now permits only that exact integrated content AND its exact immutable archived parent, using SHA-256 identities. It does not add Finder to a general allowlist. One-byte current-content changes, changed archived-parent content and applying the exception to an NFL file are rejected by regression tests. Existing archive and parent-manifest integrity checks remain active.

The strengthened refresh client, Redis ledger and KV boundary are also pinned to exact reviewed source hashes. Mutation/omission tests reject changes to all three. No `NFL_MODEL_V1` or `NFL_MODEL_V1_1_HARDENED` archive/manifest was regenerated. NFL source, probability model and authoritative six-tier formulas are unchanged. This is an explicit reviewed infrastructure identity update, not a silent rebaseline or skipped assertion.

## Safe Refresh Strategy

Paid automatic refresh remains disabled unless `ODDS_AUTO_REFRESH=true` is explicitly configured after separate authorization. No live environment or production setting was changed. The example environment defaults both refresh flags to false.

Existing behavior retained:

- Fresh memory/Redis cache reuse before a provider request; no stale payload is relabeled fresh.
- Exact market/request identities, event binding, source timestamps and current-price publication checks.
- Shared in-flight deduplication and cross-instance event locks, including overlapping market sets.
- Per-request cost estimation and authorization before network calls; unknown/unbounded paid endpoints fail closed.
- Durable atomic daily/account reservations, conservative unknown-charge accounting, no automatic provider retries, and no silent refunds after uncertain failures.
- Fail closed for unavailable Redis, unknown/stale provider balance, reserve/daily-limit failures and completed authorization scopes.

New tightening-only configuration:

| Variable | Code Default | Example Config | Allowed Range |
| --- | ---: | ---: | --- |
| `ODDS_REFRESH_MAX_SEARCH_CREDITS` | 50 | 10 | 1-50 |
| `ODDS_REFRESH_MAX_DAILY_CREDITS` | 300 | 30 | 1-300 |
| `ODDS_REFRESH_MIN_REMAINING` | 2000 | 2000 | At least 2000 |
| `ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE` | 10 | 5 | 1-50 |

Invalid configuration blocks paid work. Search and daily ceilings cannot exceed the existing hard maxima, and reserve cannot be lowered below the hard 2,000-credit floor. Explicit manual authorization also respects a configured lower cumulative search ceiling. A broad multi-sport user request shares ONE top-level search budget; nested sport/tool calls cannot multiply it.

Rate enforcement happens atomically in Redis using its server clock and fixed UTC minute windows. Blocked reservations do not debit credits. Rate counts apply to paid reservations, not free event discovery or fresh cache hits. Existing lock ownership and uncertain-request retention protections remain intact.

Actual Lua behavior was tested using the existing `/private/tmp/redis-7.4.2/src` binaries on a temporary Unix socket with no listening TCP port and no production Redis state. No package installation was required.

## All 15 Recommendation Mappings Verified

The previously successful real `Best value picks today` response remains the source for this audit, not a fabricated fixture or a new current-price claim. Its 15 rendered cards were checked in order for player, side/line, sportsbook, signed odds, exact source timestamp, estimated probability, estimated EV and six-tier label. Every field matched all 15 browser-held source records.

Those 15 records were then independently matched by candidate ID to the compressed evaluated MLB research sessions in Redis. A canonical fingerprint across identity, market, line, side, sportsbook, price, timestamp, probability, EV, edge, tier, sample size and projection matched exactly:

`f70670014f3a67924ffc38c19204bee28eb6f0921105bec9a6a396c4433f22f9`

Matching evaluated session receipts included `79e5753b-7f4a-4bfc-839b-0b436b0faa3e` (14:45:28.536Z) and `b1c3a337-a8bd-41ad-a6d0-0baa4a46acf4` (14:39:08.648Z), each containing 233 evaluated candidates. All 15 mappings passed; no duplicate/missing card was accepted.

The original quote payload expired from the fresh cache at 14:47:00.372Z. This final audit confirms source-to-card integrity of that real evaluation, NOT that those odds remain currently executable. Revalidating a fresh search requires fresh authorized market data. Paid automatic refresh was not enabled to renew them.

## Actual Live Outcome Retained

The preceding authorized run retrieved real Brewers-Dodgers quotes and completed the live pipeline. Cost was 11 of 20 credits: one discovery plus one ten-market US quote request, no retries. It produced 387 normalized rows, 709 priced book/side opportunities and 233 deduplicated researched candidates for one game and ten markets. Forty-seven qualified (6 ELITE, 28 EDGE, 13 LEAN); 186 were PASS; the top 15 appeared in the real interface.

The live all-PASS defect was fixed by preserving the already-calculated model price edge through the session instead of overwriting it with a null legacy field. Probability and tier formulas were not changed. Source quote time, EV and requested display ranking were also verified. NBA preseason remains research-only where the existing phase/availability gates do not qualify it; no preseason recommendation was manufactured.

This release-blocker phase made no paid Odds API requests. Read-only durable credit accounting still showed 16,966 remaining and daily actual/spent 11. No credentials were exposed or rotated.

## Validation

The final run uses:

```sh
DEEPSIDE_REDIS_TEST_DIR=/private/tmp/redis-7.4.2/src \
ODDS_AUTO_REFRESH=false ODDS_ALLOW_PAID_REFRESH=false npm test
npx tsc --noEmit
ODDS_AUTO_REFRESH=false ODDS_ALLOW_PAID_REFRESH=false npm run build:verify
git diff --check
```

Final executable result: **1,384 tests passed, 27 skipped, zero failed** across 155 passing and 12 skipped files (167 total). TypeScript, `git diff --check`, and the production verification build passed; 34 static pages were generated. The full suite includes strict archived-source verification, mutation rejection, real isolated Redis Lua, cache reuse, cumulative per-search/daily budgets, per-minute rate enforcement, no debit for blocked requests, uncertainty handling, sport scope, actual tool/session integration and source-tier preservation. Remaining skipped historical replay checks are not represented as passing evidence.

Touched-source lint has zero errors; seven existing unused-symbol warnings remain in the redesigned UI/tools. This is not reported as a warning-free repository.

## Release Checklist and Residual Risks

1. Review the uncommitted exact-hash infrastructure approvals and integration diff. No commit, merge, push or deployment has been made.
2. Obtain explicit production release approval before deploying. Existing Vercel credential presence was confirmed previously; values were not pulled or changed.
3. Keep automatic refresh off until a separate cost authorization sets an intended operating policy. Configure conservative budgets and rate limits with the existing durable Redis backend before enabling it.
4. Run a fresh authorized live price check at deployment time. Archived displayed cards and successful build/test results cannot replace current prices.
5. Preserve unvalidated-model disclosures, source timestamps, PASS/research-only separation, NBA phase restrictions and all publication gates. Prior live success proves pipeline function, not predictive calibration or guaranteed outcomes.
6. Cross-sport responses currently aggregate sport-specific results without creating a persistent combined research session. Individual sport sessions retain their existing behavior. Production multi-sport follow-up persistence remains a product limitation, not a claim of full conversation-state coverage.

No known failing executable release check remains after the final validated source. Fresh quote availability, optional historical replay data and deployment/cost authorization are operational prerequisites, not reasons to weaken model or source protections.