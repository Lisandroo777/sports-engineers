# NFL Ledger Production Readiness

## Approved Release Update

The owner approved publication, deployment and receipt-secret provisioning. A fresh 32-byte cryptographic signing secret was generated in memory and submitted directly to Vercel as a sensitive Production variable, without printing or storing its value. Redis credentials were not changed. Automatic paid refresh remains disabled.

The release includes an opt-in build diagnostic (`DEEPSIDE_VERIFY_LEDGER=true`) exercising real signing, tamper rejection, capture, durable read-back and duplicate prevention. A process-local loader substitutes a random diagnostic prefix for the ledger repository only during this probe; runtime source and the normal forward ledger prefix are unchanged. Diagnostic records and indexes are removed and verified absent in a finally block. No synthetic record enters the public performance denominator.

Grading has an explicit regression proving unfinished games remain PENDING without fetching player stats. Existing repeated-final grading and correction tests verify idempotent, auditable revisions; outcome/ROI/push/calibration checks use isolated fixtures.

Scheduler options (not enabled):

- Manual/operator invocation of the existing authenticated POST grade endpoint: no scheduler service charge, but requires approval to configure `NFL_LEDGER_GRADE_SECRET` and operational invocation. Existing normal function/Redis usage applies.
- Vercel Hobby daily cron, for example 10:00 UTC after typical NFL overnight finals: cron is included, each job may run once per day with up to 59 minutes scheduling variance. It needs a GET cron adapter and a separately approved `CRON_SECRET`; the existing POST route cannot be scheduled directly. Normal function/Redis limits apply. Unfinished games are deferred until a later run, not guessed.
- More frequent grading: Vercel Pro supports more frequent cron (paid plan upgrade), or an external scheduler may POST to the existing route with an approved grading token. External pricing depends on provider. No upgrade, additional secret or external scheduler is authorized/enabled by this release.

Sources: https://vercel.com/docs/cron-jobs/usage-and-pricing and https://vercel.com/docs/cron-jobs/manage-cron-jobs .

## Local Fixes

- NFL player search filters broad ESPN name hits before requesting athlete profiles. Matching unavailable profiles are omitted; missing identity details/statistics are not invented. The known IDs 42164, 385060 and 4084083 were rechecked and still return HTTP 404 from the athlete-detail endpoint. Their exact provider-side cause is unknown; filtering cannot restore a genuinely missing profile.
- Browser ledger acknowledgement retries network errors, HTTP 429 and HTTP 5xx once, with the same signed payload and a timeout. Invalid/expired receipts are not retried. Persistent failure remains visible and clears the acknowledgement marker. No odds or research requests are retried by this helper.
- Tests cover all 15 permitted returned recommendations, repeated acknowledgement deduplication, authoritative grading into ROI/calibration reports, and unavailable player profiles. Existing ranking, probabilities, edges, qualification and credit limits are unchanged.

## Recording Contract And Limits

The ledger captures browser-acknowledged, signed, displayed recommendations, not every researched candidate or every completed API response. Full research sessions retain the candidate pool separately. Capturing unshown or rejected research as published picks would change the forward-performance denominator and is not enabled.

Successful signed capture records immutable prediction snapshots and deduplicates exact market/line/book/price fingerprints. Grading uses final source statistics, preserves corrections as revisions, treats missing stats as ungradable rather than zero, and keeps invalid/post-kickoff records out of forward metrics. Reports include wins, losses, pushes, units, flat-unit ROI and model probability calibration. These are recommendation-level model metrics, not an account's realized wager ROI.

A closed browser, exhausted network retries, expired receipt, or missing signing secret can still prevent capture. The current acknowledgement design cannot guarantee that every completed qualifying API response is durably recorded. Strict server-side completed-response auditing would be a separate contract/change; it must not silently relabel unseen results as displayed picks. This release improves acknowledgement reliability without making that claim.

## Approval Required

1. Configure `NFL_LEDGER_RECEIPT_SECRET` in Production. After explicit approval, generate 32 cryptographically random bytes in memory, encode as base64url, and send directly to the authorized Vercel environment API as a sensitive production variable. Do not print, persist to a temporary file, commit, or reuse Redis credentials. Do not replace an already configured value without checking metadata first. Secret generation/upload must not place the value in command-line arguments or logs.
2. Approve deployment of the local fixes and secret configuration, then verify signed receipt issuance and real browser capture using existing cached research if still current; do not fabricate or backdate the earlier untracked test as a forward-published prediction.
3. Authorize/configure grading execution. The code exposes an authenticated POST `/api/nfl/ledger/grade`, protected by `NFL_LEDGER_GRADE_SECRET`; no scheduler is configured in this checkout. A signing secret alone does not schedule settlement. Verify grade/view/session authentication configuration before creating any additional secrets. A scheduler or operator must invoke grading after games finish and revisit source corrections. Do not infer outcomes before final source statistics exist.
4. Separately approve public automatic paid activation and any fresh paid validation. Preserve `ODDS_AUTO_REFRESH=true`, `ODDS_REFRESH_MAX_SEARCH_CREDITS=50`, `ODDS_REFRESH_MAX_DAILY_CREDITS=300`, and `ODDS_REFRESH_MIN_REMAINING=2000`. Shared durable reservations and fresh provider balance observations remain required. Automatic paid research stays disabled until approved.

## Validation

221 tests passed across 18 files spanning ledger capture/deduplication, acknowledgement, grading, ROI/calibration, player availability, routing, qualification, card contracts and paid-safety controls. TypeScript and whitespace checks passed. ESLint had zero errors and six existing unused-symbol warnings in the AI page.

Structured ranked pick-card contracts remain covered by tests. No new live research was performed during this readiness work; the preceding nine-credit test and desktop/mobile response replay remain the latest live evidence. No commit, push, deployment, production secret change or paid activation was performed in this readiness task.