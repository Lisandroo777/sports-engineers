# DeepSide Production Release Candidate

Target: https://sports-engineers.vercel.app/ai
Vercel team/project: deepside / sports-engineers.
Repository/production branch: Lisandroo777/sports-engineers / main.
Base commit: 608016412c1ca2c7c059385307be771381989f42.
This release is prepared locally only. No push or deployment is authorized.
The proposed commit SHA is reported after the local commit is created; this
document is part of that commit and cannot include its own hash.

## Completed Frontend Handoff

The AI page now receives deepside-nba-pick-presentation/1 and renders it in the
existing page layout, colors, typography and responsive grid. Legacy responses,
NFL and MLB keep their existing card path. No sibling worktree was merged or edited.

- NUKE, ELITE, SHARP, EDGE, LEAN and PASS labels are copied from authoritative
  decisions, not recalculated by the frontend.
- Recommendations and researched candidates are separate sections. PASS cannot
  appear in recommended wagers even if an incorrect selected ID is supplied.
- Unpriced/stale records have explicit research-only labels and no displayed
  unsupported probability, EV or score. Available values are copied without boosts.
- Preseason, unknown and unverified phases remain research-only at the display
  boundary, even with an invalid upstream selected tier. Source tiers are not changed.
- Exact player/team names, signed spreads, moneylines and totals, verified book/odds,
  season metadata, source observations, reasons and risks are rendered.
- New search and Clear discard previous presentation records; recommendation counts
  reflect the current payload. Older response formats retain their prior behavior.

Screenshots are local provider-free fixtures under .cache/nba-release-ui, not live
recommendations. All browser API routes were intercepted; no paid provider request
was made. The new browser harness is portable and takes NBA_BROWSER_MODULE when
Playwright is supplied outside repository dependencies.

## NFL Failure Investigation

The previously failing suites are additions absent from the deployed base commit:
lib/nfl/stage2.integration.test.ts and lib/nfl/availability.stage2.test.ts.
All 45 checked protected NFL/Finder/tier/probability runtime files are byte-identical
to the archived V1.1 baseline. No new NFL formula or eligibility change was made.

The sixteen integration failures were caused by fixture kickoffs fixed at
2026-10-11T17:00:00Z being compared with the moving machine clock. Once that time
passed, correct production logic marked those games STARTED instead of PREGAME.
The suite now pins 2026-10-11T15:00:00Z, before the final ninety-minute GAME_DAY
window. A clock at 16:00 resolved fifteen failures but correctly left roster-only
participation UNKNOWN inside that window; the test expects earlier pregame evidence.

The two availability failures were caused by October 4 report fixtures being
evaluated at the current clock rather than their stated observation time. That
suite now pins 2026-10-04T12:00:00Z. Its explicit expired-report and failed-retrieval
assertions remain unchanged and pass.

Only fake-clock setup and cleanup were added/changed. No expectation was removed,
loosened or skipped. All 29 tests in those suites pass. This is deterministic test
isolation of baseline behavior, not a release-time relaxation of freshness, minutes,
participation, injury or game-start safeguards.

## Included Source Scope

The reviewed commit includes the completed NBA backend, presentation contracts and
frontend receiver; exact cache/quote identity and freshness handling; shared AI
runner/session/tool integration; and the explicit paid-refresh guard.

It also includes the existing protected NFL hardening, communication, storage and
receipt/performance dependencies imported by the selected shared AI/page code.
They were already present locally and are preserved rather than dropping existing
features or refactoring formulas. The deployed base lacks these modules, so copying
only lib/nba would not produce the verified application. Corresponding tests and
the immutable NFL archive/validation tools are included for reproducible checks.

The selection is explicit, not git add . or a branch/worktree merge. Unrelated
historical research reports, generated .next/.vitest outputs, credentials, local
cache receipts and the already-consumed live purchase command are not release data.
Excluded existing work remains on disk without modification or deletion.

## Validation

- TypeScript and production build pass.
- Both previously failing NFL suites: 29 passed, with original assertions intact.
- New card render tests cover all six tiers, PASS separation, stale/unpriced values,
  unsupported phases, upstream order and empty states.
- Provider-free browser checks pass at 1440x1000 and 390x844, including card labels,
  signed lines, source evidence, clearing, legacy responses and no horizontal overflow.
- Full local regression suite was green after fixture-clock isolation; final counts
  are 1319 passed and 10 opt-in/cache-dependent checks skipped, zero failures.
- The exact staged source was exported into a separate directory without .env or
  development cache. It passed 1281 tests with 27 cache-dependent/opt-in checks
  skipped, TypeScript and protected-model verification. Its production webpack
  build passed; Turbopack's first isolated attempt rejected the out-of-root shared
  node_modules symlink before compilation. The normal main-workspace Turbopack
  build also passed. No dependency installation or new service was needed.
- Two conversational tests previously read an ignored local replay cache at module
  load. They now use a portable, explicitly synthetic seven-candidate fixture pool.
  Their 90 original assertions pass unchanged. The fixture is test-only and is not
  live evidence, model performance or an invented production recommendation.
- The staged-build browser check passed at desktop/mobile widths with every API
  request intercepted. It verifies all six tiers, PASS separation, source values,
  empty/research-only/stale states, resets and legacy/cross-sport fallback.
- Protected hardened archive identity remains
  746b2389e75594f8ceaed94dc3afe936d864d41e7167097f0603081196b0cf16.
- Existing build warnings are four broad cache-file tracing warnings. The AI page
  retains existing unused-symbol lint warnings; no new lint errors were introduced.
- The reviewed index has 299 explicitly selected files, including tests and the
  archived NFL verification records; a credential-value scan found zero configured
  secrets and zero generated/cache paths. No pre-existing staged changes existed.

## Paid API Safety And Evidence Limits

The active explicit request/credit scope is still required for paid refreshes.
Default searches cannot gain paid authorization just by refreshing or changing
wording. Budget reservation, duplicate-request, failed-attempt and closed-scope
tests remain part of the release checks.

The prior approved event request completed on October 9 for six credits, within
the seven-credit ceiling. The receipt reported 17727 remaining then, not a newly
queried balance. It is not repeated; its prices have expired under the quote policy.
This release makes zero new paid requests and does not fabricate current prices.

Real official reports, confirmed lineups, sufficient supported-phase history and
current quotes are still external inputs. Missing evidence produces research-only
or PASS records. Preseason remains unsupported by preserved model formulas.
No guarantee of qualified picks is made merely because the UI and release compile.

## Production Hold

Do not push main: the repository is connected to two Vercel projects and a push
may deploy automatically. Wait for approval of the exact proposed SHA and target.
No Vercel environment or production alias has been changed.

Before production promotion, review existing hosting environment/credentials and
persistent archive/KV access without enabling paid refresh. Vercel ephemeral disk
does not itself supply a durable intelligence archive. Preview/public production
verification must use actual deployed UI and cache-only searches after approval.
No new subscription, recurring service or paid data refresh is implied by this commit.