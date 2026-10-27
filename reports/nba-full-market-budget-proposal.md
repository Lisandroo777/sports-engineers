# NBA Full-Market Search Budget Proposal

Status: recommendation only. No runtime policy, environment variable, production setting, model safeguard, push or deployment changed. No paid calls made. Test-only environment overrides are isolated to Vitest.

## Exact Recommended Settings

| Setting | Current | Proposed after explicit approval |
| --- | --- | --- |
| Generic `ODDS_REFRESH_MAX_SEARCH_CREDITS` | 50, hard maximum 50 | Keep 50 for MLB, NFL and other existing scopes |
| New `ODDS_REFRESH_MAX_NBA_SEARCH_CREDITS` | Not implemented; setting this variable currently has no effect | NBA-only default/approved maximum 64, allow stricter values 1-64; invalid values block acquisition |
| `ODDS_REFRESH_MAX_DAILY_CREDITS` | 300, shared durable ledger | Keep 300 across all sports and users |
| `ODDS_REFRESH_MIN_REMAINING` | At least 2000 | Keep at least 2000; reserve worst-case cost before network |
| `ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE` | Default 10, account-wide | Keep 10; do not increase |
| `ODDS_AUTO_REFRESH` / `ODDS_ALLOW_PAID_REFRESH` | Existing environment policy | No change; do not enable a disabled gate as part of budget configuration |

64 supports one 26-market, two-region quote request (worst case 52) with 12 credits of headroom. It can also accommodate one discovery credit if explicitly requested in that same scope. The current normal research acquisition does not require a discovery call. Headroom is not permission for unrelated endpoints, arbitrary markets, more games or user-supplied budgets.

This is NOT a complete-slate allowance: two uncached games require up to 104 credits, five 260, six 312. Keeping daily 300 permits at most five worst-case full-game acquisitions in an otherwise unused day, with 40 credits left, before other usage/pending reservations. Cached games cost zero. Do not reset the 64-credit scope per event to bypass a per-search cap. A larger slate needs a separate reviewed allowance or explicit user-visible cache-only/incomplete outcome; never silently truncate requested markets or games.

## Why An Environment-Only Change Cannot Work

1. `getOddsRefreshLimits()` bounds the generic search setting to the immutable maximum 50; assigning 64 to that existing variable blocks paid refresh.
2. `withOneRunPaidRefresh()` independently rejects a standalone `maxCredits > 50` and clamps an allowed scope to the configured generic cap.
3. `reserveDailyCredits()` independently rejects a request reservation larger than the generic per-search limit before Redis evaluates daily/provider safeguards.
4. The outer `withAutomaticOddsRefresh()` is established before NBA acquisition. Nested scopes deliberately reuse the existing authorization. An inner request cannot raise the parent cap; the 52-credit reservation is rejected before network. This is correct fail-closed behavior, not a budget bypass.

Required implementation after approval: trusted server-resolved sport-specific policy at the OUTERMOST search authorization; a bounded NBA 64-credit policy; the same trusted effective cap threaded to daily reservation validation; exact basketball_nba endpoint/market/region allowlisting. Leave generic 50 and immutable historical models intact. Do not use a browser budget field or prompt text as authorization. Nested scopes may inherit or narrow a parent, never expand it. Cross-sport orchestration needs an explicit shared total policy; do not silently give each child a fresh 64-credit budget.

## Preserved Safeguards

- Worst-case credits are reserved before any paid operation. Shared durable daily ledger covers concurrent requests and sports; unknown remaining balance or storage failure blocks spending.
- Provider floor, account-wide requests/minute, event-level lock with owner-checked release and bounded lock TTL remain unchanged. Event-level locks deliberately serialize overlapping market/region requests.
- Exact request key, verified upcoming event identity and market/region allowlists remain enforced. Transport failures must not automatically retry uncertain-cost requests.
- A fresh full receipt satisfies later subset requests without another fetch. Prices must remain genuinely fresh and exact event/team/tipoff matched; requestedMarkets metadata alone does not establish fresh prices for every market.
- A blocked request must not be retried under a smaller fake market count, split to evade the budget, or presented as fully researched. Preserve all selected market IDs in the response, with explicit missing, stale or budget-blocked coverage.
- Research-only quarter, alternate and milestone cards remain separated from qualified predictions. No model, probability, EV, tier or publication threshold change is proposed.

## Other Confirmed Reliability Blockers

1. **Fresh data, not merely a larger cap:** the saved live receipt is now historical. Offline replay uses its observation time; runtime correctly rejects it when stale. Empty caches need a separately approved refresh and storage configuration.
2. **Multi-game scope:** the Finder acquires per event under one cumulative search scope. After one 52-credit acquisition, 64 cannot cover another. Before activation add a cache-aware preflight calculating selected markets x regions for every uncached event. If insufficient, clearly report incomplete/budget-blocked scope before spending, rather than buying one event and leaving the rest ambiguous.
3. **Conservative daily charging:** the current settle script books `max(reserved, actual)`, tracking actual separately. A low actual provider charge does not refund the daily booked amount. Preserve this behavior unless separately reviewed; capacity estimates must use reserved cost.
4. **Cache freshness and concurrency:** acquisition checks that the receipt requested all selected markets but only requires at least one valid normalized quote. A partly stale receipt can suppress a needed refresh for other selected markets. Coverage must distinguish fresh, not posted and stale per selected market. A subset-to-superset request can also repurchase overlapping quotes; replacing a receipt with a disjoint subset can lose reusable data. Merge per-market timestamped receipts and recheck after obtaining a lock; do not merge stale data into current evidence. The existing lock prevents simultaneous duplicate purchase but a waiting caller currently gets a busy error instead of automatically reusing the completed receipt.
5. **Player/period evidence:** cards can carry valid quotes while strict exact-player matching, completed season/phase history or full Q1 play-by-play is missing. Q1 points/rebounds/assists need actual period attribution and completeness. Do not fill missing historical samples with full-game values. Current exact-line history selects one observed prior season/phase but does not independently verify it matches the target phase; this needs target provenance before claiming matchup applicability.
6. **Model/card distinction:** broad receipts are research-only by design. Valid quotes do not ensure qualified picks. Standard model candidates still read legacy quote caches, not the new broad receipt store; a broad-only acquisition can populate research cards without repopulating the old model candidate pool. Any bridge must be restricted to existing supported canonical markets and preserve model gates. This is separate from raising the budget.
7. **Observability and access:** durable KV, fresh provider-balance observation, enabled existing acquisition authorization and permitted commercial data use are prerequisites. Current partial/missing-market metadata must surface the actual budget/refresh reason, not imply all requested markets were researched.

These are activation prerequisites/remaining work, not fixes claimed complete in this proposal phase.

## Offline Verification

- Real guard regression: a nested 52-credit request under the current automatic 50-credit scope is rejected before the provider operation, fetch or ledger spend.
- Standalone authorization and daily reservation also reject 52; generic environment 64 fails closed.
- Mocked acquisition sends all 26 contracts across US/US2 without truncation and asks for a 52-credit reservation. Its authorization helpers are mocked; it is NOT evidence that current real guards permit 52.
- A fresh full receipt satisfies a repeated/subset request without a second mocked provider fetch.
- Real chat POST/runner with mocked Finder preserves all 26 selected IDs in acquisition and response metadata. Available cards render; missing markets remain explicit partial coverage. Existing saved-receipt tests separately replay all 5,991 outcomes through the research card loader with null predictions/EV.

## Safest Activation Plan

1. Approve the NBA-only 64-credit code policy separately from any paid call. Implement and review the trusted outer-scope propagation and daily reservation cap while leaving current production env/settings untouched. Add real-guard tests for 52 allowed under proposed NBA scope, 65 rejected, other sports still 50, daily/reserve/rate/storage failures, exact allowlist, concurrency and nested non-escalation. The current tests prove the existing 50-credit blocker; proposed-64 acceptance is not implemented yet.
2. Finish cache-aware whole-request preflight, per-market cache freshness/merging, post-lock recheck and explicit per-event/per-market block reasons. Verify the full UI request and repeated/concurrent requests offline against the saved receipt. Keep research-only separation.
3. Stage using mocked/cached responses and the proposed NBA setting. No production setting changes or paid calls. Verify auth and durable storage fail closed.
4. Obtain separate approval for production configuration/deployment and a single-game live canary. Set only the new NBA variable to 64 after its code exists; keep generic50/daily300/reserve2000/rate10 and all existing auth gates. A 26-market US/US2 canary reserves at most 52 credits (53 only if one discovery is expressly included). No recurring job is enabled by that approval.
5. Run one authorized game, inspect provider charge, ledger reserved/actual values, card coverage and research-only states. Repeat within quote freshness and confirm zero new quote spend. Then decide separately on multi-game/slate budgets from observed demand; do not assume 64 solves a full slate.
6. Roll back by setting the new NBA limit to 50 or disabling the NBA-specific feature. Keep cache-only reads and the durable ledger intact; do not erase spending history or relax provider protection.