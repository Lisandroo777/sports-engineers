# NBA70 Research Reliability Implementation

Status: local code implementation, not a deployed/live claim. No paid API calls, production environment changes, credential edits, push, merge or deployment were performed.

## Policy In Code

| Scope/protection | Effective code policy |
| --- | --- |
| Trusted NBA search | 70 credits cumulative across all games/requests |
| Other sports and cross-sport parent scopes | Existing 50-credit cumulative limit |
| Shared durable daily ledger | 300 credits, unchanged |
| Provider balance floor | At least 2000, unchanged |
| Account rate | Existing configured rate, default 10 requests/minute |

`getOddsRefreshLimits('nba')` accepts the new optional `ODDS_REFRESH_MAX_NBA_SEARCH_CREDITS` integer override in 1-70, default 70. Generic `ODDS_REFRESH_MAX_SEARCH_CREDITS` remains bounded at 50. No environment file or production variable was changed. Existing disabled automatic/paid/cache-only gates remain disabled. Deploying the code into an environment where acquisition is already enabled would make the code default effective; deployment therefore still requires separate approval.

The server-resolved outermost single-sport NBA runner selects the NBA authorization scope. The one-run validator, cumulative request reservation and shared daily reservation all use the same trusted policy. Nested calls reuse the parent and cannot increase its limits. NBA authorization only funds basketball_nba endpoints and verified US/US2 market requests. Browser budget fields do not grant spending authority. Cross-sport parents retain the stricter shared policy rather than minting a new budget for each child.

## Market Cache And Deduplication

- Coverage is checked independently for each selected verified market. A fresh Points quote cannot hide stale Rebounds or missing Assists.
- Full-game research quote freshness is five minutes; Q1 quote freshness is two minutes. Timestamps must be finite, no later than their receipt observation, and tied to the exact event/teams/tipoff. A recent explicit provider response with no prices is cached as NOT_POSTED for one minute to prevent immediate repeated repurchases.
- Missing/stale markets alone are requested. Full receipts satisfy fresh subset searches without new quote acquisition. Requested market metadata never substitutes for contract-valid current prices.
- Receipts merge by exact source market, preserving per-market observation timestamps and all book/line/side/odds fields. A refreshed absent market removes its old quotes rather than presenting them as current. Older market observations cannot overwrite newer ones.
- The bounded request helper checks cache before locking, rechecks after locking before any credit reservation, and lets concurrent losers wait briefly for the winning receipt. The winning operation persists its receipt while holding the event lock. Overlapping requests recompute outstanding markets under that lock, avoiding repurchase of already filled markets. Wait timeout yields an explicit in-progress error, not a duplicate paid call.
- Durable storage/authorization/unknown-balance failures fail closed. Unknown provider outcomes retain the existing bounded lock and conservative daily reservation semantics; no automatic uncertain-cost retries were introduced. Storage writes are read back before success is reported.

## Multi-Game Preflight And Reporting

Every selected game is inspected before acquisition. The plan records all selected verified markets, individual cache state, missing/stale refresh list and worst-case region-adjusted cost. It allocates against the one remaining search allowance, not a new allowance per game.

- One full uncached game: 26 x 2 = 52 credits; within 70.
- Two full uncached games: 104 total; first can be planned at 52, second is explicitly BUDGET_BLOCKED. Existing valid cache for either game remains available. No market IDs are silently truncated.
- Multiple narrower selected scopes or cached games can fit. Seven five-market two-region acquisitions total exactly 70 and pass; an eighth is blocked. Multiple wholly fresh cached games require zero quote credits.
- Preflight is an estimate; the real shared ledger, search reservation, lock, balance floor and rate limit remain authoritative for concurrent requests and daily usage. Conservative reserved cost counts toward daily allowance even if actual provider charge is lower, unchanged from the existing ledger.

Finder summaries and saved AI session metadata retain the full per-event plan. Post-acquisition state distinguishes FRESH, NOT_POSTED, STALE and MISSING; budget and acquisition error reasons are attached. The existing AI result notice names affected games and markets. Team-only early returns also carry incomplete coverage rather than claiming success. Provider quote availability is separate from historical sample completeness and model publication eligibility.

## Data/Model Boundaries

All 41 filter identities and ranking modes remain. All 26 verified contracts retain sportsbook-backed research-card paths when genuine fresh receipts exist. Exact alternate lines and Q1 identities remain separate from standard/full-game markets. Missing period history remains unavailable; no synthetic quarter statistics are created. Blocks + Steals, Double-Double, Triple-Double and broad receipt cards retain null probability, EV, score and tier unless a separate existing model/publication path actually qualifies a candidate.

Saved live receipt replay now emits 5,989 current outcomes across all 26 markets at the original observation time. The earlier 5,991 count used a one-hour quote-age check; the stricter two-minute Q1 rule correctly removes two stale Q1 outcomes. The historical receipt is never relabeled current at today's runtime.

## Offline Verification Scope

Tests cover trusted NBA70 versus generic50, exactly70 cumulative spend, 71 rejection, cross-sport/parent containment, shared daily/provider/storage/rate failures, full26 one-game planning and real-receipt cards, multiple games, over-budget incomplete reporting, individual stale/missing markets, negative cache, disjoint merges, cached subset reuse, post-lock no-reservation reuse and simultaneous requests executing one provider operation. Existing 41-filter, ranking, exact alternate/Q1, historical and publication regressions remain part of verification. No paid provider endpoints are used in tests.

## Remaining Problems And Phone Activation

1. Code is not pushed or deployed. A phone visiting the deployed app cannot exercise these local changes yet; localhost on a developer machine is also not a public deployment.
2. Fresh live receipts and an authorized, durable production storage/ledger are still required. No new live data was purchased during implementation. The new policy does not create lines or repair missing provider posting.
3. The ten unverified contracts still need provider confirmation or a licensed alternative quote/data contract: FGA, 3PA, 2PM, defensive rebounds, offensive rebounds, personal fouls, dunks and individual Q2/Q3/Q4 points. FGM, FT made/attempted, turnovers and fantasy were documented but not observed in the live probe; existing conditional cached paths remain, while verified-only acquisition does not silently promise these quotes. Fantasy additionally requires platform scoring/payout rules.
4. Exact historical evidence can remain unavailable because of player identity, known season/phase, finality or incomplete Q1 PBP. Period applicability to a target season/phase still needs independently verified target metadata before any stronger forecast claim; existing descriptive sample labels are not a validated probability model.
5. Broad receipt cards are intentionally research-only. The legacy standard-model candidate cache is separate, so broad-only quote ingestion can return research cards without creating qualified picks. Bridging those caches needs a separately tested supported-market adapter; model thresholds must not be weakened to compensate.
6. This is offline readiness evidence, not proof of live phone reliability, provider entitlements or commercial data-use rights. A separately approved staged deployment and real authenticated browser request are required before calling it live.

Safest activation: review local diff and offline results; explicitly approve deployment/configuration; verify durable KV, current balance observation and existing authorization flags; authorize one single-game canary (52 worst-case quote credits), inspect ledger and all selected-market coverage, then repeat within freshness to confirm zero additional quote purchase. Multi-game canaries must disclose the shared70 plan. Do not enable recurring jobs or alter daily300/reserve2000/rate limits as a side effect.